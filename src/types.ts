import type { Context as GrammyContext } from "grammy";

// Session types
export interface Session {
  id: string;           // UUID for Claude --session-id
  name: string;         // Human-readable name (e.g., "project-a")
  workspace: string;    // Working directory path
  createdAt: number;    // Unix timestamp
  lastUsed: number;     // Unix timestamp
  approveAll: boolean;  // Auto-approve all tool uses
  attached: boolean;    // Connected to local running session
  notifyLevel: NotificationLevel;
}

export type NotificationLevel = "minimal" | "status" | "verbose";

// Configuration types
export interface Config {
  telegram: TelegramConfig;
  claude: ClaudeConfig;
  sessions: SessionsConfig;
  notifications: NotificationsConfig;
}

export interface TelegramConfig {
  token: string;
  allowedUsers: number[];
  rateLimit: {
    messagesPerMinute: number;
    editThrottleMs: number;
  };
}

export interface ClaudeConfig {
  model: string | null;
  defaultWorkspace: string;
  timeout: number;
  inheritSettings: boolean;
}

export interface SessionsConfig {
  maxSessions: number;
  persistPath: string;
}

export interface NotificationsConfig {
  defaultLevel: NotificationLevel;
  onError: boolean;
  onComplete: boolean;
}

// Claude CLI response types
export interface ClaudeStreamEvent {
  type: "assistant" | "user" | "tool_use" | "tool_result" | "result" | "error" | "system";
  subtype?: string;
  message?: ClaudeMessage;
  tool_use_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  content?: string;
  session_id?: string;
  total_cost_usd?: number;
  usage?: ClaudeUsage;
}

export interface ClaudeMessage {
  role: "assistant" | "user";
  content: ClaudeContent[];
}

export type ClaudeContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// Tool approval types
export interface PendingApproval {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionId: string;
  messageId: number;
  chatId: number;
  resolve: (approved: boolean) => void;
  createdAt: number;
}

// Extended Grammy context with session data
export interface BotContext extends GrammyContext {
  session?: {
    activeSessionName: string | null;
  };
}

// File handling types
export interface DownloadedFile {
  path: string;
  mimeType: string;
  fileName: string;
  size: number;
}

export type FileType = "image" | "text" | "document" | "audio" | "video" | "other";

// Command parsing
export interface ParsedCommand {
  command: string;
  args: string[];
  rawArgs: string;
}

// Approval system types
export type ApprovalStatus = "pending" | "approved" | "denied" | "timeout";

export interface ApprovalRequest {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown> | string;
  /** Unix timestamp in seconds (not milliseconds) */
  timestamp: number;
  status: ApprovalStatus;
  responseAt?: number;
}

export interface ApprovalResponse {
  approved: boolean;
}

export type PolicyAction = "auto-approve" | "auto-deny" | "require-approval";

export interface PolicyRule {
  pattern: string;
  action: PolicyAction;
  description?: string;
}

export interface ApprovalPolicy {
  rules: PolicyRule[];
  defaultAction: PolicyAction;
  timeoutSeconds: number;
}

// Scheduler types
export interface ScheduledTask {
  id: string;
  name: string;
  schedule: string; // cron expression
  prompt: string;
  enabled: boolean;
  createdAt: number;
  lastRun?: number;
  nextRun?: number;
  lastRunSuccess?: boolean;  // Track if last run succeeded
  lastError?: string;        // Store error message on failure
}

export interface SchedulerConfig {
  enabled: boolean;
  dataPath: string;
}
