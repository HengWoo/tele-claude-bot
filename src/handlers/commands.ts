import { Bot, InlineKeyboard } from "grammy";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BotContext, NotificationLevel } from "../types.js";
import { SessionManager } from "../sessions/manager.js";
import { createChildLogger } from "../utils/logger.js";
import { getConfig } from "../config.js";

const logger = createChildLogger("command-handler");

/**
 * Expand ~ to home directory in paths
 */
function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

/**
 * Parse command arguments from message text
 * Returns the text after the command
 */
function parseArgs(text: string | undefined): string {
  if (!text) return "";
  // Remove the /command part and trim
  const match = text.match(/^\/\S+\s*(.*)/);
  return match ? match[1].trim() : "";
}

/**
 * Handle /new <name> [path] - Create a new session
 */
export async function handleNewCommand(
  ctx: BotContext,
  sessionManager: SessionManager
): Promise<void> {
  const userId = ctx.from?.id;
  const args = parseArgs(ctx.message?.text);

  logger.debug({ userId, args }, "New session command");

  if (!args) {
    await ctx.reply(
      "Usage: /new <name> [workspace_path]\n\n" +
      "Examples:\n" +
      "/new project-a\n" +
      "/new backend ~/projects/myapp/backend"
    );
    return;
  }

  // Parse name and optional path
  const parts = args.split(/\s+/);
  const name = parts[0];
  const config = getConfig();
  const workspace = parts[1]
    ? expandPath(parts[1])
    : config.claude.defaultWorkspace;

  try {
    const session = await sessionManager.create({ name, workspace });
    logger.info({ userId, sessionName: name, workspace }, "Session created via command");

    await ctx.reply(
      `Session "${session.name}" created!\n\n` +
      `Workspace: ${session.workspace}\n` +
      `ID: ${session.id}\n\n` +
      `This session is now active.`
    );
  } catch (error) {
    const err = error as Error;
    logger.warn({ userId, error: err.message }, "Failed to create session");
    await ctx.reply(`Failed to create session: ${err.message}`);
  }
}

/**
 * Handle /use <name> - Switch to a session by name
 */
export async function handleUseCommand(
  ctx: BotContext,
  sessionManager: SessionManager
): Promise<void> {
  const userId = ctx.from?.id;
  const args = parseArgs(ctx.message?.text);

  logger.debug({ userId, args }, "Use session command");

  if (!args) {
    await ctx.reply(
      "Usage: /use <name>\n\n" +
      "Switch to an existing session by name.\n" +
      "Use /sessions to see available sessions."
    );
    return;
  }

  try {
    const session = await sessionManager.switch(args);
    logger.info({ userId, sessionName: session.name }, "Switched session via /use");

    await ctx.reply(
      `Switched to session "${session.name}"\n\n` +
      `Workspace: ${session.workspace}`
    );
  } catch (error) {
    const err = error as Error;
    logger.warn({ userId, error: err.message }, "Failed to switch session");
    await ctx.reply(`Failed to switch session: ${err.message}`);
  }
}

/**
 * Handle numbered session switching: /1, /2, /3, etc.
 */
export async function handleNumberedSwitch(
  ctx: BotContext,
  sessionManager: SessionManager,
  index: number
): Promise<void> {
  const userId = ctx.from?.id;

  logger.debug({ userId, index }, "Numbered session switch");

  try {
    // Convert 1-based user input to 0-based index
    const session = await sessionManager.switch(index - 1);
    logger.info({ userId, sessionName: session.name, index }, "Switched session via number");

    await ctx.reply(
      `Switched to session "${session.name}"\n\n` +
      `Workspace: ${session.workspace}`
    );
  } catch (error) {
    const err = error as Error;
    logger.warn({ userId, error: err.message, index }, "Failed to switch session by number");
    await ctx.reply(`Failed to switch session: ${err.message}`);
  }
}

/**
 * Handle /sessions - List all sessions with inline keyboard
 */
export async function handleSessionsCommand(
  ctx: BotContext,
  sessionManager: SessionManager
): Promise<void> {
  const userId = ctx.from?.id;

  logger.debug({ userId }, "List sessions command");

  const sessions = sessionManager.list();

  if (sessions.length === 0) {
    await ctx.reply(
      "No sessions found.\n\n" +
      "Use /new <name> to create a new session."
    );
    return;
  }

  // Get active session for marking
  const activeSession = await sessionManager.getActive();
  const activeId = activeSession?.id;

  // Build inline keyboard with session buttons
  const keyboard = new InlineKeyboard();

  let messageText = "Sessions:\n\n";

  sessions.forEach((session, index) => {
    const isActive = session.id === activeId;
    const indicator = isActive ? " *" : "";
    const num = index + 1;

    messageText += `${num}. ${session.name}${indicator}\n`;
    messageText += `   Workspace: ${session.workspace}\n`;
    messageText += `   Last used: ${new Date(session.lastUsed).toLocaleString()}\n\n`;

    // Add button for each session
    keyboard.text(
      `${isActive ? "* " : ""}${session.name}`,
      `session:${session.name}`
    );

    // New row every 2 buttons
    if ((index + 1) % 2 === 0) {
      keyboard.row();
    }
  });

  messageText += "\n* = active session\n";
  messageText += "Tap a button to switch sessions, or use /1, /2, /3...";

  await ctx.reply(messageText, { reply_markup: keyboard });
}

/**
 * Handle session selection callback from inline keyboard
 */
export async function handleSessionCallback(
  ctx: BotContext,
  sessionManager: SessionManager
): Promise<void> {
  const callbackData = ctx.callbackQuery?.data;
  const userId = ctx.from?.id;

  if (!callbackData?.startsWith("session:")) {
    return;
  }

  const sessionName = callbackData.replace("session:", "");

  logger.debug({ userId, sessionName }, "Session callback");

  try {
    const session = await sessionManager.switch(sessionName);

    await ctx.answerCallbackQuery({
      text: `Switched to ${session.name}`,
    });

    // Update the message to reflect the change
    await ctx.editMessageText(
      `Switched to session "${session.name}"\n\n` +
      `Workspace: ${session.workspace}\n\n` +
      `Use /sessions to see all sessions.`
    );

    logger.info({ userId, sessionName }, "Switched session via callback");
  } catch (error) {
    const err = error as Error;
    logger.warn({ userId, error: err.message }, "Failed to switch session via callback");

    await ctx.answerCallbackQuery({
      text: `Error: ${err.message}`,
      show_alert: true,
    });
  }
}

/**
 * Handle /kill <name> - Delete a session
 */
export async function handleKillCommand(
  ctx: BotContext,
  sessionManager: SessionManager
): Promise<void> {
  const userId = ctx.from?.id;
  const args = parseArgs(ctx.message?.text);

  logger.debug({ userId, args }, "Kill session command");

  if (!args) {
    await ctx.reply(
      "Usage: /kill <name>\n\n" +
      "Delete a session permanently.\n" +
      "Use /sessions to see available sessions."
    );
    return;
  }

  const sessionName = args;

  // Check if session exists
  if (!sessionManager.has(sessionName)) {
    await ctx.reply(`Session "${sessionName}" not found.`);
    return;
  }

  // Create confirmation keyboard
  const keyboard = new InlineKeyboard()
    .text("Yes, delete", `kill_confirm:${sessionName}`)
    .text("Cancel", "kill_cancel");

  await ctx.reply(
    `Are you sure you want to delete session "${sessionName}"?\n\n` +
    `This action cannot be undone.`,
    { reply_markup: keyboard }
  );
}

/**
 * Handle kill confirmation callback
 */
export async function handleKillCallback(
  ctx: BotContext,
  sessionManager: SessionManager
): Promise<void> {
  const callbackData = ctx.callbackQuery?.data;
  const userId = ctx.from?.id;

  if (!callbackData) return;

  if (callbackData === "kill_cancel") {
    await ctx.answerCallbackQuery({ text: "Cancelled" });
    await ctx.editMessageText("Session deletion cancelled.");
    return;
  }

  if (callbackData.startsWith("kill_confirm:")) {
    const sessionName = callbackData.replace("kill_confirm:", "");

    logger.debug({ userId, sessionName }, "Kill confirmation callback");

    try {
      const deleted = await sessionManager.delete(sessionName);

      if (deleted) {
        await ctx.answerCallbackQuery({ text: "Session deleted" });
        await ctx.editMessageText(`Session "${sessionName}" has been deleted.`);
        logger.info({ userId, sessionName }, "Session deleted via command");
      } else {
        await ctx.answerCallbackQuery({
          text: "Session not found",
          show_alert: true
        });
        await ctx.editMessageText(`Session "${sessionName}" not found.`);
      }
    } catch (error) {
      const err = error as Error;
      logger.warn({ userId, error: err.message }, "Failed to delete session");

      await ctx.answerCallbackQuery({
        text: `Error: ${err.message}`,
        show_alert: true,
      });
    }
  }
}

/**
 * Handle /history - Show recent conversation summary
 */
export async function handleHistoryCommand(
  ctx: BotContext,
  _sessionManager: SessionManager
): Promise<void> {
  const userId = ctx.from?.id;

  logger.debug({ userId }, "History command");

  await ctx.reply(
    "History feature coming soon!\n\n" +
    "This will show a summary of recent conversations in the current session."
  );
}

/**
 * Handle /notify <level> - Set notification level
 */
export async function handleNotifyCommand(
  ctx: BotContext,
  sessionManager: SessionManager
): Promise<void> {
  const userId = ctx.from?.id;
  const args = parseArgs(ctx.message?.text);

  logger.debug({ userId, args }, "Notify command");

  const validLevels: NotificationLevel[] = ["minimal", "status", "verbose"];

  if (!args || !validLevels.includes(args as NotificationLevel)) {
    const activeSession = await sessionManager.getActive();
    const currentLevel = activeSession?.notifyLevel ?? "status";

    await ctx.reply(
      "Usage: /notify <level>\n\n" +
      "Levels:\n" +
      "- minimal: Only errors and completion\n" +
      "- status: Progress updates (default)\n" +
      "- verbose: All details including tool usage\n\n" +
      `Current level: ${currentLevel}`
    );
    return;
  }

  const level = args as NotificationLevel;
  const activeSession = await sessionManager.getActive();

  if (!activeSession) {
    await ctx.reply("No active session. Use /new to create one.");
    return;
  }

  try {
    await sessionManager.update(activeSession.name, { notifyLevel: level });
    logger.info({ userId, level, sessionName: activeSession.name }, "Notification level updated");

    await ctx.reply(
      `Notification level set to "${level}" for session "${activeSession.name}".`
    );
  } catch (error) {
    const err = error as Error;
    logger.warn({ userId, error: err.message }, "Failed to update notification level");
    await ctx.reply(`Failed to update notification level: ${err.message}`);
  }
}

/**
 * Handle /attach - Attach to local session (v2 placeholder)
 */
export async function handleAttachCommand(
  ctx: BotContext,
  _sessionManager: SessionManager
): Promise<void> {
  const userId = ctx.from?.id;

  logger.debug({ userId }, "Attach command");

  await ctx.reply(
    "Local session attachment coming soon!\n\n" +
    "This feature will allow you to connect to a Claude session " +
    "running locally on your machine."
  );
}

/**
 * Handle /detach - Detach from local session (v2 placeholder)
 */
export async function handleDetachCommand(
  ctx: BotContext,
  _sessionManager: SessionManager
): Promise<void> {
  const userId = ctx.from?.id;

  logger.debug({ userId }, "Detach command");

  await ctx.reply(
    "Local session detachment coming soon!\n\n" +
    "This feature will allow you to disconnect from a locally " +
    "running Claude session."
  );
}

/**
 * Register all command handlers on the bot
 */
export function registerCommands(
  bot: Bot<BotContext>,
  sessionManager: SessionManager
): void {
  logger.info("Registering command handlers");

  // /new <name> [path] - Create new session
  bot.command("new", (ctx) => handleNewCommand(ctx, sessionManager));

  // /use <name> - Switch to session by name
  bot.command("use", (ctx) => handleUseCommand(ctx, sessionManager));

  // /1, /2, /3... - Switch to session by number
  for (let i = 1; i <= 9; i++) {
    bot.command(String(i), (ctx) => handleNumberedSwitch(ctx, sessionManager, i));
  }

  // /sessions - List all sessions
  bot.command("sessions", (ctx) => handleSessionsCommand(ctx, sessionManager));

  // /kill <name> - Delete session
  bot.command("kill", (ctx) => handleKillCommand(ctx, sessionManager));

  // /history - Show conversation history
  bot.command("history", (ctx) => handleHistoryCommand(ctx, sessionManager));

  // /notify <level> - Set notification level
  bot.command("notify", (ctx) => handleNotifyCommand(ctx, sessionManager));

  // /attach and /detach - Local session attachment (v2)
  bot.command("attach", (ctx) => handleAttachCommand(ctx, sessionManager));
  bot.command("detach", (ctx) => handleDetachCommand(ctx, sessionManager));

  // Callback query handlers for inline keyboards
  bot.callbackQuery(/^session:/, (ctx) => handleSessionCallback(ctx, sessionManager));
  bot.callbackQuery(/^kill_confirm:/, (ctx) => handleKillCallback(ctx, sessionManager));
  bot.callbackQuery("kill_cancel", (ctx) => handleKillCallback(ctx, sessionManager));

  logger.info("Command handlers registered");
}
