import type { ClaudeStreamEvent, ClaudeMessage, ClaudeContent } from "../types.js";
import { createChildLogger } from "../utils/logger.js";

const logger = createChildLogger("stream-parser");

/**
 * Parse a single line of NDJSON from Claude's stream-json output
 */
export function parseStreamLine(line: string): ClaudeStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return normalizeEvent(parsed);
  } catch (error) {
    logger.warn({ line, error }, "Failed to parse stream line");
    return null;
  }
}

/**
 * Normalize raw Claude CLI output into ClaudeStreamEvent
 */
function normalizeEvent(raw: Record<string, unknown>): ClaudeStreamEvent {
  const type = raw.type as ClaudeStreamEvent["type"];

  const event: ClaudeStreamEvent = { type };

  // Copy common fields
  if (raw.subtype !== undefined) {
    event.subtype = raw.subtype as string;
  }

  if (raw.session_id !== undefined) {
    event.session_id = raw.session_id as string;
  }

  if (raw.total_cost_usd !== undefined) {
    event.total_cost_usd = raw.total_cost_usd as number;
  }

  if (raw.usage !== undefined) {
    event.usage = raw.usage as ClaudeStreamEvent["usage"];
  }

  // Handle message field (for assistant/user events)
  if (raw.message !== undefined) {
    event.message = raw.message as ClaudeMessage;
  }

  // Handle tool_use events
  if (type === "tool_use") {
    event.tool_use_id = raw.tool_use_id as string;
    event.tool_name = raw.tool_name as string;
    event.tool_input = raw.tool_input as Record<string, unknown>;
  }

  // Handle tool_result events
  if (type === "tool_result") {
    event.tool_use_id = raw.tool_use_id as string;
    event.content = raw.content as string;
  }

  // Handle result events (final message)
  if (type === "result") {
    if (raw.result !== undefined) {
      // Result may contain the final message
      event.content = raw.result as string;
    }
    if (raw.content !== undefined) {
      event.content = raw.content as string;
    }
  }

  // Handle error events
  if (type === "error") {
    event.content = (raw.error as string) ?? (raw.message as string) ?? (raw.content as string);
  }

  return event;
}

/**
 * Extract text content from a ClaudeMessage
 */
export function extractTextContent(message: ClaudeMessage): string {
  if (!message.content || !Array.isArray(message.content)) {
    return "";
  }

  return message.content
    .filter((c): c is Extract<ClaudeContent, { type: "text" }> => c.type === "text")
    .map((c) => c.text)
    .join("");
}

/**
 * Extract all text from a stream event
 */
export function extractEventText(event: ClaudeStreamEvent): string | null {
  // Direct content field
  if (event.content) {
    return event.content;
  }

  // Message content
  if (event.message) {
    const text = extractTextContent(event.message);
    if (text) {
      return text;
    }
  }

  return null;
}

/**
 * Check if event is a partial message update
 */
export function isPartialMessage(event: ClaudeStreamEvent): boolean {
  return event.subtype === "partial";
}

/**
 * Check if event is a final/complete message
 */
export function isFinalMessage(event: ClaudeStreamEvent): boolean {
  return event.type === "result" || event.subtype === "final";
}

/**
 * Check if event requires tool approval
 */
export function isToolUseEvent(event: ClaudeStreamEvent): boolean {
  return event.type === "tool_use";
}

/**
 * Check if event is a tool result
 */
export function isToolResultEvent(event: ClaudeStreamEvent): boolean {
  return event.type === "tool_result";
}

/**
 * Format tool use for display
 */
export function formatToolUse(event: ClaudeStreamEvent): string {
  if (event.type !== "tool_use") {
    return "";
  }

  const toolName = event.tool_name ?? "unknown";
  const input = event.tool_input ?? {};

  // Format common tools nicely
  switch (toolName) {
    case "Bash":
      return `Running: ${input.command ?? "command"}`;
    case "Read":
      return `Reading: ${input.file_path ?? "file"}`;
    case "Write":
      return `Writing: ${input.file_path ?? "file"}`;
    case "Edit":
      return `Editing: ${input.file_path ?? "file"}`;
    case "Glob":
      return `Searching: ${input.pattern ?? "pattern"}`;
    case "Grep":
      return `Searching for: ${input.pattern ?? "pattern"}`;
    default:
      return `Tool: ${toolName}`;
  }
}
