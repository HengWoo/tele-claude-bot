import "dotenv/config";
import { initializeBot, startBot, stopBot } from "./bot.js";
import { getConfig } from "./config.js";
import { createSessionManager } from "./sessions/manager.js";
import { approvalQueue } from "./claude/bridge.js";
import { createChildLogger } from "./utils/logger.js";
import type { Session } from "./types.js";
import { getTmuxBridge } from "./tmux/bridge.js";

const logger = createChildLogger("main");

// Graceful shutdown handling
let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, "Received shutdown signal");

  try {
    // Stop the bot
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
  logger.info("Starting Telegram Claude Bot...");

  try {
    // Load and validate config
    const config = getConfig();
    logger.info(
      {
        allowedUsers: config.telegram.allowedUsers,
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

    // Initialize and start bot (pass real sessionManager for command registration)
    initializeBot(sessionManagerAdapter, claudeBridgeAdapter, sessionManager);
    await startBot();

    logger.info("Bot is running. Press Ctrl+C to stop.");
  } catch (error) {
    logger.error({ error: (error as Error).message, stack: (error as Error).stack }, "Failed to start bot");
    process.exit(1);
  }
}

// Run
main();
