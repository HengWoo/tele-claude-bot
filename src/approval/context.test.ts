import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import * as fs from "node:fs";

// Mock fs module
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

// Mock logger
vi.mock("../utils/logger.js", () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const CLAUDE_DIR = join(homedir(), ".claude");

describe("context detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("hasPendingRequest", () => {
    it("returns false when ~/.claude does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Import fresh to get clean module state
      const { hasPendingRequest } = await import("./context.js");
      const result = hasPendingRequest("telegram");

      expect(result).toBe(false);
      expect(fs.existsSync).toHaveBeenCalledWith(CLAUDE_DIR);
    });

    it("returns false when no telegram-pending-* files exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      // readdirSync returns string[] when called without withFileTypes option
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs.readdirSync as any).mockReturnValue([
        "settings.json",
        "approvals",
        "telegram-done-test",
      ]);

      const { hasPendingRequest } = await import("./context.js");
      const result = hasPendingRequest("telegram");

      expect(result).toBe(false);
    });

    it("returns true when telegram-pending-* file exists", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs.readdirSync as any).mockReturnValue([
        "settings.json",
        "telegram-pending-session-0-0",
      ]);

      const { hasPendingRequest } = await import("./context.js");
      const result = hasPendingRequest("telegram");

      expect(result).toBe(true);
    });

    it("returns true when feishu-pending-* file exists for feishu platform", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs.readdirSync as any).mockReturnValue([
        "settings.json",
        "feishu-pending-session-0-0",
      ]);

      const { hasPendingRequest } = await import("./context.js");
      const result = hasPendingRequest("feishu");

      expect(result).toBe(true);
    });

    it("returns false when checking wrong platform", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs.readdirSync as any).mockReturnValue([
        "telegram-pending-session-0-0",
      ]);

      const { hasPendingRequest } = await import("./context.js");
      // Telegram pending exists, but we're checking Feishu
      const result = hasPendingRequest("feishu");

      expect(result).toBe(false);
    });

    it("returns false on read error", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const { hasPendingRequest } = await import("./context.js");
      const result = hasPendingRequest("telegram");

      expect(result).toBe(false);
    });
  });

  describe("getPendingFiles", () => {
    it("returns empty array when ~/.claude does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { getPendingFiles } = await import("./context.js");
      const result = getPendingFiles("telegram");

      expect(result).toEqual([]);
    });

    it("returns full paths of telegram-pending-* files", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs.readdirSync as any).mockReturnValue([
        "settings.json",
        "telegram-pending-session-0-0",
        "telegram-pending-session-1-0",
        "feishu-pending-session-2-0",
      ]);

      const { getPendingFiles } = await import("./context.js");
      const result = getPendingFiles("telegram");

      expect(result).toEqual([
        join(CLAUDE_DIR, "telegram-pending-session-0-0"),
        join(CLAUDE_DIR, "telegram-pending-session-1-0"),
      ]);
    });

    it("returns only feishu files for feishu platform", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs.readdirSync as any).mockReturnValue([
        "telegram-pending-session-0-0",
        "feishu-pending-session-1-0",
      ]);

      const { getPendingFiles } = await import("./context.js");
      const result = getPendingFiles("feishu");

      expect(result).toEqual([
        join(CLAUDE_DIR, "feishu-pending-session-1-0"),
      ]);
    });
  });

  describe("cleanupStalePendingFiles", () => {
    it("returns 0 when ~/.claude does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { cleanupStalePendingFiles } = await import("./context.js");
      const result = cleanupStalePendingFiles("telegram");

      expect(result).toBe(0);
    });

    it("removes files older than maxAgeMs for specified platform", async () => {
      const now = Date.now();
      const oldTime = now - 15 * 60 * 1000; // 15 minutes ago
      const recentTime = now - 5 * 60 * 1000; // 5 minutes ago

      vi.mocked(fs.existsSync).mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs.readdirSync as any).mockReturnValue([
        "telegram-pending-old",
        "telegram-pending-recent",
        "feishu-pending-old", // Should be ignored when cleaning telegram
      ]);

      vi.mocked(fs.statSync).mockImplementation((path) => {
        if (String(path).includes("old")) {
          return { mtimeMs: oldTime } as fs.Stats;
        }
        return { mtimeMs: recentTime } as fs.Stats;
      });

      vi.mocked(fs.unlinkSync).mockImplementation(() => undefined);

      const { cleanupStalePendingFiles } = await import("./context.js");
      const result = cleanupStalePendingFiles("telegram", 10 * 60 * 1000); // 10 minute threshold

      expect(result).toBe(1);
      expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
      expect(fs.unlinkSync).toHaveBeenCalledWith(
        join(CLAUDE_DIR, "telegram-pending-old")
      );
    });

    it("keeps recent files", async () => {
      const now = Date.now();
      const recentTime = now - 5 * 60 * 1000; // 5 minutes ago

      vi.mocked(fs.existsSync).mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs.readdirSync as any).mockReturnValue([
        "telegram-pending-recent",
      ]);

      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: recentTime,
      } as fs.Stats);

      const { cleanupStalePendingFiles } = await import("./context.js");
      const result = cleanupStalePendingFiles("telegram", 10 * 60 * 1000);

      expect(result).toBe(0);
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it("continues on individual file errors", async () => {
      const now = Date.now();
      const oldTime = now - 15 * 60 * 1000;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs.readdirSync as any).mockReturnValue([
        "telegram-pending-error",
        "telegram-pending-ok",
      ]);

      vi.mocked(fs.statSync).mockImplementation((path) => {
        if (String(path).includes("error")) {
          throw new Error("Permission denied");
        }
        return { mtimeMs: oldTime } as fs.Stats;
      });

      vi.mocked(fs.unlinkSync).mockImplementation(() => undefined);

      const { cleanupStalePendingFiles } = await import("./context.js");
      const result = cleanupStalePendingFiles("telegram", 10 * 60 * 1000);

      // Should still process the second file
      expect(result).toBe(1);
    });

    it("only cleans up files for the specified platform", async () => {
      const now = Date.now();
      const oldTime = now - 15 * 60 * 1000;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs.readdirSync as any).mockReturnValue([
        "telegram-pending-old",
        "feishu-pending-old",
      ]);

      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: oldTime } as fs.Stats);
      vi.mocked(fs.unlinkSync).mockImplementation(() => undefined);

      const { cleanupStalePendingFiles } = await import("./context.js");

      // Clean only feishu
      const result = cleanupStalePendingFiles("feishu", 10 * 60 * 1000);

      expect(result).toBe(1);
      expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
      expect(fs.unlinkSync).toHaveBeenCalledWith(
        join(CLAUDE_DIR, "feishu-pending-old")
      );
    });
  });
});
