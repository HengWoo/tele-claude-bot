import { existsSync, writeFileSync, unlinkSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { sendKeys, capturePane, formatForTelegram, paneExists, getPaneInfo, stripAnsi } from "./index.js";
import { formatToHtml, truncateHtml } from "../utils/telegram-formatter.js";
import { createChildLogger } from "../utils/logger.js";

const logger = createChildLogger("tmux-bridge");

const CLAUDE_DIR = `${homedir()}/.claude`;
const STATE_FILE = `${CLAUDE_DIR}/tg-state.json`;

/**
 * Sanitize tmux target for use in filenames
 * Converts "session:window.pane" to "session-window-pane"
 */
export function sanitizeTarget(target: string): string {
  return target.replace(/[:.]/g, "-");
}

/**
 * Get the pending file path for a specific target
 */
export function getPendingFilePath(target: string): string {
  return `${CLAUDE_DIR}/tg-pending-${sanitizeTarget(target)}`;
}

/**
 * Get the done file path for a specific target
 */
export function getDoneFilePath(target: string): string {
  return `${CLAUDE_DIR}/tg-done-${sanitizeTarget(target)}`;
}

/**
 * Get the response file path for a specific target
 * This file contains the raw markdown response extracted from transcript
 */
export function getResponseFilePath(target: string): string {
  return `${CLAUDE_DIR}/tg-response-${sanitizeTarget(target)}`;
}

export interface PendingRequest {
  requestId: string;
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
 *
 * Note: Claude Code has internal input buffering - messages sent via tmux send-keys
 * while Claude is busy will be queued in the prompt and processed when ready.
 * This means we don't need our own message queue system.
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
    if (previousTarget) {
      this.cleanupMarkerFiles(previousTarget);
    }
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
   *
   * Claude Code handles input buffering internally - if Claude is busy,
   * the message will wait in the prompt and be processed when ready.
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

    // Verify pane still exists
    const exists = await paneExists(target);
    if (!exists) {
      this.state.attachedTarget = null;
      this.saveState();
      throw new Error(`Pane ${target} no longer exists. Please /attach to a valid pane.`);
    }

    // Clean up any stale marker files BEFORE starting
    this.cleanupMarkerFiles(target);

    // Create pending marker with unique request ID
    const pending: PendingRequest = {
      requestId: randomUUID(),
      target,
      chatId,
      messageId,
      timestamp: Date.now(),
      prompt: message,
    };

    this.state.pendingRequest = pending;
    writeFileSync(getPendingFilePath(target), JSON.stringify(pending));

    logger.info({ target, chatId, messageId }, "Sending message to Claude via tmux");

    try {
      // Capture pane state before sending (to know where our message starts)
      const beforeCapture = await capturePane(target);
      const beforeLineCount = beforeCapture.split("\n").length;

      // Send message to tmux
      await sendKeys(target, message);

      // Wait for completion - pass pending request for ID validation
      const response = await this.waitForCompletion(target, beforeLineCount, timeout, pending, message);

      return response;
    } finally {
      // Clean up
      this.state.pendingRequest = null;
      this.cleanupMarkerFiles(target);
    }
  }

  /**
   * Wait for Claude to finish processing
   */
  private async waitForCompletion(
    target: string,
    startLineCount: number,
    timeout: number,
    pendingRequest: PendingRequest,
    userMessage?: string
  ): Promise<string> {
    const startTime = Date.now();
    let lastOutput = "";
    const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

    const doneFile = getDoneFilePath(target);
    const responseFile = getResponseFilePath(target);
    logger.debug({ target, timeout, requestId: pendingRequest.requestId, doneFile, responseFile }, "Waiting for Claude completion");

    while (Date.now() - startTime < timeout) {
      // Check if done signal exists for this target
      if (existsSync(doneFile)) {
        logger.debug({ doneFile }, "Done signal detected");

        // Validate the done signal matches our request
        try {
          const doneData = JSON.parse(readFileSync(doneFile, "utf-8"));

          // Check if the requestId matches (if present in done file)
          if (doneData.requestId && doneData.requestId !== pendingRequest.requestId) {
            logger.warn(
              { expected: pendingRequest.requestId, got: doneData.requestId },
              "Done signal requestId mismatch - ignoring stale signal"
            );
            // Clean up the stale done file and continue waiting
            try { unlinkSync(doneFile); } catch { /* ignore */ }
            await this.sleep(500);
            continue;
          }

          // Check if the done signal is stale (timestamp > 10 minutes old)
          if (doneData.timestamp && Date.now() - doneData.timestamp > STALE_THRESHOLD_MS) {
            logger.warn(
              { timestamp: doneData.timestamp, age: Date.now() - doneData.timestamp },
              "Done signal is stale (>10 minutes) - ignoring"
            );
            try { unlinkSync(doneFile); } catch { /* ignore */ }
            await this.sleep(500);
            continue;
          }
        } catch {
          // If done file can't be parsed, check if it was created after our request started
          // This handles legacy done files without requestId
          logger.debug("Done file unparseable, accepting for backward compatibility");
        }

        // Give Claude a moment to finish writing files
        await this.sleep(500);

        // Try to read response from response file (contains raw markdown from transcript)
        if (existsSync(responseFile)) {
          try {
            const rawResponse = readFileSync(responseFile, "utf-8").trim();
            logger.debug({ responseLength: rawResponse.length, preview: rawResponse.slice(0, 200) }, "Read response from transcript file");
            if (rawResponse) {
              // Convert markdown to Telegram HTML and truncate
              const htmlResponse = formatToHtml(rawResponse);
              return truncateHtml(htmlResponse, 4000);
            }
          } catch (error) {
            logger.warn({ error: (error as Error).message }, "Failed to read response file");
          }
        }

        // Fallback: capture terminal output if response file not available
        logger.debug("Response file not available, falling back to terminal capture");
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

    // Timeout reached - check if Claude is still actively producing output
    logger.warn({ target, timeout }, "Timeout waiting for Claude response");

    // Capture output twice with a delay to detect ongoing activity
    const outputBefore = await capturePane(target);
    await this.sleep(2000);
    const outputAfter = await capturePane(target);

    const claudeStillActive = outputAfter !== outputBefore;
    if (claudeStillActive) {
      logger.info({ target }, "Claude still producing output after timeout");
    }

    const finalOutput = outputAfter;
    const response = this.parseClaudeResponse(finalOutput, startLineCount, userMessage);

    if (response.trim()) {
      const suffix = claudeStillActive
        ? "\n\n[Response incomplete - Claude still running. Wait for completion or send another message.]"
        : "\n\n[Response may be incomplete - timeout reached]";
      return response + suffix;
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
   * Clean up marker files for a specific target
   */
  private cleanupMarkerFiles(target: string): void {
    const pendingFile = getPendingFilePath(target);
    const doneFile = getDoneFilePath(target);
    const responseFile = getResponseFilePath(target);
    try {
      if (existsSync(pendingFile)) {
        unlinkSync(pendingFile);
      }
      if (existsSync(doneFile)) {
        unlinkSync(doneFile);
      }
      if (existsSync(responseFile)) {
        unlinkSync(responseFile);
      }
    } catch (error) {
      logger.warn({ error: (error as Error).message, target }, "Failed to cleanup marker files");
    }
  }

  /**
   * Clean up ALL marker files (used on startup)
   */
  private cleanupAllMarkerFiles(): void {
    try {
      if (!existsSync(CLAUDE_DIR)) return;

      const files = readdirSync(CLAUDE_DIR);
      for (const file of files) {
        if (file.startsWith("tg-pending-") || file.startsWith("tg-done-") || file.startsWith("tg-response-")) {
          try {
            unlinkSync(`${CLAUDE_DIR}/${file}`);
            logger.debug({ file }, "Cleaned up stale marker file");
          } catch { /* ignore individual file errors */ }
        }
      }
    } catch (error) {
      logger.warn({ error: (error as Error).message }, "Failed to cleanup all marker files");
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
    this.cleanupAllMarkerFiles();
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
