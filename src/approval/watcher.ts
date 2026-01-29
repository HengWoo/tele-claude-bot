import { watch, type FSWatcher } from "chokidar";
import { EventEmitter } from "events";
import { mkdir, readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { ApprovalRequest } from "../types.js";
import { createChildLogger } from "../utils/logger.js";

const logger = createChildLogger("approval-watcher");

const DEFAULT_APPROVAL_DIR = join(homedir(), ".claude", "approvals");

export interface ApprovalWatcherEvents {
  request: (request: ApprovalRequest) => void;
  error: (error: Error) => void;
}

export class ApprovalWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private readonly approvalDir: string;
  private running = false;

  constructor(approvalDir: string = DEFAULT_APPROVAL_DIR) {
    super();
    this.approvalDir = approvalDir;
  }

  /**
   * Start watching for .request files in the approval directory
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn("Approval watcher is already running");
      return;
    }

    // Ensure the approval directory exists
    try {
      await mkdir(this.approvalDir, { recursive: true });
      logger.debug({ dir: this.approvalDir }, "Ensured approval directory exists");
    } catch (error) {
      logger.error({ error, dir: this.approvalDir }, "Failed to create approval directory");
      throw error;
    }

    // Create the file watcher
    this.watcher = watch(this.approvalDir, {
      persistent: true,
      ignoreInitial: true, // Don't process existing files on startup
      depth: 0, // Only watch the top-level directory
      awaitWriteFinish: {
        stabilityThreshold: 100, // Wait for file to finish writing
        pollInterval: 50,
      },
    });

    // Only watch for file additions
    this.watcher.on("add", async (filePath: string) => {
      await this.handleFileAdded(filePath);
    });

    this.watcher.on("error", (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error({ error: err }, "File watcher error");
      this.emit("error", err);
    });

    this.watcher.on("ready", () => {
      logger.info({ dir: this.approvalDir }, "Approval watcher started");
    });

    this.running = true;
  }

  /**
   * Stop watching for approval requests
   */
  async stop(): Promise<void> {
    if (!this.running || !this.watcher) {
      logger.warn("Approval watcher is not running");
      return;
    }

    await this.watcher.close();
    this.watcher = null;
    this.running = false;
    logger.info("Approval watcher stopped");
  }

  /**
   * Check if the watcher is currently active
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the approval directory path
   */
  getApprovalDir(): string {
    return this.approvalDir;
  }

  /**
   * Handle a new file being added to the approval directory
   */
  private async handleFileAdded(filePath: string): Promise<void> {
    // Only process .request files
    if (!filePath.endsWith(".request")) {
      logger.debug({ filePath }, "Ignoring non-request file");
      return;
    }

    logger.debug({ filePath }, "Processing approval request file");

    try {
      const content = await readFile(filePath, "utf-8");
      const request = this.parseApprovalRequest(content, filePath);

      if (request) {
        logger.info(
          { id: request.id, toolName: request.toolName },
          "New approval request received"
        );
        this.emit("request", request);
      }
    } catch (error) {
      logger.error({ error, filePath }, "Failed to process approval request file");
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Parse the JSON content of an approval request file
   */
  private parseApprovalRequest(
    content: string,
    filePath: string
  ): ApprovalRequest | null {
    try {
      const parsed = JSON.parse(content);

      // Validate required fields
      if (!parsed.id || typeof parsed.id !== "string") {
        logger.warn({ filePath }, "Approval request missing or invalid 'id' field");
        return null;
      }

      if (!parsed.toolName || typeof parsed.toolName !== "string") {
        logger.warn({ filePath }, "Approval request missing or invalid 'toolName' field");
        return null;
      }

      // toolInput can be an object or string
      if (
        parsed.toolInput === undefined ||
        (typeof parsed.toolInput !== "object" && typeof parsed.toolInput !== "string")
      ) {
        logger.warn({ filePath }, "Approval request missing or invalid 'toolInput' field");
        return null;
      }

      // Build the approval request with defaults for optional fields
      // Note: timestamp is in seconds (Unix timestamp), not milliseconds
      const request: ApprovalRequest = {
        id: parsed.id,
        toolName: parsed.toolName,
        toolInput: parsed.toolInput,
        timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : Math.floor(Date.now() / 1000),
        status: parsed.status ?? "pending",
        responseAt: parsed.responseAt,
      };

      return request;
    } catch (error) {
      logger.error({ error, filePath }, "Failed to parse approval request JSON");
      return null;
    }
  }
}

// Type-safe event emitter methods
export declare interface ApprovalWatcher {
  on<K extends keyof ApprovalWatcherEvents>(
    event: K,
    listener: ApprovalWatcherEvents[K]
  ): this;
  emit<K extends keyof ApprovalWatcherEvents>(
    event: K,
    ...args: Parameters<ApprovalWatcherEvents[K]>
  ): boolean;
}
