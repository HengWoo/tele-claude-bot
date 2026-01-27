import { existsSync, writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { sendKeys, capturePane, formatForTelegram, paneExists, getPaneInfo, stripAnsi } from "./index.js";
import { createChildLogger } from "../utils/logger.js";

const logger = createChildLogger("tmux-bridge");

const CLAUDE_DIR = `${homedir()}/.claude`;
const PENDING_FILE = `${CLAUDE_DIR}/tg-pending`;
const DONE_FILE = `${CLAUDE_DIR}/tg-done`;
const STATE_FILE = `${CLAUDE_DIR}/tg-state.json`;

export interface PendingRequest {
  target: string;
  chatId: number;
  messageId: number;
  timestamp: number;
  prompt: string;
}

export interface TmuxBridgeState {
  attachedTarget: string | null;
  pendingRequest: PendingRequest | null;
}

/**
 * TmuxBridge manages the connection between Telegram bot and tmux panes running Claude
 */
export class TmuxBridge {
  private state: TmuxBridgeState = {
    attachedTarget: null,
    pendingRequest: null,
  };

  constructor() {
    // Load persisted state on startup
    this.loadPersistedState();
  }

  /**
   * Load persisted state from file
   */
  private loadPersistedState(): void {
    try {
      if (existsSync(STATE_FILE)) {
        const data = readFileSync(STATE_FILE, "utf-8");
        const saved = JSON.parse(data);
        if (saved.attachedTarget) {
          this.state.attachedTarget = saved.attachedTarget;
          logger.info({ target: saved.attachedTarget }, "Restored attached target from state file");
        }
      }
    } catch (error) {
      logger.warn({ error: (error as Error).message }, "Failed to load persisted state");
    }
  }

  /**
   * Save state to file
   */
  private saveState(): void {
    try {
      writeFileSync(STATE_FILE, JSON.stringify({ attachedTarget: this.state.attachedTarget }));
    } catch (error) {
      logger.warn({ error: (error as Error).message }, "Failed to save state");
    }
  }

  /**
   * Attach to a tmux pane
   */
  async attach(target: string): Promise<void> {
    // Verify pane exists
    const exists = await paneExists(target);
    if (!exists) {
      throw new Error(`Pane ${target} does not exist`);
    }

    // Verify it's running Claude
    const paneInfo = await getPaneInfo(target);
    if (paneInfo && paneInfo.command !== "claude") {
      logger.warn(
        { target, command: paneInfo.command },
        "Warning: Pane is not running Claude"
      );
    }

    this.state.attachedTarget = target;
    this.saveState();
    logger.info({ target }, "Attached to tmux pane");
  }

  /**
   * Detach from current pane
   */
  detach(): void {
    const previousTarget = this.state.attachedTarget;
    this.state.attachedTarget = null;
    this.state.pendingRequest = null;
    this.saveState();
    this.cleanupMarkerFiles();
    logger.info({ previousTarget }, "Detached from tmux pane");
  }

  /**
   * Check if attached to a pane
   */
  isAttached(): boolean {
    return this.state.attachedTarget !== null;
  }

  /**
   * Get current attached target
   */
  getAttachedTarget(): string | null {
    return this.state.attachedTarget;
  }

  /**
   * Check if there's a pending request
   */
  hasPendingRequest(): boolean {
    return this.state.pendingRequest !== null;
  }

  /**
   * Send a message to Claude via tmux and wait for response
   */
  async sendMessage(
    message: string,
    chatId: number,
    messageId: number,
    timeout = 300000 // 5 minutes default
  ): Promise<string> {
    const target = this.state.attachedTarget;

    if (!target) {
      throw new Error("Not attached to any tmux pane. Use /attach <target> first.");
    }

    // Check if there's already a pending request
    if (this.state.pendingRequest) {
      throw new Error("Another request is already pending. Please wait for it to complete.");
    }

    // Verify pane still exists
    const exists = await paneExists(target);
    if (!exists) {
      this.state.attachedTarget = null;
      throw new Error(`Pane ${target} no longer exists. Please /attach to a valid pane.`);
    }

    // Clean up any stale marker files BEFORE starting
    this.cleanupMarkerFiles();

    // Create pending marker
    const pending: PendingRequest = {
      target,
      chatId,
      messageId,
      timestamp: Date.now(),
      prompt: message,
    };

    this.state.pendingRequest = pending;
    writeFileSync(PENDING_FILE, JSON.stringify(pending));

    logger.info({ target, chatId, messageId }, "Sending message to Claude via tmux");

    try {
      // Capture pane state before sending (to know where our message starts)
      const beforeCapture = await capturePane(target);
      const beforeLineCount = beforeCapture.split("\n").length;

      // Send message to tmux
      await sendKeys(target, message);

      // Wait for completion - pass original message for better parsing
      const response = await this.waitForCompletion(target, beforeLineCount, timeout, message);

      return response;
    } finally {
      // Clean up
      this.state.pendingRequest = null;
      this.cleanupMarkerFiles();
    }
  }

  /**
   * Wait for Claude to finish processing
   */
  private async waitForCompletion(
    target: string,
    startLineCount: number,
    timeout: number,
    userMessage?: string
  ): Promise<string> {
    const startTime = Date.now();
    let lastOutput = "";

    logger.debug({ target, timeout }, "Waiting for Claude completion");

    while (Date.now() - startTime < timeout) {
      // Check if done signal exists
      if (existsSync(DONE_FILE)) {
        logger.debug("Done signal detected");

        // Give Claude a moment to finish writing to terminal
        await this.sleep(500);

        // Capture final output - get more lines to ensure we have the full response
        const output = await capturePane(target, 1000);
        logger.debug({ outputLength: output.length, outputLines: output.split("\n").length }, "Captured pane after done signal");
        return this.parseClaudeResponse(output, startLineCount, userMessage);
      }

      // Poll for output changes (fallback method)
      const currentOutput = await capturePane(target);
      if (currentOutput !== lastOutput) {
        lastOutput = currentOutput;
        // Reset the timeout on activity (Claude is still working)
      }

      await this.sleep(500);
    }

    // Timeout reached - return whatever we have
    logger.warn({ target, timeout }, "Timeout waiting for Claude response");
    const finalOutput = await capturePane(target);
    const response = this.parseClaudeResponse(finalOutput, startLineCount, userMessage);

    if (response.trim()) {
      return response + "\n\n[Response may be incomplete - timeout reached]";
    }

    throw new Error(`Timeout waiting for Claude response after ${timeout / 1000}s`);
  }

  /**
   * Parse Claude's response from terminal output
   * @param userMessage - The original message sent by user, to find exact location in output
   */
  private parseClaudeResponse(paneOutput: string, startLineCount: number, userMessage?: string): string {
    // Strip ANSI codes
    const cleaned = stripAnsi(paneOutput);
    const lines = cleaned.split("\n");

    // Find the user's message in the output by searching backwards
    let userMsgIndex = -1;
    if (userMessage) {
      const msgStart = userMessage.slice(0, 25).trim(); // First 25 chars for matching
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        // Match "❯ <message>" pattern - look for prompt followed by message text
        if (/[❯>]/.test(line) && line.includes(msgStart)) {
          userMsgIndex = i;
          logger.info({ foundAt: i, line: line.slice(0, 60), msgStart }, "Found user message");
          break;
        }
      }
    }

    if (userMsgIndex === -1 && userMessage) {
      logger.warn({ msgStart: userMessage.slice(0, 25), lastLines: lines.slice(-5).map(l => l.slice(0, 50)) }, "Could not find user message in output");
    }

    // Start from user message if found, otherwise use startLineCount
    const startIdx = userMsgIndex >= 0 ? userMsgIndex + 1 : Math.max(0, startLineCount - 10);
    const newLines = lines.slice(startIdx);

    logger.debug({
      totalLines: lines.length,
      userMsgIndex,
      startIdx,
      newLinesCount: newLines.length,
      userMsgLine: userMsgIndex >= 0 ? lines[userMsgIndex]?.slice(0, 50) : null,
      lastFewLines: lines.slice(-10).map(l => l.slice(0, 60))
    }, "Parsing response");

    const responseLines: string[] = [];
    let capturing = false;  // Are we capturing text?

    for (const line of newLines) {
      const trimmedLine = line.trim();

      // Skip terminal artifacts
      if (this.isTerminalArtifact(trimmedLine)) {
        continue;
      }

      // Detect end of response: next user prompt
      if (/^[❯>]\s*$/.test(trimmedLine)) {
        break;
      }

      // When we see ⏺, decide: tool call (green) or text (white)?
      if (/^⏺/.test(trimmedLine)) {
        // Green dot patterns: tool calls, tool outputs, agent outputs
        // - "⏺ Bash(command)" - tool invocation
        // - "⏺ Read agent output" - agent/tool output display
        // - "⏺ Read file path" - tool with file argument
        const isToolLine = /^⏺\s*(Bash|Read|Edit|Write|Glob|Grep|Task|WebFetch|WebSearch|NotebookEdit|TaskOutput)(\s*\(|\s+agent|\s+tool|\s+file)/i.test(trimmedLine);

        if (isToolLine) {
          // Green dot (tool call) - stop capturing
          capturing = false;
        } else {
          // White dot (text response) - start capturing
          capturing = true;
          responseLines.push(trimmedLine.replace(/^⏺\s*/, ""));
        }
        continue;
      }

      // If capturing, add the line (continuation of text response)
      if (capturing && trimmedLine) {
        responseLines.push(line);
      }
    }

    logger.info({
      responseLineCount: responseLines.length,
      firstLine: responseLines[0]?.slice(0, 50),
      totalNewLines: newLines.length,
      sampleLines: newLines.slice(0, 5).map(l => l.slice(0, 60)),
    }, "Parsed response lines");

    // Clean up the response
    let response = responseLines.join("\n");
    response = this.cleanResponse(response);

    logger.info({ finalResponseLength: response.length, preview: response.slice(0, 100) }, "Final response");

    return formatForTelegram(response);
  }

  /**
   * Check if a line is a terminal artifact (not actual content)
   */
  private isTerminalArtifact(line: string): boolean {
    // Lines that are just underscores, dashes, or box-drawing characters
    if (/^[_\-─━═┄┅┈┉]+$/.test(line)) return true;

    // Lines that are just whitespace
    if (!line.trim()) return true;

    // Lines that are just prompt characters
    if (/^[❯>$%●⏺]\s*$/.test(line)) return true;

    // Lines that look like horizontal rules (repeated chars)
    if (/^(.)\1{10,}$/.test(line.trim())) return true;

    // Claude Code status lines (spinners, progress indicators)
    if (/^[✻✓⏺●○◐◑◒◓]/.test(line) && /\.\.\.|thinking|running|interrupt/i.test(line)) return true;

    // Status lines with "Esc to interrupt" or similar
    if (/Esc to interrupt|running.*hooks/i.test(line)) return true;

    // Claude Code bottom status bar (⏵⏵ accept edits on · 2 background tasks)
    if (/^⏵/.test(line)) return true;
    if (/background tasks?|accept edits|bypass permissions/i.test(line)) return true;

    // Tool usage display lines (not prefixed with ⏺)
    if (/^(Read|Bash|Edit|Write|Glob|Grep|Task|WebFetch|WebSearch)\s+(agent output|tool|file)/i.test(line)) return true;

    // Tool result indicators
    if (/^⎿/.test(line)) return true;

    // "Read X lines", "Error:", tool output summaries
    if (/^\s*⎿?\s*(Read \d+ lines|Error:|wrote to|Updated|Created|Deleted)/i.test(line)) return true;

    return false;
  }


  /**
   * Clean up response text
   */
  private cleanResponse(text: string): string {
    let cleaned = text;

    // Remove lines that are just underscores or dashes
    cleaned = cleaned
      .split("\n")
      .filter(line => !this.isTerminalArtifact(line.trim()))
      .join("\n");

    // Remove excessive blank lines
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

    // Trim
    cleaned = cleaned.trim();

    return cleaned;
  }

  /**
   * Clean up marker files
   */
  private cleanupMarkerFiles(): void {
    try {
      if (existsSync(PENDING_FILE)) {
        unlinkSync(PENDING_FILE);
      }
      if (existsSync(DONE_FILE)) {
        unlinkSync(DONE_FILE);
      }
    } catch (error) {
      logger.warn({ error: (error as Error).message }, "Failed to cleanup marker files");
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get current state (for persistence)
   */
  getState(): TmuxBridgeState {
    return { ...this.state };
  }

  /**
   * Restore state (from persistence)
   */
  async restoreState(state: Partial<TmuxBridgeState>): Promise<void> {
    if (state.attachedTarget) {
      // Verify pane still exists before restoring
      const exists = await paneExists(state.attachedTarget);
      if (exists) {
        this.state.attachedTarget = state.attachedTarget;
        logger.info({ target: state.attachedTarget }, "Restored attached target");
      } else {
        logger.warn({ target: state.attachedTarget }, "Previously attached pane no longer exists");
      }
    }

    // Clear any stale pending requests on startup
    this.cleanupMarkerFiles();
  }
}

// Singleton instance
let bridgeInstance: TmuxBridge | null = null;

/**
 * Get or create the TmuxBridge singleton
 */
export function getTmuxBridge(): TmuxBridge {
  if (!bridgeInstance) {
    bridgeInstance = new TmuxBridge();
  }
  return bridgeInstance;
}

/**
 * Create a Claude bridge adapter compatible with the existing message handler interface
 */
export function createTmuxBridgeAdapter() {
  const bridge = getTmuxBridge();

  return {
    async *sendMessage(
      _session: unknown,
      message: string,
      chatId?: number,
      messageId?: number
    ): AsyncGenerator<string> {
      if (!bridge.isAttached()) {
        yield "Not attached to any tmux pane. Use /attach <target> first.";
        return;
      }

      try {
        const response = await bridge.sendMessage(
          message,
          chatId ?? 0,
          messageId ?? 0
        );
        yield response;
      } catch (error) {
        const err = error as Error;
        yield `Error: ${err.message}`;
      }
    },

    isSessionActive(): boolean {
      return bridge.isAttached();
    },

    // Additional methods for tmux-specific functionality
    bridge,
  };
}
