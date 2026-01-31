import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Config, TelegramConfig, ClaudeConfig, SessionsConfig, NotificationsConfig, FeishuConfig, FeishuDomain } from "./types.js";

// Load environment variables
import "dotenv/config";

const DEFAULT_CONFIG_PATH = join(process.cwd(), "config", "default.json");

function loadDefaultConfig(): Partial<Config> {
  if (existsSync(DEFAULT_CONFIG_PATH)) {
    const content = readFileSync(DEFAULT_CONFIG_PATH, "utf-8");
    return JSON.parse(content);
  }
  return {};
}

function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

function getEnvNumber(key: string, fallback: number): number {
  const value = process.env[key];
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function getEnvArray(key: string, fallback: number[]): number[] {
  const value = process.env[key];
  if (!value) return fallback;
  return value.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
}

function getEnvStringArray(key: string, fallback: string[]): string[] {
  const value = process.env[key];
  if (!value) return fallback;
  return value.split(",").map(s => s.trim()).filter(s => s.length > 0);
}

function getEnvBoolean(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

export function loadConfig(): Config {
  const defaults = loadDefaultConfig();

  // Telegram config
  const token = process.env.TELEGRAM_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_TOKEN environment variable is required");
  }

  const allowedUserId = process.env.ALLOWED_USER_ID;
  if (!allowedUserId) {
    throw new Error("ALLOWED_USER_ID environment variable is required");
  }

  const telegram: TelegramConfig = {
    token,
    allowedUsers: getEnvArray("ALLOWED_USER_ID", [parseInt(allowedUserId, 10)]),
    rateLimit: {
      messagesPerMinute: (defaults.telegram?.rateLimit as { messagesPerMinute?: number })?.messagesPerMinute ?? 20,
      editThrottleMs: (defaults.telegram?.rateLimit as { editThrottleMs?: number })?.editThrottleMs ?? 500,
    },
  };

  // Claude config
  const claude: ClaudeConfig = {
    model: process.env.CLAUDE_MODEL ?? (defaults.claude as ClaudeConfig | undefined)?.model ?? null,
    defaultWorkspace: expandPath(
      process.env.DEFAULT_WORKSPACE ??
      (defaults.claude as ClaudeConfig | undefined)?.defaultWorkspace ??
      "~/projects"
    ),
    timeout: getEnvNumber("CLAUDE_TIMEOUT", (defaults.claude as ClaudeConfig | undefined)?.timeout ?? 300000),
    inheritSettings: (defaults.claude as ClaudeConfig | undefined)?.inheritSettings ?? true,
  };

  // Sessions config
  const sessions: SessionsConfig = {
    maxSessions: (defaults.sessions as SessionsConfig | undefined)?.maxSessions ?? 10,
    persistPath: (defaults.sessions as SessionsConfig | undefined)?.persistPath ?? "./data/sessions.json",
  };

  // Notifications config
  const notifications: NotificationsConfig = {
    defaultLevel: (defaults.notifications as NotificationsConfig | undefined)?.defaultLevel ?? "status",
    onError: (defaults.notifications as NotificationsConfig | undefined)?.onError ?? true,
    onComplete: (defaults.notifications as NotificationsConfig | undefined)?.onComplete ?? true,
  };

  // Feishu config (optional)
  let feishu: FeishuConfig | undefined;
  const feishuEnabled = getEnvBoolean("FEISHU_ENABLED", false);

  if (feishuEnabled) {
    const appId = process.env.FEISHU_APP_ID;
    const appSecret = process.env.FEISHU_APP_SECRET;

    if (!appId || !appSecret) {
      throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET are required when FEISHU_ENABLED=true");
    }

    const domain = (process.env.FEISHU_DOMAIN || "feishu") as FeishuDomain;
    if (domain !== "feishu" && domain !== "lark") {
      throw new Error("FEISHU_DOMAIN must be either 'feishu' or 'lark'");
    }

    const allowAll = getEnvBoolean("FEISHU_ALLOW_ALL", false);
    const allowedUsers = getEnvStringArray("FEISHU_ALLOWED_USERS", []);

    // Require explicit authorization config
    if (allowedUsers.length === 0 && !allowAll) {
      throw new Error(
        "FEISHU_ALLOWED_USERS is required when FEISHU_ENABLED=true. " +
        "Set FEISHU_ALLOW_ALL=true to allow all users (testing only)."
      );
    }

    feishu = {
      enabled: true,
      appId,
      appSecret,
      webhookPort: getEnvNumber("FEISHU_WEBHOOK_PORT", 3000),
      allowedUsers,
      domain,
      verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
      encryptKey: process.env.FEISHU_ENCRYPT_KEY,
      allowAll,
      rateLimit: {
        messagesPerMinute: getEnvNumber("FEISHU_RATE_LIMIT", 30),
      },
    };
  }

  return {
    telegram,
    claude,
    sessions,
    notifications,
    feishu,
  };
}

// Singleton config instance
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

export function reloadConfig(): Config {
  configInstance = loadConfig();
  return configInstance;
}
