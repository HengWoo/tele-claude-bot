import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createChildLogger } from "../utils/logger.js";

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
 * Format pane output for Telegram
 * - Strips ANSI codes
 * - Preserves code blocks
 * - Handles line wrapping
 */
export function formatForTelegram(text: string): string {
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

  // Telegram has a 4096 character limit - truncate if needed
  const MAX_LENGTH = 4000; // Leave some buffer
  if (formatted.length > MAX_LENGTH) {
    formatted = formatted.slice(0, MAX_LENGTH) + "\n\n... [truncated]";
  }

  return formatted;
}
