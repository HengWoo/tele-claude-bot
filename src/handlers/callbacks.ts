import { InlineKeyboard, type Context } from "grammy";
import type { Bot } from "grammy";
import { approvalQueue } from "../claude/approval.js";
import { createChildLogger } from "../utils/logger.js";
import type { BotContext, Session } from "../types.js";

const logger = createChildLogger("callbacks");

// Reference to session manager (set during initialization)
let sessionManagerRef: SessionManagerInterface | null = null;

export interface SessionManagerInterface {
  get(name: string): Session | undefined;
  switch(nameOrIndex: string | number): Promise<Session>;
  list(): Session[];
}

/**
 * Set the session manager reference for callback handlers
 */
export function setSessionManager(manager: SessionManagerInterface): void {
  sessionManagerRef = manager;
}

/**
 * Creates an inline keyboard for tool approval
 * @param toolId - The unique ID of the tool use
 * @param sessionId - The session ID for approve all functionality
 */
export function createApprovalKeyboard(toolId: string, sessionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Approve", `approve:${toolId}`)
    .text("Deny", `deny:${toolId}`)
    .row()
    .text("Approve All", `approve_all:${sessionId}`);
}

/**
 * Handle approval callback queries
 */
export async function handleApprovalCallback(ctx: Context): Promise<void> {
  const callbackData = ctx.callbackQuery?.data;

  if (!callbackData) {
    logger.warn("Received callback query without data");
    await ctx.answerCallbackQuery({ text: "Invalid callback" });
    return;
  }

  // Parse callback data (format: action:id)
  const colonIndex = callbackData.indexOf(":");
  if (colonIndex === -1) {
    logger.warn({ callbackData }, "Invalid callback data format");
    await ctx.answerCallbackQuery({ text: "Invalid callback format" });
    return;
  }

  const action = callbackData.substring(0, colonIndex);
  const id = callbackData.substring(colonIndex + 1);

  logger.debug({ action, id }, "Processing approval callback");

  try {
    switch (action) {
      case "approve": {
        const resolved = approvalQueue.resolve(id, true);
        if (resolved) {
          await ctx.answerCallbackQuery({ text: "Approved" });
          await ctx.editMessageText("<b>\u2705 Approved</b>", { parse_mode: "HTML" });
        } else {
          await ctx.answerCallbackQuery({ text: "Approval already processed or expired" });
        }
        break;
      }

      case "deny": {
        const resolved = approvalQueue.resolve(id, false);
        if (resolved) {
          await ctx.answerCallbackQuery({ text: "Denied" });
          await ctx.editMessageText("<b>\u274C Denied</b>", { parse_mode: "HTML" });
        } else {
          await ctx.answerCallbackQuery({ text: "Approval already processed or expired" });
        }
        break;
      }

      case "approve_all": {
        // id is the sessionId
        const pendingApprovals = approvalQueue.getBySession(id);

        if (pendingApprovals.length === 0) {
          await ctx.answerCallbackQuery({ text: "No pending approvals for this session" });
          return;
        }

        // Resolve all pending approvals for this session
        for (const approval of pendingApprovals) {
          approvalQueue.resolve(approval.id, true);
        }

        logger.info(
          { sessionId: id, count: pendingApprovals.length },
          "Approved all pending tool uses for session"
        );

        await ctx.answerCallbackQuery({
          text: `Approved ${pendingApprovals.length} pending tool use(s)`,
        });
        await ctx.editMessageText(`<b>\u2705 Approved all</b> (${pendingApprovals.length} tool uses)`, { parse_mode: "HTML" });
        break;
      }

      default:
        logger.warn({ action }, "Unknown approval action");
        await ctx.answerCallbackQuery({ text: "Unknown action" });
    }
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message, action, id }, "Failed to process approval callback");
    await ctx.answerCallbackQuery({ text: "Error processing approval" });
  }
}

/**
 * Handle session switching callback queries
 */
export async function handleSessionCallback(ctx: Context): Promise<void> {
  const callbackData = ctx.callbackQuery?.data;

  if (!callbackData) {
    logger.warn("Received session callback without data");
    await ctx.answerCallbackQuery({ text: "Invalid callback" });
    return;
  }

  // Parse callback data (format: session:sessionName)
  const colonIndex = callbackData.indexOf(":");
  if (colonIndex === -1) {
    logger.warn({ callbackData }, "Invalid session callback format");
    await ctx.answerCallbackQuery({ text: "Invalid callback format" });
    return;
  }

  const sessionName = callbackData.substring(colonIndex + 1);

  logger.debug({ sessionName }, "Processing session switch callback");

  if (!sessionManagerRef) {
    logger.error("Session manager not initialized");
    await ctx.answerCallbackQuery({ text: "Bot not fully initialized" });
    return;
  }

  try {
    const session = await sessionManagerRef.switch(sessionName);
    await ctx.answerCallbackQuery({ text: `Switched to session: ${session.name}` });
    await ctx.editMessageText(
      `Switched to session: ${session.name}\n` +
        `Workspace: ${session.workspace}\n` +
        `Auto-approve: ${session.approveAll ? "Yes" : "No"}`
    );

    logger.info({ sessionName: session.name }, "Session switched via callback");
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message, sessionName }, "Failed to switch session");
    await ctx.answerCallbackQuery({ text: `Error: ${err.message}` });
  }
}

/**
 * Register callback query handlers on the bot
 */
export function registerCallbackHandlers(bot: Bot<BotContext>): void {
  // Approval callbacks
  bot.callbackQuery(/^approve:/, handleApprovalCallback);
  bot.callbackQuery(/^deny:/, handleApprovalCallback);
  bot.callbackQuery(/^approve_all:/, handleApprovalCallback);

  // Session switching callbacks
  bot.callbackQuery(/^session:/, handleSessionCallback);

  logger.info("Callback handlers registered");
}
