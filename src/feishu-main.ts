/**
 * Feishu-specific entry point
 *
 * This is the recommended way to run the Feishu bot.
 * It uses a platform-specific tmux bridge with isolated state.
 */
import "dotenv/config";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getConfig } from "./config.js";
import { createSessionManager } from "./sessions/manager.js";
import { createChildLogger } from "./utils/logger.js";
import type { Session } from "./types.js";
import { getTmuxBridge, type Platform } from "./tmux/bridge.js";
import { FeishuAdapter } from "./platforms/feishu/index.js";
import { cleanupStalePendingFiles } from "./approval/index.js";
import { FeishuInteractiveHandler } from "./interactive/index.js";

const logger = createChildLogger("feishu-main");
const PLATFORM: Platform = "feishu";

// Graceful shutdown handling
let isShuttingDown = false;

// Service references for shutdown
let feishuAdapter: FeishuAdapter | null = null;
let interactiveHandler: FeishuInteractiveHandler | null = null;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, "Received shutdown signal");

  try {
    // Stop the interactive handler
    if (interactiveHandler) {
      await interactiveHandler.cleanup();
      logger.info("Interactive handler stopped");
    }

    // Stop the Feishu adapter
    if (feishuAdapter) {
      await feishuAdapter.stop();
      logger.info("Feishu adapter stopped");
    }

    logger.info("Shutdown complete");
    process.exit(0);
  } catch (error) {
    logger.error({ error: (error as Error).message }, "Error during shutdown");
    process.exit(1);
  }
}

// Register signal handlers
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Unhandled rejection handler
process.on("unhandledRejection", (reason, promise) => {
  logger.error({ reason, promise }, "Unhandled rejection");
});

// Uncaught exception handler
process.on("uncaughtException", (error) => {
  logger.error({ error: error.message, stack: error.stack }, "Uncaught exception");
  process.exit(1);
});

/**
 * Claude bridge adapter for Feishu
 * Supports per-user targeting - each user has their own tmux session
 */
function createClaudeBridgeAdapter() {
  const bridge = getTmuxBridge(PLATFORM);

  return {
    async *sendMessage(
      _session: Session,
      message: string,
      userId: string,
      chatId?: number,
      messageId?: number
    ): AsyncGenerator<string> {
      if (!bridge.isAttached(userId)) {
        yield "Not attached to any tmux pane.\n\nUse /attach <target> to connect to a Claude session.";
        return;
      }

      try {
        const config = getConfig();
        logger.info({ userId, message: message.slice(0, 100) }, "Sending message via tmux bridge");

        const response = await bridge.sendMessage(
          message,
          userId,
          chatId ?? 0,
          messageId ?? 0,
          config.claude.timeout
        );

        yield response;
      } catch (error) {
        const err = error as Error;
        logger.error({ error: err.message }, "tmux bridge error");
        yield `Error: ${err.message}`;
      }
    },

    isSessionActive(_session: Session, userId: string): boolean {
      return bridge.isAttached(userId);
    },

    bridge,
  };
}

/**
 * Session manager adapter for Feishu
 */
function createSessionManagerAdapter(manager: ReturnType<typeof createSessionManager>) {
  const userActiveSessions = new Map<string, string>();

  return {
    getActiveSession(userId: string): Session | null {
      const sessionName = userActiveSessions.get(userId);
      if (!sessionName) return null;
      return manager.get(sessionName) ?? null;
    },

    createSession(userId: string, name: string, workspace?: string): Session {
      const config = getConfig();
      const session: Session = {
        id: crypto.randomUUID(),
        name,
        workspace: workspace ?? config.claude.defaultWorkspace,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        approveAll: false,
        attached: false,
        notifyLevel: config.notifications.defaultLevel,
      };

      manager.create({ name, workspace: session.workspace }).catch((err) => {
        logger.error({ error: err.message }, "Failed to persist session");
      });

      userActiveSessions.set(userId, name);
      return session;
    },

    setActiveSession(userId: string, sessionId: string): void {
      const sessions = manager.list();
      const session = sessions.find((s) => s.id === sessionId);
      if (session) {
        userActiveSessions.set(userId, session.name);
      }
    },
  };
}

/**
 * Set up Feishu message handlers
 */
function setupFeishuHandlers(
  adapter: FeishuAdapter,
  sessionManager: ReturnType<typeof createSessionManagerAdapter>,
  claudeBridge: ReturnType<typeof createClaudeBridgeAdapter>
): void {
  // Handle regular messages
  adapter.onMessage(async (event) => {
    const userId = event.message.from.id;
    const text = event.message.text || "";
    const chatId = event.message.chat.id;

    if (!text.trim()) return;

    // Check if this is a response to an "Other" prompt (custom text input)
    if (interactiveHandler?.isAwaitingTextInput(userId)) {
      const handled = await interactiveHandler.handleTextInput(userId, text);
      if (handled) {
        logger.info({ userId }, "Handled custom text input for interactive prompt");
        return;
      }
    }

    logger.info({ userId, messageLength: text.length, platform: PLATFORM }, "Processing Feishu message");

    try {
      // Get or create session
      let session = sessionManager.getActiveSession(userId);
      if (!session) {
        const config = getConfig();
        session = sessionManager.createSession(userId, "default", config.claude.defaultWorkspace);
        sessionManager.setActiveSession(userId, session.id);
      }

      session.lastUsed = Date.now();

      // Check if this user has an attached tmux pane
      if (!claudeBridge.isSessionActive(session, userId)) {
        await adapter.sendMessage(chatId, "Not attached to any tmux pane.\n\nUse /attach <target> to connect to a Claude session.");
        return;
      }

      // Send initial "thinking" message
      const initialMsg = await adapter.sendMessage(chatId, "...");

      // Get response from Claude (pass userId for per-user targeting)
      let fullResponse = "";
      for await (const chunk of claudeBridge.sendMessage(session, text, userId)) {
        fullResponse += chunk;
      }

      // Update with final response (fallback to new message if edit fails)
      if (fullResponse.trim()) {
        try {
          await adapter.editMessage(chatId, initialMsg.id, fullResponse);
        } catch (editError) {
          logger.warn(
            { messageId: initialMsg.id, error: (editError as Error).message },
            "Failed to edit message, sending as new message"
          );
          await adapter.sendMessage(chatId, fullResponse);
          try {
            await adapter.deleteMessage(chatId, initialMsg.id);
          } catch (deleteError) {
            logger.debug(
              { messageId: initialMsg.id, error: (deleteError as Error).message },
              "Best-effort cleanup: failed to delete placeholder message"
            );
          }
        }
      }
    } catch (error) {
      const err = error as Error;
      logger.error({ error: err.message, platform: PLATFORM }, "Failed to process Feishu message");
      await adapter.sendMessage(chatId, `Error: ${err.message}`);
    }
  });

  // Register basic commands
  adapter.onCommand("start", async (event) => {
    await adapter.sendMessage(
      event.message.chat.id,
      "Welcome to Claude Bot!\n\n" +
      "I'm a bridge to Claude Code. Send me any message and I'll forward it to Claude.\n\n" +
      "Commands:\n" +
      "/start - Show this message\n" +
      "/help - Show help\n" +
      "/status - Show current status\n" +
      "/attach <target> - Attach to tmux pane\n" +
      "/detach - Detach from current pane"
    );
  });

  adapter.onCommand("help", async (event) => {
    await adapter.sendMessage(
      event.message.chat.id,
      "Claude Bot Help\n\n" +
      "Just send me any text message and I'll forward it to Claude.\n\n" +
      "tmux Commands:\n" +
      "/attach <target> - Attach to a tmux pane (e.g., /attach 1:0.0)\n" +
      "/detach - Detach from current pane\n" +
      "/status - Show current connection status"
    );
  });

  adapter.onCommand("status", async (event) => {
    const userId = event.message.from.id;
    const bridge = getTmuxBridge(PLATFORM);
    const attachedTarget = bridge.getAttachedTarget(userId);
    const hasPending = bridge.hasPendingRequest(userId);

    let message = "Status:\n\n";
    if (attachedTarget) {
      message += `tmux Target: ${attachedTarget}\n`;
      message += `Status: ${hasPending ? "Processing request..." : "Ready"}`;
    } else {
      message += "tmux Target: Not attached\n";
      message += "Use /attach <target> to connect to a Claude pane";
    }

    await adapter.sendMessage(event.message.chat.id, message);
  });

  adapter.onCommand("attach", async (event) => {
    const userId = event.message.from.id;
    const target = event.command.rawArgs.trim();
    if (!target) {
      await adapter.sendMessage(
        event.message.chat.id,
        "Usage: /attach <target>\n\nTarget format: session:window.pane\nExample: /attach 1:0.0"
      );
      return;
    }

    const bridge = getTmuxBridge(PLATFORM);
    try {
      await bridge.attach(target, userId);
      await adapter.sendMessage(
        event.message.chat.id,
        `Attached to tmux pane: ${target}\n\nYou can now send messages to Claude.`
      );
    } catch (error) {
      const err = error as Error;
      await adapter.sendMessage(event.message.chat.id, `Failed to attach: ${err.message}`);
    }
  });

  adapter.onCommand("detach", async (event) => {
    const userId = event.message.from.id;
    const bridge = getTmuxBridge(PLATFORM);
    const currentTarget = bridge.getAttachedTarget(userId);

    if (!currentTarget) {
      await adapter.sendMessage(event.message.chat.id, "Not currently attached to any tmux pane.");
      return;
    }

    bridge.detach(userId);
    await adapter.sendMessage(event.message.chat.id, `Detached from tmux pane: ${currentTarget}`);
  });

  logger.info("Feishu handlers registered");
}

/**
 * Main entry point for Feishu bot
 */
async function main(): Promise<void> {
  logger.info("Starting Claude Bot (Feishu)...");

  try {
    // Load and validate config
    const config = getConfig();

    if (!config.feishu?.enabled) {
      logger.error("Feishu is not enabled in config. Set FEISHU_ENABLED=true in .env");
      process.exit(1);
    }

    // Clean up stale pending files from crashed sessions (older than 10 minutes)
    const stalePendingRemoved = cleanupStalePendingFiles(PLATFORM, 10 * 60 * 1000);
    if (stalePendingRemoved > 0) {
      logger.info({ count: stalePendingRemoved }, "Cleaned up stale pending files on startup");
    }

    logger.info(
      {
        platform: PLATFORM,
        webhookPort: config.feishu.webhookPort,
        allowedUsers: config.feishu.allowedUsers,
        defaultWorkspace: config.claude.defaultWorkspace,
      },
      "Configuration loaded"
    );

    // Ensure data directory exists
    const sessionsPath = "./data/feishu-sessions.json";
    const dir = dirname(sessionsPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Initialize session manager with Feishu-specific path
    const sessionManager = createSessionManager(sessionsPath);
    await sessionManager.initialize();
    logger.info({ sessionCount: sessionManager.count }, "Session manager initialized");

    // Create adapters
    const sessionManagerAdapter = createSessionManagerAdapter(sessionManager);
    const claudeBridgeAdapter = createClaudeBridgeAdapter();

    // Start Feishu adapter
    feishuAdapter = new FeishuAdapter(config.feishu);

    // Initialize interactive handler for AskUserQuestion prompts
    interactiveHandler = new FeishuInteractiveHandler(feishuAdapter);

    // Register interactive callback on tmux bridge
    const bridge = getTmuxBridge(PLATFORM);
    bridge.setInteractiveCallback(async (prompt, userId, paneId, target, chatId) => {
      if (!interactiveHandler) return null;
      // Feishu uses string chat IDs
      return interactiveHandler.showPrompt(prompt, userId, paneId, target, String(chatId));
    });
    logger.info("Interactive prompt handler initialized");

    // Register Feishu message handlers
    setupFeishuHandlers(feishuAdapter, sessionManagerAdapter, claudeBridgeAdapter);

    await feishuAdapter.start();

    logger.info({ port: config.feishu.webhookPort }, "Feishu bot is running. Press Ctrl+C to stop.");
  } catch (error) {
    logger.error({ error: (error as Error).message, stack: (error as Error).stack }, "Failed to start bot");
    process.exit(1);
  }
}

// Run
main();
