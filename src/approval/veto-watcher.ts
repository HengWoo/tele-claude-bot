import { watch, type FSWatcher } from "chokidar";
import { readFile, stat } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { Bot } from "grammy";
import type { BotContext } from "../types.js";
import { createChildLogger } from "../utils/logger.js";

const logger = createChildLogger("veto-watcher");

const BLOCKED_LOG = join(homedir(), ".claude", "blocked-operations.log");

interface BlockedOperation {
  timestamp: number;
  tool: string;
  reason: string;
  input: Record<string, unknown>;
}

/**
 * Watches for blocked operations and notifies user via Telegram
 * This is a non-blocking notification system - operations are already blocked
 */
export class VetoWatcher {
  private bot: Bot<BotContext>;
  private chatId: number;
  private watcher: FSWatcher | null = null;
  private lastSize = 0;
  private running = false;
  private processing = false;

  constructor(bot: Bot<BotContext>, chatId: number) {
    this.bot = bot;
    this.chatId = chatId;
  }

  async start(): Promise<void> {
    if (this.running) {
      logger.warn("Veto watcher already running");
      return;
    }

    // Get initial file size
    try {
      const stats = await stat(BLOCKED_LOG);
      this.lastSize = stats.size;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        // File doesn't exist yet - this is expected
        this.lastSize = 0;
      } else {
        logger.warn({ error: err.message, path: BLOCKED_LOG }, "Failed to stat blocked log file");
        this.lastSize = 0;
      }
    }

    // Watch for changes to the blocked log
    this.watcher = watch(BLOCKED_LOG, {
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on("change", async () => {
      try {
        await this.handleLogChange();
      } catch (error) {
        logger.error({ error: (error as Error).message }, "Error in change handler");
      }
    });

    this.watcher.on("add", async () => {
      try {
        await this.handleLogChange();
      } catch (error) {
        logger.error({ error: (error as Error).message }, "Error in add handler");
      }
    });

    this.watcher.on("error", (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error({ error: err.message }, "Veto watcher error");
    });

    this.running = true;
    logger.info("Veto watcher started");
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.running = false;
    logger.info("Veto watcher stopped");
  }

  private async handleLogChange(): Promise<void> {
    // Prevent concurrent processing
    if (this.processing) {
      logger.debug("Already processing log change, skipping");
      return;
    }

    this.processing = true;
    try {
      const content = await readFile(BLOCKED_LOG, "utf-8");
      const newContent = content.slice(this.lastSize);

      if (!newContent.trim()) {
        this.lastSize = content.length;
        return;
      }

      // Parse new blocked operations (one JSON per line)
      const lines = newContent.trim().split("\n");
      for (const line of lines) {
        try {
          const blocked: BlockedOperation = JSON.parse(line);
          await this.notifyBlocked(blocked);
        } catch (e) {
          logger.warn({ line }, "Failed to parse blocked operation");
        }
      }

      // Only update lastSize after successful processing
      this.lastSize = content.length;
    } catch (error) {
      logger.error({ error }, "Failed to read blocked operations log");
    } finally {
      this.processing = false;
    }
  }

  private async notifyBlocked(blocked: BlockedOperation): Promise<void> {
    const inputPreview = JSON.stringify(blocked.input, null, 2).slice(0, 300);

    const message = [
      `<b>🚫 Operation Blocked</b>`,
      ``,
      `<b>Tool:</b> ${this.escapeHtml(blocked.tool)}`,
      `<b>Reason:</b> ${this.escapeHtml(blocked.reason)}`,
      ``,
      `<pre>${this.escapeHtml(inputPreview)}</pre>`,
    ].join("\n");

    try {
      await this.bot.api.sendMessage(this.chatId, message, {
        parse_mode: "HTML",
      });
      logger.info({ tool: blocked.tool, reason: blocked.reason }, "Notified user of blocked operation");
    } catch (error) {
      logger.error({ error }, "Failed to send blocked notification");
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
