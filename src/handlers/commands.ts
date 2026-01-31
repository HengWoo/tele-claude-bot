import { Bot, InlineKeyboard } from "grammy";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { BotContext, NotificationLevel } from "../types.js";
import { SessionManager } from "../sessions/manager.js";
import { createChildLogger } from "../utils/logger.js";
import { getConfig } from "../config.js";
import { getTmuxBridge, type Platform } from "../tmux/bridge.js";
import {
  listPanes,
  listSessions,
  findClaudePanes,
  validateTarget,
  isTmuxAvailable,
} from "../tmux/index.js";

const logger = createChildLogger("command-handler");

// Default platform for command handlers (Telegram)
const PLATFORM: Platform = "telegram";

/**
 * Expand ~ to home directory in paths and validate against directory traversal
 */
function expandPath(path: string): string {
  let resolved = path;
  if (path.startsWith("~/")) {
    resolved = join(homedir(), path.slice(2));
  }
  resolved = resolve(resolved);

  // Ensure no traversal outside home directory
  const home = homedir();
  if (!resolved.startsWith(home)) {
    throw new Error("Path must be within home directory");
  }
  return resolved;
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
 * Handle /attach <target> - Attach to a tmux pane running Claude
 * Target format: session:window.pane (e.g., "1:0.0", "dev:2.1")
 */
export async function handleAttachCommand(
  ctx: BotContext,
  _sessionManager: SessionManager
): Promise<void> {
  const userId = ctx.from?.id;
  const args = parseArgs(ctx.message?.text);

  logger.debug({ userId, args }, "Attach command");

  // Check if tmux is available
  const tmuxAvailable = await isTmuxAvailable();
  if (!tmuxAvailable) {
    await ctx.reply(
      "tmux is not running or no sessions found.\n\n" +
      "Start a tmux session with Claude first:\n" +
      "```\ntmux new -s myproject\nclaude\n```"
    );
    return;
  }

  if (!args) {
    // Show available panes
    const claudePanes = await findClaudePanes();
    const allPanes = await listPanes();

    let message = "Usage: /attach <target>\n\n";
    message += "Target format: session:window.pane\n";
    message += "Example: /attach 1:0.0\n\n";

    if (claudePanes.length > 0) {
      message += "Panes running Claude:\n";
      for (const pane of claudePanes) {
        message += `  ${pane.target}${pane.active ? " (active)" : ""}\n`;
      }
    } else {
      message += "No panes currently running Claude.\n";
    }

    if (allPanes.length > 0 && claudePanes.length === 0) {
      message += "\nAll available panes:\n";
      for (const pane of allPanes.slice(0, 10)) {
        message += `  ${pane.target} - ${pane.command}\n`;
      }
      if (allPanes.length > 10) {
        message += `  ... and ${allPanes.length - 10} more\n`;
      }
    }

    await ctx.reply(message);
    return;
  }

  const target = args;

  // Validate target format
  if (!validateTarget(target)) {
    await ctx.reply(
      `Invalid target format: "${target}"\n\n` +
      "Expected format: session:window.pane\n" +
      "Examples: 1:0.0, dev:2.1, myproject:0.0"
    );
    return;
  }

  const bridge = getTmuxBridge(PLATFORM);
  const userIdStr = String(userId);

  try {
    await bridge.attach(target, userIdStr);
    logger.info({ userId, target }, "Attached to tmux pane");

    await ctx.reply(
      `Attached to tmux pane: ${target}\n\n` +
      "You can now send messages to Claude.\n" +
      "Use /detach to disconnect, /status to check connection."
    );
  } catch (error) {
    const err = error as Error;
    logger.warn({ userId, target, error: err.message }, "Failed to attach");
    await ctx.reply(`Failed to attach: ${err.message}`);
  }
}

/**
 * Handle /detach - Detach from current tmux pane
 */
export async function handleDetachCommand(
  ctx: BotContext,
  _sessionManager: SessionManager
): Promise<void> {
  const userId = ctx.from?.id;
  const userIdStr = String(userId);

  logger.debug({ userId }, "Detach command");

  const bridge = getTmuxBridge(PLATFORM);
  const currentTarget = bridge.getAttachedTarget(userIdStr);

  if (!currentTarget) {
    await ctx.reply("Not currently attached to any tmux pane.");
    return;
  }

  bridge.detach(userIdStr);
  logger.info({ userId, previousTarget: currentTarget }, "Detached from tmux pane");

  await ctx.reply(`Detached from tmux pane: ${currentTarget}`);
}

/**
 * Handle /list - List all tmux sessions and panes
 */
export async function handleListCommand(
  ctx: BotContext,
  _sessionManager: SessionManager
): Promise<void> {
  const userId = ctx.from?.id;

  logger.debug({ userId }, "List command");

  const tmuxAvailable = await isTmuxAvailable();
  if (!tmuxAvailable) {
    await ctx.reply("tmux is not running or no sessions found.");
    return;
  }

  const sessions = await listSessions();
  const panes = await listPanes();

  if (sessions.length === 0) {
    await ctx.reply("No tmux sessions found.");
    return;
  }

  let message = "tmux Sessions:\n\n";

  for (const session of sessions) {
    message += `Session: ${session}\n`;
    const sessionPanes = panes.filter((p) => p.session === session);
    for (const pane of sessionPanes) {
      const activeMarker = pane.active ? " *" : "";
      message += `  ${pane.target} - ${pane.command}${activeMarker}\n`;
    }
    message += "\n";
  }

  message += "* = active pane";

  await ctx.reply(message);
}

/**
 * Handle /panes - List panes running Claude
 */
export async function handlePanesCommand(
  ctx: BotContext,
  _sessionManager: SessionManager
): Promise<void> {
  const userId = ctx.from?.id;

  logger.debug({ userId }, "Panes command");

  const tmuxAvailable = await isTmuxAvailable();
  if (!tmuxAvailable) {
    await ctx.reply("tmux is not running or no sessions found.");
    return;
  }

  const claudePanes = await findClaudePanes();
  const userIdStr = String(userId);

  if (claudePanes.length === 0) {
    await ctx.reply(
      "No panes running Claude found.\n\n" +
      "Start Claude in a tmux pane:\n" +
      "```\ntmux new -s myproject\nclaude\n```"
    );
    return;
  }

  const bridge = getTmuxBridge(PLATFORM);
  const currentTarget = bridge.getAttachedTarget(userIdStr);

  // Create inline keyboard for quick attachment
  const keyboard = new InlineKeyboard();

  let message = "Panes running Claude:\n\n";

  claudePanes.forEach((pane, index) => {
    const isAttached = pane.target === currentTarget;
    const marker = isAttached ? " [attached]" : "";
    message += `${index + 1}. ${pane.target}${marker}\n`;
    message += `   Session: ${pane.session}\n\n`;

    // Add attach button if not already attached
    if (!isAttached) {
      keyboard.text(`Attach ${pane.target}`, `attach:${pane.target}`);
      if ((index + 1) % 2 === 0) {
        keyboard.row();
      }
    }
  });

  if (currentTarget) {
    message += `\nCurrently attached to: ${currentTarget}`;
  }

  await ctx.reply(message, { reply_markup: keyboard });
}

/**
 * Handle /status - Show current attachment status
 */
export async function handleStatusCommand(
  ctx: BotContext,
  sessionManager: SessionManager
): Promise<void> {
  const userId = ctx.from?.id;
  const userIdStr = String(userId);

  logger.debug({ userId }, "Status command");

  const bridge = getTmuxBridge(PLATFORM);
  const attachedTarget = bridge.getAttachedTarget(userIdStr);
  const hasPending = bridge.hasPendingRequest(userIdStr);

  const activeSession = await sessionManager.getActive();

  let message = "Status:\n\n";

  // tmux attachment status
  if (attachedTarget) {
    message += `tmux Target: ${attachedTarget}\n`;
    message += `Status: ${hasPending ? "Processing request..." : "Ready"}\n\n`;
  } else {
    message += "tmux Target: Not attached\n";
    message += "Use /attach <target> to connect to a Claude pane\n\n";
  }

  // Session info
  if (activeSession) {
    message += `Session: ${activeSession.name}\n`;
    message += `Workspace: ${activeSession.workspace}\n`;
    message += `Notify Level: ${activeSession.notifyLevel}\n`;
  }

  await ctx.reply(message);
}

/**
 * Handle attach callback from inline keyboard
 */
export async function handleAttachCallback(
  ctx: BotContext,
  _sessionManager: SessionManager
): Promise<void> {
  const callbackData = ctx.callbackQuery?.data;
  const userId = ctx.from?.id;
  const userIdStr = String(userId);

  if (!callbackData?.startsWith("attach:")) {
    return;
  }

  const target = callbackData.replace("attach:", "");

  logger.debug({ userId, target }, "Attach callback");

  const bridge = getTmuxBridge(PLATFORM);

  try {
    await bridge.attach(target, userIdStr);

    await ctx.answerCallbackQuery({
      text: `Attached to ${target}`,
    });

    await ctx.editMessageText(
      `Attached to tmux pane: ${target}\n\n` +
      "You can now send messages to Claude.\n" +
      "Use /detach to disconnect."
    );

    logger.info({ userId, target }, "Attached via callback");
  } catch (error) {
    const err = error as Error;
    logger.warn({ userId, target, error: err.message }, "Failed to attach via callback");

    await ctx.answerCallbackQuery({
      text: `Error: ${err.message}`,
      show_alert: true,
    });
  }
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

  // tmux commands
  bot.command("attach", (ctx) => handleAttachCommand(ctx, sessionManager));
  bot.command("detach", (ctx) => handleDetachCommand(ctx, sessionManager));
  bot.command("list", (ctx) => handleListCommand(ctx, sessionManager));
  bot.command("panes", (ctx) => handlePanesCommand(ctx, sessionManager));
  bot.command("status", (ctx) => handleStatusCommand(ctx, sessionManager));

  // Callback query handlers for inline keyboards
  bot.callbackQuery(/^session:/, (ctx) => handleSessionCallback(ctx, sessionManager));
  bot.callbackQuery(/^kill_confirm:/, (ctx) => handleKillCallback(ctx, sessionManager));
  bot.callbackQuery("kill_cancel", (ctx) => handleKillCallback(ctx, sessionManager));
  bot.callbackQuery(/^attach:/, (ctx) => handleAttachCallback(ctx, sessionManager));

  logger.info("Command handlers registered");
}
