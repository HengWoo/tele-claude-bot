/**
 * Feishu Interactive Prompt Handler
 *
 * Presents AskUserQuestion prompts as Feishu interactive cards
 * and handles user responses.
 */

import type { FeishuAdapter } from "../platforms/feishu/adapter.js";
import type { DetectedPrompt, PendingPrompt, PromptResponse } from "./types.js";
import { selectOptionByIndex, toggleOption, submitMultiSelect, sendLiteralText, sendNavigationKey, capturePane } from "../tmux/index.js";
import { getCurrentSelections } from "./prompt-parser.js";
import { createChildLogger } from "../utils/logger.js";
import type { InteractiveCard, CardElement, CardAction } from "../platforms/feishu/client.js";

const logger = createChildLogger("feishu-interactive");

// Timeout for prompts (5 minutes)
const PROMPT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Escape markdown special characters for Feishu cards
 */
function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/`/g, "\\`")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

/**
 * Feishu Interactive Handler
 * Manages interactive prompts for Feishu users
 */
export class FeishuInteractiveHandler {
  private adapter: FeishuAdapter;
  private pendingPrompts: Map<string, PendingPrompt> = new Map();
  private timeoutHandles: Map<string, NodeJS.Timeout> = new Map();

  constructor(adapter: FeishuAdapter) {
    this.adapter = adapter;
    this.registerCallbacks();
  }

  /**
   * Register callback handlers for prompt responses
   */
  private registerCallbacks(): void {
    // Single-select option
    this.adapter.onCallback(/^prompt_select:/, (event) => this.handleSelect(event));

    // Multi-select toggle
    this.adapter.onCallback(/^prompt_toggle:/, (event) => this.handleToggle(event));

    // Multi-select submit
    this.adapter.onCallback(/^prompt_submit:/, (event) => this.handleSubmit(event));

    // Other option (custom text)
    this.adapter.onCallback(/^prompt_other:/, (event) => this.handleOther(event));

    // Cancel prompt
    this.adapter.onCallback(/^prompt_cancel:/, (event) => this.handleCancel(event));

    logger.info("Feishu interactive callbacks registered");
  }

  /**
   * Show a prompt to the user as an interactive card
   *
   * @param prompt - Detected prompt from terminal
   * @param userId - User ID
   * @param paneId - tmux pane ID
   * @param target - tmux target
   * @param chatId - Feishu chat ID
   * @returns Promise that resolves when user responds
   */
  async showPrompt(
    prompt: DetectedPrompt,
    userId: string,
    paneId: string,
    target: string,
    chatId: string
  ): Promise<PromptResponse | null> {
    const promptKey = `${userId}:${paneId}`;

    // Cancel any existing prompt for this user
    await this.cancelPendingPrompt(promptKey);

    // Build card
    const card = this.buildCard(prompt, userId);

    try {
      // Send prompt card
      const sentMessage = await this.adapter.getClient().sendCard(chatId, card);

      // Create pending prompt
      const pending: PendingPrompt = {
        prompt,
        userId,
        paneId,
        target,
        chatId,
        messageId: sentMessage,
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
        (pending as PendingPromptWithResolver).resolve = resolve;
      });
    } catch (error) {
      logger.error({ error: (error as Error).message, userId, chatId }, "Failed to send prompt card");
      return null;
    }
  }

  /**
   * Build interactive card for the prompt
   */
  private buildCard(prompt: DetectedPrompt, userId: string): InteractiveCard {
    const elements: CardElement[] = [];

    // Question text (escape markdown to prevent injection)
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**${escapeMarkdown(prompt.question)}**`,
      },
    });

    // Instructions
    elements.push({
      tag: "div",
      text: {
        tag: "plain_text",
        content: prompt.type === "multi"
          ? "Select multiple options, then click Submit"
          : "Select an option below",
      },
    });

    elements.push({ tag: "hr" });

    // Build action buttons
    const actions: CardAction[] = [];

    if (prompt.type === "single") {
      // Single-select: one button per option
      for (const option of prompt.options) {
        if (option.label.match(/^Other(\s*\(.*\))?$/i)) {
          continue;
        }
        actions.push({
          tag: "button",
          text: { tag: "plain_text", content: option.label },
          type: "default",
          value: { action: `prompt_select:${userId}:${option.index}` },
        });
      }

      // Add "Other" button if available
      if (prompt.hasOther) {
        actions.push({
          tag: "button",
          text: { tag: "plain_text", content: "Other (type custom)" },
          type: "default",
          value: { action: `prompt_other:${userId}` },
        });
      }
    } else {
      // Multi-select: toggleable buttons
      for (const option of prompt.options) {
        if (option.label.match(/^Other(\s*\(.*\))?$/i)) {
          continue;
        }
        const prefix = option.selected ? "✓ " : "☐ ";
        actions.push({
          tag: "button",
          text: { tag: "plain_text", content: prefix + option.label },
          type: "default",
          value: { action: `prompt_toggle:${userId}:${option.index}` },
        });
      }

      // Add submit button
      actions.push({
        tag: "button",
        text: { tag: "plain_text", content: "Submit" },
        type: "primary",
        value: { action: `prompt_submit:${userId}` },
      });
    }

    // Add cancel button
    actions.push({
      tag: "button",
      text: { tag: "plain_text", content: "Cancel" },
      type: "danger",
      value: { action: `prompt_cancel:${userId}` },
    });

    // Add action row(s) - Feishu limits buttons per row
    const MAX_BUTTONS_PER_ROW = 3;
    for (let i = 0; i < actions.length; i += MAX_BUTTONS_PER_ROW) {
      const rowActions = actions.slice(i, i + MAX_BUTTONS_PER_ROW);
      elements.push({ tag: "action", actions: rowActions });
    }

    return {
      config: {
        wide_screen_mode: true,
      },
      header: {
        title: { tag: "plain_text", content: "Claude Question" },
        template: "blue",
      },
      elements,
    };
  }

  /**
   * Handle single-select option selection
   */
  private async handleSelect(event: { data: string; from: { id: string }; chat: { id: string } }): Promise<void> {
    // Parse: prompt_select:userId:index
    const parts = event.data.split(":");
    if (parts.length !== 3) {
      logger.debug({ data: event.data }, "Invalid select callback data format");
      return;
    }

    const userId = parts[1];
    const optionIndex = parseInt(parts[2], 10);

    // Verify the callback is from the user who owns this prompt
    if (event.from.id !== userId) {
      logger.warn({ callerId: event.from.id, expectedUserId: userId }, "Unauthorized select attempt");
      return;
    }

    // Validate parsed optionIndex
    if (Number.isNaN(optionIndex)) {
      logger.warn({ userId, rawIndex: parts[2] }, "Invalid option index (NaN)");
      return;
    }

    const promptKey = this.findPromptKey(userId);
    if (!promptKey) {
      logger.debug({ userId }, "No pending prompt found for select");
      return;
    }

    const pending = this.pendingPrompts.get(promptKey);
    if (!pending) {
      logger.debug({ promptKey }, "Pending prompt not in map");
      return;
    }

    // Validate option index bounds
    if (optionIndex < 0 || optionIndex >= pending.prompt.options.length) {
      logger.warn({ userId, optionIndex, maxIndex: pending.prompt.options.length - 1 }, "Option index out of bounds");
      return;
    }

    try {
      // Inject selection into tmux with cursor tracking
      await selectOptionByIndex(pending.target, optionIndex, pending.cursorPosition ?? 0);
      pending.cursorPosition = optionIndex;

      // Resolve the promise
      const response: PromptResponse = {
        selectedIndices: [optionIndex],
        isOther: false,
      };

      this.resolvePrompt(promptKey, response);

      // Update card
      const selectedLabel = pending.prompt.options[optionIndex]?.label || `Option ${optionIndex}`;
      await this.updateCardWithResult(pending.chatId, pending.messageId as string, `Selected: ${selectedLabel}`);

      logger.info({ userId, optionIndex, selectedLabel }, "Option selected");
    } catch (error) {
      logger.error({ error: (error as Error).message, userId, optionIndex }, "Failed to select option");
    }
  }

  /**
   * Handle multi-select toggle
   */
  private async handleToggle(event: { data: string; from: { id: string }; chat: { id: string } }): Promise<void> {
    const parts = event.data.split(":");
    if (parts.length !== 3) {
      logger.debug({ data: event.data }, "Invalid toggle callback data format");
      return;
    }

    const userId = parts[1];
    const optionIndex = parseInt(parts[2], 10);

    // Verify the callback is from the user who owns this prompt
    if (event.from.id !== userId) {
      logger.warn({ callerId: event.from.id, expectedUserId: userId }, "Unauthorized toggle attempt");
      return;
    }

    // Validate parsed optionIndex
    if (Number.isNaN(optionIndex)) {
      logger.warn({ userId, rawIndex: parts[2] }, "Invalid option index (NaN)");
      return;
    }

    const promptKey = this.findPromptKey(userId);
    if (!promptKey) {
      logger.debug({ userId }, "No pending prompt found for toggle");
      return;
    }

    const pending = this.pendingPrompts.get(promptKey);
    if (!pending || !pending.toggledIndices) {
      logger.debug({ promptKey, hasToggledIndices: !!pending?.toggledIndices }, "Pending prompt missing or not multi-select");
      return;
    }

    // Validate option index bounds
    if (optionIndex < 0 || optionIndex >= pending.prompt.options.length) {
      logger.warn({ userId, optionIndex, maxIndex: pending.prompt.options.length - 1 }, "Option index out of bounds");
      return;
    }

    try {
      // Toggle in tmux with cursor tracking
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

      // Rebuild and update card
      const newCard = this.buildMultiSelectCard(pending.prompt, userId, pending.toggledIndices);
      await this.adapter.getClient().updateCard(pending.messageId as string, newCard);

      logger.debug({ userId, optionIndex }, "Option toggled");
    } catch (error) {
      logger.error({ error: (error as Error).message, userId, optionIndex }, "Failed to toggle option");
    }
  }

  /**
   * Handle multi-select submit
   */
  private async handleSubmit(event: { data: string; from: { id: string }; chat: { id: string } }): Promise<void> {
    const parts = event.data.split(":");
    if (parts.length !== 2) {
      logger.debug({ data: event.data }, "Invalid submit callback data format");
      return;
    }

    const userId = parts[1];

    // Verify the callback is from the user who owns this prompt
    if (event.from.id !== userId) {
      logger.warn({ callerId: event.from.id, expectedUserId: userId }, "Unauthorized submit attempt");
      return;
    }

    const promptKey = this.findPromptKey(userId);
    if (!promptKey) {
      logger.debug({ userId }, "No pending prompt found for submit");
      return;
    }

    const pending = this.pendingPrompts.get(promptKey);
    if (!pending) {
      logger.debug({ promptKey }, "Pending prompt not in map");
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

      // Update card
      const selectedLabels = response.selectedIndices
        .map((i) => pending.prompt.options[i]?.label || `Option ${i}`)
        .join(", ");

      await this.updateCardWithResult(
        pending.chatId,
        pending.messageId as string,
        `Selected: ${selectedLabels || "None"}`
      );

      logger.info({ userId, selectedIndices: response.selectedIndices }, "Multi-select submitted");
    } catch (error) {
      logger.error({ error: (error as Error).message, userId }, "Failed to submit multi-select");
    }
  }

  /**
   * Handle "Other" option - prompt for custom text
   */
  private async handleOther(event: { data: string; from: { id: string }; chat: { id: string } }): Promise<void> {
    const parts = event.data.split(":");
    if (parts.length !== 2) {
      logger.debug({ data: event.data }, "Invalid other callback data format");
      return;
    }

    const userId = parts[1];

    // Verify the callback is from the user who owns this prompt
    if (event.from.id !== userId) {
      logger.warn({ callerId: event.from.id, expectedUserId: userId }, "Unauthorized other attempt");
      return;
    }

    const promptKey = this.findPromptKey(userId);
    if (!promptKey) {
      logger.debug({ userId }, "No pending prompt found for other");
      return;
    }

    const pending = this.pendingPrompts.get(promptKey);
    if (!pending) {
      logger.debug({ promptKey }, "Pending prompt not in map");
      return;
    }

    // Set awaiting text input flag
    pending.awaitingTextInput = true;

    // Send a message asking for input
    try {
      await this.adapter.sendMessage(
        pending.chatId,
        `Please type your custom response to: "${escapeMarkdown(pending.prompt.question)}"`
      );
    } catch (error) {
      logger.error({ error: (error as Error).message, userId }, "Failed to send text input prompt");
      pending.awaitingTextInput = false;
    }
  }

  /**
   * Handle text input for "Other" option
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

      // Update card
      await this.updateCardWithResult(
        pending.chatId,
        pending.messageId as string,
        `Custom response: ${text.slice(0, 100)}${text.length > 100 ? "..." : ""}`
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
  private async handleCancel(event: { data: string; from: { id: string }; chat: { id: string } }): Promise<void> {
    const parts = event.data.split(":");
    if (parts.length !== 2) {
      logger.debug({ data: event.data }, "Invalid cancel callback data format");
      return;
    }

    const userId = parts[1];

    // Verify the callback is from the user who owns this prompt
    if (event.from.id !== userId) {
      logger.warn({ callerId: event.from.id, expectedUserId: userId }, "Unauthorized cancel attempt");
      return;
    }

    const promptKey = this.findPromptKey(userId);

    if (promptKey) {
      const pending = this.pendingPrompts.get(promptKey);
      if (pending) {
        await this.updateCardWithResult(pending.chatId, pending.messageId as string, "Cancelled");
      }
      this.resolvePrompt(promptKey, null);
    }
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

    // Update card
    try {
      await this.updateCardWithResult(pending.chatId, pending.messageId as string, "Timed out");
    } catch (error) {
      logger.warn({ error: (error as Error).message, promptKey }, "Failed to update timed out card");
    }
  }

  /**
   * Build multi-select card with current toggle state
   */
  private buildMultiSelectCard(
    prompt: DetectedPrompt,
    userId: string,
    toggledIndices: Set<number>
  ): InteractiveCard {
    const elements: CardElement[] = [];

    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**${escapeMarkdown(prompt.question)}**`,
      },
    });

    elements.push({
      tag: "div",
      text: {
        tag: "plain_text",
        content: "Select multiple options, then click Submit",
      },
    });

    elements.push({ tag: "hr" });

    const actions: CardAction[] = [];

    for (const option of prompt.options) {
      if (option.label.match(/^Other(\s*\(.*\))?$/i)) {
        continue;
      }
      const isToggled = toggledIndices.has(option.index);
      const prefix = isToggled ? "✓ " : "☐ ";
      actions.push({
        tag: "button",
        text: { tag: "plain_text", content: prefix + option.label },
        type: isToggled ? "primary" : "default",
        value: { action: `prompt_toggle:${userId}:${option.index}` },
      });
    }

    actions.push({
      tag: "button",
      text: { tag: "plain_text", content: "Submit" },
      type: "primary",
      value: { action: `prompt_submit:${userId}` },
    });

    actions.push({
      tag: "button",
      text: { tag: "plain_text", content: "Cancel" },
      type: "danger",
      value: { action: `prompt_cancel:${userId}` },
    });

    const MAX_BUTTONS_PER_ROW = 3;
    for (let i = 0; i < actions.length; i += MAX_BUTTONS_PER_ROW) {
      const rowActions = actions.slice(i, i + MAX_BUTTONS_PER_ROW);
      elements.push({ tag: "action", actions: rowActions });
    }

    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: "Claude Question" },
        template: "blue",
      },
      elements,
    };
  }

  /**
   * Update card with result message
   */
  private async updateCardWithResult(_chatId: string, messageId: string, result: string): Promise<void> {
    const card: InteractiveCard = {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: "Claude Question" },
        template: result.includes("Cancelled") || result.includes("Timed out") ? "grey" : "green",
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `**${escapeMarkdown(result)}**`,
          },
        },
      ],
    };

    await this.adapter.getClient().updateCard(messageId, card);
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

    const timeoutHandle = this.timeoutHandles.get(promptKey);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      this.timeoutHandles.delete(promptKey);
    }

    if (pending.resolve) {
      pending.resolve(response);
    }

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
   * Clean up all pending prompts (for shutdown)
   */
  async cleanup(): Promise<void> {
    logger.info({ count: this.pendingPrompts.size }, "Cleaning up pending prompts");

    for (const [promptKey, pending] of this.pendingPrompts) {
      const timeoutHandle = this.timeoutHandles.get(promptKey);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      const pwithResolver = pending as PendingPromptWithResolver;
      if (pwithResolver.resolve) {
        pwithResolver.resolve(null);
      }

      try {
        await this.updateCardWithResult(pending.chatId, pending.messageId as string, "Bot shutting down");
      } catch (error) {
        logger.debug({ error: (error as Error).message, promptKey }, "Failed to update card during cleanup");
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
