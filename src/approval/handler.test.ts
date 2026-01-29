import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { ApprovalRequest } from "../types.js";

// Hoist mock functions so they're available when vi.mock runs
const { mockMkdir, mockWriteFile } = vi.hoisted(() => ({
  mockMkdir: vi.fn().mockResolvedValue(undefined),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock fs/promises - handler uses default import
vi.mock("fs/promises", () => ({
  default: {
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
  },
}));

// Mock policy module
vi.mock("./policy.js", () => ({
  loadPolicy: vi.fn(() => ({
    rules: [],
    defaultAction: "require-approval",
    timeoutSeconds: 300,
  })),
  evaluatePolicy: vi.fn(() => "require-approval"),
}));

// Mock logger
vi.mock("../utils/logger.js", () => ({
  createChildLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { ApprovalHandler } from "./handler.js";
import { evaluatePolicy } from "./policy.js";
import type { Bot } from "grammy";
import type { BotContext } from "../types.js";

// Create a mock bot with properly typed methods for testing
function createMockBot() {
  const bot = {
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 123 }),
      editMessageText: vi.fn().mockResolvedValue({}),
    },
  };
  return bot;
}

describe("ApprovalHandler", () => {
  let handler: ApprovalHandler;
  let mockBot: {
    api: {
      sendMessage: ReturnType<typeof vi.fn>;
      editMessageText: ReturnType<typeof vi.fn>;
    };
  };
  const chatId = 12345;

  // Helper to create a request
  const createRequest = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
    id: overrides.id ?? "test-request-id",
    toolName: overrides.toolName ?? "Bash",
    toolInput: overrides.toolInput ?? { command: "ls -la" },
    timestamp: overrides.timestamp ?? Date.now() / 1000,
    status: overrides.status ?? "pending",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockBot = createMockBot();
    handler = new ApprovalHandler(mockBot as unknown as Bot<BotContext>, chatId);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("handleRequest", () => {
    it("should auto-approve when policy returns auto-approve", async () => {
      vi.mocked(evaluatePolicy).mockReturnValue("auto-approve");
      const request = createRequest();

      await handler.handleRequest(request);

      expect(mockWriteFile).toHaveBeenCalled();
      const [, content] = mockWriteFile.mock.calls[0];
      expect(JSON.parse(content as string)).toEqual({ approved: true });
      expect(mockBot.api.sendMessage).not.toHaveBeenCalled();
    });

    it("should auto-deny when policy returns auto-deny", async () => {
      vi.mocked(evaluatePolicy).mockReturnValue("auto-deny");
      const request = createRequest();

      await handler.handleRequest(request);

      expect(mockWriteFile).toHaveBeenCalled();
      const [, content] = mockWriteFile.mock.calls[0];
      expect(JSON.parse(content as string)).toEqual({ approved: false });
      expect(mockBot.api.sendMessage).not.toHaveBeenCalled();
    });

    it("should prompt user when policy returns require-approval", async () => {
      vi.mocked(evaluatePolicy).mockReturnValue("require-approval");
      const request = createRequest();

      await handler.handleRequest(request);

      expect(mockBot.api.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.any(String),
        expect.objectContaining({
          parse_mode: "HTML",
          reply_markup: expect.any(Object),
        })
      );
    });

    it("should auto-deny when sendMessage fails", async () => {
      vi.mocked(evaluatePolicy).mockReturnValue("require-approval");
      mockBot.api.sendMessage.mockRejectedValueOnce(new Error("Telegram API error"));

      const request = createRequest({ id: "send-fail-test" });
      await handler.handleRequest(request);

      expect(mockWriteFile).toHaveBeenCalled();
      const [, content] = mockWriteFile.mock.calls[0];
      expect(JSON.parse(content as string)).toEqual({ approved: false });
    });

    it("should write response file on auto-approve", async () => {
      vi.mocked(evaluatePolicy).mockReturnValue("auto-approve");
      const request = createRequest({ id: "auto-approve-test" });

      await handler.handleRequest(request);

      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("auto-approve-test.response"),
        expect.any(String),
        "utf-8"
      );
    });

    it("should write response file on auto-deny", async () => {
      vi.mocked(evaluatePolicy).mockReturnValue("auto-deny");
      const request = createRequest({ id: "auto-deny-test" });

      await handler.handleRequest(request);

      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("auto-deny-test.response"),
        expect.any(String),
        "utf-8"
      );
    });
  });

  describe("writeResponse", () => {
    it("should create approval directory if not exists", async () => {
      await handler.writeResponse("test-id", true);

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining("approvals"),
        { recursive: true }
      );
    });

    it("should write JSON response file", async () => {
      await handler.writeResponse("test-id", true);

      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("test-id.response"),
        JSON.stringify({ approved: true }),
        "utf-8"
      );
    });

    it("should cleanup pending request", async () => {
      // First create a pending request
      vi.mocked(evaluatePolicy).mockReturnValue("require-approval");
      const request = createRequest({ id: "pending-test" });
      await handler.handleRequest(request);

      // Verify it's pending
      expect(handler.getPendingRequest("pending-test")).toBeDefined();

      // Write response
      await handler.writeResponse("pending-test", true);

      // Verify it's cleaned up
      expect(handler.getPendingRequest("pending-test")).toBeUndefined();
    });

    it("should throw on write error", async () => {
      mockWriteFile.mockRejectedValueOnce(new Error("Write failed"));

      await expect(handler.writeResponse("test-id", true)).rejects.toThrow("Write failed");
    });
  });

  describe("resolveRequest", () => {
    beforeEach(async () => {
      // Create a pending request first
      vi.mocked(evaluatePolicy).mockReturnValue("require-approval");
      const request = createRequest({ id: "resolve-test" });
      await handler.handleRequest(request);
    });

    it("should resolve pending request with approval", async () => {
      const result = await handler.resolveRequest("resolve-test", true);

      expect(result).toBe(true);
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("should resolve pending request with denial", async () => {
      const result = await handler.resolveRequest("resolve-test", false);

      expect(result).toBe(true);
    });

    it("should return false for unknown request", async () => {
      const result = await handler.resolveRequest("unknown-id", true);

      expect(result).toBe(false);
    });
  });

  describe("timeout handling", () => {
    it("should auto-deny on timeout", async () => {
      vi.mocked(evaluatePolicy).mockReturnValue("require-approval");
      const request = createRequest({ id: "timeout-test" });

      await handler.handleRequest(request);

      // Fast-forward past timeout (5 minutes)
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);

      // Should have written denial response
      const writeCalls = mockWriteFile.mock.calls;
      const lastCall = writeCalls[writeCalls.length - 1];
      expect(JSON.parse(lastCall[1] as string)).toEqual({ approved: false });
    });

    it("should update telegram message on timeout", async () => {
      vi.mocked(evaluatePolicy).mockReturnValue("require-approval");
      const request = createRequest({ id: "timeout-msg-test" });

      await handler.handleRequest(request);
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);

      expect(mockBot.api.editMessageText).toHaveBeenCalledWith(
        chatId,
        123,
        "<b>Timed out - auto-denied</b>",
        { parse_mode: "HTML" }
      );
    });

    it("should not timeout already resolved requests", async () => {
      vi.mocked(evaluatePolicy).mockReturnValue("require-approval");
      const request = createRequest({ id: "early-resolve-test" });

      await handler.handleRequest(request);

      // Resolve before timeout
      await handler.resolveRequest("early-resolve-test", true);

      // Fast-forward past timeout
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);

      // editMessageText should only have been called once (not for timeout)
      expect(mockBot.api.editMessageText).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        "<b>Timed out - auto-denied</b>",
        expect.anything()
      );
    });
  });

  describe("cleanup", () => {
    it("should clear all pending requests on shutdown", async () => {
      vi.mocked(evaluatePolicy).mockReturnValue("require-approval");

      // Create multiple pending requests
      await handler.handleRequest(createRequest({ id: "cleanup-1" }));
      await handler.handleRequest(createRequest({ id: "cleanup-2" }));

      // Both should be pending
      expect(handler.getAllPendingRequests().size).toBe(2);

      await handler.cleanup();

      // All pending should be cleared
      expect(handler.getAllPendingRequests().size).toBe(0);
    });

    it("should update telegram messages on shutdown", async () => {
      vi.mocked(evaluatePolicy).mockReturnValue("require-approval");
      await handler.handleRequest(createRequest({ id: "cleanup-msg-test" }));

      await handler.cleanup();

      expect(mockBot.api.editMessageText).toHaveBeenCalledWith(
        chatId,
        123,
        "<b>Shutdown - auto-denied</b>",
        { parse_mode: "HTML" }
      );
    });

    it("should continue on partial failures", async () => {
      vi.mocked(evaluatePolicy).mockReturnValue("require-approval");

      // Create multiple pending requests
      await handler.handleRequest(createRequest({ id: "fail-1" }));
      await handler.handleRequest(createRequest({ id: "fail-2" }));

      // Configure writeFile to fail once then succeed
      mockWriteFile
        .mockRejectedValueOnce(new Error("Write failed"))
        .mockResolvedValue(undefined);

      // Should not throw even with failures
      await expect(handler.cleanup()).resolves.not.toThrow();

      // Pending should still be cleared
      expect(handler.getAllPendingRequests().size).toBe(0);
    });
  });

  describe("formatRequestMessage", () => {
    it("should format tool name in bold", () => {
      const request = createRequest({ toolName: "Bash" });

      const message = handler.formatRequestMessage(request);

      expect(message).toContain("<b>Tool:</b> Bash");
    });

    it("should format string tool input", () => {
      const request = createRequest({ toolInput: "simple string input" });

      const message = handler.formatRequestMessage(request);

      expect(message).toContain("simple string input");
    });

    it("should format object tool input as JSON", () => {
      const request = createRequest({ toolInput: { command: "ls" } });

      const message = handler.formatRequestMessage(request);

      expect(message).toContain("command");
      expect(message).toContain("ls");
    });

    it("should truncate long inputs", () => {
      const longInput = "a".repeat(1000);
      const request = createRequest({ toolInput: longInput });

      const message = handler.formatRequestMessage(request);

      expect(message.length).toBeLessThan(longInput.length + 200);
      expect(message).toContain("...");
    });
  });

  describe("getPendingRequest", () => {
    it("should return pending request by ID", async () => {
      vi.mocked(evaluatePolicy).mockReturnValue("require-approval");
      const request = createRequest({ id: "get-test" });
      await handler.handleRequest(request);

      const pending = handler.getPendingRequest("get-test");

      expect(pending).toBeDefined();
      expect(pending?.request.id).toBe("get-test");
    });

    it("should return undefined for non-existent ID", () => {
      const pending = handler.getPendingRequest("non-existent");

      expect(pending).toBeUndefined();
    });
  });

  describe("getAllPendingRequests", () => {
    it("should return all pending requests", async () => {
      vi.mocked(evaluatePolicy).mockReturnValue("require-approval");
      await handler.handleRequest(createRequest({ id: "all-1" }));
      await handler.handleRequest(createRequest({ id: "all-2" }));

      const all = handler.getAllPendingRequests();

      expect(all.size).toBe(2);
      expect(all.has("all-1")).toBe(true);
      expect(all.has("all-2")).toBe(true);
    });
  });
});
