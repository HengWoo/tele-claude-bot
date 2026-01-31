/**
 * Telegram-specific entry point
 *
 * This is the recommended way to run the Telegram bot.
 * It uses a platform-specific tmux bridge with isolated state.
 */
import "dotenv/config";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { initializeBot, startBot, stopBot, bot, setTextInterceptor } from "./bot.js";
import { getConfig } from "./config.js";
import { createSessionManager } from "./sessions/manager.js";
import { approvalQueue } from "./claude/bridge.js";
import { createChildLogger } from "./utils/logger.js";
import type { Session } from "./types.js";
import { getTmuxBridge, type Platform } from "./tmux/bridge.js";
import { ApprovalService, cleanupStalePendingFiles, VetoWatcher } from "./approval/index.js";
import { Scheduler } from "./scheduler/index.js";
import { registerScheduleCommands } from "./handlers/schedule.js";
import { setApprovalHandler, registerCallbackHandlers } from "./handlers/callbacks.js";
import { TelegramInteractiveHandler } from "./interactive/index.js";

const logger = createChildLogger("telegram-main");
const PLATFORM: Platform = "telegram";

// Graceful shutdown handling
let isShuttingDown = false;

// Service references for shutdown
let approvalService: ApprovalService | null = null;
let vetoWatcher: VetoWatcher | null = null;
let scheduler: Scheduler | null = null;
let interactiveHandler: TelegramInteractiveHandler | null = null;

/**
 * Migrate legacy state files to new platform-specific names
 */
async function migrateFromLegacy(): Promise<void> {
  const claudeDir = `${homedir()}/.claude`;

  // Migrate bridge state file
  const oldState = `${claudeDir}/tg-state.json`;
  const newState = `${claudeDir}/telegram-bridge.json`;

  if (existsSync(oldState) && !existsSync(newState)) {
    try {
      copyFileSync(oldState, newState);
      logger.info("Migrated tg-state.json → telegram-bridge.json");
    } catch (error) {
      logger.warn(
        { error: (error as Error).message, oldState, newState },
        "Failed to migrate bridge state - starting fresh (old file preserved)"
      );
    }
  }

  // Migrate sessions file
  const oldSessions = "./data/sessions.json";
  const newSessions = "./data/telegram-sessions.json";

  if (existsSync(oldSessions) && !existsSync(newSessions)) {
    try {
      // Ensure data directory exists
      const dir = dirname(newSessions);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      copyFileSync(oldSessions, newSessions);
      logger.info("Migrated sessions.json → telegram-sessions.json");
    } catch (error) {
      logger.warn(
        { error: (error as Error).message, oldSessions, newSessions },
        "Failed to migrate sessions - starting fresh (old file preserved)"
      );
    }
  }
}

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

    // Stop the interactive handler
    if (interactiveHandler) {
      await interactiveHandler.cleanup();
      logger.info("Interactive handler stopped");
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
 * Supports per-user targeting - each user has their own tmux session.
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
        yield "Not attached to any tmux pane.\n\nUse /attach <target> to connect to a Claude session.\nUse /panes to see available Claude panes.";
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
 * Main entry point for Telegram bot
 */
async function main(): Promise<void> {
  logger.info("Starting Claude Bot (Telegram)...");

  try {
    // Run migration for legacy files
    await migrateFromLegacy();

    // Clean up stale pending files from crashed sessions (older than 10 minutes)
    const stalePendingRemoved = cleanupStalePendingFiles(PLATFORM, 10 * 60 * 1000);
    if (stalePendingRemoved > 0) {
      logger.info({ count: stalePendingRemoved }, "Cleaned up stale pending files on startup");
    }

    // Load and validate config
    const config = getConfig();

    logger.info(
      {
        platform: PLATFORM,
        telegramUsers: config.telegram.allowedUsers,
        defaultWorkspace: config.claude.defaultWorkspace,
        model: config.claude.model,
      },
      "Configuration loaded"
    );

    // Initialize session manager with Telegram-specific path
    const sessionManager = createSessionManager("./data/telegram-sessions.json");
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

    // Initialize interactive handler for AskUserQuestion prompts
    interactiveHandler = new TelegramInteractiveHandler(bot);

    // Register interactive callback on tmux bridge
    const bridge = getTmuxBridge(PLATFORM);
    bridge.setInteractiveCallback(async (prompt, userId, paneId, target, chatId) => {
      if (!interactiveHandler) return null;
      return interactiveHandler.showPrompt(prompt, userId, paneId, target, chatId);
    });

    // Register text interceptor for "Other" option custom text input
    setTextInterceptor(async (userId: number, text: string) => {
      if (!interactiveHandler) return false;
      if (!interactiveHandler.isAwaitingTextInput(String(userId))) return false;
      return interactiveHandler.handleTextInput(String(userId), text);
    });

    logger.info("Interactive prompt handler initialized");

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

    logger.info("Telegram bot is running. Press Ctrl+C to stop.");
  } catch (error) {
    logger.error({ error: (error as Error).message, stack: (error as Error).stack }, "Failed to start bot");
    process.exit(1);
  }
}

// Run
main();
