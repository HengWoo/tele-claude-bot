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
    } catch {
      this.lastSize = 0;
    }

    // Watch for changes to the blocked log
    this.watcher = watch(BLOCKED_LOG, {
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on("change", async () => {
      await this.handleLogChange();
    });

    this.watcher.on("add", async () => {
      await this.handleLogChange();
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
    try {
      const content = await readFile(BLOCKED_LOG, "utf-8");
      const newContent = content.slice(this.lastSize);
      this.lastSize = content.length;

      if (!newContent.trim()) return;

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
    } catch (error) {
      logger.error({ error }, "Failed to read blocked operations log");
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
