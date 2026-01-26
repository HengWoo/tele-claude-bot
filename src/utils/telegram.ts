import type { Context } from "grammy";
import { getConfig } from "../config.js";
import { createChildLogger } from "./logger.js";

const logger = createChildLogger("telegram-utils");

/**
 * Escape special characters for Telegram MarkdownV2 format
 * See: https://core.telegram.org/bots/api#markdownv2-style
 */
export function escapeMarkdown(text: string): string {
  // Characters that need to be escaped in MarkdownV2
  const specialChars = ["_", "*", "[", "]", "(", ")", "~", "`", ">", "#", "+", "-", "=", "|", "{", "}", ".", "!"];
  let escaped = text;
  for (const char of specialChars) {
    escaped = escaped.split(char).join(`\\${char}`);
  }
  return escaped;
}

/**
 * Send a message with automatic retry on failure
 */
export async function sendWithRetry(
  ctx: Context,
  text: string,
  options: Parameters<Context["reply"]>[1] = {},
  retries = 3
): Promise<ReturnType<Context["reply"]>> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await ctx.reply(text, options);
    } catch (error) {
      lastError = error as Error;
      logger.warn({ attempt, retries, error: lastError.message }, "Send failed, retrying");

      if (attempt < retries) {
        // Exponential backoff: 1s, 2s, 4s...
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  logger.error({ error: lastError?.message }, "All send attempts failed");
  throw lastError;
}

/**
 * Stream text to Telegram with throttled message edits
 * Collects chunks from an async iterator and updates the message periodically
 */
export async function streamToTelegram(
  ctx: Context,
  asyncIterator: AsyncIterable<string>
): Promise<void> {
  const config = getConfig();
  const throttleMs = config.telegram.rateLimit.editThrottleMs;

  let message: Awaited<ReturnType<Context["reply"]>> | null = null;
  let accumulatedText = "";
  let lastEditTime = 0;
  let pendingEdit = false;

  const doEdit = async () => {
    if (!message || !accumulatedText.trim()) return;

    const now = Date.now();
    const timeSinceLastEdit = now - lastEditTime;

    if (timeSinceLastEdit < throttleMs) {
      // Schedule edit for later if not already pending
      if (!pendingEdit) {
        pendingEdit = true;
        setTimeout(async () => {
          pendingEdit = false;
          await doEdit();
        }, throttleMs - timeSinceLastEdit);
      }
      return;
    }

    try {
      await ctx.api.editMessageText(
        message.chat.id,
        message.message_id,
        accumulatedText
      );
      lastEditTime = Date.now();
    } catch (error) {
      const err = error as Error;
      // Ignore "message is not modified" errors
      if (!err.message?.includes("message is not modified")) {
        logger.warn({ error: err.message }, "Failed to edit message");
      }
    }
  };

  try {
    // Send initial "thinking" message
    message = await sendWithRetry(ctx, "...", {});

    for await (const chunk of asyncIterator) {
      accumulatedText += chunk;
      await doEdit();
    }

    // Final edit to ensure complete text is shown
    if (message && accumulatedText.trim()) {
      // Wait a bit to avoid rate limits on final edit
      const timeSinceLastEdit = Date.now() - lastEditTime;
      if (timeSinceLastEdit < throttleMs) {
        await new Promise((resolve) => setTimeout(resolve, throttleMs - timeSinceLastEdit));
      }

      try {
        await ctx.api.editMessageText(
          message.chat.id,
          message.message_id,
          accumulatedText
        );
      } catch (error) {
        const err = error as Error;
        if (!err.message?.includes("message is not modified")) {
          logger.warn({ error: err.message }, "Failed to send final edit");
        }
      }
    }
  } catch (error) {
    logger.error({ error: (error as Error).message }, "Stream to Telegram failed");
    throw error;
  }
}

/**
 * Split a long message into chunks that fit Telegram's 4096 character limit
 */
export function splitMessage(text: string, maxLength = 4096): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      // Try to split at a space
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      // Force split at max length
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}

/**
 * Send a potentially long message, splitting if necessary
 */
export async function sendLongMessage(
  ctx: Context,
  text: string,
  options: Parameters<Context["reply"]>[1] = {}
): Promise<void> {
  const chunks = splitMessage(text);

  for (const chunk of chunks) {
    await sendWithRetry(ctx, chunk, options);
  }
}
