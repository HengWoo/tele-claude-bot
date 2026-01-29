import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { EventEmitter } from "events";
import type { ApprovalRequest } from "../types.js";

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
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue("{}"),
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

import { ApprovalWatcher } from "./watcher.js";
import { watch } from "chokidar";
import { mkdir, readFile } from "fs/promises";

describe("ApprovalWatcher", () => {
  let watcher: ApprovalWatcher;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock watcher event listeners
    mockWatcher.removeAllListeners();
    watcher = new ApprovalWatcher("/test/approvals");
  });

  afterEach(async () => {
    if (watcher.isRunning()) {
      await watcher.stop();
    }
  });

  describe("start", () => {
    it("should create the approval directory", async () => {
      await watcher.start();

      expect(mkdir).toHaveBeenCalledWith("/test/approvals", { recursive: true });
    });

    it("should create a file watcher", async () => {
      await watcher.start();

      expect(watch).toHaveBeenCalledWith(
        "/test/approvals",
        expect.objectContaining({
          persistent: true,
          ignoreInitial: true,
        })
      );
    });

    it("should set running to true", async () => {
      expect(watcher.isRunning()).toBe(false);

      await watcher.start();

      expect(watcher.isRunning()).toBe(true);
    });

    it("should not start if already running", async () => {
      await watcher.start();
      vi.clearAllMocks();

      await watcher.start();

      // Should not call watch again
      expect(watch).not.toHaveBeenCalled();
    });
  });

  describe("stop", () => {
    it("should close the watcher", async () => {
      await watcher.start();

      await watcher.stop();

      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it("should set running to false", async () => {
      await watcher.start();
      expect(watcher.isRunning()).toBe(true);

      await watcher.stop();

      expect(watcher.isRunning()).toBe(false);
    });
  });

  describe("file handling", () => {
    beforeEach(async () => {
      await watcher.start();
    });

    it("should ignore non-.request files", async () => {
      const requestHandler = vi.fn();
      watcher.on("request", requestHandler);

      mockWatcher.emit("add", "/test/approvals/somefile.txt");

      expect(requestHandler).not.toHaveBeenCalled();
    });

    it("should process .request files", async () => {
      const validRequest = {
        id: "test-123",
        toolName: "Bash",
        toolInput: { command: "ls" },
        timestamp: Date.now(),
        status: "pending",
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(validRequest));

      const requestHandler = vi.fn();
      watcher.on("request", requestHandler);

      mockWatcher.emit("add", "/test/approvals/test-123.request");

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(readFile).toHaveBeenCalledWith("/test/approvals/test-123.request", "utf-8");
      expect(requestHandler).toHaveBeenCalledWith(expect.objectContaining({
        id: "test-123",
        toolName: "Bash",
      }));
    });

    it("should emit error on file read failure", async () => {
      vi.mocked(readFile).mockRejectedValueOnce(new Error("Read failed"));

      const errorHandler = vi.fn();
      watcher.on("error", errorHandler);

      mockWatcher.emit("add", "/test/approvals/fail.request");

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe("parseApprovalRequest", () => {
    beforeEach(async () => {
      await watcher.start();
    });

    it("should parse valid JSON", async () => {
      const validRequest = {
        id: "valid-id",
        toolName: "Read",
        toolInput: { file_path: "/test.txt" },
        timestamp: 1700000000,
        status: "pending",
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(validRequest));

      const requestHandler = vi.fn();
      watcher.on("request", requestHandler);

      mockWatcher.emit("add", "/test/approvals/valid.request");
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(requestHandler).toHaveBeenCalledWith(expect.objectContaining({
        id: "valid-id",
        toolName: "Read",
        toolInput: { file_path: "/test.txt" },
      }));
    });

    it("should return null for missing id", async () => {
      const invalidRequest = {
        toolName: "Bash",
        toolInput: { command: "ls" },
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(invalidRequest));

      const requestHandler = vi.fn();
      watcher.on("request", requestHandler);

      mockWatcher.emit("add", "/test/approvals/no-id.request");
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(requestHandler).not.toHaveBeenCalled();
    });

    it("should return null for missing toolName", async () => {
      const invalidRequest = {
        id: "test-id",
        toolInput: { command: "ls" },
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(invalidRequest));

      const requestHandler = vi.fn();
      watcher.on("request", requestHandler);

      mockWatcher.emit("add", "/test/approvals/no-tool.request");
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(requestHandler).not.toHaveBeenCalled();
    });

    it("should return null for missing toolInput", async () => {
      const invalidRequest = {
        id: "test-id",
        toolName: "Bash",
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(invalidRequest));

      const requestHandler = vi.fn();
      watcher.on("request", requestHandler);

      mockWatcher.emit("add", "/test/approvals/no-input.request");
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(requestHandler).not.toHaveBeenCalled();
    });

    it("should use defaults for optional fields", async () => {
      const minimalRequest = {
        id: "minimal-id",
        toolName: "Write",
        toolInput: "string input",
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(minimalRequest));

      const requestHandler = vi.fn();
      watcher.on("request", requestHandler);

      mockWatcher.emit("add", "/test/approvals/minimal.request");
      await new Promise((resolve) => setTimeout(resolve, 10));

      const receivedRequest = requestHandler.mock.calls[0][0] as ApprovalRequest;
      expect(receivedRequest.timestamp).toBeDefined();
      expect(receivedRequest.status).toBe("pending");
    });
  });

  describe("getApprovalDir", () => {
    it("should return the configured approval directory", () => {
      expect(watcher.getApprovalDir()).toBe("/test/approvals");
    });
  });

  describe("error handling", () => {
    it("should emit error on watcher error", async () => {
      await watcher.start();

      const errorHandler = vi.fn();
      watcher.on("error", errorHandler);

      mockWatcher.emit("error", new Error("Watcher failed"));

      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
