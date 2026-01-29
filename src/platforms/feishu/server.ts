/**
 * Feishu Webhook Server
 * Express server for receiving Feishu event callbacks
 */

import express, { type Express, type Request, type Response } from "express";
import * as lark from "@larksuiteoapi/node-sdk";
import type { Server } from "node:http";
import type { FeishuConfig } from "../../types.js";
import { createChildLogger } from "../../utils/logger.js";
import type { FeishuMessageEvent, FeishuSender } from "./client.js";

const logger = createChildLogger("feishu-server");

/**
 * Event types from Feishu
 */
export interface MessageReceiveEvent {
  schema: string;
  header: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
    tenant_key: string;
  };
  event: {
    sender: FeishuSender;
    message: FeishuMessageEvent;
  };
}

export interface CardActionEvent {
  open_id: string;
  user_id?: string;
  open_message_id: string;
  open_chat_id: string;
  tenant_key: string;
  token: string;
  action: {
    value: Record<string, string>;
    tag: string;
  };
}

/**
 * Message handler callback type
 */
export type MessageReceiveHandler = (event: MessageReceiveEvent) => Promise<void>;

/**
 * Card action handler callback type
 */
export type CardActionHandler = (event: CardActionEvent) => Promise<{ toast?: { type: string; content: string } } | void>;

/**
 * Feishu webhook server
 */
export class FeishuWebhookServer {
  private app: Express;
  private server: Server | null = null;
  private config: FeishuConfig;
  private messageHandlers: MessageReceiveHandler[] = [];
  private cardActionHandlers: CardActionHandler[] = [];
  private processedEvents: Set<string> = new Set();

  constructor(config: FeishuConfig, _eventDispatcher?: lark.EventDispatcher) {
    this.config = config;
    this.app = express();

    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Parse JSON body
    this.app.use(express.json());

    // Health check endpoint
    this.app.get("/health", (_req: Request, res: Response) => {
      res.json({ status: "ok", platform: "feishu" });
    });

    // Feishu event callback endpoint
    this.app.post("/webhook/event", async (req: Request, res: Response) => {
      logger.debug({ body: JSON.stringify(req.body).slice(0, 500) }, "Received event callback");

      try {
        // Handle URL verification challenge
        if (req.body.type === "url_verification") {
          logger.info("Handling URL verification challenge");
          res.json({ challenge: req.body.challenge });
          return;
        }

        // Verify and process event using Lark SDK
        const eventData = req.body;

        // Check for duplicate events
        const eventId = eventData.header?.event_id;
        if (eventId && this.processedEvents.has(eventId)) {
          logger.debug({ eventId }, "Duplicate event, skipping");
          res.json({ code: 0 });
          return;
        }

        // Mark event as processed (with cleanup for memory)
        if (eventId) {
          this.processedEvents.add(eventId);
          // Clean up old events after 5 minutes
          setTimeout(() => this.processedEvents.delete(eventId), 5 * 60 * 1000);
        }

        // Route based on event type
        const eventType = eventData.header?.event_type;

        if (eventType === "im.message.receive_v1") {
          await this.handleMessageReceive(eventData as MessageReceiveEvent);
        } else {
          logger.debug({ eventType }, "Unhandled event type");
        }

        res.json({ code: 0 });
      } catch (error) {
        const err = error as Error;
        logger.error({ error: err.message, stack: err.stack }, "Error processing event");
        res.status(500).json({ code: -1, msg: err.message });
      }
    });

    // Card action callback endpoint
    this.app.post("/webhook/card", async (req: Request, res: Response) => {
      logger.debug({ body: JSON.stringify(req.body).slice(0, 500) }, "Received card action");

      try {
        // Handle URL verification for card actions
        if (req.body.type === "url_verification") {
          res.json({ challenge: req.body.challenge });
          return;
        }

        const cardEvent = req.body as CardActionEvent;
        let response: { toast?: { type: string; content: string } } | void = undefined;

        for (const handler of this.cardActionHandlers) {
          response = await handler(cardEvent);
          if (response) break;
        }

        if (response) {
          res.json(response);
        } else {
          res.json({});
        }
      } catch (error) {
        const err = error as Error;
        logger.error({ error: err.message }, "Error processing card action");
        res.json({ toast: { type: "error", content: "Error processing action" } });
      }
    });
  }

  private async handleMessageReceive(event: MessageReceiveEvent): Promise<void> {
    logger.info(
      {
        messageId: event.event.message.message_id,
        chatId: event.event.message.chat_id,
        senderId: event.event.sender.sender_id.open_id,
        messageType: event.event.message.message_type,
      },
      "Processing message receive event"
    );

    for (const handler of this.messageHandlers) {
      try {
        await handler(event);
      } catch (error) {
        const err = error as Error;
        logger.error({ error: err.message }, "Message handler error");
      }
    }
  }

  /**
   * Register a message receive handler
   */
  onMessageReceive(handler: MessageReceiveHandler): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Register a card action handler
   */
  onCardAction(handler: CardActionHandler): void {
    this.cardActionHandlers.push(handler);
  }

  /**
   * Start the webhook server
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.webhookPort, () => {
        logger.info({ port: this.config.webhookPort }, "Feishu webhook server started");
        resolve();
      });
    });
  }

  /**
   * Stop the webhook server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((err) => {
        if (err) {
          logger.error({ error: err.message }, "Error stopping webhook server");
          reject(err);
        } else {
          logger.info("Feishu webhook server stopped");
          this.server = null;
          resolve();
        }
      });
    });
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  /**
   * Get the Express app for testing or additional routes
   */
  getApp(): Express {
    return this.app;
  }
}
