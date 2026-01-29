import { spawn } from "node:child_process";
import type { ScheduledTask } from "../types.js";
import { createChildLogger } from "../utils/logger.js";

const logger = createChildLogger("scheduler-jobs");

/**
 * Default tmux session name for Claude Code
 */
const DEFAULT_TMUX_SESSION = process.env.CLAUDE_TMUX_SESSION ?? "claude";

/**
 * Default morning briefing prompt
 */
export const DEFAULT_MORNING_BRIEFING = `First, read ~/.claude/soul.md for your personality and ~/.claude/memories/ for context about me.

Then provide a morning briefing:
1. Summarize unread emails (top 5 most important, use urgency indicators from soul.md)
2. List today's calendar events with any relevant context from my memories
3. Flag any urgent items that need attention
4. Remind me of any important dates coming up (from memories/facts.md)

Keep it concise and actionable.`;

/**
 * Result of a job execution
 */
export interface JobResult {
  success: boolean;
  error?: string;
  timestamp: number;
}

/**
 * Escape text for safe injection via tmux send-keys -l (literal mode).
 * The -l flag handles most special characters, but we still need to escape
 * shell metacharacters since the command goes through spawn.
 */
function escapeForTmux(text: string): string {
  // Escape backslashes first, then double quotes for shell safety
  // Newlines are handled correctly by tmux send-keys -l in literal mode
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")      // Escape shell variable expansion
    .replace(/`/g, "\\`");      // Escape backtick command substitution
}

/**
 * Execute a scheduled job by injecting the prompt into a Claude Code tmux session
 *
 * @param task - The scheduled task to execute
 * @param tmuxSession - Optional tmux session name (defaults to env var or "claude")
 * @returns Promise<boolean> indicating success or failure
 */
export async function executeJob(
  task: ScheduledTask,
  tmuxSession?: string
): Promise<boolean> {
  const session = tmuxSession ?? DEFAULT_TMUX_SESSION;

  logger.info(
    { taskId: task.id, taskName: task.name, session },
    "Executing scheduled job"
  );

  try {
    const result = await injectPromptToTmux(task.prompt, session);

    if (result.success) {
      logger.info(
        { taskId: task.id, taskName: task.name, session },
        "Job executed successfully"
      );
    } else {
      logger.error(
        { taskId: task.id, taskName: task.name, error: result.error },
        "Job execution failed"
      );
    }

    return result.success;
  } catch (error) {
    const err = error as Error;
    logger.error(
      { taskId: task.id, taskName: task.name, error: err.message },
      "Job execution threw an error"
    );
    return false;
  }
}

/**
 * Inject a prompt into a tmux session running Claude Code
 *
 * @param prompt - The prompt text to inject
 * @param session - The tmux session name
 * @returns JobResult with success status and optional error
 */
export async function injectPromptToTmux(
  prompt: string,
  session: string = DEFAULT_TMUX_SESSION
): Promise<JobResult> {
  const timestamp = Date.now();

  // First, check if the tmux session exists
  const sessionExists = await checkTmuxSession(session);
  if (!sessionExists) {
    return {
      success: false,
      error: `tmux session "${session}" not found. Make sure Claude Code is running in tmux.`,
      timestamp,
    };
  }

  // Escape the prompt for safe injection
  const escapedPrompt = escapeForTmux(prompt);

  return new Promise((resolve) => {
    // Use spawn to send the prompt via tmux send-keys
    // First send the text, then send Enter to execute
    const tmuxProcess = spawn("tmux", [
      "send-keys",
      "-t",
      session,
      "-l", // Literal mode - don't interpret special keys
      escapedPrompt,
    ]);

    let stderr = "";

    tmuxProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    tmuxProcess.on("close", (code) => {
      if (code !== 0) {
        resolve({
          success: false,
          error: `tmux send-keys failed with code ${code}: ${stderr.trim()}`,
          timestamp,
        });
        return;
      }

      // Small delay before sending Enter
      setTimeout(() => {
        const enterProcess = spawn("tmux", ["send-keys", "-t", session, "Enter"]);

        enterProcess.on("close", (enterCode) => {
          if (enterCode !== 0) {
            resolve({
              success: false,
              error: `Failed to send Enter key to tmux session`,
              timestamp,
            });
            return;
          }

          logger.debug(
            { session, promptLength: prompt.length },
            "Prompt injected successfully"
          );

          resolve({
            success: true,
            timestamp,
          });
        });

        enterProcess.on("error", (err) => {
          resolve({
            success: false,
            error: `Failed to spawn tmux for Enter key: ${err.message}`,
            timestamp,
          });
        });
      }, 50); // 50ms delay to ensure text is processed
    });

    tmuxProcess.on("error", (err) => {
      resolve({
        success: false,
        error: `Failed to spawn tmux: ${err.message}`,
        timestamp,
      });
    });
  });
}

/**
 * Check if a tmux session exists
 *
 * @param session - The tmux session name to check
 * @returns Promise<boolean> indicating if the session exists
 */
async function checkTmuxSession(session: string): Promise<boolean> {
  return new Promise((resolve) => {
    const process = spawn("tmux", ["has-session", "-t", session]);

    process.on("close", (code) => {
      resolve(code === 0);
    });

    process.on("error", (err) => {
      // spawn failed - tmux binary not found
      logger.warn(
        { error: err.message, session },
        "tmux binary not available - scheduled jobs will fail"
      );
      resolve(false);
    });
  });
}

/**
 * List all available tmux sessions
 *
 * @returns Promise<string[]> array of session names
 */
export async function listTmuxSessions(): Promise<string[]> {
  return new Promise((resolve) => {
    const process = spawn("tmux", ["list-sessions", "-F", "#{session_name}"]);

    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    process.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    process.on("close", (code) => {
      if (code !== 0) {
        logger.debug({ stderr }, "No tmux sessions found");
        resolve([]);
        return;
      }

      const sessions = stdout
        .trim()
        .split("\n")
        .filter((s) => s.length > 0);
      resolve(sessions);
    });

    process.on("error", (err) => {
      // spawn failed - tmux binary not found
      logger.warn(
        { error: err.message },
        "tmux binary not available - cannot list sessions"
      );
      resolve([]);
    });
  });
}
