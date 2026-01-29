/**
 * Telegram Platform Adapter
 * Wraps Grammy bot to implement the PlatformAdapter interface
 */

import { Bot, InlineKeyboard } from "grammy";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { TelegramConfig, BotContext } from "../../types.js";
import type {
  PlatformAdapter,
  MessageHandler,
  CommandHandler,
  CallbackHandler,
  FileHandler,
  SentMessage,
} from "../interface.js";
import type {
  PlatformMessage,
  PlatformChat,
  PlatformUser,
  PlatformFile,
  SendOptions,
  MessageEvent,
  CommandEvent,
  CallbackEvent,
  FileEvent,
} from "../types.js";
import { parseCommand, createPlatformMessage } from "../interface.js";
import { createChildLogger } from "../../utils/logger.js";
import { formatToHtml } from "../../utils/telegram-formatter.js";

const logger = createChildLogger("telegram-adapter");

/**
 * Convert Telegram user to PlatformUser
 */
function toPlatformUser(user: { id: number; first_name: string; last_name?: string; username?: string }): PlatformUser {
  return {
    id: String(user.id),
    platform: "telegram",
    name: user.last_name ? `${user.first_name} ${user.last_name}` : user.first_name,
    username: user.username,
  };
}

/**
 * Convert Telegram chat to PlatformChat
 */
function toPlatformChat(chat: { id: number; type: string; title?: string }): PlatformChat {
  return {
    id: String(chat.id),
    platform: "telegram",
    type: chat.type === "private" ? "private" : chat.type === "channel" ? "channel" : "group",
    title: chat.title,
  };
}

/**
 * Build inline keyboard from platform buttons
 */
function buildKeyboard(buttons?: SendOptions["buttons"]): InlineKeyboard | undefined {
  if (!buttons || buttons.length === 0) return undefined;

  const keyboard = new InlineKeyboard();
  for (const row of buttons) {
    for (const button of row) {
      if (button.url) {
        keyboard.url(button.text, button.url);
      } else if (button.callbackData) {
        keyboard.text(button.text, button.callbackData);
      }
    }
    keyboard.row();
  }
  return keyboard;
}

/**
 * Telegram adapter implementing PlatformAdapter
 */
export class TelegramAdapter implements PlatformAdapter {
  readonly platform = "telegram" as const;
  readonly name = "Telegram";

  private bot: Bot<BotContext>;
  private config: TelegramConfig;
  private running = false;
  private messageHandlers: MessageHandler[] = [];
  private commandHandlers: Map<string, CommandHandler> = new Map();
  private callbackHandlers: Array<{ pattern: RegExp; handler: CallbackHandler }> = [];
  private fileHandlers: FileHandler[] = [];

  constructor(config: TelegramConfig) {
    this.config = config;
    this.bot = new Bot<BotContext>(config.token);
    this.setupMiddleware();
  }

  /**
   * Get the underlying Grammy bot instance
   * Useful for backward compatibility with existing code
   */
  getBot(): Bot<BotContext> {
    return this.bot;
  }

  private setupMiddleware(): void {
    // Authentication middleware
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (!userId) {
        logger.warn("Received update without user ID");
        return;
      }

      if (!this.isUserAuthorized(String(userId))) {
        logger.warn({ userId }, "Unauthorized user");
        await ctx.reply("Sorry, you are not authorized to use this bot.");
        return;
      }

      await next();
    });

    // Logging middleware
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      const startTime = Date.now();
      const updateType = ctx.update.message ? "message" :
        ctx.update.callback_query ? "callback_query" :
        ctx.update.edited_message ? "edited_message" : "other";

      logger.debug({ userId, updateType }, "Incoming update");

      try {
        await next();
      } finally {
        const duration = Date.now() - startTime;
        logger.debug({ userId, duration }, "Update processed");
      }
    });

    // Error handler
    this.bot.catch((err) => {
      logger.error(
        {
          updateId: err.ctx.update.update_id,
          userId: err.ctx.from?.id,
          error: err.error instanceof Error ? err.error.message : String(err.error),
        },
        "Bot error"
      );
      err.ctx.reply("An error occurred. Please try again.").catch(() => {});
    });
  }

  async start(): Promise<void> {
    if (this.running) return;

    logger.info("Starting Telegram adapter...");

    // Delete webhook to ensure long polling works
    await this.bot.api.deleteWebhook();

    // Start long polling
    this.bot.start({
      onStart: (botInfo) => {
        logger.info({ username: botInfo.username }, "Telegram bot started");
        this.running = true;
      },
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    logger.info("Stopping Telegram adapter...");
    await this.bot.stop();
    this.running = false;
    logger.info("Telegram adapter stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(chatId: string, text: string, options?: SendOptions): Promise<SentMessage> {
    const formattedText = options?.parseMode === "html" || options?.parseMode === "markdown"
      ? text
      : formatToHtml(text);

    const keyboard = buildKeyboard(options?.buttons);

    const sent = await this.bot.api.sendMessage(chatId, formattedText, {
      parse_mode: options?.parseMode === "plain" ? undefined : "HTML",
      reply_markup: keyboard,
      reply_parameters: options?.replyToMessageId
        ? { message_id: parseInt(options.replyToMessageId, 10) }
        : undefined,
      link_preview_options: options?.disableLinkPreview
        ? { is_disabled: true }
        : undefined,
    });

    return {
      id: String(sent.message_id),
      chatId: String(sent.chat.id),
    };
  }

  async editMessage(chatId: string, messageId: string, text: string, options?: SendOptions): Promise<void> {
    const formattedText = options?.parseMode === "html" || options?.parseMode === "markdown"
      ? text
      : formatToHtml(text);

    const keyboard = buildKeyboard(options?.buttons);

    await this.bot.api.editMessageText(chatId, parseInt(messageId, 10), formattedText, {
      parse_mode: options?.parseMode === "plain" ? undefined : "HTML",
      reply_markup: keyboard,
    });
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    await this.bot.api.deleteMessage(chatId, parseInt(messageId, 10));
  }

  async downloadFile(fileId: string, destPath: string): Promise<string> {
    const file = await this.bot.api.getFile(fileId);
    if (!file.file_path) {
      throw new Error("No file path returned from Telegram");
    }

    const url = `https://api.telegram.org/file/bot${this.config.token}/${file.file_path}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }

    const fileStream = createWriteStream(destPath);
    await pipeline(response.body as unknown as NodeJS.ReadableStream, fileStream);

    return destPath;
  }

  async answerCallback(callbackId: string, text?: string, showAlert?: boolean): Promise<void> {
    await this.bot.api.answerCallbackQuery(callbackId, {
      text,
      show_alert: showAlert,
    });
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);

    // Register with Grammy if this is the first handler
    if (this.messageHandlers.length === 1) {
      this.bot.on("message:text", async (ctx) => {
        const text = ctx.message.text;

        // Skip commands
        if (text.startsWith("/")) return;

        const platformMessage = this.ctxToPlatformMessage(ctx);
        const event: MessageEvent = {
          type: "message",
          platform: "telegram",
          timestamp: Date.now(),
          message: platformMessage,
        };

        for (const h of this.messageHandlers) {
          await h(event);
        }
      });
    }
  }

  onCommand(command: string, handler: CommandHandler): void {
    this.commandHandlers.set(command, handler);

    this.bot.command(command, async (ctx) => {
      const text = ctx.message?.text || "";
      const parsed = parseCommand(text);
      if (!parsed) return;

      const platformMessage = this.ctxToPlatformMessage(ctx);
      const event: CommandEvent = {
        type: "command",
        platform: "telegram",
        timestamp: Date.now(),
        message: platformMessage,
        command: parsed,
      };

      await handler(event);
    });
  }

  onCallback(pattern: string | RegExp, handler: CallbackHandler): void {
    const regex = typeof pattern === "string" ? new RegExp(`^${pattern}`) : pattern;
    this.callbackHandlers.push({ pattern: regex, handler });

    this.bot.callbackQuery(regex, async (ctx) => {
      const data = ctx.callbackQuery.data || "";
      const event: CallbackEvent = {
        type: "callback",
        platform: "telegram",
        timestamp: Date.now(),
        callbackId: ctx.callbackQuery.id,
        data,
        from: toPlatformUser(ctx.from),
        chat: ctx.callbackQuery.message
          ? toPlatformChat(ctx.callbackQuery.message.chat)
          : { id: String(ctx.from.id), platform: "telegram", type: "private" },
        message: ctx.callbackQuery.message
          ? this.msgToPlatformMessage(ctx.callbackQuery.message)
          : undefined,
      };

      await handler(event);
    });
  }

  onFile(handler: FileHandler): void {
    this.fileHandlers.push(handler);

    // Register file handlers if this is the first
    if (this.fileHandlers.length === 1) {
      // Photo handler
      this.bot.on("message:photo", async (ctx) => {
        const photos = ctx.message.photo;
        if (!photos.length) return;

        const photo = photos[photos.length - 1]; // Highest resolution
        const platformMessage = this.ctxToPlatformMessage(ctx);
        const file: PlatformFile = {
          id: photo.file_id,
          name: `photo_${Date.now()}.jpg`,
          mimeType: "image/jpeg",
          size: photo.file_size || 0,
          type: "image",
        };
        platformMessage.files = [file];

        const event: FileEvent = {
          type: "file",
          platform: "telegram",
          timestamp: Date.now(),
          message: platformMessage,
          file,
        };

        for (const h of this.fileHandlers) {
          await h(event);
        }
      });

      // Document handler
      this.bot.on("message:document", async (ctx) => {
        const doc = ctx.message.document;
        const platformMessage = this.ctxToPlatformMessage(ctx);
        const file: PlatformFile = {
          id: doc.file_id,
          name: doc.file_name || "document",
          mimeType: doc.mime_type || "application/octet-stream",
          size: doc.file_size || 0,
          type: this.getFileType(doc.mime_type || ""),
        };
        platformMessage.files = [file];

        const event: FileEvent = {
          type: "file",
          platform: "telegram",
          timestamp: Date.now(),
          message: platformMessage,
          file,
        };

        for (const h of this.fileHandlers) {
          await h(event);
        }
      });
    }
  }

  isUserAuthorized(userId: string): boolean {
    const numericId = parseInt(userId, 10);
    return this.config.allowedUsers.includes(numericId);
  }

  async getBotInfo(): Promise<{ id: string; name: string; username?: string }> {
    const me = await this.bot.api.getMe();
    return {
      id: String(me.id),
      name: me.first_name,
      username: me.username,
    };
  }

  private ctxToPlatformMessage(ctx: { from?: { id: number; first_name: string; last_name?: string; username?: string }; chat?: { id: number; type: string; title?: string }; message?: { message_id: number; text?: string; date: number; caption?: string } }): PlatformMessage {
    const from = ctx.from
      ? toPlatformUser(ctx.from)
      : { id: "unknown", platform: "telegram" as const };
    const chat = ctx.chat
      ? toPlatformChat(ctx.chat)
      : { id: "unknown", platform: "telegram" as const, type: "private" as const };
    const msg = ctx.message;

    return createPlatformMessage(
      "telegram",
      msg ? String(msg.message_id) : "0",
      chat,
      from,
      msg?.text || msg?.caption,
      msg ? msg.date * 1000 : Date.now()
    );
  }

  private msgToPlatformMessage(msg: { message_id: number; chat: { id: number; type: string; title?: string }; from?: { id: number; first_name: string; last_name?: string; username?: string }; text?: string; date: number; caption?: string }): PlatformMessage {
    const from = msg.from
      ? toPlatformUser(msg.from)
      : { id: "unknown", platform: "telegram" as const };
    const chat = toPlatformChat(msg.chat);

    return createPlatformMessage(
      "telegram",
      String(msg.message_id),
      chat,
      from,
      msg.text || msg.caption,
      msg.date * 1000
    );
  }

  private getFileType(mimeType: string): PlatformFile["type"] {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("text/") || mimeType.includes("json") || mimeType.includes("xml")) return "document";
    return "other";
  }
}
