/**
 * Telegram Interactive Prompt Handler
 *
 * Presents AskUserQuestion prompts as inline keyboard buttons
 * and handles user responses.
 */

import { InlineKeyboard } from "grammy";
import type { Bot, Context } from "grammy";
import type { BotContext } from "../types.js";
import type { DetectedPrompt, PendingPrompt, PromptResponse } from "./types.js";
import { selectOptionByIndex, toggleOption, submitMultiSelect, sendLiteralText, sendNavigationKey, capturePane } from "../tmux/index.js";
import { getCurrentSelections } from "./prompt-parser.js";
import { createChildLogger } from "../utils/logger.js";

const logger = createChildLogger("telegram-interactive");

// Timeout for prompts (5 minutes)
const PROMPT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Telegram Interactive Handler
 * Manages interactive prompts for Telegram users
 */
export class TelegramInteractiveHandler {
  private bot: Bot<BotContext>;
  private pendingPrompts: Map<string, PendingPrompt> = new Map();
  private timeoutHandles: Map<string, NodeJS.Timeout> = new Map();

  constructor(bot: Bot<BotContext>) {
    this.bot = bot;
    this.registerCallbacks();
  }

  /**
   * Register callback query handlers for prompt responses
   */
  private registerCallbacks(): void {
    // Single-select option
    this.bot.callbackQuery(/^prompt_select:/, (ctx) => this.handleSelect(ctx));

    // Multi-select toggle
    this.bot.callbackQuery(/^prompt_toggle:/, (ctx) => this.handleToggle(ctx));

    // Multi-select submit
    this.bot.callbackQuery(/^prompt_submit:/, (ctx) => this.handleSubmit(ctx));

    // Other option (custom text)
    this.bot.callbackQuery(/^prompt_other:/, (ctx) => this.handleOther(ctx));

    // Cancel prompt
    this.bot.callbackQuery(/^prompt_cancel:/, (ctx) => this.handleCancel(ctx));

    logger.info("Telegram interactive callbacks registered");
  }

  /**
   * Show a prompt to the user as an inline keyboard
   *
   * @param prompt - Detected prompt from terminal
   * @param userId - User ID
   * @param paneId - tmux pane ID
   * @param target - tmux target
   * @param chatId - Telegram chat ID
   * @returns Promise that resolves when user responds
   */
  async showPrompt(
    prompt: DetectedPrompt,
    userId: string,
    paneId: string,
    target: string,
    chatId: number
  ): Promise<PromptResponse | null> {
    const promptKey = `${userId}:${paneId}`;

    // Cancel any existing prompt for this user
    await this.cancelPendingPrompt(promptKey);

    // Build keyboard
    const keyboard = this.buildKeyboard(prompt, userId);

    // Build message text
    const messageText = this.formatPromptMessage(prompt);

    try {
      // Send prompt message
      const sentMessage = await this.bot.api.sendMessage(chatId, messageText, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });

      // Create pending prompt
      const pending: PendingPrompt = {
        prompt,
        userId,
        paneId,
        target,
        chatId: chatId.toString(),
        messageId: sentMessage.message_id,
        timestamp: Date.now(),
        toggledIndices: prompt.type === "multi" ? new Set() : undefined,
      };

      this.pendingPrompts.set(promptKey, pending);

      // Set timeout
      const timeoutHandle = setTimeout(() => {
        this.handleTimeout(promptKey).catch((err) => {
          logger.error({ error: err.message, promptKey }, "Error in timeout handler");
        });
      }, PROMPT_TIMEOUT_MS);

      this.timeoutHandles.set(promptKey, timeoutHandle);

      logger.info(
        { userId, paneId, question: prompt.question, optionCount: prompt.options.length },
        "Prompt shown to user"
      );

      // Return a promise that resolves when user responds
      return new Promise((resolve) => {
        // Store the resolver on the pending prompt
        (pending as PendingPromptWithResolver).resolve = resolve;
      });
    } catch (error) {
      logger.error({ error: (error as Error).message, userId, chatId }, "Failed to send prompt message");
      return null;
    }
  }

  /**
   * Build inline keyboard for the prompt
   */
  private buildKeyboard(prompt: DetectedPrompt, userId: string): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    if (prompt.type === "single") {
      // Single-select: one button per option
      for (const option of prompt.options) {
        // Skip "Other" option - handle separately
        if (option.label.match(/^Other(\s*\(.*\))?$/i)) {
          continue;
        }
        keyboard.text(option.label, `prompt_select:${userId}:${option.index}`).row();
      }

      // Add "Other" button if available
      if (prompt.hasOther) {
        keyboard.text("Other (type custom)", `prompt_other:${userId}`).row();
      }
    } else {
      // Multi-select: toggleable buttons with submit
      for (const option of prompt.options) {
        if (option.label.match(/^Other(\s*\(.*\))?$/i)) {
          continue;
        }
        const prefix = option.selected ? "✓ " : "☐ ";
        keyboard.text(prefix + option.label, `prompt_toggle:${userId}:${option.index}`).row();
      }

      // Add submit button
      keyboard.text("Submit", `prompt_submit:${userId}`).row();
    }

    // Add cancel button
    keyboard.text("Cancel", `prompt_cancel:${userId}`);

    return keyboard;
  }

  /**
   * Format prompt for Telegram message
   */
  private formatPromptMessage(prompt: DetectedPrompt): string {
    const lines: string[] = [];

    lines.push(`<b>${this.escapeHtml(prompt.question)}</b>`);
    lines.push("");

    if (prompt.type === "multi") {
      lines.push("<i>Select multiple options, then click Submit</i>");
    } else {
      lines.push("<i>Select an option below</i>");
    }

    return lines.join("\n");
  }

  /**
   * Handle single-select option selection
   */
  private async handleSelect(ctx: Context): Promise<void> {
    const data = ctx.callbackQuery?.data;
    if (!data) return;

    // Parse: prompt_select:userId:index
    const parts = data.split(":");
    if (parts.length !== 3) {
      await ctx.answerCallbackQuery({ text: "Invalid callback data" });
      return;
    }

    const userId = parts[1];
    const optionIndex = parseInt(parts[2], 10);

    // Verify the callback is from the user who owns this prompt
    if (ctx.from?.id.toString() !== userId) {
      logger.warn({ callerId: ctx.from?.id, expectedUserId: userId }, "Unauthorized callback attempt");
      await ctx.answerCallbackQuery({ text: "This prompt is not for you" });
      return;
    }

    // Validate parsed optionIndex
    if (Number.isNaN(optionIndex)) {
      await ctx.answerCallbackQuery({ text: "Invalid option index" });
      return;
    }

    const promptKey = this.findPromptKey(userId);
    if (!promptKey) {
      await ctx.answerCallbackQuery({ text: "Prompt expired or not found" });
      return;
    }

    const pending = this.pendingPrompts.get(promptKey);
    if (!pending) {
      await ctx.answerCallbackQuery({ text: "Prompt expired" });
      return;
    }

    // Validate option index bounds
    if (optionIndex < 0 || optionIndex >= pending.prompt.options.length) {
      await ctx.answerCallbackQuery({ text: "Invalid option" });
      return;
    }

    try {
      // Inject selection into tmux
      await selectOptionByIndex(pending.target, optionIndex, pending.cursorPosition ?? 0);
      pending.cursorPosition = optionIndex;

      // Resolve the promise
      const response: PromptResponse = {
        selectedIndices: [optionIndex],
        isOther: false,
      };

      this.resolvePrompt(promptKey, response);

      // Update message
      const selectedLabel = pending.prompt.options[optionIndex]?.label || `Option ${optionIndex}`;
      await ctx.editMessageText(`<b>Selected:</b> ${this.escapeHtml(selectedLabel)}`, {
        parse_mode: "HTML",
      });

      await ctx.answerCallbackQuery({ text: "Selection sent to Claude" });
    } catch (error) {
      logger.error({ error: (error as Error).message, userId, optionIndex }, "Failed to select option");
      await ctx.answerCallbackQuery({ text: "Failed to send selection" });
    }
  }

  /**
   * Handle multi-select toggle
   */
  private async handleToggle(ctx: Context): Promise<void> {
    const data = ctx.callbackQuery?.data;
    if (!data) return;

    const parts = data.split(":");
    if (parts.length !== 3) {
      await ctx.answerCallbackQuery({ text: "Invalid callback data" });
      return;
    }

    const userId = parts[1];
    const optionIndex = parseInt(parts[2], 10);

    // Verify the callback is from the user who owns this prompt
    if (ctx.from?.id.toString() !== userId) {
      logger.warn({ callerId: ctx.from?.id, expectedUserId: userId }, "Unauthorized toggle attempt");
      await ctx.answerCallbackQuery({ text: "This prompt is not for you" });
      return;
    }

    // Validate parsed optionIndex
    if (Number.isNaN(optionIndex)) {
      await ctx.answerCallbackQuery({ text: "Invalid option index" });
      return;
    }

    const promptKey = this.findPromptKey(userId);
    if (!promptKey) {
      await ctx.answerCallbackQuery({ text: "Prompt expired or not found" });
      return;
    }

    const pending = this.pendingPrompts.get(promptKey);
    if (!pending || !pending.toggledIndices) {
      await ctx.answerCallbackQuery({ text: "Prompt expired" });
      return;
    }

    // Validate option index bounds
    if (optionIndex < 0 || optionIndex >= pending.prompt.options.length) {
      await ctx.answerCallbackQuery({ text: "Invalid option" });
      return;
    }

    try {
      // Toggle in tmux with current cursor position
      await toggleOption(pending.target, optionIndex, pending.cursorPosition ?? 0);
      pending.cursorPosition = optionIndex;

      // Sync state from terminal to avoid desynchronization
      const terminalOutput = await capturePane(pending.target, 50);
      const terminalSelections = getCurrentSelections(terminalOutput);

      if (terminalSelections) {
        // Use terminal state as source of truth
        pending.toggledIndices = new Set(terminalSelections);
      } else {
        // Fallback: update our tracking optimistically
        if (pending.toggledIndices.has(optionIndex)) {
          pending.toggledIndices.delete(optionIndex);
        } else {
          pending.toggledIndices.add(optionIndex);
        }
      }

      // Rebuild keyboard with updated state
      const newKeyboard = this.buildMultiSelectKeyboard(pending.prompt, userId, pending.toggledIndices);

      await ctx.editMessageReplyMarkup({ reply_markup: newKeyboard });
      await ctx.answerCallbackQuery({ text: "Toggled" });
    } catch (error) {
      logger.error({ error: (error as Error).message, userId, optionIndex }, "Failed to toggle option");
      await ctx.answerCallbackQuery({ text: "Failed to toggle" });
    }
  }

  /**
   * Handle multi-select submit
   */
  private async handleSubmit(ctx: Context): Promise<void> {
    const data = ctx.callbackQuery?.data;
    if (!data) return;

    const parts = data.split(":");
    if (parts.length !== 2) {
      await ctx.answerCallbackQuery({ text: "Invalid callback data" });
      return;
    }

    const userId = parts[1];

    // Verify the callback is from the user who owns this prompt
    if (ctx.from?.id.toString() !== userId) {
      logger.warn({ callerId: ctx.from?.id, expectedUserId: userId }, "Unauthorized submit attempt");
      await ctx.answerCallbackQuery({ text: "This prompt is not for you" });
      return;
    }

    const promptKey = this.findPromptKey(userId);
    if (!promptKey) {
      await ctx.answerCallbackQuery({ text: "Prompt expired or not found" });
      return;
    }

    const pending = this.pendingPrompts.get(promptKey);
    if (!pending) {
      await ctx.answerCallbackQuery({ text: "Prompt expired" });
      return;
    }

    try {
      // Submit the multi-select
      await submitMultiSelect(pending.target);

      // Resolve the promise
      const response: PromptResponse = {
        selectedIndices: Array.from(pending.toggledIndices || []),
        isOther: false,
      };

      this.resolvePrompt(promptKey, response);

      // Update message
      const selectedLabels = response.selectedIndices
        .map((i) => pending.prompt.options[i]?.label || `Option ${i}`)
        .join(", ");

      await ctx.editMessageText(
        `<b>Selected:</b> ${this.escapeHtml(selectedLabels || "None")}`,
        { parse_mode: "HTML" }
      );

      await ctx.answerCallbackQuery({ text: "Selections sent to Claude" });
    } catch (error) {
      logger.error({ error: (error as Error).message, userId }, "Failed to submit multi-select");
      await ctx.answerCallbackQuery({ text: "Failed to submit" });
    }
  }

  /**
   * Handle "Other" option - prompt for custom text
   */
  private async handleOther(ctx: Context): Promise<void> {
    const data = ctx.callbackQuery?.data;
    if (!data) return;

    const parts = data.split(":");
    if (parts.length !== 2) {
      await ctx.answerCallbackQuery({ text: "Invalid callback data" });
      return;
    }

    const userId = parts[1];

    // Verify the callback is from the user who owns this prompt
    if (ctx.from?.id.toString() !== userId) {
      logger.warn({ callerId: ctx.from?.id, expectedUserId: userId }, "Unauthorized other attempt");
      await ctx.answerCallbackQuery({ text: "This prompt is not for you" });
      return;
    }

    const promptKey = this.findPromptKey(userId);
    if (!promptKey) {
      await ctx.answerCallbackQuery({ text: "Prompt expired or not found" });
      return;
    }

    const pending = this.pendingPrompts.get(promptKey);
    if (!pending) {
      await ctx.answerCallbackQuery({ text: "Prompt expired" });
      return;
    }

    // Set awaiting text input flag
    pending.awaitingTextInput = true;

    // Update message to prompt for text
    await ctx.editMessageText(
      `<b>${this.escapeHtml(pending.prompt.question)}</b>\n\n` +
        "<i>Please type your custom response as a reply to this message:</i>",
      { parse_mode: "HTML" }
    );

    await ctx.answerCallbackQuery({ text: "Type your response" });
  }

  /**
   * Handle text input for "Other" option
   * Called by message handler when user sends text
   */
  async handleTextInput(userId: string, text: string): Promise<boolean> {
    const promptKey = this.findPromptKey(userId);
    if (!promptKey) {
      return false;
    }

    const pending = this.pendingPrompts.get(promptKey);
    if (!pending || !pending.awaitingTextInput) {
      return false;
    }

    try {
      // First select the "Other" option
      const otherIndex = pending.prompt.options.findIndex((opt) =>
        opt.label.match(/^Other(\s*\(.*\))?$/i)
      );

      if (otherIndex >= 0) {
        await selectOptionByIndex(pending.target, otherIndex, pending.cursorPosition ?? 0);

        // Poll for "Other" input prompt to appear (up to 2 seconds)
        const maxWait = 2000;
        const pollInterval = 100;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
          const output = await capturePane(pending.target, 30);
          // Look for input prompt indicators (no more option markers visible)
          if (!output.includes("○") && !output.includes("●") && !output.includes("☐") && !output.includes("☑")) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
        }
      }

      // Send the custom text
      await sendLiteralText(pending.target, text);

      // Resolve the promise
      const response: PromptResponse = {
        selectedIndices: otherIndex >= 0 ? [otherIndex] : [],
        isOther: true,
        customText: text,
      };

      this.resolvePrompt(promptKey, response);

      // Update original message
      const chatId = parseInt(pending.chatId, 10);
      const messageId = pending.messageId as number;

      await this.bot.api.editMessageText(
        chatId,
        messageId,
        `<b>Custom response sent:</b>\n<pre>${this.escapeHtml(text)}</pre>`,
        { parse_mode: "HTML" }
      );

      logger.info({ userId, textLength: text.length }, "Custom text response sent");
      return true;
    } catch (error) {
      logger.error({ error: (error as Error).message, userId }, "Failed to send custom text");
      return false;
    }
  }

  /**
   * Handle cancel
   */
  private async handleCancel(ctx: Context): Promise<void> {
    const data = ctx.callbackQuery?.data;
    if (!data) return;

    const parts = data.split(":");
    if (parts.length !== 2) {
      await ctx.answerCallbackQuery({ text: "Invalid callback data" });
      return;
    }

    const userId = parts[1];

    // Verify the callback is from the user who owns this prompt
    if (ctx.from?.id.toString() !== userId) {
      logger.warn({ callerId: ctx.from?.id, expectedUserId: userId }, "Unauthorized cancel attempt");
      await ctx.answerCallbackQuery({ text: "This prompt is not for you" });
      return;
    }

    const promptKey = this.findPromptKey(userId);

    if (promptKey) {
      this.resolvePrompt(promptKey, null);
    }

    await ctx.editMessageText("<b>Prompt cancelled</b>", { parse_mode: "HTML" });
    await ctx.answerCallbackQuery({ text: "Cancelled" });
  }

  /**
   * Handle timeout for a pending prompt
   */
  private async handleTimeout(promptKey: string): Promise<void> {
    const pending = this.pendingPrompts.get(promptKey);
    if (!pending) {
      return;
    }

    logger.info({ promptKey }, "Prompt timed out");

    // Send Escape to cancel the prompt in Claude Code
    try {
      await sendNavigationKey(pending.target, "Escape");
      logger.debug({ target: pending.target }, "Sent Escape to cancel prompt");
    } catch (error) {
      logger.warn({ error: (error as Error).message }, "Failed to send Escape key");
    }

    this.resolvePrompt(promptKey, null);

    // Update message
    try {
      const chatId = parseInt(pending.chatId, 10);
      const messageId = pending.messageId as number;

      await this.bot.api.editMessageText(chatId, messageId, "<b>Prompt timed out</b>", {
        parse_mode: "HTML",
      });
    } catch (error) {
      logger.warn({ error: (error as Error).message, promptKey }, "Failed to update timed out message");
    }
  }

  /**
   * Build multi-select keyboard with current toggle state
   */
  private buildMultiSelectKeyboard(
    prompt: DetectedPrompt,
    userId: string,
    toggledIndices: Set<number>
  ): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    for (const option of prompt.options) {
      if (option.label.match(/^Other(\s*\(.*\))?$/i)) {
        continue;
      }
      const isToggled = toggledIndices.has(option.index);
      const prefix = isToggled ? "✓ " : "☐ ";
      keyboard.text(prefix + option.label, `prompt_toggle:${userId}:${option.index}`).row();
    }

    keyboard.text("Submit", `prompt_submit:${userId}`).row();
    keyboard.text("Cancel", `prompt_cancel:${userId}`);

    return keyboard;
  }

  /**
   * Find prompt key by user ID
   */
  private findPromptKey(userId: string): string | null {
    for (const [key, pending] of this.pendingPrompts) {
      if (pending.userId === userId) {
        return key;
      }
    }
    return null;
  }

  /**
   * Resolve a pending prompt
   */
  private resolvePrompt(promptKey: string, response: PromptResponse | null): void {
    const pending = this.pendingPrompts.get(promptKey) as PendingPromptWithResolver | undefined;
    if (!pending) {
      return;
    }

    // Clear timeout
    const timeoutHandle = this.timeoutHandles.get(promptKey);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      this.timeoutHandles.delete(promptKey);
    }

    // Resolve promise
    if (pending.resolve) {
      pending.resolve(response);
    }

    // Remove from pending
    this.pendingPrompts.delete(promptKey);
  }

  /**
   * Cancel a pending prompt
   */
  private async cancelPendingPrompt(promptKey: string): Promise<void> {
    if (this.pendingPrompts.has(promptKey)) {
      this.resolvePrompt(promptKey, null);
    }
  }

  /**
   * Check if user has a pending prompt awaiting text input
   */
  isAwaitingTextInput(userId: string): boolean {
    const promptKey = this.findPromptKey(userId);
    if (!promptKey) {
      return false;
    }
    const pending = this.pendingPrompts.get(promptKey);
    return pending?.awaitingTextInput ?? false;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /**
   * Clean up all pending prompts (for shutdown)
   */
  async cleanup(): Promise<void> {
    logger.info({ count: this.pendingPrompts.size }, "Cleaning up pending prompts");

    for (const [promptKey, pending] of this.pendingPrompts) {
      // Clear timeout
      const timeoutHandle = this.timeoutHandles.get(promptKey);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      // Resolve with null
      const pwithResolver = pending as PendingPromptWithResolver;
      if (pwithResolver.resolve) {
        pwithResolver.resolve(null);
      }

      // Update message
      try {
        const chatId = parseInt(pending.chatId, 10);
        const messageId = pending.messageId as number;
        await this.bot.api.editMessageText(chatId, messageId, "<b>Bot shutting down</b>", {
          parse_mode: "HTML",
        });
      } catch (error) {
        logger.debug({ error: (error as Error).message, promptKey }, "Failed to update message during cleanup");
      }
    }

    this.pendingPrompts.clear();
    this.timeoutHandles.clear();
  }
}

/**
 * Internal type with resolver function
 */
interface PendingPromptWithResolver extends PendingPrompt {
  resolve?: (response: PromptResponse | null) => void;
}
