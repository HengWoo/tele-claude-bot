import cron, { type ScheduledTask as CronTask } from "node-cron";
import { ScheduleStorage } from "./storage.js";
import {
  executeJob,
  listTmuxSessions,
  type JobResult,
  DEFAULT_MORNING_BRIEFING,
} from "./jobs.js";
import { createChildLogger } from "../utils/logger.js";
import type { ScheduledTask } from "../types.js";

const logger = createChildLogger("scheduler");

/**
 * Reference to a scheduled cron job
 */
interface ScheduledCron {
  task: CronTask;
  taskId: string;
}

/**
 * Main Scheduler service that manages scheduled tasks using node-cron
 */
export class Scheduler {
  private storage: ScheduleStorage;
  private cronJobs: Map<string, ScheduledCron> = new Map();
  private running: boolean = false;

  constructor(dataPath?: string) {
    this.storage = new ScheduleStorage(dataPath);
  }

  /**
   * Start the scheduler - load all enabled tasks and schedule them
   */
  start(): void {
    if (this.running) {
      logger.warn("Scheduler is already running");
      return;
    }

    logger.info("Starting scheduler");

    const tasks = this.storage.listTasks();
    let scheduled = 0;

    for (const task of tasks) {
      if (task.enabled) {
        this.scheduleTask(task);
        scheduled++;
      }
    }

    this.running = true;
    logger.info(
      { totalTasks: tasks.length, scheduledTasks: scheduled },
      "Scheduler started"
    );
  }

  /**
   * Stop the scheduler - stop all scheduled jobs
   */
  stop(): void {
    if (!this.running) {
      logger.warn("Scheduler is not running");
      return;
    }

    logger.info("Stopping scheduler");

    for (const taskId of this.cronJobs.keys()) {
      const cronJob = this.cronJobs.get(taskId);
      if (cronJob) {
        cronJob.task.stop();
        logger.debug({ taskId }, "Stopped cron job");
      }
    }

    this.cronJobs.clear();
    this.running = false;
    logger.info("Scheduler stopped");
  }

  /**
   * Schedule a single task using node-cron
   * @returns true if task was scheduled successfully, false if cron expression is invalid
   */
  scheduleTask(task: ScheduledTask): boolean {
    // Remove existing job if present
    this.unscheduleTask(task.id);

    // Validate cron expression
    if (!cron.validate(task.schedule)) {
      logger.error(
        { taskId: task.id, schedule: task.schedule },
        "Invalid cron expression"
      );
      return false;
    }

    try {
      const cronTask = cron.schedule(
        task.schedule,
        async () => {
          try {
            logger.info({ taskId: task.id, taskName: task.name }, "Cron job triggered");

            const success = await executeJob(task);

            if (success) {
              // Update lastRun and mark success
              this.storage.updateTask(task.id, {
                lastRun: Date.now(),
                lastRunSuccess: true,
                lastError: undefined,
              });
            } else {
              // Mark failure with error
              this.storage.updateTask(task.id, {
                lastRunSuccess: false,
                lastError: "Job execution failed",
              });
              logger.warn(
                { taskId: task.id, taskName: task.name },
                "Scheduled job execution failed"
              );
            }
          } catch (error) {
            logger.error(
              { error, taskId: task.id, taskName: task.name },
              "Cron job threw exception"
            );
            this.storage.updateTask(task.id, {
              lastRunSuccess: false,
              lastError: (error as Error).message,
            });
          }
        },
        {
          name: task.id,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }
      );

      // Start the task if enabled
      if (task.enabled) {
        cronTask.start();
      }

      this.cronJobs.set(task.id, { task: cronTask, taskId: task.id });

      logger.debug(
        { taskId: task.id, taskName: task.name, schedule: task.schedule },
        "Task scheduled"
      );
      return true;
    } catch (error) {
      const err = error as Error;
      logger.error(
        { taskId: task.id, schedule: task.schedule, error: err.message },
        "Failed to schedule task"
      );
      return false;
    }
  }

  /**
   * Remove a scheduled task from the cron scheduler
   */
  unscheduleTask(taskId: string): void {
    const cronJob = this.cronJobs.get(taskId);
    if (cronJob) {
      cronJob.task.stop();
      this.cronJobs.delete(taskId);
      logger.debug({ taskId }, "Task unscheduled");
    }
  }

  /**
   * Add a new task and schedule it
   */
  addTask(task: Omit<ScheduledTask, "id" | "createdAt">): ScheduledTask {
    // Validate cron expression before adding
    if (!cron.validate(task.schedule)) {
      logger.error({ schedule: task.schedule }, "Invalid cron expression");
      throw new Error(`Invalid cron expression: ${task.schedule}`);
    }

    const newTask = this.storage.addTask(task);

    if (this.running && newTask.enabled) {
      this.scheduleTask(newTask);
    }

    logger.info(
      { taskId: newTask.id, taskName: newTask.name },
      "Task added"
    );

    return newTask;
  }

  /**
   * Update an existing task and reschedule if needed
   */
  updateTask(
    id: string,
    updates: Partial<ScheduledTask>
  ): ScheduledTask | undefined {
    // Validate new cron expression if provided
    if (updates.schedule && !cron.validate(updates.schedule)) {
      logger.error({ schedule: updates.schedule }, "Invalid cron expression");
      throw new Error(`Invalid cron expression: ${updates.schedule}`);
    }

    const updatedTask = this.storage.updateTask(id, updates);

    if (!updatedTask) {
      return undefined;
    }

    // Reschedule if scheduler is running
    if (this.running) {
      if (updatedTask.enabled) {
        // Reschedule with new settings
        this.scheduleTask(updatedTask);
      } else {
        // Disable - just unschedule
        this.unscheduleTask(id);
      }
    }

    logger.info({ taskId: id }, "Task updated");

    return updatedTask;
  }

  /**
   * Delete a task and unschedule it
   */
  deleteTask(id: string): boolean {
    this.unscheduleTask(id);
    const deleted = this.storage.deleteTask(id);

    if (deleted) {
      logger.info({ taskId: id }, "Task deleted");
    }

    return deleted;
  }

  /**
   * Run a task immediately (bypass schedule)
   */
  async runTask(id: string): Promise<boolean> {
    const task = this.storage.getTask(id);

    if (!task) {
      logger.warn({ taskId: id }, "Task not found for immediate execution");
      return false;
    }

    logger.info({ taskId: id, taskName: task.name }, "Running task immediately");

    const success = await executeJob(task);

    if (success) {
      // Update lastRun and mark success
      this.storage.updateTask(id, {
        lastRun: Date.now(),
        lastRunSuccess: true,
        lastError: undefined,
      });
    } else {
      // Mark failure with error
      this.storage.updateTask(id, {
        lastRunSuccess: false,
        lastError: "Job execution failed",
      });
    }

    return success;
  }

  /**
   * List all tasks
   */
  listTasks(): ScheduledTask[] {
    return this.storage.listTasks();
  }

  /**
   * Get a task by ID
   */
  getTask(id: string): ScheduledTask | undefined {
    return this.storage.getTask(id);
  }

  /**
   * Check if the scheduler is running
   */
  isRunning(): boolean {
    return this.running;
  }
}

// Re-export storage and job utilities
export { ScheduleStorage };
export { executeJob, listTmuxSessions, type JobResult, DEFAULT_MORNING_BRIEFING };
