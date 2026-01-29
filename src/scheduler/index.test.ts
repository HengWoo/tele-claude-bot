import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { ScheduledTask } from "../types.js";

// Helper to create a task
const createTask = (overrides: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: overrides.id ?? "task-1",
  name: overrides.name ?? "Test Task",
  schedule: overrides.schedule ?? "0 9 * * *",
  prompt: overrides.prompt ?? "Test prompt",
  enabled: overrides.enabled ?? true,
  createdAt: overrides.createdAt ?? 1700000000000,
  lastRun: overrides.lastRun,
  nextRun: overrides.nextRun,
});

// Mock logger
vi.mock("../utils/logger.js", () => ({
  createChildLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock storage with a factory that returns a fresh mock each time
vi.mock("./storage.js", () => {
  // Create mock storage inside the factory
  const mockStorage = {
    listTasks: vi.fn(() => []),
    getTask: vi.fn(),
    addTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
  };
  return {
    ScheduleStorage: function() {
      return mockStorage;
    },
    getMockStorage: () => mockStorage,
  };
});

// Mock jobs
vi.mock("./jobs.js", () => ({
  executeJob: vi.fn().mockResolvedValue(true),
  listTmuxSessions: vi.fn().mockResolvedValue([]),
  DEFAULT_MORNING_BRIEFING: "Good morning!",
}));

// Mock cron task and store reference
const mockCronTask = {
  start: vi.fn(),
  stop: vi.fn(),
};

// Mock node-cron
vi.mock("node-cron", () => ({
  default: {
    validate: vi.fn((expression: string) => {
      if (expression === "invalid" || expression.includes("bad")) {
        return false;
      }
      return true;
    }),
    schedule: vi.fn(() => mockCronTask),
  },
}));

import { Scheduler } from "./index.js";
import cron from "node-cron";
import { executeJob } from "./jobs.js";
// Import getMockStorage helper to get the mock (only available in test via vi.mock)
// @ts-expect-error - getMockStorage is a test-only export from the mock
import { getMockStorage } from "./storage.js";

// Get reference to the mock storage
const mockStorage = getMockStorage();

describe("Scheduler", () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.listTasks.mockReturnValue([]);
    mockStorage.getTask.mockReturnValue(undefined);
    mockStorage.addTask.mockImplementation((task: Partial<ScheduledTask>) => createTask({ ...task, id: "new-task" }));
    mockStorage.updateTask.mockReturnValue(undefined);
    mockStorage.deleteTask.mockReturnValue(false);
    scheduler = new Scheduler();
  });

  afterEach(() => {
    if (scheduler && scheduler.isRunning()) {
      scheduler.stop();
    }
  });

  describe("start", () => {
    it("should start the scheduler", () => {
      scheduler.start();

      expect(scheduler.isRunning()).toBe(true);
    });

    it("should load tasks from storage", () => {
      scheduler.start();

      expect(mockStorage.listTasks).toHaveBeenCalled();
    });

    it("should schedule enabled tasks", () => {
      const enabledTask = createTask({ id: "enabled-1", enabled: true });
      mockStorage.listTasks.mockReturnValue([enabledTask]);

      scheduler.start();

      expect(cron.schedule).toHaveBeenCalled();
      expect(mockCronTask.start).toHaveBeenCalled();
    });

    it("should not schedule disabled tasks", () => {
      const disabledTask = createTask({ id: "disabled-1", enabled: false });
      mockStorage.listTasks.mockReturnValue([disabledTask]);

      scheduler.start();

      expect(cron.schedule).not.toHaveBeenCalled();
    });

    it("should not start if already running", () => {
      scheduler.start();
      vi.clearAllMocks();

      scheduler.start();

      expect(mockStorage.listTasks).not.toHaveBeenCalled();
    });
  });

  describe("stop", () => {
    it("should stop the scheduler", () => {
      scheduler.start();

      scheduler.stop();

      expect(scheduler.isRunning()).toBe(false);
    });

    it("should stop all cron jobs", () => {
      const task = createTask();
      mockStorage.listTasks.mockReturnValue([task]);
      scheduler.start();

      scheduler.stop();

      expect(mockCronTask.stop).toHaveBeenCalled();
    });

    it("should not stop if not running", () => {
      expect(() => scheduler.stop()).not.toThrow();
    });

    it("should clear all cron jobs", () => {
      const task = createTask();
      mockStorage.listTasks.mockReturnValue([task]);
      scheduler.start();

      scheduler.stop();

      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe("scheduleTask", () => {
    it("should validate cron expression", () => {
      const task = createTask({ schedule: "0 9 * * *" });

      scheduler.scheduleTask(task);

      expect(cron.validate).toHaveBeenCalledWith("0 9 * * *");
    });

    it("should return false for invalid cron expression", () => {
      const task = createTask({ schedule: "invalid" });

      const result = scheduler.scheduleTask(task);

      expect(result).toBe(false);
    });

    it("should return true for valid cron expression", () => {
      const task = createTask({ schedule: "0 9 * * *" });

      const result = scheduler.scheduleTask(task);

      expect(result).toBe(true);
    });

    it("should create cron job with correct schedule", () => {
      const task = createTask({ schedule: "30 8 * * 1-5" });

      scheduler.scheduleTask(task);

      expect(cron.schedule).toHaveBeenCalledWith(
        "30 8 * * 1-5",
        expect.any(Function),
        expect.any(Object)
      );
    });

    it("should start the cron job if task is enabled", () => {
      const task = createTask({ enabled: true });

      scheduler.scheduleTask(task);

      expect(mockCronTask.start).toHaveBeenCalled();
    });

    it("should not start the cron job if task is disabled", () => {
      const task = createTask({ enabled: false });
      vi.clearAllMocks();

      scheduler.scheduleTask(task);

      expect(mockCronTask.start).not.toHaveBeenCalled();
    });
  });

  describe("task lifecycle", () => {
    it("should update lastRun only on success", async () => {
      vi.mocked(executeJob).mockResolvedValueOnce(true);
      const task = createTask();

      let cronCallback: () => Promise<void>;
      vi.mocked(cron.schedule).mockImplementationOnce((_schedule, callback) => {
        cronCallback = callback as () => Promise<void>;
        return mockCronTask as unknown as import("node-cron").ScheduledTask;
      });

      scheduler.scheduleTask(task);
      await cronCallback!();

      expect(mockStorage.updateTask).toHaveBeenCalledWith(
        task.id,
        expect.objectContaining({
          lastRun: expect.any(Number),
          lastRunSuccess: true,
        })
      );
    });

    it("should set lastError on failure", async () => {
      vi.mocked(executeJob).mockResolvedValueOnce(false);
      const task = createTask();

      let cronCallback: () => Promise<void>;
      vi.mocked(cron.schedule).mockImplementationOnce((_schedule, callback) => {
        cronCallback = callback as () => Promise<void>;
        return mockCronTask as unknown as import("node-cron").ScheduledTask;
      });

      scheduler.scheduleTask(task);
      await cronCallback!();

      expect(mockStorage.updateTask).toHaveBeenCalledWith(
        task.id,
        expect.objectContaining({
          lastRunSuccess: false,
          lastError: expect.any(String),
        })
      );
    });

    it("should not update lastRun on failure", async () => {
      vi.mocked(executeJob).mockResolvedValueOnce(false);
      const task = createTask();

      let cronCallback: () => Promise<void>;
      vi.mocked(cron.schedule).mockImplementationOnce((_schedule, callback) => {
        cronCallback = callback as () => Promise<void>;
        return mockCronTask as unknown as import("node-cron").ScheduledTask;
      });

      scheduler.scheduleTask(task);
      await cronCallback!();

      const updateCall = mockStorage.updateTask.mock.calls[0][1];
      expect(updateCall.lastRun).toBeUndefined();
    });

    it("should clear lastError on success", async () => {
      vi.mocked(executeJob).mockResolvedValueOnce(true);
      const task = createTask();

      let cronCallback: () => Promise<void>;
      vi.mocked(cron.schedule).mockImplementationOnce((_schedule, callback) => {
        cronCallback = callback as () => Promise<void>;
        return mockCronTask as unknown as import("node-cron").ScheduledTask;
      });

      scheduler.scheduleTask(task);
      await cronCallback!();

      expect(mockStorage.updateTask).toHaveBeenCalledWith(
        task.id,
        expect.objectContaining({
          lastError: undefined,
        })
      );
    });

    it("should catch exceptions from executeJob", async () => {
      vi.mocked(executeJob).mockRejectedValueOnce(new Error("Unexpected error"));
      const task = createTask({ id: "exception-test" });

      let cronCallback: () => Promise<void>;
      vi.mocked(cron.schedule).mockImplementationOnce((_schedule, callback) => {
        cronCallback = callback as () => Promise<void>;
        return mockCronTask as unknown as import("node-cron").ScheduledTask;
      });

      scheduler.scheduleTask(task);
      // Should not throw
      await expect(cronCallback!()).resolves.not.toThrow();

      // Should update task with error
      expect(mockStorage.updateTask).toHaveBeenCalledWith(
        task.id,
        expect.objectContaining({
          lastRunSuccess: false,
          lastError: "Unexpected error",
        })
      );
    });
  });

  describe("addTask", () => {
    it("should validate cron expression", () => {
      expect(() =>
        scheduler.addTask({
          name: "Test",
          schedule: "invalid",
          prompt: "test",
          enabled: true,
        })
      ).toThrow("Invalid cron expression");
    });

    it("should add task to storage", () => {
      scheduler.addTask({
        name: "New Task",
        schedule: "0 9 * * *",
        prompt: "Do something",
        enabled: true,
      });

      expect(mockStorage.addTask).toHaveBeenCalled();
    });

    it("should schedule task if scheduler is running and task is enabled", () => {
      mockStorage.addTask.mockReturnValue(createTask({ id: "new-task", enabled: true }));
      scheduler.start();
      vi.clearAllMocks();

      scheduler.addTask({
        name: "New Task",
        schedule: "0 9 * * *",
        prompt: "Do something",
        enabled: true,
      });

      expect(cron.schedule).toHaveBeenCalled();
    });
  });

  describe("updateTask", () => {
    it("should validate new cron expression if provided", () => {
      expect(() =>
        scheduler.updateTask("task-1", { schedule: "bad-cron" })
      ).toThrow("Invalid cron expression");
    });

    it("should update task in storage", () => {
      mockStorage.updateTask.mockReturnValue(createTask({ id: "task-1", name: "Updated" }));

      scheduler.updateTask("task-1", { name: "Updated" });

      expect(mockStorage.updateTask).toHaveBeenCalledWith("task-1", { name: "Updated" });
    });
  });

  describe("deleteTask", () => {
    it("should unschedule task before deleting", () => {
      mockStorage.deleteTask.mockReturnValue(true);
      const task = createTask({ id: "delete-me" });
      mockStorage.listTasks.mockReturnValue([task]);
      scheduler.start();

      scheduler.deleteTask("delete-me");

      expect(mockCronTask.stop).toHaveBeenCalled();
    });

    it("should delete task from storage", () => {
      mockStorage.deleteTask.mockReturnValue(true);

      const result = scheduler.deleteTask("task-1");

      expect(mockStorage.deleteTask).toHaveBeenCalledWith("task-1");
      expect(result).toBe(true);
    });
  });

  describe("runTask", () => {
    it("should return false if task not found", async () => {
      mockStorage.getTask.mockReturnValue(undefined);

      const result = await scheduler.runTask("non-existent");

      expect(result).toBe(false);
    });

    it("should execute the job", async () => {
      const task = createTask({ id: "run-me" });
      mockStorage.getTask.mockReturnValue(task);
      vi.mocked(executeJob).mockResolvedValue(true);

      await scheduler.runTask("run-me");

      expect(executeJob).toHaveBeenCalledWith(task);
    });

    it("should update lastRun on success", async () => {
      const task = createTask({ id: "run-success" });
      mockStorage.getTask.mockReturnValue(task);
      vi.mocked(executeJob).mockResolvedValue(true);

      await scheduler.runTask("run-success");

      expect(mockStorage.updateTask).toHaveBeenCalledWith(
        "run-success",
        expect.objectContaining({
          lastRun: expect.any(Number),
          lastRunSuccess: true,
        })
      );
    });

    it("should set lastError on failure", async () => {
      const task = createTask({ id: "run-fail" });
      mockStorage.getTask.mockReturnValue(task);
      vi.mocked(executeJob).mockResolvedValue(false);

      await scheduler.runTask("run-fail");

      expect(mockStorage.updateTask).toHaveBeenCalledWith(
        "run-fail",
        expect.objectContaining({
          lastRunSuccess: false,
          lastError: expect.any(String),
        })
      );
    });
  });

  describe("listTasks", () => {
    it("should return tasks from storage", () => {
      const tasks = [createTask({ id: "1" }), createTask({ id: "2" })];
      mockStorage.listTasks.mockReturnValue(tasks);

      const result = scheduler.listTasks();

      expect(result).toEqual(tasks);
    });
  });

  describe("getTask", () => {
    it("should return task from storage", () => {
      const task = createTask({ id: "get-me" });
      mockStorage.getTask.mockReturnValue(task);

      const result = scheduler.getTask("get-me");

      expect(result).toEqual(task);
    });

    it("should return undefined for non-existent task", () => {
      mockStorage.getTask.mockReturnValue(undefined);

      const result = scheduler.getTask("non-existent");

      expect(result).toBeUndefined();
    });
  });

  describe("isRunning", () => {
    it("should return false initially", () => {
      expect(scheduler.isRunning()).toBe(false);
    });

    it("should return true after start", () => {
      scheduler.start();

      expect(scheduler.isRunning()).toBe(true);
    });

    it("should return false after stop", () => {
      scheduler.start();
      scheduler.stop();

      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe("unscheduleTask", () => {
    it("should stop and remove cron job", () => {
      const task = createTask({ id: "unsched" });
      mockStorage.listTasks.mockReturnValue([task]);
      scheduler.start();
      vi.clearAllMocks();

      scheduler.unscheduleTask("unsched");

      expect(mockCronTask.stop).toHaveBeenCalled();
    });

    it("should handle unscheduling non-existent task", () => {
      expect(() => scheduler.unscheduleTask("non-existent")).not.toThrow();
    });
  });
});
