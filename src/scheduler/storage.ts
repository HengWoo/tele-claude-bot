import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { ScheduledTask } from "../types.js";
import { createChildLogger } from "../utils/logger.js";

const logger = createChildLogger("scheduler-storage");

const DEFAULT_SCHEDULES: ScheduledTask[] = [
  {
    id: "morning-briefing",
    name: "Morning Briefing",
    schedule: "0 7 * * *", // 7 AM daily
    prompt: `Provide a morning briefing:
1. Summarize unread emails (top 5 most important)
2. List today's calendar events
3. Flag any urgent items that need attention`,
    enabled: true,
    createdAt: Date.now(),
  },
];

export class ScheduleStorage {
  private dataPath: string;
  private tasks: ScheduledTask[] = [];

  constructor(dataPath: string = "data/schedules.json") {
    this.dataPath = dataPath;
    this.tasks = this.load();
  }

  /**
   * Load scheduled tasks from file, return defaults if not exists
   */
  load(): ScheduledTask[] {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = fs.readFileSync(this.dataPath, "utf-8");
        const parsed = JSON.parse(data) as ScheduledTask[];
        logger.debug({ count: parsed.length }, "Loaded scheduled tasks");
        return parsed;
      }
    } catch (error) {
      logger.error({ error, path: this.dataPath }, "Failed to load schedules");
    }

    logger.info("Using default schedules");
    // Save defaults to file
    this.tasks = [...DEFAULT_SCHEDULES];
    this.save(this.tasks);
    return this.tasks;
  }

  /**
   * Save tasks to file, ensuring data directory exists
   */
  save(tasks: ScheduledTask[]): void {
    try {
      // Ensure data directory exists
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.debug({ dir }, "Created data directory");
      }

      fs.writeFileSync(this.dataPath, JSON.stringify(tasks, null, 2), "utf-8");
      this.tasks = tasks;
      logger.debug({ count: tasks.length }, "Saved scheduled tasks");
    } catch (error) {
      logger.error({ error, path: this.dataPath }, "Failed to save schedules");
      throw error;
    }
  }

  /**
   * Get a task by ID
   */
  getTask(id: string): ScheduledTask | undefined {
    return this.tasks.find((task) => task.id === id);
  }

  /**
   * Add a new task with generated ID and createdAt
   */
  addTask(
    task: Omit<ScheduledTask, "id" | "createdAt">
  ): ScheduledTask {
    const newTask: ScheduledTask = {
      ...task,
      id: randomUUID(),
      createdAt: Date.now(),
    };

    this.tasks.push(newTask);
    this.save(this.tasks);
    logger.info({ taskId: newTask.id, name: newTask.name }, "Added scheduled task");
    return newTask;
  }

  /**
   * Update an existing task
   */
  updateTask(
    id: string,
    updates: Partial<ScheduledTask>
  ): ScheduledTask | undefined {
    const index = this.tasks.findIndex((task) => task.id === id);
    if (index === -1) {
      logger.warn({ taskId: id }, "Task not found for update");
      return undefined;
    }

    // Don't allow changing id or createdAt
    const { id: _id, createdAt: _createdAt, ...safeUpdates } = updates;

    this.tasks[index] = {
      ...this.tasks[index],
      ...safeUpdates,
    };

    this.save(this.tasks);
    logger.info({ taskId: id }, "Updated scheduled task");
    return this.tasks[index];
  }

  /**
   * Delete a task by ID
   */
  deleteTask(id: string): boolean {
    const initialLength = this.tasks.length;
    this.tasks = this.tasks.filter((task) => task.id !== id);

    if (this.tasks.length < initialLength) {
      this.save(this.tasks);
      logger.info({ taskId: id }, "Deleted scheduled task");
      return true;
    }

    logger.warn({ taskId: id }, "Task not found for deletion");
    return false;
  }

  /**
   * List all tasks
   */
  listTasks(): ScheduledTask[] {
    return [...this.tasks];
  }
}
