import { describe, it, expect } from "vitest";
import {
  parseStreamLine,
  extractTextContent,
  extractEventText,
  isPartialMessage,
  isFinalMessage,
  isToolUseEvent,
  isToolResultEvent,
  formatToolUse,
} from "./stream-parser.js";
import type { ClaudeStreamEvent, ClaudeMessage, ClaudeContent } from "../types.js";

describe("stream-parser", () => {
  describe("parseStreamLine", () => {
    it("should parse valid JSON line", () => {
      const line = '{"type":"assistant","message":{"role":"assistant","content":[]}}';
      const result = parseStreamLine(line);
      expect(result).toEqual({ type: "assistant", message: { role: "assistant", content: [] } });
    });

    it("should return null for empty line", () => {
      expect(parseStreamLine("")).toBeNull();
      expect(parseStreamLine("  ")).toBeNull();
    });

    it("should return null for invalid JSON", () => {
      expect(parseStreamLine("{invalid}")).toBeNull();
      expect(parseStreamLine("not json")).toBeNull();
    });

    it("should parse assistant message with text content", () => {
      const event = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello world" }],
        },
      };
      const result = parseStreamLine(JSON.stringify(event));
      expect(result).toEqual(event);
    });

    it("should parse tool_use event", () => {
      const event = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-123",
              name: "bash",
              input: { command: "ls" },
            },
          ],
        },
      };
      const result = parseStreamLine(JSON.stringify(event));
      expect(result).toEqual(event);
    });
  });

  describe("extractTextContent", () => {
    it("should extract text from message content", () => {
      const message: ClaudeMessage = {
        role: "assistant",
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
        ],
      };
      expect(extractTextContent(message)).toBe("Hello world");
    });

    it("should return empty string for no text content", () => {
      const message: ClaudeMessage = {
        role: "assistant",
        content: [
          { type: "tool_use", id: "1", name: "bash", input: {} },
        ],
      };
      expect(extractTextContent(message)).toBe("");
    });

    it("should handle empty content array", () => {
      const message: ClaudeMessage = { role: "assistant", content: [] };
      expect(extractTextContent(message)).toBe("");
    });
  });

  describe("extractEventText", () => {
    it("should extract text from assistant event", () => {
      const event: ClaudeStreamEvent = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Test response" }],
        },
      };
      expect(extractEventText(event)).toBe("Test response");
    });

    it("should extract text from result event content", () => {
      const event: ClaudeStreamEvent = {
        type: "result",
        content: "Final result text",
      };
      expect(extractEventText(event)).toBe("Final result text");
    });

    it("should return null for other event types", () => {
      const event: ClaudeStreamEvent = {
        type: "system",
      };
      expect(extractEventText(event)).toBeNull();
    });
  });

  describe("isPartialMessage", () => {
    it("should return true for partial assistant message", () => {
      const event: ClaudeStreamEvent = {
        type: "assistant",
        subtype: "partial",
        message: { role: "assistant", content: [] },
      };
      expect(isPartialMessage(event)).toBe(true);
    });

    it("should return false for complete message", () => {
      const event: ClaudeStreamEvent = {
        type: "assistant",
        message: { role: "assistant", content: [] },
      };
      expect(isPartialMessage(event)).toBe(false);
    });
  });

  describe("isFinalMessage", () => {
    it("should return true for result event", () => {
      const event: ClaudeStreamEvent = {
        type: "result",
        content: "done",
      };
      expect(isFinalMessage(event)).toBe(true);
    });

    it("should return false for assistant message", () => {
      const event: ClaudeStreamEvent = {
        type: "assistant",
        message: { role: "assistant", content: [] },
      };
      expect(isFinalMessage(event)).toBe(false);
    });
  });

  describe("isToolUseEvent", () => {
    it("should return true for tool_use event type", () => {
      const event: ClaudeStreamEvent = {
        type: "tool_use",
        tool_use_id: "tool-123",
        tool_name: "bash",
        tool_input: { command: "ls" },
      };
      expect(isToolUseEvent(event)).toBe(true);
    });

    it("should return false for assistant event type", () => {
      const event: ClaudeStreamEvent = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
        },
      };
      expect(isToolUseEvent(event)).toBe(false);
    });
  });

  describe("isToolResultEvent", () => {
    it("should return true for tool_result event type", () => {
      const event: ClaudeStreamEvent = {
        type: "tool_result",
        tool_use_id: "tool-123",
        content: "Command output here",
      };
      expect(isToolResultEvent(event)).toBe(true);
    });

    it("should return false for assistant event type", () => {
      const event: ClaudeStreamEvent = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
        },
      };
      expect(isToolResultEvent(event)).toBe(false);
    });
  });

  describe("formatToolUse", () => {
    it("should format Bash tool use for display", () => {
      const event: ClaudeStreamEvent = {
        type: "tool_use",
        tool_use_id: "tool-123",
        tool_name: "Bash",
        tool_input: { command: "ls -la" },
      };
      const result = formatToolUse(event);
      expect(result).toContain("Running");
      expect(result).toContain("ls -la");
    });

    it("should format Read tool use for display", () => {
      const event: ClaudeStreamEvent = {
        type: "tool_use",
        tool_use_id: "tool-456",
        tool_name: "Read",
        tool_input: { file_path: "/path/to/file.ts" },
      };
      const result = formatToolUse(event);
      expect(result).toContain("Reading");
      expect(result).toContain("/path/to/file.ts");
    });

    it("should format unknown tools generically", () => {
      const event: ClaudeStreamEvent = {
        type: "tool_use",
        tool_use_id: "tool-789",
        tool_name: "CustomTool",
        tool_input: {},
      };
      const result = formatToolUse(event);
      expect(result).toBe("Tool: CustomTool");
    });

    it("should return empty string for non-tool event", () => {
      const event: ClaudeStreamEvent = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
        },
      };
      expect(formatToolUse(event)).toBe("");
    });
  });
});
