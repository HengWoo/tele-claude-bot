import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { EventEmitter } from "events";
import type { BotContext } from "../types.js";
import type { Bot } from "grammy";

// Mock chokidar
const mockWatcher = new EventEmitter() as EventEmitter & {
  close: () => Promise<void>;
};
mockWatcher.close = vi.fn().mockResolvedValue(undefined);

vi.mock("chokidar", () => ({
  watch: vi.fn(() => mockWatcher),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue(""),
  stat: vi.fn().mockResolvedValue({ size: 0 }),
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

import { VetoWatcher } from "./veto-watcher.js";
import { watch } from "chokidar";
import { stat, readFile } from "fs/promises";

// Create a mock bot
function createMockBot() {
  return {
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 123 }),
    },
  } as unknown as Bot<BotContext>;
}

describe("VetoWatcher", () => {
  let vetoWatcher: VetoWatcher;
  let mockBot: ReturnType<typeof createMockBot>;
  const chatId = 12345;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWatcher.removeAllListeners();
    mockBot = createMockBot();
    vetoWatcher = new VetoWatcher(mockBot as unknown as Bot<BotContext>, chatId);
  });

  afterEach(async () => {
    try {
      await vetoWatcher.stop();
    } catch {
      // Ignore errors on cleanup
    }
  });

  describe("start", () => {
    it("should get initial file size", async () => {
      vi.mocked(stat).mockResolvedValueOnce({ size: 100 } as import("fs").Stats);

      await vetoWatcher.start();

      expect(stat).toHaveBeenCalled();
    });

    it("should handle ENOENT for missing log", async () => {
      const error = new Error("File not found") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      vi.mocked(stat).mockRejectedValueOnce(error);

      // Should not throw
      await expect(vetoWatcher.start()).resolves.not.toThrow();
    });

    it("should warn on other stat errors", async () => {
      const error = new Error("Permission denied") as NodeJS.ErrnoException;
      error.code = "EACCES";
      vi.mocked(stat).mockRejectedValueOnce(error);

      await vetoWatcher.start();

      // Should still start successfully
      expect(watch).toHaveBeenCalled();
    });

    it("should add error handler to watcher", async () => {
      await vetoWatcher.start();

      // Emit error to verify handler exists (should not throw)
      expect(() => mockWatcher.emit("error", new Error("Test error"))).not.toThrow();
    });

    it("should not start if already running", async () => {
      await vetoWatcher.start();
      vi.clearAllMocks();

      await vetoWatcher.start();

      expect(watch).not.toHaveBeenCalled();
    });
  });

  describe("stop", () => {
    it("should close the watcher", async () => {
      await vetoWatcher.start();

      await vetoWatcher.stop();

      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it("should handle stop when not running", async () => {
      // Should not throw
      await expect(vetoWatcher.stop()).resolves.not.toThrow();
    });
  });

  describe("handleLogChange", () => {
    beforeEach(async () => {
      vi.mocked(stat).mockResolvedValue({ size: 0 } as import("fs").Stats);
      await vetoWatcher.start();
    });

    it("should parse and notify for blocked operations", async () => {
      const blockedOp = {
        timestamp: Date.now(),
        tool: "Bash",
        reason: "Dangerous command",
        input: { command: "rm -rf /" },
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(blockedOp) + "\n");

      mockWatcher.emit("change");
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockBot.api.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining("Operation Blocked"),
        expect.objectContaining({ parse_mode: "HTML" })
      );
    });

    it("should prevent concurrent processing", async () => {
      // Slow down the read to allow concurrent calls
      let resolveRead: (value: string) => void;
      const readPromise = new Promise<string>((resolve) => {
        resolveRead = resolve;
      });
      vi.mocked(readFile).mockReturnValueOnce(readPromise as Promise<string>);

      // Trigger two changes simultaneously
      mockWatcher.emit("change");
      mockWatcher.emit("change");

      // Resolve the read
      resolveRead!("");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // readFile should only be called once due to processing flag
      expect(readFile).toHaveBeenCalledTimes(1);
    });

    it("should handle parse errors for malformed JSON", async () => {
      vi.mocked(readFile).mockResolvedValueOnce("not valid json\n");

      // Should not throw
      mockWatcher.emit("change");
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockBot.api.sendMessage).not.toHaveBeenCalled();
    });

    it("should process multiple blocked operations", async () => {
      const op1 = { timestamp: Date.now(), tool: "Bash", reason: "Test 1", input: {} };
      const op2 = { timestamp: Date.now(), tool: "Write", reason: "Test 2", input: {} };
      vi.mocked(readFile).mockResolvedValueOnce(
        JSON.stringify(op1) + "\n" + JSON.stringify(op2) + "\n"
      );

      mockWatcher.emit("change");
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockBot.api.sendMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe("notifyBlocked", () => {
    beforeEach(async () => {
      vi.mocked(stat).mockResolvedValue({ size: 0 } as import("fs").Stats);
      await vetoWatcher.start();
    });

    it("should send notification with tool name", async () => {
      const blockedOp = {
        timestamp: Date.now(),
        tool: "Bash",
        reason: "Blocked reason",
        input: {},
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(blockedOp));

      mockWatcher.emit("change");
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockBot.api.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining("Bash"),
        expect.anything()
      );
    });

    it("should send notification with reason", async () => {
      const blockedOp = {
        timestamp: Date.now(),
        tool: "Bash",
        reason: "Dangerous rm command",
        input: {},
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(blockedOp));

      mockWatcher.emit("change");
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockBot.api.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining("Dangerous rm command"),
        expect.anything()
      );
    });
  });

  describe("error handling in event handlers", () => {
    beforeEach(async () => {
      vi.mocked(stat).mockResolvedValue({ size: 0 } as import("fs").Stats);
      await vetoWatcher.start();
    });

    it("should handle errors in change handler", async () => {
      vi.mocked(readFile).mockRejectedValueOnce(new Error("Read failed"));

      // Should not throw
      expect(() => mockWatcher.emit("change")).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it("should handle errors in add handler", async () => {
      vi.mocked(readFile).mockRejectedValueOnce(new Error("Read failed"));

      // Should not throw
      expect(() => mockWatcher.emit("add")).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  });
});
