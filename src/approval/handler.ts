import fs from "fs/promises";
import os from "os";
import path from "path";
import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";
import type { ApprovalRequest, ApprovalResponse, BotContext } from "../types.js";
import { evaluatePolicy, loadPolicy } from "./policy.js";
import { createChildLogger } from "../utils/logger.js";

const logger = createChildLogger("approval-handler");

const APPROVAL_DIR = path.join(os.homedir(), ".claude", "approvals");
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_INPUT_DISPLAY_LENGTH = 500;

interface PendingRequest {
  request: ApprovalRequest;
  messageId: number;
  timeoutHandle: NodeJS.Timeout;
}

/**
 * Handles file-based approval requests and bridges them to Telegram
 */
export class ApprovalHandler {
  private bot: Bot<BotContext>;
  private chatId: number;
  private pendingRequests: Map<string, PendingRequest> = new Map();

  constructor(bot: Bot<BotContext>, chatId: number) {
    this.bot = bot;
    this.chatId = chatId;
  }

  /**
   * Handle an incoming approval request
   * Checks policy first, then prompts user if needed
   */
  async handleRequest(request: ApprovalRequest): Promise<void> {
    logger.debug({ id: request.id, toolName: request.toolName }, "Handling approval request");

    const policy = loadPolicy();
    const action = evaluatePolicy(request.toolName, request.toolInput, policy);

    if (action === "auto-approve") {
      logger.info({ id: request.id, toolName: request.toolName }, "Auto-approving request");
      await this.writeResponse(request.id, true);
      return;
    }

    if (action === "auto-deny") {
      logger.info({ id: request.id, toolName: request.toolName }, "Auto-denying request");
      await this.writeResponse(request.id, false);
      return;
    }

    // Requires user approval - send Telegram message
    await this.promptUser(request);
  }

  /**
   * Write response JSON file for Claude to read
   */
  async writeResponse(requestId: string, approved: boolean): Promise<void> {
    const responsePath = path.join(APPROVAL_DIR, `${requestId}.response`);
    const response: ApprovalResponse = { approved };

    try {
      // Ensure directory exists
      await fs.mkdir(APPROVAL_DIR, { recursive: true });

      await fs.writeFile(responsePath, JSON.stringify(response), "utf-8");
      logger.debug({ requestId, approved, path: responsePath }, "Wrote approval response");

      // Clean up pending request if exists
      this.cleanupPendingRequest(requestId);
    } catch (error) {
      logger.error({ error, requestId }, "Failed to write approval response");
      throw error;
    }
  }

  /**
   * Format the request details for display in Telegram
   */
  formatRequestMessage(request: ApprovalRequest): string {
    const lines: string[] = [];

    // Tool name in bold
    lines.push(`<b>Tool:</b> ${this.escapeHtml(request.toolName)}`);

    // Format tool input
    let inputDisplay: string;
    if (typeof request.toolInput === "string") {
      inputDisplay = request.toolInput;
    } else {
      inputDisplay = JSON.stringify(request.toolInput, null, 2);
    }

    // Truncate if too long
    if (inputDisplay.length > MAX_INPUT_DISPLAY_LENGTH) {
      inputDisplay = inputDisplay.substring(0, MAX_INPUT_DISPLAY_LENGTH) + "...";
    }

    lines.push(`\n<b>Input:</b>\n<pre>${this.escapeHtml(inputDisplay)}</pre>`);

    // Timestamp
    const timestamp = new Date(request.timestamp).toLocaleString();
    lines.push(`\n<i>Requested at: ${timestamp}</i>`);

    return lines.join("\n");
  }

  /**
   * Resolve a pending approval request
   * Called by callback handlers when user clicks approve/deny
   */
  async resolveRequest(requestId: string, approved: boolean): Promise<boolean> {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      logger.warn({ requestId }, "Attempted to resolve unknown or expired request");
      return false;
    }

    await this.writeResponse(requestId, approved);
    return true;
  }

  /**
   * Get a pending request by ID
   */
  getPendingRequest(requestId: string): PendingRequest | undefined {
    return this.pendingRequests.get(requestId);
  }

  /**
   * Get all pending requests
   */
  getAllPendingRequests(): Map<string, PendingRequest> {
    return this.pendingRequests;
  }

  /**
   * Send approval prompt to Telegram user
   */
  private async promptUser(request: ApprovalRequest): Promise<void> {
    const keyboard = new InlineKeyboard()
      .text("Approve", `hook_approve:${request.id}`)
      .text("Deny", `hook_deny:${request.id}`);

    const message = this.formatRequestMessage(request);

    try {
      const sentMessage = await this.bot.api.sendMessage(this.chatId, message, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });

      // Set up timeout handler
      const timeoutHandle = setTimeout(async () => {
        await this.handleTimeout(request.id);
      }, TIMEOUT_MS);

      // Store pending request
      this.pendingRequests.set(request.id, {
        request,
        messageId: sentMessage.message_id,
        timeoutHandle,
      });

      logger.info(
        { id: request.id, toolName: request.toolName, messageId: sentMessage.message_id },
        "Sent approval prompt to user"
      );
    } catch (error) {
      logger.error({ error, id: request.id }, "Failed to send approval prompt");
      // On failure to send, auto-deny for safety
      await this.writeResponse(request.id, false);
    }
  }

  /**
   * Handle timeout for a pending request
   */
  private async handleTimeout(requestId: string): Promise<void> {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return; // Already resolved
    }

    logger.info({ requestId }, "Approval request timed out, auto-denying");

    // Write denial response
    await this.writeResponse(requestId, false);

    // Update the Telegram message
    try {
      await this.bot.api.editMessageText(
        this.chatId,
        pending.messageId,
        "<b>Timed out - auto-denied</b>",
        { parse_mode: "HTML" }
      );
    } catch (error) {
      logger.warn({ error, requestId }, "Failed to update timed out message");
    }
  }

  /**
   * Clean up a pending request
   */
  private cleanupPendingRequest(requestId: string): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeoutHandle);
      this.pendingRequests.delete(requestId);
      logger.debug({ requestId }, "Cleaned up pending request");
    }
  }

  /**
   * Escape HTML special characters for Telegram message formatting
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /**
   * Clean up all pending requests (for shutdown)
   */
  async cleanup(): Promise<void> {
    logger.info({ count: this.pendingRequests.size }, "Cleaning up pending requests");

    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutHandle);
      // Auto-deny any remaining pending requests
      try {
        await this.writeResponse(requestId, false);
        await this.bot.api.editMessageText(
          this.chatId,
          pending.messageId,
          "<b>Shutdown - auto-denied</b>",
          { parse_mode: "HTML" }
        );
      } catch (error) {
        logger.warn({ error, requestId }, "Failed to cleanup pending request on shutdown");
      }
    }

    this.pendingRequests.clear();
  }
}
