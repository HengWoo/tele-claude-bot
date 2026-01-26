import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ApprovalQueue } from "./approval.js";

describe("ApprovalQueue", () => {
  let queue: ApprovalQueue;

  beforeEach(() => {
    queue = new ApprovalQueue();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper to create approval data (without resolve callback - queue.add creates it)
  const createApprovalData = (overrides: Partial<{
    id: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    sessionId: string;
    chatId: number;
    messageId: number;
  }> = {}) => ({
    id: overrides.id ?? "tool-1",
    toolName: overrides.toolName ?? "bash",
    toolInput: overrides.toolInput ?? { command: "ls" },
    sessionId: overrides.sessionId ?? "session-1",
    chatId: overrides.chatId ?? 123,
    messageId: overrides.messageId ?? 456,
  });

  describe("add", () => {
    it("should add approval to queue and return promise", () => {
      const data = createApprovalData();
      const promise = queue.add(data);

      expect(queue.size).toBe(1);
      expect(queue.get("tool-1")).toBeDefined();
      expect(promise).toBeInstanceOf(Promise);
    });

    it("should allow multiple approvals", () => {
      queue.add(createApprovalData({ id: "tool-1" }));
      queue.add(createApprovalData({ id: "tool-2", toolName: "write" }));

      expect(queue.size).toBe(2);
    });
  });

  describe("resolve", () => {
    it("should resolve approval with true when approved", async () => {
      const promise = queue.add(createApprovalData());
      const resolved = queue.resolve("tool-1", true);

      expect(resolved).toBe(true);
      expect(queue.size).toBe(0);
      await expect(promise).resolves.toBe(true);
    });

    it("should resolve approval with false when denied", async () => {
      const promise = queue.add(createApprovalData());
      queue.resolve("tool-1", false);

      await expect(promise).resolves.toBe(false);
    });

    it("should return false for non-existent approval", () => {
      expect(queue.resolve("non-existent", true)).toBe(false);
    });
  });

  describe("get", () => {
    it("should return approval by id", () => {
      queue.add(createApprovalData());
      const approval = queue.get("tool-1");

      expect(approval).toBeDefined();
      expect(approval?.toolName).toBe("bash");
    });

    it("should return undefined for non-existent id", () => {
      expect(queue.get("non-existent")).toBeUndefined();
    });
  });

  describe("getBySession", () => {
    it("should return all approvals for a session", () => {
      queue.add(createApprovalData({ id: "tool-1", sessionId: "session-1" }));
      queue.add(createApprovalData({ id: "tool-2", sessionId: "session-1" }));
      queue.add(createApprovalData({ id: "tool-3", sessionId: "session-2" }));

      const session1Approvals = queue.getBySession("session-1");
      expect(session1Approvals).toHaveLength(2);
      expect(session1Approvals.map((a) => a.id)).toContain("tool-1");
      expect(session1Approvals.map((a) => a.id)).toContain("tool-2");
    });

    it("should return empty array for non-existent session", () => {
      expect(queue.getBySession("non-existent")).toEqual([]);
    });
  });

  describe("getByChat", () => {
    it("should return all approvals for a chat", () => {
      queue.add(createApprovalData({ id: "tool-1", chatId: 123 }));
      queue.add(createApprovalData({ id: "tool-2", chatId: 123, sessionId: "session-2" }));

      const chat123Approvals = queue.getByChat(123);
      expect(chat123Approvals).toHaveLength(2);
    });

    it("should return empty array for non-existent chat", () => {
      expect(queue.getByChat(999)).toEqual([]);
    });
  });

  describe("hasPending", () => {
    it("should return true if session has pending approvals", () => {
      queue.add(createApprovalData({ sessionId: "session-1" }));
      expect(queue.hasPending("session-1")).toBe(true);
    });

    it("should return false if session has no pending approvals", () => {
      expect(queue.hasPending("session-1")).toBe(false);
    });
  });

  describe("cleanup", () => {
    it("should remove old approvals", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      queue.add(createApprovalData());
      expect(queue.size).toBe(1);

      // Advance time by 10 seconds
      vi.setSystemTime(now + 10000);
      queue.cleanup(5000); // Clean up approvals older than 5 seconds
      expect(queue.size).toBe(0);
    });

    it("should keep recent approvals", () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      queue.add(createApprovalData());

      // Only advance 2 seconds
      vi.setSystemTime(now + 2000);
      queue.cleanup(5000);
      expect(queue.size).toBe(1);
    });
  });

  describe("cancelSession", () => {
    it("should cancel all approvals for a session", async () => {
      const promise1 = queue.add(createApprovalData({ id: "tool-1", sessionId: "session-1" }));
      const promise2 = queue.add(createApprovalData({ id: "tool-2", sessionId: "session-1" }));
      queue.add(createApprovalData({ id: "tool-3", sessionId: "session-2" }));

      queue.cancelSession("session-1");

      expect(queue.size).toBe(1);
      expect(queue.get("tool-3")).toBeDefined();

      // Cancelled approvals should resolve to false
      await expect(promise1).resolves.toBe(false);
      await expect(promise2).resolves.toBe(false);
    });
  });

  describe("clear", () => {
    it("should clear all approvals", async () => {
      const promise = queue.add(createApprovalData());
      expect(queue.size).toBe(1);

      queue.clear();
      expect(queue.size).toBe(0);

      // Cleared approvals should resolve to false
      await expect(promise).resolves.toBe(false);
    });
  });

  describe("all", () => {
    it("should return all pending approvals", () => {
      queue.add(createApprovalData({ id: "tool-1" }));
      queue.add(createApprovalData({ id: "tool-2", sessionId: "session-2" }));

      const all = queue.all();
      expect(all).toHaveLength(2);
    });

    it("should return empty array when queue is empty", () => {
      expect(queue.all()).toEqual([]);
    });
  });
});
