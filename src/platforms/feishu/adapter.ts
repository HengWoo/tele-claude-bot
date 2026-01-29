/**
 * Feishu Platform Adapter
 * Implements PlatformAdapter for Feishu/Lark messaging platform
 */

import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import type { FeishuConfig } from "../../types.js";
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
import { FeishuClient } from "./client.js";
import { FeishuWebhookServer, type MessageReceiveEvent, type CardActionEvent } from "./server.js";
import { markdownToPlainText, truncateForFeishu, buildInteractiveCard } from "./formatter.js";
import { createChildLogger } from "../../utils/logger.js";

const logger = createChildLogger("feishu-adapter");

/**
 * Feishu adapter implementing PlatformAdapter
 */
export class FeishuAdapter implements PlatformAdapter {
  readonly platform = "feishu" as const;
  readonly name = "Feishu";

  private client: FeishuClient;
  private server: FeishuWebhookServer;
  private config: FeishuConfig;
  private running = false;
  private messageHandlers: MessageHandler[] = [];
  private commandHandlers: Map<string, CommandHandler> = new Map();
  private callbackHandlers: Array<{ pattern: RegExp; handler: CallbackHandler }> = [];
  private fileHandlers: FileHandler[] = [];
  private downloadDir: string;

  constructor(config: FeishuConfig) {
    this.config = config;
    this.client = new FeishuClient(config);
    this.server = new FeishuWebhookServer(config);
    this.downloadDir = join(process.cwd(), "data", "feishu-downloads");

    // Ensure download directory exists
    if (!existsSync(this.downloadDir)) {
      mkdirSync(this.downloadDir, { recursive: true });
    }

    this.setupEventHandlers();
  }

  /**
   * Get the Feishu client for direct API access
   */
  getClient(): FeishuClient {
    return this.client;
  }

  private setupEventHandlers(): void {
    // Handle incoming messages
    this.server.onMessageReceive(async (event: MessageReceiveEvent) => {
      const senderId = event.event.sender.sender_id.open_id;

      // Check authorization
      if (!senderId || !this.isUserAuthorized(senderId)) {
        logger.warn({ senderId }, "Unauthorized Feishu user");
        return;
      }

      const message = event.event.message;
      let textContent = "";

      // Parse message content based on type
      if (message.message_type === "text") {
        try {
          const content = JSON.parse(message.content);
          textContent = content.text || "";
        } catch (error) {
          logger.warn(
            { messageId: message.message_id, error: (error as Error).message },
            "Failed to parse text message JSON, using raw content"
          );
          textContent = message.content;
        }
      } else if (message.message_type === "post") {
        // Rich text - extract plain text
        try {
          const content = JSON.parse(message.content);
          textContent = this.extractPostText(content);
        } catch (error) {
          logger.warn(
            { messageId: message.message_id, error: (error as Error).message },
            "Failed to parse post message JSON, using raw content"
          );
          textContent = message.content;
        }
      } else if (message.message_type === "image" || message.message_type === "file") {
        // Handle file messages
        await this.handleFileMessage(event);
        return;
      }

      // Remove bot mention if present
      textContent = this.stripBotMention(textContent, message.mentions);

      const platformMessage = this.eventToPlatformMessage(event, textContent);

      // Check if it's a command
      const parsed = parseCommand(textContent);
      if (parsed) {
        const handler = this.commandHandlers.get(parsed.command);
        if (handler) {
          const commandEvent: CommandEvent = {
            type: "command",
            platform: "feishu",
            timestamp: Date.now(),
            message: platformMessage,
            command: parsed,
          };
          await handler(commandEvent);
          return;
        }
      }

      // Regular message
      const messageEvent: MessageEvent = {
        type: "message",
        platform: "feishu",
        timestamp: Date.now(),
        message: platformMessage,
      };

      for (const handler of this.messageHandlers) {
        await handler(messageEvent);
      }
    });

    // Handle card actions (button clicks)
    this.server.onCardAction(async (event: CardActionEvent) => {
      const senderId = event.open_id;

      if (!this.isUserAuthorized(senderId)) {
        logger.warn({ senderId }, "Unauthorized card action");
        return { toast: { type: "error", content: "Unauthorized" } };
      }

      const actionValue = event.action.value.action || "";

      const callbackEvent: CallbackEvent = {
        type: "callback",
        platform: "feishu",
        timestamp: Date.now(),
        callbackId: event.token,
        data: actionValue,
        from: {
          id: senderId,
          platform: "feishu",
        },
        chat: {
          id: event.open_chat_id,
          platform: "feishu",
          type: "private", // Assume private for now
        },
      };

      for (const { pattern, handler } of this.callbackHandlers) {
        if (pattern.test(actionValue)) {
          await handler(callbackEvent);
          return { toast: { type: "success", content: "Processed" } };
        }
      }

      return undefined;
    });
  }

  private stripBotMention(
    text: string,
    mentions?: Array<{ key: string; name: string }>
  ): string {
    if (!mentions) return text.trim();

    let result = text;
    for (const mention of mentions) {
      // Remove @mention patterns
      result = result.replace(new RegExp(`@${mention.name}`, "g"), "");
      result = result.replace(new RegExp(mention.key, "g"), "");
    }
    return result.trim();
  }

  private extractPostText(content: unknown): string {
    // Extract plain text from Feishu post format
    if (!content || typeof content !== "object") return "";

    const post = content as Record<string, unknown>;
    const firstLang = Object.values(post)[0] as Record<string, unknown> | undefined;
    if (!firstLang || !firstLang.content) return "";

    const paragraphs = firstLang.content as Array<Array<{ text?: string }>>;
    return paragraphs
      .flat()
      .map((item) => item.text || "")
      .join("")
      .trim();
  }

  private async handleFileMessage(event: MessageReceiveEvent): Promise<void> {
    const message = event.event.message;
    const senderId = event.event.sender.sender_id.open_id || "unknown";

    let fileKey = "";
    let fileName = "file";
    let fileType: PlatformFile["type"] = "other";

    try {
      const content = JSON.parse(message.content);

      if (message.message_type === "image") {
        fileKey = content.image_key;
        fileName = `image_${Date.now()}.png`;
        fileType = "image";
      } else if (message.message_type === "file") {
        fileKey = content.file_key;
        fileName = content.file_name || "file";
        fileType = "document";
      }
    } catch (error) {
      logger.warn(
        { messageId: message.message_id, error: (error as Error).message },
        "Failed to parse file content"
      );
      // Notify user that file couldn't be processed
      try {
        await this.sendMessage(message.chat_id, "Sorry, I couldn't process your file. Please try a different format.");
      } catch {
        // Ignore send failure
      }
      return;
    }

    if (!fileKey) return;

    const file: PlatformFile = {
      id: fileKey,
      name: fileName,
      mimeType: "application/octet-stream",
      size: 0,
      type: fileType,
    };

    const platformMessage = this.eventToPlatformMessage(event, `[File: ${fileName}]`);
    platformMessage.files = [file];

    const fileEvent: FileEvent = {
      type: "file",
      platform: "feishu",
      timestamp: Date.now(),
      message: platformMessage,
      file,
    };

    for (const handler of this.fileHandlers) {
      await handler(fileEvent);
    }
  }

  private eventToPlatformMessage(event: MessageReceiveEvent, text: string): PlatformMessage {
    const message = event.event.message;
    const sender = event.event.sender;

    const from: PlatformUser = {
      id: sender.sender_id.open_id || "unknown",
      platform: "feishu",
    };

    const chat: PlatformChat = {
      id: message.chat_id,
      platform: "feishu",
      type: message.chat_type === "p2p" ? "private" : "group",
    };

    return createPlatformMessage(
      "feishu",
      message.message_id,
      chat,
      from,
      text,
      parseInt(message.create_time, 10)
    );
  }

  async start(): Promise<void> {
    if (this.running) return;

    logger.info("Starting Feishu adapter...");
    await this.server.start();
    this.running = true;

    // Warn if no allowed users configured (auth bypass for testing)
    if (this.config.allowedUsers.length === 0) {
      logger.warn(
        "SECURITY: No FEISHU_ALLOWED_USERS configured - all users can interact with the bot. " +
        "Configure allowed user IDs in production."
      );
    }

    logger.info({ port: this.config.webhookPort }, "Feishu adapter started");
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    logger.info("Stopping Feishu adapter...");
    await this.server.stop();
    this.running = false;
    logger.info("Feishu adapter stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(chatId: string, text: string, options?: SendOptions): Promise<SentMessage> {
    const formattedText = truncateForFeishu(
      options?.parseMode === "markdown" ? text : markdownToPlainText(text)
    );

    let messageId: string;

    // Use interactive card if we have buttons
    if (options?.buttons && options.buttons.length > 0) {
      const card = buildInteractiveCard(formattedText, options.buttons);
      messageId = await this.client.sendCard(chatId, card);
    } else {
      messageId = await this.client.sendText(chatId, formattedText);
    }

    return {
      id: messageId,
      chatId,
    };
  }

  async editMessage(_chatId: string, messageId: string, text: string, options?: SendOptions): Promise<void> {
    const formattedText = truncateForFeishu(
      options?.parseMode === "markdown" ? text : markdownToPlainText(text)
    );

    await this.client.updateMessage(messageId, formattedText);
  }

  async deleteMessage(_chatId: string, messageId: string): Promise<void> {
    await this.client.deleteMessage(messageId);
  }

  async downloadFile(fileId: string, destPath: string): Promise<string> {
    // Determine if it's an image or file based on key prefix
    const isImage = fileId.startsWith("img_");
    return await this.client.downloadFile(fileId, destPath, isImage ? "image" : "file");
  }

  async answerCallback(callbackId: string, text?: string, _showAlert?: boolean): Promise<void> {
    // Feishu card actions are responded to via the HTTP response
    // This is handled in the card action handler returning a toast
    logger.debug({ callbackId, text }, "Callback answer (handled via HTTP response)");
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  onCommand(command: string, handler: CommandHandler): void {
    this.commandHandlers.set(command, handler);
  }

  onCallback(pattern: string | RegExp, handler: CallbackHandler): void {
    const regex = typeof pattern === "string" ? new RegExp(`^${pattern}`) : pattern;
    this.callbackHandlers.push({ pattern: regex, handler });
  }

  onFile(handler: FileHandler): void {
    this.fileHandlers.push(handler);
  }

  isUserAuthorized(userId: string): boolean {
    // If no allowed users configured, allow all (for testing)
    if (this.config.allowedUsers.length === 0) {
      return true;
    }
    return this.config.allowedUsers.includes(userId);
  }

  async getBotInfo(): Promise<{ id: string; name: string; username?: string }> {
    // Feishu doesn't have a simple "get bot info" API
    // Return app ID as identifier
    return {
      id: this.config.appId,
      name: "Feishu Bot",
    };
  }
}
