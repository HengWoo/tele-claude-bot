/**
 * Tests for FeishuInteractiveHandler
 *
 * Focuses on error handling scenarios that need user feedback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FeishuInteractiveHandler } from "./feishu-handler.js";
import type { DetectedPrompt } from "./types.js";
import * as tmux from "../tmux/index.js";

// Mock the tmux module
vi.mock("../tmux/index.js", () => ({
  selectOptionByIndex: vi.fn(),
  toggleOption: vi.fn(),
  submitMultiSelect: vi.fn(),
  sendLiteralText: vi.fn(),
  sendNavigationKey: vi.fn(),
  capturePane: vi.fn(),
}));

/**
 * Create a minimal mock Feishu adapter with required methods
 */
function createMockAdapter() {
  return {
    sendMessage: vi.fn().mockResolvedValue("msg_id_123"),
    getClient: vi.fn().mockReturnValue({
      sendCard: vi.fn().mockResolvedValue("card_msg_id"),
      updateCard: vi.fn().mockResolvedValue({}),
    }),
    onCallback: vi.fn(),
  };
}

/**
 * Create a test prompt
 */
function createTestPrompt(overrides: Partial<DetectedPrompt> = {}): DetectedPrompt {
  return {
    type: "single",
    question: "Which option?",
    options: [
      { index: 0, label: "Option A", selected: false },
      { index: 1, label: "Option B", selected: false },
      { index: 2, label: "Other", selected: false },
    ],
    hasOther: true,
    ...overrides,
  };
}

describe("FeishuInteractiveHandler", () => {
  let mockAdapter: ReturnType<typeof createMockAdapter>;
  let handler: FeishuInteractiveHandler;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    // Create handler - cast to any to bypass type checking for mock
    handler = new FeishuInteractiveHandler(mockAdapter as any);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("handleTextInput error feedback", () => {
    it("should return false when no pending prompt exists", async () => {
      const result = await handler.handleTextInput("user123", "my custom text");
      expect(result).toBe(false);
    });

    it("should return false when prompt is not awaiting text input", async () => {
      // Show a prompt (creates pending state)
      handler.showPrompt(createTestPrompt(), "user123", "%1", "1:0.0", "chat_456");
      await new Promise((r) => setTimeout(r, 0));

      // handleTextInput should fail because awaitingTextInput is false
      const result = await handler.handleTextInput("user123", "my custom text");
      expect(result).toBe(false);

      // Clean up
      (handler as any).pendingPrompts.clear();
      (handler as any).timeoutHandles.clear();
    });

    it("should send error message to user when tmux injection fails", async () => {
      // Show a prompt
      handler.showPrompt(createTestPrompt(), "user123", "%1", "1:0.0", "chat_456");
      await new Promise((r) => setTimeout(r, 0));

      // Manually set awaitingTextInput flag
      const pendingMap = (handler as any).pendingPrompts as Map<string, any>;
      const promptKey = "user123:%1";
      const pending = pendingMap.get(promptKey);
      expect(pending).toBeDefined();
      pending.awaitingTextInput = true;

      // Mock tmux failure
      vi.mocked(tmux.selectOptionByIndex).mockRejectedValue(new Error("tmux injection failed"));

      const result = await handler.handleTextInput("user123", "my custom response");

      // Should return false
      expect(result).toBe(false);

      // Should have attempted to send error message via adapter
      expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
        "chat_456",
        expect.stringContaining("Failed to send")
      );

      // Clean up
      pendingMap.clear();
      (handler as any).timeoutHandles.clear();
    });

    it("should reset awaitingTextInput flag on failure", async () => {
      // Show a prompt
      handler.showPrompt(createTestPrompt(), "user123", "%1", "1:0.0", "chat_456");
      await new Promise((r) => setTimeout(r, 0));

      // Manually set awaitingTextInput flag
      const pendingMap = (handler as any).pendingPrompts as Map<string, any>;
      const promptKey = "user123:%1";
      const pending = pendingMap.get(promptKey);
      expect(pending).toBeDefined();
      pending.awaitingTextInput = true;

      // Mock tmux failure
      vi.mocked(tmux.selectOptionByIndex).mockRejectedValue(new Error("fail"));

      await handler.handleTextInput("user123", "test");

      // awaitingTextInput should be reset to false
      const pendingAfter = pendingMap.get(promptKey);
      expect(pendingAfter?.awaitingTextInput).toBe(false);

      // Clean up
      pendingMap.clear();
      (handler as any).timeoutHandles.clear();
    });

    it("should still return false even if error message sending fails", async () => {
      // Show a prompt
      handler.showPrompt(createTestPrompt(), "user123", "%1", "1:0.0", "chat_456");
      await new Promise((r) => setTimeout(r, 0));

      // Manually set awaitingTextInput flag
      const pendingMap = (handler as any).pendingPrompts as Map<string, any>;
      const promptKey = "user123:%1";
      const pending = pendingMap.get(promptKey);
      expect(pending).toBeDefined();
      pending.awaitingTextInput = true;

      // Mock tmux failure AND message sending failure
      vi.mocked(tmux.selectOptionByIndex).mockRejectedValue(new Error("tmux fail"));
      mockAdapter.sendMessage.mockRejectedValue(new Error("feishu fail"));

      const result = await handler.handleTextInput("user123", "test");

      // Should still return false gracefully
      expect(result).toBe(false);

      // Clean up
      pendingMap.clear();
      (handler as any).timeoutHandles.clear();
    });

    it("should include helpful retry instructions in error message", async () => {
      // Show a prompt
      handler.showPrompt(createTestPrompt(), "user123", "%1", "1:0.0", "chat_456");
      await new Promise((r) => setTimeout(r, 0));

      // Manually set awaitingTextInput flag
      const pendingMap = (handler as any).pendingPrompts as Map<string, any>;
      const promptKey = "user123:%1";
      const pending = pendingMap.get(promptKey);
      expect(pending).toBeDefined();
      pending.awaitingTextInput = true;

      // Mock tmux failure
      vi.mocked(tmux.selectOptionByIndex).mockRejectedValue(new Error("fail"));

      await handler.handleTextInput("user123", "test");

      // Error message should include retry instructions
      expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
        "chat_456",
        expect.stringMatching(/try again|cancel/i)
      );

      // Clean up
      pendingMap.clear();
      (handler as any).timeoutHandles.clear();
    });

    it("should allow user to retry after error", async () => {
      // Show a prompt
      handler.showPrompt(createTestPrompt(), "user123", "%1", "1:0.0", "chat_456");
      await new Promise((r) => setTimeout(r, 0));

      // Manually set awaitingTextInput flag
      const pendingMap = (handler as any).pendingPrompts as Map<string, any>;
      const promptKey = "user123:%1";
      const pending = pendingMap.get(promptKey);
      expect(pending).toBeDefined();
      pending.awaitingTextInput = true;

      // First attempt fails
      vi.mocked(tmux.selectOptionByIndex).mockRejectedValueOnce(new Error("fail"));
      const result1 = await handler.handleTextInput("user123", "test");
      expect(result1).toBe(false);

      // Re-enable text input (simulating user clicking "Other" again)
      const pendingAfter = pendingMap.get(promptKey);
      expect(pendingAfter).toBeDefined();
      pendingAfter.awaitingTextInput = true;

      // Second attempt succeeds
      vi.mocked(tmux.selectOptionByIndex).mockResolvedValueOnce(undefined);
      vi.mocked(tmux.capturePane).mockResolvedValue(""); // No option markers
      vi.mocked(tmux.sendLiteralText).mockResolvedValue(undefined);

      const result2 = await handler.handleTextInput("user123", "test");
      expect(result2).toBe(true);

      // Clean up
      pendingMap.clear();
      (handler as any).timeoutHandles.clear();
    });
  });

  describe("isAwaitingTextInput", () => {
    it("should return false when no pending prompt", () => {
      expect(handler.isAwaitingTextInput("user123")).toBe(false);
    });

    it("should return false when prompt exists but not awaiting text", async () => {
      handler.showPrompt(createTestPrompt(), "user123", "%1", "1:0.0", "chat_456");
      await new Promise((r) => setTimeout(r, 0));
      expect(handler.isAwaitingTextInput("user123")).toBe(false);

      // Clean up
      (handler as any).pendingPrompts.clear();
      (handler as any).timeoutHandles.clear();
    });

    it("should return true when awaiting text input", async () => {
      handler.showPrompt(createTestPrompt(), "user123", "%1", "1:0.0", "chat_456");
      await new Promise((r) => setTimeout(r, 0));

      // Manually set flag
      const pendingMap = (handler as any).pendingPrompts as Map<string, any>;
      const pending = pendingMap.get("user123:%1");
      expect(pending).toBeDefined();
      pending.awaitingTextInput = true;

      expect(handler.isAwaitingTextInput("user123")).toBe(true);

      // Clean up
      pendingMap.clear();
      (handler as any).timeoutHandles.clear();
    });
  });
});
