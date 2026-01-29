import { Bot } from "grammy";
import type { BotContext } from "./types.js";
import { getConfig } from "./config.js";
import { createChildLogger } from "./utils/logger.js";
import {
  handleTextMessage,
  handleFileMessage,
  handlePhotoMessage,
  type SessionManager,
  type ClaudeBridge,
} from "./handlers/message.js";
import { registerCommands } from "./handlers/commands.js";
import { SessionManager as RealSessionManager } from "./sessions/manager.js";

const logger = createChildLogger("bot");

// Create the bot instance
const config = getConfig();
export const bot = new Bot<BotContext>(config.telegram.token);

// Store references to managers (will be set during initialization)
let sessionManager: SessionManager | null = null;
let claudeBridge: ClaudeBridge | null = null;

/**
 * Middleware: Authentication check
 * Rejects messages from users not in the allowed list
 */
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;

  if (!userId) {
    logger.warn("Received update without user ID");
    return;
  }

  const allowedUsers = getConfig().telegram.allowedUsers;

  if (!allowedUsers.includes(userId)) {
    logger.warn({ userId }, "Unauthorized user attempted to access bot");
    await ctx.reply("Sorry, you are not authorized to use this bot.");
    return;
  }

  await next();
});

/**
 * Middleware: Request logging
 */
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  // Determine update type by checking which property is present
  const update = ctx.update;
  const updateType = update.message ? "message" :
    update.edited_message ? "edited_message" :
    update.callback_query ? "callback_query" :
    update.inline_query ? "inline_query" :
    update.channel_post ? "channel_post" :
    "other";
  const messageType = ctx.message ? Object.keys(ctx.message).find(k =>
    ["text", "photo", "document", "voice", "audio", "video"].includes(k)
  ) : undefined;

  logger.debug(
    { userId, updateType, messageType },
    "Incoming update"
  );

  const startTime = Date.now();

  try {
    await next();
  } finally {
    const duration = Date.now() - startTime;
    logger.debug({ userId, duration }, "Update processed");
  }
});

/**
 * Command: /start
 */
bot.command("start", async (ctx) => {
  const userId = ctx.from?.id;
  logger.info({ userId }, "Start command received");

  await ctx.reply(
    "Welcome to Claude Bot!\n\n" +
    "I'm a bridge to Claude Code. Send me any message and I'll forward it to Claude.\n\n" +
    "Commands:\n" +
    "/start - Show this message\n" +
    "/help - Show help\n" +
    "/session - Manage sessions\n" +
    "/status - Show current status"
  );
});

/**
 * Command: /help
 */
bot.command("help", async (ctx) => {
  await ctx.reply(
    "Claude Bot Help\n\n" +
    "Just send me any text message and I'll forward it to Claude.\n\n" +
    "Session Management:\n" +
    "/session new <name> - Create new session\n" +
    "/session list - List all sessions\n" +
    "/session switch <name> - Switch to session\n" +
    "/session delete <name> - Delete session\n\n" +
    "/status - Show current session status\n\n" +
    "Tips:\n" +
    "- Each session maintains its own conversation history\n" +
    "- Sessions can have different working directories\n" +
    "- Use descriptive session names for different projects"
  );
});

/**
 * Command: /status
 */
bot.command("status", async (ctx) => {
  const userId = ctx.from?.id;

  if (!sessionManager) {
    await ctx.reply("Bot is still initializing. Please try again in a moment.");
    return;
  }

  const session = sessionManager.getActiveSession(String(userId!));

  if (!session) {
    await ctx.reply(
      "No active session.\n\n" +
      "Use /session new <name> to create a new session."
    );
    return;
  }

  const isActive = claudeBridge?.isSessionActive(session) ?? false;
  const lastUsed = new Date(session.lastUsed).toLocaleString();

  await ctx.reply(
    `Current Session: ${session.name}\n` +
    `ID: ${session.id}\n` +
    `Workspace: ${session.workspace}\n` +
    `Status: ${isActive ? "Active" : "Inactive"}\n` +
    `Auto-approve: ${session.approveAll ? "Yes" : "No"}\n` +
    `Last used: ${lastUsed}`
  );
});

// Message handlers are registered in registerMessageHandlers() after command handlers

/**
 * Error handler
 */
bot.catch((err) => {
  const ctx = err.ctx;
  const error = err.error;

  logger.error(
    {
      updateId: ctx.update.update_id,
      userId: ctx.from?.id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
    "Bot error"
  );

  // Try to notify user
  ctx.reply("An error occurred while processing your request. Please try again.")
    .catch((e) => logger.error({ error: (e as Error).message }, "Failed to send error message"));
});

/**
 * Register message handlers (must be called AFTER command handlers)
 */
function registerMessageHandlers(): void {
  // Handle text messages
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;

    // Skip if it's a command (already handled by command handlers)
    if (text.startsWith("/")) {
      return;
    }

    if (!sessionManager || !claudeBridge) {
      await ctx.reply("Bot is still initializing. Please try again in a moment.");
      return;
    }

    await handleTextMessage(ctx, sessionManager, claudeBridge);
  });

  // Handle photo messages
  bot.on("message:photo", async (ctx) => {
    if (!sessionManager || !claudeBridge) {
      await ctx.reply("Bot is still initializing. Please try again in a moment.");
      return;
    }

    await handlePhotoMessage(ctx, sessionManager, claudeBridge);
  });

  // Handle document messages
  bot.on("message:document", async (ctx) => {
    if (!sessionManager || !claudeBridge) {
      await ctx.reply("Bot is still initializing. Please try again in a moment.");
      return;
    }

    await handleFileMessage(ctx, sessionManager, claudeBridge);
  });

  logger.info("Message handlers registered");
}

/**
 * Initialize the bot with session manager and Claude bridge
 */
export function initializeBot(
  manager: SessionManager,
  bridge: ClaudeBridge,
  realSessionManager?: RealSessionManager
): void {
  sessionManager = manager;
  claudeBridge = bridge;

  // Register command handlers FIRST (order matters in grammY)
  if (realSessionManager) {
    registerCommands(bot, realSessionManager);
  }

  // Register message handlers AFTER commands
  registerMessageHandlers();

  logger.info("Bot initialized with session manager and Claude bridge");
}

/**
 * Start the bot (long polling mode)
 */
export async function startBot(): Promise<void> {
  logger.info("Starting bot...");

  // Delete webhook to ensure we can use long polling
  await bot.api.deleteWebhook();

  // Start long polling
  bot.start({
    onStart: (botInfo) => {
      logger.info({ username: botInfo.username }, "Bot started successfully");
    },
  });
}

/**
 * Stop the bot gracefully
 */
export async function stopBot(): Promise<void> {
  logger.info("Stopping bot...");
  await bot.stop();
  logger.info("Bot stopped");
}
