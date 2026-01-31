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

  describe("callback error feedback", () => {
    describe("handleSelect", () => {
      it("should send error when tmux injection fails", async () => {
        // Show a prompt
        handler.showPrompt(createTestPrompt(), "user123", "%1", "1:0.0", "chat_456");
        await new Promise((r) => setTimeout(r, 0));

        // Mock tmux failure
        vi.mocked(tmux.selectOptionByIndex).mockRejectedValue(new Error("tmux injection failed"));

        const mockEvent = {
          data: "prompt_select:user123:0",
          from: { id: "user123" },
          chat: { id: "chat_456" },
        };

        // Call private method directly
        await (handler as any).handleSelect(mockEvent);

        // Should have sent error message via adapter
        expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
          "chat_456",
          expect.stringContaining("Failed to")
        );

        // Clean up
        (handler as any).pendingPrompts.clear();
        (handler as any).timeoutHandles.clear();
      });
    });

    describe("handleToggle", () => {
      it("should send error when tmux toggle fails", async () => {
        // Show a multi-select prompt
        const multiPrompt = createTestPrompt({
          type: "multi",
          options: [
            { index: 0, label: "Option A", selected: false },
            { index: 1, label: "Option B", selected: false },
          ],
          hasOther: false,
        });

        handler.showPrompt(multiPrompt, "user123", "%1", "1:0.0", "chat_456");
        await new Promise((r) => setTimeout(r, 0));

        // Mock tmux failure
        vi.mocked(tmux.toggleOption).mockRejectedValue(new Error("tmux toggle failed"));

        const mockEvent = {
          data: "prompt_toggle:user123:0",
          from: { id: "user123" },
          chat: { id: "chat_456" },
        };

        // Call private method directly
        await (handler as any).handleToggle(mockEvent);

        // Should have sent error message via adapter
        expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
          "chat_456",
          expect.stringContaining("Failed to")
        );

        // Clean up
        (handler as any).pendingPrompts.clear();
        (handler as any).timeoutHandles.clear();
      });
    });

    describe("handleSubmit", () => {
      it("should send error when tmux submit fails", async () => {
        // Show a multi-select prompt
        const multiPrompt = createTestPrompt({
          type: "multi",
          options: [
            { index: 0, label: "Option A", selected: false },
            { index: 1, label: "Option B", selected: false },
          ],
          hasOther: false,
        });

        handler.showPrompt(multiPrompt, "user123", "%1", "1:0.0", "chat_456");
        await new Promise((r) => setTimeout(r, 0));

        // Mock tmux failure
        vi.mocked(tmux.submitMultiSelect).mockRejectedValue(new Error("tmux submit failed"));

        const mockEvent = {
          data: "prompt_submit:user123",
          from: { id: "user123" },
          chat: { id: "chat_456" },
        };

        // Call private method directly
        await (handler as any).handleSubmit(mockEvent);

        // Should have sent error message via adapter
        expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
          "chat_456",
          expect.stringContaining("Failed to")
        );

        // Clean up
        (handler as any).pendingPrompts.clear();
        (handler as any).timeoutHandles.clear();
      });
    });
  });

  describe("callback authorization", () => {
    describe("handleSelect", () => {
      it("should reject callback from unauthorized user", async () => {
        // Setup prompt for user123
        handler.showPrompt(createTestPrompt(), "user123", "%1", "1:0.0", "chat_456");
        await new Promise((r) => setTimeout(r, 0));

        // Call with different user (unauthorized)
        const mockEvent = {
          data: "prompt_select:user123:0",
          from: { id: "attacker456" }, // Different user
          chat: { id: "chat_456" },
        };

        // Call private method directly
        await (handler as any).handleSelect(mockEvent);

        // Should NOT have called tmux (action should be blocked)
        expect(vi.mocked(tmux.selectOptionByIndex)).not.toHaveBeenCalled();

        // Clean up
        (handler as any).pendingPrompts.clear();
        (handler as any).timeoutHandles.clear();
      });
    });

    describe("handleToggle", () => {
      it("should reject callback from unauthorized user", async () => {
        const multiPrompt = createTestPrompt({
          type: "multi",
          options: [
            { index: 0, label: "Option A", selected: false },
            { index: 1, label: "Option B", selected: false },
          ],
          hasOther: false,
        });

        handler.showPrompt(multiPrompt, "user123", "%1", "1:0.0", "chat_456");
        await new Promise((r) => setTimeout(r, 0));

        const mockEvent = {
          data: "prompt_toggle:user123:0",
          from: { id: "attacker456" },
          chat: { id: "chat_456" },
        };

        // Call private method directly
        await (handler as any).handleToggle(mockEvent);

        expect(vi.mocked(tmux.toggleOption)).not.toHaveBeenCalled();

        (handler as any).pendingPrompts.clear();
        (handler as any).timeoutHandles.clear();
      });
    });

    describe("handleSubmit", () => {
      it("should reject callback from unauthorized user", async () => {
        const multiPrompt = createTestPrompt({
          type: "multi",
          options: [
            { index: 0, label: "Option A", selected: false },
            { index: 1, label: "Option B", selected: false },
          ],
          hasOther: false,
        });

        handler.showPrompt(multiPrompt, "user123", "%1", "1:0.0", "chat_456");
        await new Promise((r) => setTimeout(r, 0));

        const mockEvent = {
          data: "prompt_submit:user123",
          from: { id: "attacker456" },
          chat: { id: "chat_456" },
        };

        // Call private method directly
        await (handler as any).handleSubmit(mockEvent);

        expect(vi.mocked(tmux.submitMultiSelect)).not.toHaveBeenCalled();

        (handler as any).pendingPrompts.clear();
        (handler as any).timeoutHandles.clear();
      });
    });

    describe("handleOther", () => {
      it("should reject callback from unauthorized user", async () => {
        handler.showPrompt(createTestPrompt(), "user123", "%1", "1:0.0", "chat_456");
        await new Promise((r) => setTimeout(r, 0));

        const mockEvent = {
          data: "prompt_other:user123",
          from: { id: "attacker456" },
          chat: { id: "chat_456" },
        };

        // Check pending state before
        const pendingMap = (handler as any).pendingPrompts as Map<string, any>;
        const pendingBefore = pendingMap.get("user123:%1");
        expect(pendingBefore?.awaitingTextInput).toBeFalsy();

        // Call private method directly
        await (handler as any).handleOther(mockEvent);

        // State should be unchanged (attacker should not be able to set awaitingTextInput)
        const pendingAfter = pendingMap.get("user123:%1");
        expect(pendingAfter?.awaitingTextInput).toBeFalsy();

        (handler as any).pendingPrompts.clear();
        (handler as any).timeoutHandles.clear();
      });
    });

    describe("handleCancel", () => {
      it("should reject callback from unauthorized user", async () => {
        handler.showPrompt(createTestPrompt(), "user123", "%1", "1:0.0", "chat_456");
        await new Promise((r) => setTimeout(r, 0));

        const mockEvent = {
          data: "prompt_cancel:user123",
          from: { id: "attacker456" },
          chat: { id: "chat_456" },
        };

        // Prompt should still exist after unauthorized cancel
        const pendingMap = (handler as any).pendingPrompts as Map<string, any>;
        expect(pendingMap.has("user123:%1")).toBe(true);

        // Call private method directly
        await (handler as any).handleCancel(mockEvent);

        // Prompt should still exist (cancel should be blocked)
        expect(pendingMap.has("user123:%1")).toBe(true);

        (handler as any).pendingPrompts.clear();
        (handler as any).timeoutHandles.clear();
      });
    });
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

  describe("handleToggle terminal sync fallback", () => {
    it("should log warning when terminal state cannot be read", async () => {
      // Show a multi-select prompt
      const multiPrompt = createTestPrompt({
        type: "multi",
        options: [
          { index: 0, label: "Option A", selected: false },
          { index: 1, label: "Option B", selected: false },
        ],
        hasOther: false,
      });

      handler.showPrompt(multiPrompt, "user123", "%1", "1:0.0", "chat_456");
      await new Promise((r) => setTimeout(r, 0));

      // Mock capturePane to return unparseable output (no selection markers)
      vi.mocked(tmux.capturePane).mockResolvedValue("random text without markers");
      vi.mocked(tmux.toggleOption).mockResolvedValue(undefined);

      const mockEvent = {
        data: "prompt_toggle:user123:0",
        from: { id: "user123" },
        chat: { id: "chat_456" },
      };

      // Call private method directly
      await (handler as any).handleToggle(mockEvent);

      // Verify toggleOption was called (meaning handler executed)
      expect(vi.mocked(tmux.toggleOption)).toHaveBeenCalled();

      // Clean up
      (handler as any).pendingPrompts.clear();
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
