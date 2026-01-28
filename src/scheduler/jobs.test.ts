import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChildProcess } from "node:child_process";
import {
  DEFAULT_MORNING_BRIEFING,
  injectPromptToTmux,
  executeJob,
  listTmuxSessions,
  type JobResult,
} from "./jobs.js";
import type { ScheduledTask } from "../types.js";

// Mock child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// Import the mocked spawn
import { spawn } from "node:child_process";
const mockSpawn = vi.mocked(spawn);

// Helper to create a mock ChildProcess
function createMockProcess(): ChildProcess {
  const process = {
    stdout: {
      on: vi.fn(),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn(),
    kill: vi.fn(),
    pid: 12345,
  } as unknown as ChildProcess;

  return process;
}

// Helper to create a ScheduledTask
function createTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: overrides.id ?? "task-1",
    name: overrides.name ?? "Test Task",
    schedule: overrides.schedule ?? "0 9 * * *",
    prompt: overrides.prompt ?? "Test prompt",
    enabled: overrides.enabled ?? true,
    createdAt: overrides.createdAt ?? Date.now(),
    ...overrides,
  };
}

describe("scheduler jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("DEFAULT_MORNING_BRIEFING", () => {
    it("should be a non-empty string", () => {
      expect(DEFAULT_MORNING_BRIEFING).toBeDefined();
      expect(typeof DEFAULT_MORNING_BRIEFING).toBe("string");
      expect(DEFAULT_MORNING_BRIEFING.length).toBeGreaterThan(0);
    });

    it("should contain expected content about emails", () => {
      expect(DEFAULT_MORNING_BRIEFING.toLowerCase()).toContain("email");
    });

    it("should contain expected content about calendar", () => {
      expect(DEFAULT_MORNING_BRIEFING.toLowerCase()).toContain("calendar");
    });

    it("should contain expected content about urgent items", () => {
      expect(DEFAULT_MORNING_BRIEFING.toLowerCase()).toContain("urgent");
    });
  });

  describe("JobResult interface usage", () => {
    it("should have correct shape for success result", () => {
      const result: JobResult = {
        success: true,
        timestamp: Date.now(),
      };

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("timestamp");
      expect(typeof result.success).toBe("boolean");
      expect(typeof result.timestamp).toBe("number");
    });

    it("should have correct shape for failure result with error", () => {
      const result: JobResult = {
        success: false,
        error: "Something went wrong",
        timestamp: Date.now(),
      };

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("error");
      expect(result).toHaveProperty("timestamp");
      expect(result.success).toBe(false);
      expect(typeof result.error).toBe("string");
    });
  });

  describe("injectPromptToTmux", () => {
    it("should return success: true when tmux commands succeed", async () => {
      // Mock has-session check (first call)
      const hasSessionProcess = createMockProcess();
      (hasSessionProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === "close") {
            setTimeout(() => callback(0), 0);
          }
          return hasSessionProcess;
        }
      );

      // Mock send-keys (second call)
      const sendKeysProcess = createMockProcess();
      (sendKeysProcess.stderr!.on as ReturnType<typeof vi.fn>).mockImplementation(() => sendKeysProcess);
      (sendKeysProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === "close") {
            setTimeout(() => callback(0), 0);
          }
          return sendKeysProcess;
        }
      );

      // Mock Enter key (third call)
      const enterProcess = createMockProcess();
      (enterProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === "close") {
            setTimeout(() => callback(0), 0);
          }
          return enterProcess;
        }
      );

      mockSpawn
        .mockReturnValueOnce(hasSessionProcess)
        .mockReturnValueOnce(sendKeysProcess)
        .mockReturnValueOnce(enterProcess);

      const result = await injectPromptToTmux("test prompt", "test-session");

      expect(result.success).toBe(true);
      expect(result.timestamp).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();
    });

    it("should return success: false when tmux session does not exist", async () => {
      const hasSessionProcess = createMockProcess();
      (hasSessionProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === "close") {
            setTimeout(() => callback(1), 0); // Non-zero exit code means session not found
          }
          return hasSessionProcess;
        }
      );

      mockSpawn.mockReturnValueOnce(hasSessionProcess);

      const result = await injectPromptToTmux("test prompt", "non-existent");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("should return success: false when spawn fails with error", async () => {
      const hasSessionProcess = createMockProcess();
      (hasSessionProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (error?: Error) => void) => {
          if (event === "error") {
            setTimeout(() => callback(new Error("spawn failed")), 0);
          }
          return hasSessionProcess;
        }
      );

      mockSpawn.mockReturnValueOnce(hasSessionProcess);

      const result = await injectPromptToTmux("test prompt", "test-session");

      expect(result.success).toBe(false);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("should include timestamp in result", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const hasSessionProcess = createMockProcess();
      (hasSessionProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === "close") {
            callback(1); // Session not found
          }
          return hasSessionProcess;
        }
      );

      mockSpawn.mockReturnValueOnce(hasSessionProcess);

      const result = await injectPromptToTmux("test prompt", "test-session");

      expect(result.timestamp).toBe(now);
    });

    it("should include error message on failure", async () => {
      const hasSessionProcess = createMockProcess();
      (hasSessionProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === "close") {
            setTimeout(() => callback(1), 0);
          }
          return hasSessionProcess;
        }
      );

      mockSpawn.mockReturnValueOnce(hasSessionProcess);

      const result = await injectPromptToTmux("test prompt", "missing-session");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("missing-session");
    });

    it("should return success: false when send-keys fails", async () => {
      // Mock has-session check (success)
      const hasSessionProcess = createMockProcess();
      (hasSessionProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === "close") {
            setTimeout(() => callback(0), 0);
          }
          return hasSessionProcess;
        }
      );

      // Mock send-keys (failure)
      const sendKeysProcess = createMockProcess();
      let stderrCallback: ((data: Buffer) => void) | null = null;
      (sendKeysProcess.stderr!.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === "data") {
            stderrCallback = callback;
          }
          return sendKeysProcess;
        }
      );
      (sendKeysProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === "close") {
            setTimeout(() => {
              if (stderrCallback) {
                stderrCallback(Buffer.from("tmux error"));
              }
              callback(1);
            }, 0);
          }
          return sendKeysProcess;
        }
      );

      mockSpawn
        .mockReturnValueOnce(hasSessionProcess)
        .mockReturnValueOnce(sendKeysProcess);

      const result = await injectPromptToTmux("test prompt", "test-session");

      expect(result.success).toBe(false);
      expect(result.error).toContain("tmux send-keys failed");
    });
  });

  describe("executeJob", () => {
    it("should return true on successful injection", async () => {
      // Mock successful tmux operations
      const hasSessionProcess = createMockProcess();
      (hasSessionProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === "close") {
            setTimeout(() => callback(0), 0);
          }
          return hasSessionProcess;
        }
      );

      const sendKeysProcess = createMockProcess();
      (sendKeysProcess.stderr!.on as ReturnType<typeof vi.fn>).mockImplementation(() => sendKeysProcess);
      (sendKeysProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === "close") {
            setTimeout(() => callback(0), 0);
          }
          return sendKeysProcess;
        }
      );

      const enterProcess = createMockProcess();
      (enterProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === "close") {
            setTimeout(() => callback(0), 0);
          }
          return enterProcess;
        }
      );

      mockSpawn
        .mockReturnValueOnce(hasSessionProcess)
        .mockReturnValueOnce(sendKeysProcess)
        .mockReturnValueOnce(enterProcess);

      const task = createTask();
      const result = await executeJob(task, "test-session");

      expect(result).toBe(true);
    });

    it("should return false on failed injection", async () => {
      const hasSessionProcess = createMockProcess();
      (hasSessionProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === "close") {
            setTimeout(() => callback(1), 0); // Session not found
          }
          return hasSessionProcess;
        }
      );

      mockSpawn.mockReturnValueOnce(hasSessionProcess);

      const task = createTask();
      const result = await executeJob(task, "missing-session");

      expect(result).toBe(false);
    });

    it("should use default tmux session when not specified", async () => {
      const hasSessionProcess = createMockProcess();
      (hasSessionProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === "close") {
            setTimeout(() => callback(1), 0);
          }
          return hasSessionProcess;
        }
      );

      mockSpawn.mockReturnValueOnce(hasSessionProcess);

      const task = createTask();
      await executeJob(task); // No tmux session specified

      expect(mockSpawn).toHaveBeenCalledWith("tmux", ["has-session", "-t", "claude"]);
    });

    it("should use provided tmux session when specified", async () => {
      const hasSessionProcess = createMockProcess();
      (hasSessionProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === "close") {
            setTimeout(() => callback(1), 0);
          }
          return hasSessionProcess;
        }
      );

      mockSpawn.mockReturnValueOnce(hasSessionProcess);

      const task = createTask();
      await executeJob(task, "custom-session");

      expect(mockSpawn).toHaveBeenCalledWith("tmux", ["has-session", "-t", "custom-session"]);
    });
  });

  describe("listTmuxSessions", () => {
    it("should return array of session names", async () => {
      const listProcess = createMockProcess();
      let stdoutCallback: ((data: Buffer) => void) | null = null;

      (listProcess.stdout!.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === "data") {
            stdoutCallback = callback;
          }
          return listProcess;
        }
      );
      (listProcess.stderr!.on as ReturnType<typeof vi.fn>).mockImplementation(() => listProcess);
      (listProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === "close") {
            setTimeout(() => {
              if (stdoutCallback) {
                stdoutCallback(Buffer.from("session1\nsession2\nsession3\n"));
              }
              callback(0);
            }, 0);
          }
          return listProcess;
        }
      );

      mockSpawn.mockReturnValueOnce(listProcess);

      const sessions = await listTmuxSessions();

      expect(sessions).toEqual(["session1", "session2", "session3"]);
    });

    it("should return empty array when no sessions exist", async () => {
      const listProcess = createMockProcess();
      let stderrCallback: ((data: Buffer) => void) | null = null;

      (listProcess.stdout!.on as ReturnType<typeof vi.fn>).mockImplementation(() => listProcess);
      (listProcess.stderr!.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === "data") {
            stderrCallback = callback;
          }
          return listProcess;
        }
      );
      (listProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === "close") {
            setTimeout(() => {
              if (stderrCallback) {
                stderrCallback(Buffer.from("no server running"));
              }
              callback(1); // Non-zero exit code when no sessions
            }, 0);
          }
          return listProcess;
        }
      );

      mockSpawn.mockReturnValueOnce(listProcess);

      const sessions = await listTmuxSessions();

      expect(sessions).toEqual([]);
    });

    it("should return empty array on error", async () => {
      const listProcess = createMockProcess();

      (listProcess.stdout!.on as ReturnType<typeof vi.fn>).mockImplementation(() => listProcess);
      (listProcess.stderr!.on as ReturnType<typeof vi.fn>).mockImplementation(() => listProcess);
      (listProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (error?: Error) => void) => {
          if (event === "error") {
            setTimeout(() => callback(new Error("tmux not found")), 0);
          }
          return listProcess;
        }
      );

      mockSpawn.mockReturnValueOnce(listProcess);

      const sessions = await listTmuxSessions();

      expect(sessions).toEqual([]);
    });
  });
});
