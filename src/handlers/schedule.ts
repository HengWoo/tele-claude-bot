import { Bot, InlineKeyboard } from "grammy";
import cron from "node-cron";
import type { BotContext } from "../types.js";
import { createChildLogger } from "../utils/logger.js";
import { Scheduler } from "../scheduler/index.js";

const logger = createChildLogger("schedule-handler");

/**
 * Parse command arguments from message text
 * Returns the text after the command
 */
function parseArgs(text: string | undefined): string {
  if (!text) return "";
  // Remove the /command part and trim
  const match = text.match(/^\/\S+\s*(.*)/);
  return match ? match[1].trim() : "";
}

/**
 * Handle /schedule list - List all scheduled tasks
 */
export async function handleScheduleListCommand(
  ctx: BotContext,
  scheduler: Scheduler
): Promise<void> {
  const userId = ctx.from?.id;

  logger.debug({ userId }, "Schedule list command");

  const tasks = scheduler.listTasks();

  if (tasks.length === 0) {
    await ctx.reply(
      "No scheduled tasks found.\n\n" +
        "Use /schedule add <name> <cron> <prompt> to create a new task."
    );
    return;
  }

  // Build inline keyboard with enable/disable toggle buttons
  const keyboard = new InlineKeyboard();

  let messageText = "Scheduled Tasks:\n\n";

  tasks.forEach((task, index) => {
    const statusIcon = task.enabled ? "[ON]" : "[OFF]";
    const lastRun = task.lastRun
      ? new Date(task.lastRun).toLocaleString()
      : "Never";

    messageText += `${index + 1}. ${statusIcon} ${task.name}\n`;
    messageText += `   Schedule: ${task.schedule}\n`;
    messageText += `   Last Run: ${lastRun}\n`;
    messageText += `   ID: ${task.id.slice(0, 8)}...\n\n`;

    // Add toggle button
    const toggleAction = task.enabled ? "schedule_disable" : "schedule_enable";
    const toggleLabel = task.enabled ? `Disable ${task.name}` : `Enable ${task.name}`;
    keyboard.text(toggleLabel, `${toggleAction}:${task.id}`);
    keyboard.row();
  });

  messageText += "Tap a button to toggle task status.";

  await ctx.reply(messageText, { reply_markup: keyboard });
}

/**
 * Handle /schedule add <name> <cron> <prompt> - Add a new scheduled task
 */
export async function handleScheduleAddCommand(
  ctx: BotContext,
  scheduler: Scheduler
): Promise<void> {
  const userId = ctx.from?.id;
  const args = parseArgs(ctx.message?.text);

  logger.debug({ userId, args }, "Schedule add command");

  if (!args) {
    await ctx.reply(
      "Usage: /schedule add <name> <cron> <prompt>\n\n" +
        "Examples:\n" +
        '/schedule add daily-report "0 9 * * *" Check my calendar and summarize tasks\n' +
        '/schedule add hourly-check "0 * * * *" Check for new emails\n\n' +
        "Cron format: minute hour day month weekday\n" +
        "Use quotes around cron if it contains spaces."
    );
    return;
  }

  // Parse: name, cron expression, and prompt
  // Format: <name> <cron> <prompt>
  // Cron can be quoted or unquoted
  let name: string;
  let cronExpr: string;
  let prompt: string;

  // Try to parse with quoted cron first
  const quotedMatch = args.match(/^(\S+)\s+"([^"]+)"\s+(.+)$/);
  if (quotedMatch) {
    name = quotedMatch[1];
    cronExpr = quotedMatch[2];
    prompt = quotedMatch[3];
  } else {
    // Parse without quotes - assume standard 5-field cron
    const parts = args.split(/\s+/);
    if (parts.length < 7) {
      // name + 5 cron fields + at least 1 prompt word
      await ctx.reply(
        "Invalid format. Expected: /schedule add <name> <cron> <prompt>\n\n" +
          "Cron must have 5 fields (minute hour day month weekday).\n" +
          'Use quotes around cron: /schedule add task "0 9 * * *" My prompt'
      );
      return;
    }

    name = parts[0];
    cronExpr = parts.slice(1, 6).join(" ");
    prompt = parts.slice(6).join(" ");
  }

  // Validate cron expression
  if (!cron.validate(cronExpr)) {
    await ctx.reply(
      `Invalid cron expression: ${cronExpr}\n\n` +
        "Cron format: minute hour day month weekday\n" +
        "Examples:\n" +
        "  0 9 * * * = 9:00 AM daily\n" +
        "  0 * * * * = Every hour\n" +
        "  */15 * * * * = Every 15 minutes"
    );
    return;
  }

  try {
    const task = scheduler.addTask({
      name,
      schedule: cronExpr,
      prompt,
      enabled: true,
    });

    logger.info({ userId, taskId: task.id, name }, "Scheduled task added");

    await ctx.reply(
      `Task "${name}" created!\n\n` +
        `ID: ${task.id}\n` +
        `Schedule: ${cronExpr}\n` +
        `Prompt: ${prompt}\n\n` +
        "The task is now enabled and will run on schedule."
    );
  } catch (error) {
    const err = error as Error;
    logger.warn({ userId, error: err.message }, "Failed to add scheduled task");
    await ctx.reply(`Failed to add task: ${err.message}`);
  }
}

/**
 * Handle /schedule enable <id> - Enable a scheduled task
 */
export async function handleScheduleEnableCommand(
  ctx: BotContext,
  scheduler: Scheduler
): Promise<void> {
  const userId = ctx.from?.id;
  const args = parseArgs(ctx.message?.text);

  logger.debug({ userId, args }, "Schedule enable command");

  if (!args) {
    await ctx.reply(
      "Usage: /schedule enable <id>\n\n" +
        "Enable a scheduled task by its ID.\n" +
        "Use /schedule list to see task IDs."
    );
    return;
  }

  const taskId = args.trim();

  try {
    const task = scheduler.updateTask(taskId, { enabled: true });

    if (!task) {
      await ctx.reply(`Task not found: ${taskId}`);
      return;
    }

    logger.info({ userId, taskId }, "Scheduled task enabled");

    await ctx.reply(
      `Task "${task.name}" has been enabled.\n\n` +
        `Schedule: ${task.schedule}`
    );
  } catch (error) {
    const err = error as Error;
    logger.warn({ userId, taskId, error: err.message }, "Failed to enable task");
    await ctx.reply(`Failed to enable task: ${err.message}`);
  }
}

/**
 * Handle /schedule disable <id> - Disable a scheduled task
 */
export async function handleScheduleDisableCommand(
  ctx: BotContext,
  scheduler: Scheduler
): Promise<void> {
  const userId = ctx.from?.id;
  const args = parseArgs(ctx.message?.text);

  logger.debug({ userId, args }, "Schedule disable command");

  if (!args) {
    await ctx.reply(
      "Usage: /schedule disable <id>\n\n" +
        "Disable a scheduled task by its ID.\n" +
        "Use /schedule list to see task IDs."
    );
    return;
  }

  const taskId = args.trim();

  try {
    const task = scheduler.updateTask(taskId, { enabled: false });

    if (!task) {
      await ctx.reply(`Task not found: ${taskId}`);
      return;
    }

    logger.info({ userId, taskId }, "Scheduled task disabled");

    await ctx.reply(
      `Task "${task.name}" has been disabled.\n\n` +
        "The task will not run until re-enabled."
    );
  } catch (error) {
    const err = error as Error;
    logger.warn({ userId, taskId, error: err.message }, "Failed to disable task");
    await ctx.reply(`Failed to disable task: ${err.message}`);
  }
}

/**
 * Handle /schedule run <id> - Run a task immediately
 */
export async function handleScheduleRunCommand(
  ctx: BotContext,
  scheduler: Scheduler
): Promise<void> {
  const userId = ctx.from?.id;
  const args = parseArgs(ctx.message?.text);

  logger.debug({ userId, args }, "Schedule run command");

  if (!args) {
    await ctx.reply(
      "Usage: /schedule run <id>\n\n" +
        "Run a scheduled task immediately.\n" +
        "Use /schedule list to see task IDs."
    );
    return;
  }

  const taskId = args.trim();
  const task = scheduler.getTask(taskId);

  if (!task) {
    await ctx.reply(`Task not found: ${taskId}`);
    return;
  }

  await ctx.reply(`Running task "${task.name}"...`);

  try {
    const success = await scheduler.runTask(taskId);

    if (success) {
      logger.info({ userId, taskId }, "Task executed successfully");
      await ctx.reply(`Task "${task.name}" completed successfully.`);
    } else {
      logger.warn({ userId, taskId }, "Task execution failed");
      await ctx.reply(
        `Task "${task.name}" failed to execute.\n\n` +
          "Check the logs for more details."
      );
    }
  } catch (error) {
    const err = error as Error;
    logger.warn({ userId, taskId, error: err.message }, "Failed to run task");
    await ctx.reply(`Failed to run task: ${err.message}`);
  }
}

/**
 * Handle /schedule delete <id> - Delete a scheduled task
 */
export async function handleScheduleDeleteCommand(
  ctx: BotContext,
  scheduler: Scheduler
): Promise<void> {
  const userId = ctx.from?.id;
  const args = parseArgs(ctx.message?.text);

  logger.debug({ userId, args }, "Schedule delete command");

  if (!args) {
    await ctx.reply(
      "Usage: /schedule delete <id>\n\n" +
        "Delete a scheduled task permanently.\n" +
        "Use /schedule list to see task IDs."
    );
    return;
  }

  const taskId = args.trim();
  const task = scheduler.getTask(taskId);

  if (!task) {
    await ctx.reply(`Task not found: ${taskId}`);
    return;
  }

  // Create confirmation keyboard
  const keyboard = new InlineKeyboard()
    .text("Yes, delete", `schedule_delete_confirm:${taskId}`)
    .text("Cancel", "schedule_delete_cancel");

  await ctx.reply(
    `Are you sure you want to delete task "${task.name}"?\n\n` +
      `Schedule: ${task.schedule}\n\n` +
      "This action cannot be undone.",
    { reply_markup: keyboard }
  );
}

/**
 * Handle callback queries for schedule actions
 */
export async function handleScheduleCallback(
  ctx: BotContext,
  scheduler: Scheduler
): Promise<void> {
  const callbackData = ctx.callbackQuery?.data;
  const userId = ctx.from?.id;

  if (!callbackData) return;

  logger.debug({ userId, callbackData }, "Schedule callback");

  // Handle enable
  if (callbackData.startsWith("schedule_enable:")) {
    const taskId = callbackData.replace("schedule_enable:", "");

    try {
      const task = scheduler.updateTask(taskId, { enabled: true });

      if (!task) {
        await ctx.answerCallbackQuery({
          text: "Task not found",
          show_alert: true,
        });
        return;
      }

      await ctx.answerCallbackQuery({ text: `Enabled ${task.name}` });
      await ctx.editMessageText(
        `Task "${task.name}" has been enabled.\n\n` +
          `Schedule: ${task.schedule}\n\n` +
          "Use /schedule list to see all tasks."
      );

      logger.info({ userId, taskId }, "Task enabled via callback");
    } catch (error) {
      const err = error as Error;
      await ctx.answerCallbackQuery({
        text: `Error: ${err.message}`,
        show_alert: true,
      });
    }
    return;
  }

  // Handle disable
  if (callbackData.startsWith("schedule_disable:")) {
    const taskId = callbackData.replace("schedule_disable:", "");

    try {
      const task = scheduler.updateTask(taskId, { enabled: false });

      if (!task) {
        await ctx.answerCallbackQuery({
          text: "Task not found",
          show_alert: true,
        });
        return;
      }

      await ctx.answerCallbackQuery({ text: `Disabled ${task.name}` });
      await ctx.editMessageText(
        `Task "${task.name}" has been disabled.\n\n` +
          "Use /schedule list to see all tasks."
      );

      logger.info({ userId, taskId }, "Task disabled via callback");
    } catch (error) {
      const err = error as Error;
      await ctx.answerCallbackQuery({
        text: `Error: ${err.message}`,
        show_alert: true,
      });
    }
    return;
  }

  // Handle delete confirmation
  if (callbackData.startsWith("schedule_delete_confirm:")) {
    const taskId = callbackData.replace("schedule_delete_confirm:", "");
    const task = scheduler.getTask(taskId);

    if (!task) {
      await ctx.answerCallbackQuery({
        text: "Task not found",
        show_alert: true,
      });
      await ctx.editMessageText("Task not found.");
      return;
    }

    const deleted = scheduler.deleteTask(taskId);

    if (deleted) {
      await ctx.answerCallbackQuery({ text: "Task deleted" });
      await ctx.editMessageText(`Task "${task.name}" has been deleted.`);
      logger.info({ userId, taskId }, "Task deleted via callback");
    } else {
      await ctx.answerCallbackQuery({
        text: "Failed to delete task",
        show_alert: true,
      });
    }
    return;
  }

  // Handle delete cancel
  if (callbackData === "schedule_delete_cancel") {
    await ctx.answerCallbackQuery({ text: "Cancelled" });
    await ctx.editMessageText("Task deletion cancelled.");
    return;
  }
}

/**
 * Main /schedule command dispatcher
 */
async function handleScheduleCommand(
  ctx: BotContext,
  scheduler: Scheduler
): Promise<void> {
  const args = parseArgs(ctx.message?.text);
  const parts = args.split(/\s+/);
  const subCommand = parts[0]?.toLowerCase() || "";

  // Reconstruct the text for sub-handlers by creating a fake message text
  // that they can parse with parseArgs
  const subArgs = parts.slice(1).join(" ");

  switch (subCommand) {
    case "list":
    case "":
      await handleScheduleListCommand(ctx, scheduler);
      break;

    case "add": {
      // Create a context-like object with the subArgs for parseArgs
      const fakeCtx = {
        ...ctx,
        message: ctx.message
          ? { ...ctx.message, text: `/add ${subArgs}` }
          : undefined,
      } as BotContext;
      await handleScheduleAddCommand(fakeCtx, scheduler);
      break;
    }

    case "enable": {
      const fakeCtx = {
        ...ctx,
        message: ctx.message
          ? { ...ctx.message, text: `/enable ${subArgs}` }
          : undefined,
      } as BotContext;
      await handleScheduleEnableCommand(fakeCtx, scheduler);
      break;
    }

    case "disable": {
      const fakeCtx = {
        ...ctx,
        message: ctx.message
          ? { ...ctx.message, text: `/disable ${subArgs}` }
          : undefined,
      } as BotContext;
      await handleScheduleDisableCommand(fakeCtx, scheduler);
      break;
    }

    case "run": {
      const fakeCtx = {
        ...ctx,
        message: ctx.message
          ? { ...ctx.message, text: `/run ${subArgs}` }
          : undefined,
      } as BotContext;
      await handleScheduleRunCommand(fakeCtx, scheduler);
      break;
    }

    case "delete": {
      const fakeCtx = {
        ...ctx,
        message: ctx.message
          ? { ...ctx.message, text: `/delete ${subArgs}` }
          : undefined,
      } as BotContext;
      await handleScheduleDeleteCommand(fakeCtx, scheduler);
      break;
    }

    default:
      await ctx.reply(
        "Unknown schedule command.\n\n" +
          "Available commands:\n" +
          "  /schedule list - List all scheduled tasks\n" +
          "  /schedule add <name> <cron> <prompt> - Add a new task\n" +
          "  /schedule enable <id> - Enable a task\n" +
          "  /schedule disable <id> - Disable a task\n" +
          "  /schedule run <id> - Run a task immediately\n" +
          "  /schedule delete <id> - Delete a task"
      );
  }
}

/**
 * Register all schedule command handlers on the bot
 */
export function registerScheduleCommands(
  bot: Bot<BotContext>,
  scheduler: Scheduler
): void {
  logger.info("Registering schedule command handlers");

  // Main /schedule command that dispatches to sub-commands
  bot.command("schedule", (ctx) => handleScheduleCommand(ctx, scheduler));

  // Callback query handlers for inline keyboards
  bot.callbackQuery(/^schedule_enable:/, (ctx) =>
    handleScheduleCallback(ctx, scheduler)
  );
  bot.callbackQuery(/^schedule_disable:/, (ctx) =>
    handleScheduleCallback(ctx, scheduler)
  );
  bot.callbackQuery(/^schedule_delete_confirm:/, (ctx) =>
    handleScheduleCallback(ctx, scheduler)
  );
  bot.callbackQuery("schedule_delete_cancel", (ctx) =>
    handleScheduleCallback(ctx, scheduler)
  );

  logger.info("Schedule command handlers registered");
}
