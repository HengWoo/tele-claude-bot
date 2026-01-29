import "dotenv/config";
import { initializeBot, startBot, stopBot, bot } from "./bot.js";
import { getConfig } from "./config.js";
import { createSessionManager } from "./sessions/manager.js";
import { approvalQueue } from "./claude/bridge.js";
import { createChildLogger } from "./utils/logger.js";
import type { Session } from "./types.js";
import { getTmuxBridge } from "./tmux/bridge.js";
import { ApprovalService, cleanupStalePendingFiles, VetoWatcher } from "./approval/index.js";
import { Scheduler } from "./scheduler/index.js";
import { registerScheduleCommands } from "./handlers/schedule.js";
import { setApprovalHandler, registerCallbackHandlers } from "./handlers/callbacks.js";
import { FeishuAdapter } from "./platforms/feishu/index.js";

const logger = createChildLogger("main");

// Graceful shutdown handling
let isShuttingDown = false;

// Service references for shutdown
let approvalService: ApprovalService | null = null;
let vetoWatcher: VetoWatcher | null = null;
let scheduler: Scheduler | null = null;
let feishuAdapter: FeishuAdapter | null = null;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, "Received shutdown signal");

  try {
    // Stop the scheduler
    if (scheduler) {
      scheduler.stop();
      logger.info("Scheduler stopped");
    }

    // Stop the approval service
    if (approvalService) {
      await approvalService.stop();
      logger.info("Approval service stopped");
    }

    // Stop the veto watcher
    if (vetoWatcher) {
      await vetoWatcher.stop();
      logger.info("Veto watcher stopped");
    }

    // Stop the Feishu adapter
    if (feishuAdapter) {
      await feishuAdapter.stop();
      logger.info("Feishu adapter stopped");
    }

    // Stop the Telegram bot
    await stopBot();

    // Clear any pending approvals
    approvalQueue.clear();

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
 * Claude bridge adapter that implements the ClaudeBridge interface
 * expected by the message handler.
 *
 * This adapter uses the tmux bridge to inject messages into existing
 * Claude Code sessions running in tmux panes.
 */
function createClaudeBridgeAdapter() {
  const bridge = getTmuxBridge();

  return {
    async *sendMessage(
      _session: Session,
      message: string,
      chatId?: number,
      messageId?: number
    ): AsyncGenerator<string> {
      if (!bridge.isAttached()) {
        yield "Not attached to any tmux pane.\n\nUse /attach <target> to connect to a Claude session.\nUse /panes to see available Claude panes.";
        return;
      }

      try {
        const config = getConfig();
        logger.info({ message: message.slice(0, 100) }, "Sending message via tmux bridge");

        const response = await bridge.sendMessage(
          message,
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

    isSessionActive(_session: Session): boolean {
      return bridge.isAttached();
    },

    // Expose the bridge for direct access if needed
    bridge,
  };
}

/**
 * Session manager adapter that implements the SessionManager interface
 * expected by the message handler
 */
function createSessionManagerAdapter(manager: ReturnType<typeof createSessionManager>) {
  // Map user IDs to their active session names
  const userActiveSessions = new Map<number, string>();

  return {
    getActiveSession(userId: number): Session | null {
      const sessionName = userActiveSessions.get(userId);
      if (!sessionName) return null;
      return manager.get(sessionName) ?? null;
    },

    createSession(userId: number, name: string, workspace?: string): Session {
      const config = getConfig();
      // This is synchronous but returns a promise, we need to handle it
      // For simplicity, we'll create synchronously here
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

      // Store in manager (this needs the async create method)
      // For now, we'll use a workaround
      manager.create({ name, workspace: session.workspace }).catch((err) => {
        logger.error({ error: err.message }, "Failed to persist session");
      });

      userActiveSessions.set(userId, name);
      return session;
    },

    setActiveSession(userId: number, sessionId: string): void {
      // Find session by ID
      const sessions = manager.list();
      const session = sessions.find((s) => s.id === sessionId);
      if (session) {
        userActiveSessions.set(userId, session.name);
      }
    },
  };
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  logger.info("Starting Claude Bot (multi-platform)...");

  try {
    // Clean up stale pending files from crashed sessions (older than 10 minutes)
    const stalePendingRemoved = cleanupStalePendingFiles(10 * 60 * 1000);
    if (stalePendingRemoved > 0) {
      logger.info({ count: stalePendingRemoved }, "Cleaned up stale pending files on startup");
    }

    // Load and validate config
    const config = getConfig();

    const enabledPlatforms: string[] = ["telegram"];
    if (config.feishu?.enabled) {
      enabledPlatforms.push("feishu");
    }

    logger.info(
      {
        platforms: enabledPlatforms,
        telegramUsers: config.telegram.allowedUsers,
        feishuEnabled: config.feishu?.enabled ?? false,
        defaultWorkspace: config.claude.defaultWorkspace,
        model: config.claude.model,
      },
      "Configuration loaded"
    );

    // Initialize session manager
    const sessionManager = createSessionManager(config.sessions.persistPath);
    await sessionManager.initialize();
    logger.info({ sessionCount: sessionManager.count }, "Session manager initialized");

    // Create adapters for the bot
    const sessionManagerAdapter = createSessionManagerAdapter(sessionManager);
    const claudeBridgeAdapter = createClaudeBridgeAdapter();

    // Initialize the scheduler service
    scheduler = new Scheduler();
    scheduler.start();
    logger.info("Scheduler service started");

    // Register schedule commands before initializing the bot
    registerScheduleCommands(bot, scheduler);

    // Register callback handlers (including hook approval callbacks)
    registerCallbackHandlers(bot);

    // Initialize and start bot (pass real sessionManager for command registration)
    initializeBot(sessionManagerAdapter, claudeBridgeAdapter, sessionManager);
    await startBot();

    // Initialize approval service after bot is started (needs chatId from first allowed user)
    const primaryUserId = config.telegram.allowedUsers[0];
    if (primaryUserId) {
      approvalService = new ApprovalService(bot, primaryUserId);
      await approvalService.start();

      // Set the approval handler reference for callback handling
      setApprovalHandler(approvalService.getHandler());

      logger.info({ chatId: primaryUserId }, "Approval service started");

      // Initialize veto watcher for blocked operation notifications
      vetoWatcher = new VetoWatcher(bot, primaryUserId);
      await vetoWatcher.start();
      logger.info({ chatId: primaryUserId }, "Veto watcher started");
    } else {
      logger.warn("No allowed users configured, approval service not started");
    }

    // Start Feishu adapter if enabled
    if (config.feishu?.enabled) {
      logger.info("Starting Feishu adapter...");
      feishuAdapter = new FeishuAdapter(config.feishu);

      // Register Feishu message handlers
      setupFeishuHandlers(feishuAdapter, sessionManagerAdapter, claudeBridgeAdapter);

      await feishuAdapter.start();
      logger.info({ port: config.feishu.webhookPort }, "Feishu adapter started");
    }

    const platformStatus = [
      "Telegram: active",
      config.feishu?.enabled ? `Feishu: active (port ${config.feishu.webhookPort})` : "Feishu: disabled",
    ];
    logger.info({ platforms: platformStatus }, "Bot is running. Press Ctrl+C to stop.");
  } catch (error) {
    logger.error({ error: (error as Error).message, stack: (error as Error).stack }, "Failed to start bot");
    process.exit(1);
  }
}

/**
 * Set up Feishu message handlers to mirror Telegram functionality
 */
function setupFeishuHandlers(
  adapter: FeishuAdapter,
  sessionManager: ReturnType<typeof createSessionManagerAdapter>,
  claudeBridge: ReturnType<typeof createClaudeBridgeAdapter>
): void {
  // Handle regular messages
  adapter.onMessage(async (event) => {
    const userId = parseInt(event.message.from.id, 10) || 0;
    const text = event.message.text || "";
    const chatId = event.message.chat.id;

    if (!text.trim()) return;

    logger.info({ userId, messageLength: text.length, platform: "feishu" }, "Processing Feishu message");

    try {
      // Get or create session
      let session = sessionManager.getActiveSession(userId);
      if (!session) {
        const config = getConfig();
        session = sessionManager.createSession(userId, "default", config.claude.defaultWorkspace);
        sessionManager.setActiveSession(userId, session.id);
      }

      session.lastUsed = Date.now();

      // Check if Claude is attached
      if (!claudeBridge.isSessionActive(session)) {
        await adapter.sendMessage(chatId, "Not attached to any tmux pane.\n\nUse /attach <target> to connect to a Claude session.");
        return;
      }

      // Send initial "thinking" message
      const initialMsg = await adapter.sendMessage(chatId, "...");

      // Get response from Claude
      let fullResponse = "";
      for await (const chunk of claudeBridge.sendMessage(session, text)) {
        fullResponse += chunk;
      }

      // Update with final response
      if (fullResponse.trim()) {
        await adapter.editMessage(chatId, initialMsg.id, fullResponse);
      }
    } catch (error) {
      const err = error as Error;
      logger.error({ error: err.message, platform: "feishu" }, "Failed to process Feishu message");
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
    const bridge = getTmuxBridge();
    const attachedTarget = bridge.getAttachedTarget();
    const hasPending = bridge.hasPendingRequest();

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
    const target = event.command.rawArgs.trim();
    if (!target) {
      await adapter.sendMessage(
        event.message.chat.id,
        "Usage: /attach <target>\n\nTarget format: session:window.pane\nExample: /attach 1:0.0"
      );
      return;
    }

    const bridge = getTmuxBridge();
    try {
      await bridge.attach(target);
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
    const bridge = getTmuxBridge();
    const currentTarget = bridge.getAttachedTarget();

    if (!currentTarget) {
      await adapter.sendMessage(event.message.chat.id, "Not currently attached to any tmux pane.");
      return;
    }

    bridge.detach();
    await adapter.sendMessage(event.message.chat.id, `Detached from tmux pane: ${currentTarget}`);
  });

  logger.info("Feishu handlers registered");
}

// Run
main();
