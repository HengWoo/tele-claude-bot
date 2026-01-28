import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createChildLogger } from "../utils/logger.js";
import { formatToHtml, truncateHtml } from "../utils/telegram-formatter.js";

const execFileAsync = promisify(execFile);
const logger = createChildLogger("tmux");

export interface TmuxPane {
  target: string;
  command: string;
  session: string;
  window: number;
  pane: number;
  active: boolean;
  title: string;
}

/**
 * Validate tmux target format
 * Valid formats: session:window.pane, e.g., "1:0.0", "dev:2.1", "my-session:0.0"
 */
export function validateTarget(target: string): boolean {
  // Pattern: session_name:window_index.pane_index
  // Session name can be alphanumeric, dash, underscore
  // Window and pane indices are numbers
  const pattern = /^[\w-]+:\d+\.\d+$/;
  return pattern.test(target);
}

/**
 * Check if tmux is available and running
 */
export async function isTmuxAvailable(): Promise<boolean> {
  try {
    await execFileAsync("tmux", ["list-sessions"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Send keys to a tmux pane
 */
export async function sendKeys(target: string, text: string): Promise<void> {
  if (!validateTarget(target)) {
    throw new Error(`Invalid tmux target format: ${target}. Expected format: session:window.pane`);
  }

  // Escape special characters for tmux
  // Use literal-string mode with -l to avoid interpreting special keys
  const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  logger.debug({ target, textLength: text.length }, "Sending keys to tmux");

  try {
    // Send text with -l (literal mode)
    await execFileAsync("tmux", ["send-keys", "-t", target, "-l", escaped]);

    // Small delay to ensure text is processed
    await new Promise(resolve => setTimeout(resolve, 50));

    // Send Enter to execute
    await execFileAsync("tmux", ["send-keys", "-t", target, "Enter"]);

    logger.debug({ target }, "Keys sent successfully");
  } catch (error) {
    const err = error as Error;
    logger.error({ target, error: err.message }, "Failed to send keys to tmux");
    throw new Error(`Failed to send keys to tmux pane ${target}: ${err.message}`);
  }
}

/**
 * Capture pane content
 * @param target - tmux target (session:window.pane)
 * @param lines - number of lines to capture (from bottom)
 * @param startLine - start from this line (negative = from end)
 */
export async function capturePane(
  target: string,
  lines = 500,
  startLine?: number
): Promise<string> {
  if (!validateTarget(target)) {
    throw new Error(`Invalid tmux target format: ${target}. Expected format: session:window.pane`);
  }

  logger.debug({ target, lines, startLine }, "Capturing tmux pane");

  try {
    const startLineValue = startLine !== undefined ? String(startLine) : String(-lines);
    const { stdout } = await execFileAsync("tmux", ["capture-pane", "-t", target, "-p", "-S", startLineValue]);
    return stdout;
  } catch (error) {
    const err = error as Error;
    logger.error({ target, error: err.message }, "Failed to capture tmux pane");
    throw new Error(`Failed to capture tmux pane ${target}: ${err.message}`);
  }
}

/**
 * List all panes with their current command
 */
export async function listPanes(): Promise<TmuxPane[]> {
  try {
    const { stdout } = await execFileAsync("tmux", [
      "list-panes",
      "-a",
      "-F",
      "#{session_name}|#{window_index}|#{pane_index}|#{pane_current_command}|#{pane_active}|#{pane_title}",
    ]);

    if (!stdout.trim()) {
      return [];
    }

    return stdout
      .trim()
      .split("\n")
      .map((line) => {
        const [session, windowStr, paneStr, command, activeStr, title] = line.split("|");
        const window = parseInt(windowStr, 10);
        const pane = parseInt(paneStr, 10);
        return {
          target: `${session}:${window}.${pane}`,
          command,
          session,
          window,
          pane,
          active: activeStr === "1",
          title: title || "",
        };
      });
  } catch (error) {
    const err = error as Error;
    // tmux not running or no sessions is not an error
    if (err.message.includes("no server running") || err.message.includes("no sessions")) {
      return [];
    }
    logger.error({ error: err.message }, "Failed to list tmux panes");
    throw new Error(`Failed to list tmux panes: ${err.message}`);
  }
}

/**
 * List all tmux sessions
 */
export async function listSessions(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("tmux", ["list-sessions", "-F", "#{session_name}"]);
    return stdout.trim().split("\n").filter(Boolean);
  } catch (error) {
    const err = error as Error;
    if (err.message.includes("no server running") || err.message.includes("no sessions")) {
      return [];
    }
    logger.error({ error: err.message }, "Failed to list tmux sessions");
    throw new Error(`Failed to list tmux sessions: ${err.message}`);
  }
}

/**
 * Find panes running Claude
 */
export async function findClaudePanes(): Promise<TmuxPane[]> {
  const panes = await listPanes();
  return panes.filter((p) => p.command === "claude");
}

/**
 * Check if a specific pane exists
 */
export async function paneExists(target: string): Promise<boolean> {
  if (!validateTarget(target)) {
    return false;
  }

  const panes = await listPanes();
  return panes.some((p) => p.target === target);
}

/**
 * Get info about a specific pane
 */
export async function getPaneInfo(target: string): Promise<TmuxPane | null> {
  if (!validateTarget(target)) {
    return null;
  }

  const panes = await listPanes();
  return panes.find((p) => p.target === target) ?? null;
}

/**
 * Strip ANSI escape codes from text
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

/**
 * Check if Claude Code is idle (at the prompt, ready for input)
 * Looks for the ❯ prompt without busy indicators AFTER the prompt
 */
export async function isClaudeIdle(target: string): Promise<boolean> {
  try {
    const content = await capturePane(target, 20); // Last 20 lines
    const cleaned = stripAnsi(content);

    // Filter out:
    // - Empty lines
    // - Status bar lines (⏵⏵ bypass permissions...)
    // - Horizontal rule lines (───────)
    const lines = cleaned
      .split("\n")
      .map(l => l.trim())
      .filter(l => {
        if (!l) return false;
        if (l.startsWith("⏵")) return false;
        // Filter horizontal rules (lines of repeated ─, -, =, etc.)
        if (/^[─━═┄┅┈┉\-_=]+$/.test(l)) return false;
        return true;
      });

    if (lines.length === 0) return false;

    // Find the LAST prompt line (❯ or >)
    let promptIndex = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^[❯>]\s*$/.test(lines[i]) || lines[i] === "❯") {
        promptIndex = i;
        break;
      }
    }

    // No prompt found = not idle
    if (promptIndex === -1) {
      logger.debug({ target, lastLines: lines.slice(-3).map(l => l.slice(0, 40)) }, "No prompt found");
      return false;
    }

    // Check if there are busy indicators AFTER the prompt
    // (Lines after the prompt that indicate Claude started working again)
    const linesAfterPrompt = lines.slice(promptIndex + 1);

    // Busy indicators - Claude is processing
    const busyPatterns = [
      /Running.*hooks/i,
      /Hatching/i,
      /Metamorphosing/i,
      /Transfiguring/i,
      /Thinking/i,
      /✻/,  // Spinner
      /◐|◑|◒|◓/,  // Rotating spinner
      /Esc to interrupt/i,
      // Tool execution indicators - match any tool-like pattern after prompt
      /^⏺\s*\w+\s*\(/,  // ⏺ Word( - e.g., "⏺ Bash(", "⏺ Update("
      /^⏺\s*\w+\b/,     // ⏺ Word - e.g., "⏺ Read file", "⏺ Task agent"
      /^·\s*\w+/i,       // · Word - alternative bullet style
    ];

    for (const line of linesAfterPrompt) {
      for (const pattern of busyPatterns) {
        if (pattern.test(line)) {
          logger.debug({ target, pattern: pattern.source, line: line.slice(0, 40) }, "Claude is busy (activity after prompt)");
          return false;
        }
      }
    }

    // Prompt found and no busy activity after it = idle
    logger.debug({ target, promptIndex, linesAfterPrompt: linesAfterPrompt.length }, "Claude is idle");
    return true;
  } catch (error) {
    logger.warn({ target, error: (error as Error).message }, "Failed to check idle state");
    return false;
  }
}

/**
 * Wait for Claude to become idle (with timeout)
 * @param target - tmux target
 * @param timeoutMs - maximum time to wait (default: 30 seconds)
 * @param pollIntervalMs - how often to check (default: 500ms)
 * @returns true if Claude became idle, false if timeout
 */
export async function waitForIdle(
  target: string,
  timeoutMs = 30000,
  pollIntervalMs = 500
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await isClaudeIdle(target)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  logger.warn({ target, timeoutMs }, "Timeout waiting for Claude to become idle");
  return false;
}

/**
 * Format pane output for Telegram
 * - Strips ANSI codes
 * - Converts to HTML formatting
 * - Preserves code blocks
 * - Handles line wrapping
 * @param text - Raw text from tmux pane
 * @param useHtml - Whether to use HTML formatting (default: true)
 */
export function formatForTelegram(text: string, useHtml = true): string {
  let formatted = stripAnsi(text);

  // Remove excessive blank lines (more than 2 consecutive)
  formatted = formatted.replace(/\n{3,}/g, "\n\n");

  // Trim trailing whitespace from each line
  formatted = formatted
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

  // Trim overall whitespace
  formatted = formatted.trim();

  if (useHtml) {
    // Convert to HTML and safely truncate
    formatted = formatToHtml(formatted);
    formatted = truncateHtml(formatted, 4000);
  } else {
    // Plain text truncation
    const MAX_LENGTH = 4000;
    if (formatted.length > MAX_LENGTH) {
      formatted = formatted.slice(0, MAX_LENGTH) + "\n\n... [truncated]";
    }
  }

  return formatted;
}
