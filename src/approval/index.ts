import type { Bot } from "grammy";
import type { BotContext } from "../types.js";
import { createChildLogger } from "../utils/logger.js";
import { ApprovalWatcher } from "./watcher.js";
import { ApprovalHandler } from "./handler.js";
import * as policy from "./policy.js";

const logger = createChildLogger("approval-service");

/**
 * ApprovalService orchestrates the file watcher and handler
 * to detect and process Claude tool approval requests via Telegram
 */
export class ApprovalService {
  private watcher: ApprovalWatcher;
  private handler: ApprovalHandler;
  private running = false;

  constructor(bot: Bot<BotContext>, chatId: number) {
    this.watcher = new ApprovalWatcher();
    this.handler = new ApprovalHandler(bot, chatId);

    // Connect watcher events to handler
    this.watcher.on("request", async (request) => {
      try {
        await this.handler.handleRequest(request);
      } catch (error) {
        logger.error({ error, requestId: request.id }, "Failed to handle approval request");
      }
    });

    this.watcher.on("error", (error) => {
      logger.error({ error }, "Approval watcher error");
    });

    logger.debug({ chatId }, "ApprovalService initialized");
  }

  /**
   * Start the approval watcher
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn("ApprovalService is already running");
      return;
    }

    await this.watcher.start();
    this.running = true;
    logger.info("ApprovalService started");
  }

  /**
   * Stop the watcher and cleanup handler
   */
  async stop(): Promise<void> {
    if (!this.running) {
      logger.warn("ApprovalService is not running");
      return;
    }

    await this.watcher.stop();
    await this.handler.cleanup();
    this.running = false;
    logger.info("ApprovalService stopped");
  }

  /**
   * Get the handler instance for callback handling
   */
  getHandler(): ApprovalHandler {
    return this.handler;
  }

  /**
   * Check if the service is currently running
   */
  isRunning(): boolean {
    return this.running;
  }
}

// Re-export components for direct access
export { ApprovalWatcher } from "./watcher.js";
export { ApprovalHandler } from "./handler.js";

// Re-export policy module
export {
  loadPolicy,
  savePolicy,
  evaluatePolicy,
  shouldAutoApprove,
  shouldAutoDeny,
  DEFAULT_POLICY,
} from "./policy.js";

// Re-export policy namespace for advanced usage
export { policy };

// Re-export context detection utilities
export {
  hasPendingTelegramRequest,
  getPendingTelegramFiles,
  cleanupStalePendingFiles,
} from "./context.js";

// Re-export veto watcher for blocked operation notifications
export { VetoWatcher } from "./veto-watcher.js";
