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

  describe("hasPendingTelegramRequest", () => {
    it("returns false when ~/.claude does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Import fresh to get clean module state
      const { hasPendingTelegramRequest } = await import("./context.js");
      const result = hasPendingTelegramRequest();

      expect(result).toBe(false);
      expect(fs.existsSync).toHaveBeenCalledWith(CLAUDE_DIR);
    });

    it("returns false when no tg-pending-* files exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      // readdirSync returns string[] when called without withFileTypes option
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs.readdirSync as any).mockReturnValue([
        "settings.json",
        "approvals",
        "tg-done-test",
      ]);

      const { hasPendingTelegramRequest } = await import("./context.js");
      const result = hasPendingTelegramRequest();

      expect(result).toBe(false);
    });

    it("returns true when tg-pending-* file exists", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs.readdirSync as any).mockReturnValue([
        "settings.json",
        "tg-pending-session-0-0",
      ]);

      const { hasPendingTelegramRequest } = await import("./context.js");
      const result = hasPendingTelegramRequest();

      expect(result).toBe(true);
    });

    it("returns false on read error", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const { hasPendingTelegramRequest } = await import("./context.js");
      const result = hasPendingTelegramRequest();

      expect(result).toBe(false);
    });
  });

  describe("getPendingTelegramFiles", () => {
    it("returns empty array when ~/.claude does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { getPendingTelegramFiles } = await import("./context.js");
      const result = getPendingTelegramFiles();

      expect(result).toEqual([]);
    });

    it("returns full paths of tg-pending-* files", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs.readdirSync as any).mockReturnValue([
        "settings.json",
        "tg-pending-session-0-0",
        "tg-pending-session-1-0",
      ]);

      const { getPendingTelegramFiles } = await import("./context.js");
      const result = getPendingTelegramFiles();

      expect(result).toEqual([
        join(CLAUDE_DIR, "tg-pending-session-0-0"),
        join(CLAUDE_DIR, "tg-pending-session-1-0"),
      ]);
    });
  });

  describe("cleanupStalePendingFiles", () => {
    it("returns 0 when ~/.claude does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { cleanupStalePendingFiles } = await import("./context.js");
      const result = cleanupStalePendingFiles();

      expect(result).toBe(0);
    });

    it("removes files older than maxAgeMs", async () => {
      const now = Date.now();
      const oldTime = now - 15 * 60 * 1000; // 15 minutes ago
      const recentTime = now - 5 * 60 * 1000; // 5 minutes ago

      vi.mocked(fs.existsSync).mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs.readdirSync as any).mockReturnValue([
        "tg-pending-old",
        "tg-pending-recent",
      ]);

      vi.mocked(fs.statSync).mockImplementation((path) => {
        if (String(path).includes("old")) {
          return { mtimeMs: oldTime } as fs.Stats;
        }
        return { mtimeMs: recentTime } as fs.Stats;
      });

      vi.mocked(fs.unlinkSync).mockImplementation(() => undefined);

      const { cleanupStalePendingFiles } = await import("./context.js");
      const result = cleanupStalePendingFiles(10 * 60 * 1000); // 10 minute threshold

      expect(result).toBe(1);
      expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
      expect(fs.unlinkSync).toHaveBeenCalledWith(
        join(CLAUDE_DIR, "tg-pending-old")
      );
    });

    it("keeps recent files", async () => {
      const now = Date.now();
      const recentTime = now - 5 * 60 * 1000; // 5 minutes ago

      vi.mocked(fs.existsSync).mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs.readdirSync as any).mockReturnValue([
        "tg-pending-recent",
      ]);

      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: recentTime,
      } as fs.Stats);

      const { cleanupStalePendingFiles } = await import("./context.js");
      const result = cleanupStalePendingFiles(10 * 60 * 1000);

      expect(result).toBe(0);
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it("continues on individual file errors", async () => {
      const now = Date.now();
      const oldTime = now - 15 * 60 * 1000;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs.readdirSync as any).mockReturnValue([
        "tg-pending-error",
        "tg-pending-ok",
      ]);

      vi.mocked(fs.statSync).mockImplementation((path) => {
        if (String(path).includes("error")) {
          throw new Error("Permission denied");
        }
        return { mtimeMs: oldTime } as fs.Stats;
      });

      vi.mocked(fs.unlinkSync).mockImplementation(() => undefined);

      const { cleanupStalePendingFiles } = await import("./context.js");
      const result = cleanupStalePendingFiles(10 * 60 * 1000);

      // Should still process the second file
      expect(result).toBe(1);
    });
  });
});
