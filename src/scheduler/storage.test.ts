import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { ScheduledTask } from "../types.js";

// Mock node:fs before importing ScheduleStorage
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock node:crypto for predictable UUIDs
vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "mock-uuid-12345"),
}));

// Mock logger to avoid console noise
vi.mock("../utils/logger.js", () => ({
  createChildLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { ScheduleStorage } from "./storage.js";
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";

describe("ScheduleStorage", () => {
  const mockFs = vi.mocked(fs);
  const mockRandomUUID = vi.mocked(randomUUID);

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

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset UUID counter for predictable IDs
    let uuidCounter = 0;
    mockRandomUUID.mockImplementation(
      () => `mock-uuid-${++uuidCounter}` as `${string}-${string}-${string}-${string}-${string}`
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("should create instance with default path", () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.mkdirSync.mockImplementation(() => undefined);

      void new ScheduleStorage();

      // Verify it tried to check the default path (absolute path based on module location)
      expect(mockFs.existsSync).toHaveBeenCalledWith(
        expect.stringContaining("data/schedules.json")
      );
    });

    it("should create instance with custom path", () => {
      const customPath = "custom/path/schedules.json";
      mockFs.existsSync.mockReturnValue(false);
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.mkdirSync.mockImplementation(() => undefined);

      void new ScheduleStorage(customPath);

      expect(mockFs.existsSync).toHaveBeenCalledWith(customPath);
    });

    it("should load existing tasks from file", () => {
      const existingTasks = [createTask({ id: "existing-1", name: "Existing Task" })];
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(existingTasks));

      const storage = new ScheduleStorage("data/schedules.json");
      const tasks = storage.listTasks();

      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe("Existing Task");
    });

    it("should use default schedules when file does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.mkdirSync.mockImplementation(() => undefined);

      const storage = new ScheduleStorage();
      const tasks = storage.listTasks();

      // Default schedules include morning briefing
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks.some(t => t.name === "Morning Briefing")).toBe(true);
    });
  });

  describe("addTask", () => {
    let storage: ScheduleStorage;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(1700000000000);

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("[]");
      mockFs.writeFileSync.mockImplementation(() => {});

      storage = new ScheduleStorage("data/schedules.json");
    });

    it("should add task with generated id and createdAt", () => {
      const taskData = {
        name: "New Task",
        schedule: "0 8 * * *",
        prompt: "Do something",
        enabled: true,
      };

      const result = storage.addTask(taskData);

      expect(result.id).toBe("mock-uuid-1");
      expect(result.createdAt).toBe(1700000000000);
    });

    it("should return the created task", () => {
      const taskData = {
        name: "My Task",
        schedule: "30 14 * * 1-5",
        prompt: "Weekly report",
        enabled: false,
      };

      const result = storage.addTask(taskData);

      expect(result).toMatchObject({
        name: "My Task",
        schedule: "30 14 * * 1-5",
        prompt: "Weekly report",
        enabled: false,
      });
    });

    it("should have all required fields", () => {
      const taskData = {
        name: "Complete Task",
        schedule: "0 0 * * *",
        prompt: "Midnight task",
        enabled: true,
      };

      const result = storage.addTask(taskData);

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("name");
      expect(result).toHaveProperty("schedule");
      expect(result).toHaveProperty("prompt");
      expect(result).toHaveProperty("enabled");
      expect(result).toHaveProperty("createdAt");
      expect(typeof result.id).toBe("string");
      expect(typeof result.createdAt).toBe("number");
    });

    it("should persist the task to storage", () => {
      const taskData = {
        name: "Persistent Task",
        schedule: "0 12 * * *",
        prompt: "Noon reminder",
        enabled: true,
      };

      storage.addTask(taskData);

      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const savedData = JSON.parse(
        mockFs.writeFileSync.mock.calls[mockFs.writeFileSync.mock.calls.length - 1][1] as string
      );
      expect(savedData).toHaveLength(1);
      expect(savedData[0].name).toBe("Persistent Task");
    });
  });

  describe("getTask", () => {
    let storage: ScheduleStorage;
    const existingTasks = [
      createTask({ id: "task-1", name: "First Task" }),
      createTask({ id: "task-2", name: "Second Task" }),
    ];

    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(existingTasks));
      mockFs.writeFileSync.mockImplementation(() => {});

      storage = new ScheduleStorage("data/schedules.json");
    });

    it("should return task by id", () => {
      const task = storage.getTask("task-1");

      expect(task).toBeDefined();
      expect(task?.id).toBe("task-1");
      expect(task?.name).toBe("First Task");
    });

    it("should return undefined for non-existent id", () => {
      const task = storage.getTask("non-existent-id");

      expect(task).toBeUndefined();
    });
  });

  describe("updateTask", () => {
    let storage: ScheduleStorage;
    const existingTasks = [
      createTask({ id: "task-1", name: "Original Name", createdAt: 1600000000000 }),
    ];

    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(existingTasks));
      mockFs.writeFileSync.mockImplementation(() => {});

      storage = new ScheduleStorage("data/schedules.json");
    });

    it("should update task fields", () => {
      const result = storage.updateTask("task-1", {
        name: "Updated Name",
        enabled: false,
      });

      expect(result).toBeDefined();
      expect(result?.name).toBe("Updated Name");
      expect(result?.enabled).toBe(false);
    });

    it("should not allow changing id", () => {
      const result = storage.updateTask("task-1", {
        id: "new-id",
        name: "Updated Name",
      } as Partial<ScheduledTask>);

      expect(result).toBeDefined();
      expect(result?.id).toBe("task-1"); // ID should remain unchanged
    });

    it("should not allow changing createdAt", () => {
      const result = storage.updateTask("task-1", {
        createdAt: 9999999999999,
        name: "Updated Name",
      } as Partial<ScheduledTask>);

      expect(result).toBeDefined();
      expect(result?.createdAt).toBe(1600000000000); // createdAt should remain unchanged
    });

    it("should return updated task", () => {
      const result = storage.updateTask("task-1", {
        prompt: "New prompt text",
        schedule: "0 0 * * 0",
      });

      expect(result).toBeDefined();
      expect(result?.prompt).toBe("New prompt text");
      expect(result?.schedule).toBe("0 0 * * 0");
      // Other fields should be preserved
      expect(result?.id).toBe("task-1");
      expect(result?.name).toBe("Original Name");
    });

    it("should return undefined for non-existent id", () => {
      const result = storage.updateTask("non-existent-id", {
        name: "Updated",
      });

      expect(result).toBeUndefined();
    });

    it("should persist updates to storage", () => {
      storage.updateTask("task-1", { name: "Persisted Update" });

      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const savedData = JSON.parse(
        mockFs.writeFileSync.mock.calls[mockFs.writeFileSync.mock.calls.length - 1][1] as string
      );
      expect(savedData[0].name).toBe("Persisted Update");
    });
  });

  describe("deleteTask", () => {
    let storage: ScheduleStorage;
    const existingTasks = [
      createTask({ id: "task-1", name: "First Task" }),
      createTask({ id: "task-2", name: "Second Task" }),
    ];

    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(existingTasks));
      mockFs.writeFileSync.mockImplementation(() => {});

      storage = new ScheduleStorage("data/schedules.json");
    });

    it("should delete task by id", () => {
      const result = storage.deleteTask("task-1");

      expect(result).toBe(true);
      expect(storage.getTask("task-1")).toBeUndefined();
      expect(storage.listTasks()).toHaveLength(1);
    });

    it("should return true on success", () => {
      const result = storage.deleteTask("task-2");

      expect(result).toBe(true);
    });

    it("should return false for non-existent id", () => {
      const result = storage.deleteTask("non-existent-id");

      expect(result).toBe(false);
    });

    it("should persist deletion to storage", () => {
      storage.deleteTask("task-1");

      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const savedData = JSON.parse(
        mockFs.writeFileSync.mock.calls[mockFs.writeFileSync.mock.calls.length - 1][1] as string
      );
      expect(savedData).toHaveLength(1);
      expect(savedData[0].id).toBe("task-2");
    });

    it("should not modify storage for non-existent id", () => {
      const callCountBefore = mockFs.writeFileSync.mock.calls.length;

      storage.deleteTask("non-existent-id");

      // writeFileSync should not be called for failed deletion
      expect(mockFs.writeFileSync.mock.calls.length).toBe(callCountBefore);
    });
  });

  describe("listTasks", () => {
    it("should return all tasks", () => {
      const existingTasks = [
        createTask({ id: "task-1", name: "Task One" }),
        createTask({ id: "task-2", name: "Task Two" }),
        createTask({ id: "task-3", name: "Task Three" }),
      ];
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(existingTasks));
      mockFs.writeFileSync.mockImplementation(() => {});

      const storage = new ScheduleStorage("data/schedules.json");
      const tasks = storage.listTasks();

      expect(tasks).toHaveLength(3);
      expect(tasks.map(t => t.name)).toEqual(["Task One", "Task Two", "Task Three"]);
    });

    it("should return empty array when no tasks exist (after loading empty file)", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("[]");
      mockFs.writeFileSync.mockImplementation(() => {});

      const storage = new ScheduleStorage("data/schedules.json");
      const tasks = storage.listTasks();

      expect(tasks).toEqual([]);
    });

    it("should return a copy of tasks array (not the internal array)", () => {
      const existingTasks = [createTask({ id: "task-1" })];
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(existingTasks));
      mockFs.writeFileSync.mockImplementation(() => {});

      const storage = new ScheduleStorage("data/schedules.json");
      const tasks1 = storage.listTasks();
      const tasks2 = storage.listTasks();

      // Should be equal but not the same reference
      expect(tasks1).toEqual(tasks2);
      expect(tasks1).not.toBe(tasks2);
    });
  });

  describe("load error handling", () => {
    it("should use defaults when file read throws error", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("Read error");
      });
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.mkdirSync.mockImplementation(() => undefined);

      const storage = new ScheduleStorage("data/schedules.json");
      const tasks = storage.listTasks();

      // Should fall back to defaults
      expect(tasks.length).toBeGreaterThan(0);
    });

    it("should use defaults when JSON parse fails", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("invalid json");
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.mkdirSync.mockImplementation(() => undefined);

      const storage = new ScheduleStorage("data/schedules.json");
      const tasks = storage.listTasks();

      // Should fall back to defaults
      expect(tasks.length).toBeGreaterThan(0);
    });
  });

  describe("save", () => {
    it("should create directory if it does not exist", () => {
      mockFs.existsSync
        .mockReturnValueOnce(false) // For load - file doesn't exist
        .mockReturnValueOnce(false); // For save - directory doesn't exist
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.mkdirSync.mockImplementation(() => undefined);

      void new ScheduleStorage("nested/data/schedules.json");

      expect(mockFs.mkdirSync).toHaveBeenCalledWith("nested/data", { recursive: true });
    });

    it("should throw error when save fails", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("[]");
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error("Write failed");
      });

      const storage = new ScheduleStorage("data/schedules.json");

      expect(() => {
        storage.addTask({
          name: "Task",
          schedule: "0 0 * * *",
          prompt: "Test",
          enabled: true,
        });
      }).toThrow("Write failed");
    });
  });
});
