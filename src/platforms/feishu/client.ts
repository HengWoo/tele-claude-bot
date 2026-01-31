/**
 * Feishu/Lark SDK Client Wrapper
 * Provides simplified interface to Feishu Open Platform APIs
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { FeishuConfig, FeishuDomain } from "../../types.js";
import { createChildLogger } from "../../utils/logger.js";

const logger = createChildLogger("feishu-client");

/**
 * Message content types
 */
export interface TextContent {
  text: string;
}

export interface RichTextParagraph {
  tag: "text" | "a" | "at" | "img";
  text?: string;
  href?: string;
  user_id?: string;
  image_key?: string;
  style?: string[];
}

export interface RichTextContent {
  title?: string;
  content: RichTextParagraph[][];
}

export interface InteractiveCard {
  config?: {
    wide_screen_mode?: boolean;
    enable_forward?: boolean;
  };
  header?: {
    title: {
      tag: "plain_text";
      content: string;
    };
    template?: string;
  };
  elements: CardElement[];
}

export type CardElement =
  | { tag: "div"; text: { tag: "plain_text" | "lark_md"; content: string } }
  | { tag: "hr" }
  | { tag: "action"; actions: CardAction[] };

export type CardAction = {
  tag: "button";
  text: { tag: "plain_text"; content: string };
  type: "default" | "primary" | "danger";
  value: Record<string, string>;
};

/**
 * Received message event data
 */
export interface FeishuMessageEvent {
  message_id: string;
  root_id?: string;
  parent_id?: string;
  create_time: string;
  chat_id: string;
  chat_type: "p2p" | "group";
  message_type: string;
  content: string;
  mentions?: Array<{
    key: string;
    id: { open_id?: string; union_id?: string; user_id?: string };
    name: string;
    tenant_key: string;
  }>;
}

export interface FeishuSender {
  sender_id: {
    open_id?: string;
    union_id?: string;
    user_id?: string;
  };
  sender_type: string;
  tenant_key: string;
}

/**
 * Feishu client wrapper
 */
export class FeishuClient {
  private client: lark.Client;
  private config: FeishuConfig;

  constructor(config: FeishuConfig) {
    this.config = config;

    const domain = this.getDomain(config.domain);

    this.client = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      domain,
      loggerLevel: lark.LoggerLevel.warn,
    });

    logger.info({ domain: config.domain }, "Feishu client initialized");
  }

  private getDomain(domain: FeishuDomain): lark.Domain {
    return domain === "lark" ? lark.Domain.Lark : lark.Domain.Feishu;
  }

  /**
   * Get the underlying Lark SDK client
   */
  getClient(): lark.Client {
    return this.client;
  }

  /**
   * Send a text message
   */
  async sendText(chatId: string, text: string): Promise<string> {
    const content = JSON.stringify({ text });

    const response = await this.client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "text",
        content,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to send message: ${response.msg}`);
    }

    logger.debug({ chatId, messageId: response.data?.message_id }, "Text message sent");
    return response.data?.message_id || "";
  }

  /**
   * Send a rich text (post) message
   */
  async sendRichText(chatId: string, content: RichTextContent, lang = "zh_cn"): Promise<string> {
    const post = {
      [lang]: content,
    };

    const response = await this.client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "post",
        content: JSON.stringify({ post }),
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to send rich text: ${response.msg}`);
    }

    logger.debug({ chatId, messageId: response.data?.message_id }, "Rich text message sent");
    return response.data?.message_id || "";
  }

  /**
   * Send an interactive card message
   */
  async sendCard(chatId: string, card: InteractiveCard): Promise<string> {
    const response = await this.client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "interactive",
        content: JSON.stringify(card),
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to send card: ${response.msg}`);
    }

    logger.debug({ chatId, messageId: response.data?.message_id }, "Card message sent");
    return response.data?.message_id || "";
  }

  /**
   * Reply to a message
   */
  async reply(messageId: string, text: string): Promise<string> {
    const content = JSON.stringify({ text });

    const response = await this.client.im.message.reply({
      path: { message_id: messageId },
      data: {
        msg_type: "text",
        content,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to reply: ${response.msg}`);
    }

    logger.debug({ originalMessageId: messageId, replyId: response.data?.message_id }, "Reply sent");
    return response.data?.message_id || "";
  }

  /**
   * Update/patch an existing message
   */
  async updateMessage(messageId: string, text: string): Promise<void> {
    const content = JSON.stringify({ text });

    const response = await this.client.im.message.patch({
      path: { message_id: messageId },
      data: { content },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to update message: ${response.msg}`);
    }

    logger.debug({ messageId }, "Message updated");
  }

  /**
   * Update/patch an existing interactive card
   */
  async updateCard(messageId: string, card: InteractiveCard): Promise<void> {
    const content = JSON.stringify(card);

    const response = await this.client.im.message.patch({
      path: { message_id: messageId },
      data: { content },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to update card: ${response.msg}`);
    }

    logger.debug({ messageId }, "Card updated");
  }

  /**
   * Delete a message
   */
  async deleteMessage(messageId: string): Promise<void> {
    const response = await this.client.im.message.delete({
      path: { message_id: messageId },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to delete message: ${response.msg}`);
    }

    logger.debug({ messageId }, "Message deleted");
  }

  /**
   * Download a file/image to local path
   */
  async downloadFile(fileKey: string, destPath: string, type: "file" | "image" = "file"): Promise<string> {
    let response;

    if (type === "image") {
      response = await this.client.im.image.get({
        path: { image_key: fileKey },
      });
    } else {
      response = await this.client.im.file.get({
        path: { file_key: fileKey },
      });
    }

    if (!response) {
      throw new Error("Failed to download file: empty response");
    }

    const fileStream = createWriteStream(destPath);
    await pipeline(response as unknown as NodeJS.ReadableStream, fileStream);

    logger.debug({ fileKey, destPath }, "File downloaded");
    return destPath;
  }

  /**
   * Get message content by ID
   */
  async getMessage(messageId: string): Promise<{
    message_id: string;
    msg_type: string;
    content: string;
    create_time: string;
  } | null> {
    const response = await this.client.im.message.get({
      path: { message_id: messageId },
    });

    if (response.code !== 0) {
      logger.warn({ messageId, code: response.code }, "Failed to get message");
      return null;
    }

    const items = response.data?.items;
    if (!items || items.length === 0) return null;

    const item = items[0];
    return {
      message_id: item.message_id || messageId,
      msg_type: item.msg_type || "text",
      content: item.body?.content || "",
      create_time: item.create_time || "",
    };
  }

  /**
   * Get user info by open_id
   */
  async getUser(openId: string): Promise<{
    open_id: string;
    name: string;
    avatar_url?: string;
  } | null> {
    const response = await this.client.contact.user.get({
      path: { user_id: openId },
      params: { user_id_type: "open_id" },
    });

    if (response.code !== 0) {
      logger.warn({ openId, code: response.code }, "Failed to get user");
      return null;
    }

    const user = response.data?.user;
    if (!user) return null;

    return {
      open_id: user.open_id || openId,
      name: user.name || "Unknown",
      avatar_url: user.avatar?.avatar_origin,
    };
  }

  /**
   * Create event dispatcher for webhook handling
   */
  createEventDispatcher(): lark.EventDispatcher {
    return new lark.EventDispatcher({
      encryptKey: this.config.encryptKey,
      verificationToken: this.config.verificationToken,
    });
  }
}
