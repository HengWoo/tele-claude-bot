import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync } from "node:fs";
import type { Session, ClaudeStreamEvent } from "../types.js";
import { createChildLogger } from "../utils/logger.js";
import { parseStreamLine, extractEventText, isToolUseEvent, isFinalMessage } from "./stream-parser.js";

const logger = createChildLogger("claude-bridge");

export interface SpawnClaudeOptions {
  /** Model to use (overrides default) */
  model?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Environment variables to pass */
  env?: Record<string, string>;
  /** Whether to use --dangerously-skip-permissions */
  skipPermissions?: boolean;
}

export interface ClaudeProcess extends EventEmitter {
  /** The underlying child process */
  process: ChildProcess;
  /** Session ID being used */
  sessionId: string;
  /** Send approval response for a tool */
  sendApproval(approved: boolean): void;
  /** Send a follow-up message */
  sendMessage(message: string): void;
  /** Kill the process */
  kill(): void;
  /** Whether the process is still running */
  isRunning(): boolean;
}

/**
 * Events emitted by ClaudeProcess:
 * - 'event': (event: ClaudeStreamEvent) - Parsed stream event
 * - 'text': (text: string) - Text content from assistant
 * - 'tool_use': (event: ClaudeStreamEvent) - Tool use requiring approval
 * - 'result': (event: ClaudeStreamEvent) - Final result
 * - 'error': (error: Error) - Error occurred
 * - 'exit': (code: number | null) - Process exited
 */

/**
 * Spawn Claude CLI and communicate with it
 */
export function spawnClaude(
  prompt: string,
  session: Session,
  options: SpawnClaudeOptions = {}
): ClaudeProcess {
  const emitter = new EventEmitter() as ClaudeProcess;
  const { model, timeout, env, skipPermissions = false } = options;

  // Build command arguments
  const args = [
    "-p", // Print mode (non-interactive)
    "--output-format",
    "stream-json",
    "--verbose", // Required for stream-json with -p
    "--session-id",
    session.id,
  ];

  if (model) {
    args.push("--model", model);
  }

  if (skipPermissions) {
    args.push("--dangerously-skip-permissions");
  }

  logger.info(
    { sessionId: session.id, workspace: session.workspace, args },
    "Spawning Claude CLI"
  );

  // Spawn the process using full path to claude CLI
  const homedir = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const claudePath = `${homedir}/.local/bin/claude`;

  // Ensure workspace directory exists
  if (!existsSync(session.workspace)) {
    logger.info({ workspace: session.workspace }, "Creating workspace directory");
    mkdirSync(session.workspace, { recursive: true });
  }

  const proc = spawn(claudePath, args, {
    cwd: session.workspace,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let running = true;
  let buffer = "";
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  // Set up timeout if specified
  if (timeout && timeout > 0) {
    timeoutId = setTimeout(() => {
      if (running) {
        logger.warn({ sessionId: session.id, timeout }, "Claude process timed out");
        emitter.emit("error", new Error(`Process timed out after ${timeout}ms`));
        proc.kill("SIGTERM");
      }
    }, timeout);
  }

  // Handle stdout (NDJSON stream)
  proc.stdout?.on("data", (data: Buffer) => {
    const dataStr = data.toString();
    logger.info({ dataLength: dataStr.length }, "Received stdout data");
    buffer += dataStr;

    // Process complete lines
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

    logger.info({ lineCount: lines.length }, "Processing lines");

    for (const line of lines) {
      const event = parseStreamLine(line);
      if (!event) continue;

      logger.info({ eventType: event.type, hasMessage: !!event.message }, "Received stream event");

      // Emit the raw event
      emitter.emit("event", event);

      // Emit specialized events
      if (isToolUseEvent(event)) {
        emitter.emit("tool_use", event);
      }

      if (isFinalMessage(event)) {
        emitter.emit("result", event);
      }

      // Extract and emit text content
      const text = extractEventText(event);
      if (text) {
        logger.info({ textLength: text.length, textPreview: text.slice(0, 100) }, "Emitting text event");
        emitter.emit("text", text, event);
      }
    }
  });

  // Handle stderr
  proc.stderr?.on("data", (data: Buffer) => {
    const message = data.toString().trim();
    if (message) {
      logger.warn({ sessionId: session.id, stderr: message }, "Claude stderr");
      // Don't emit as error - stderr often contains non-fatal messages
    }
  });

  // Handle process exit
  proc.on("exit", (code, signal) => {
    running = false;
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    logger.info({ sessionId: session.id, code, signal }, "Claude process exited");

    // Process any remaining buffer
    if (buffer.trim()) {
      const event = parseStreamLine(buffer);
      if (event) {
        emitter.emit("event", event);
      }
    }

    emitter.emit("exit", code);
  });

  // Handle process errors
  proc.on("error", (error) => {
    running = false;
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    logger.error({ sessionId: session.id, error }, "Claude process error");
    emitter.emit("error", error);
  });

  // Write the prompt to stdin and close it
  if (proc.stdin) {
    proc.stdin.write(prompt);
    proc.stdin.end();
  }

  // Attach methods and properties
  emitter.process = proc;
  emitter.sessionId = session.id;

  emitter.sendApproval = (approved: boolean) => {
    if (!running || !proc.stdin?.writable) {
      logger.warn({ sessionId: session.id }, "Cannot send approval - process not running");
      return;
    }
    // Send y/n to stdin for approval
    const response = approved ? "y\n" : "n\n";
    proc.stdin.write(response);
    logger.debug({ sessionId: session.id, approved }, "Sent approval response");
  };

  emitter.sendMessage = (message: string) => {
    if (!running || !proc.stdin?.writable) {
      logger.warn({ sessionId: session.id }, "Cannot send message - process not running");
      return;
    }
    proc.stdin.write(message + "\n");
    logger.debug({ sessionId: session.id }, "Sent follow-up message");
  };

  emitter.kill = () => {
    if (running) {
      proc.kill("SIGTERM");
      running = false;
    }
  };

  emitter.isRunning = () => running;

  return emitter;
}

/**
 * Async generator version of spawnClaude for simpler iteration
 */
export async function* streamClaude(
  prompt: string,
  session: Session,
  options: SpawnClaudeOptions = {}
): AsyncGenerator<ClaudeStreamEvent, void, unknown> {
  const claude = spawnClaude(prompt, session, options);
  const events: ClaudeStreamEvent[] = [];
  let done = false;
  let error: Error | null = null;
  let resolveWait: (() => void) | null = null;

  claude.on("event", (event: ClaudeStreamEvent) => {
    events.push(event);
    if (resolveWait) {
      resolveWait();
      resolveWait = null;
    }
  });

  claude.on("exit", () => {
    done = true;
    if (resolveWait) {
      resolveWait();
      resolveWait = null;
    }
  });

  claude.on("error", (err: Error) => {
    error = err;
    done = true;
    if (resolveWait) {
      resolveWait();
      resolveWait = null;
    }
  });

  while (!done || events.length > 0) {
    if (events.length > 0) {
      yield events.shift()!;
    } else if (!done) {
      await new Promise<void>((resolve) => {
        resolveWait = resolve;
      });
    }
  }

  if (error) {
    throw error;
  }
}

// Re-export stream parser utilities
export {
  parseStreamLine,
  extractEventText,
  extractTextContent,
  isToolUseEvent,
  isToolResultEvent,
  isFinalMessage,
  isPartialMessage,
  formatToolUse,
} from "./stream-parser.js";

// Re-export approval queue
export { ApprovalQueue, approvalQueue } from "./approval.js";
