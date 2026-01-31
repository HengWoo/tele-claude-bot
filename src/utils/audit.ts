/**
 * Audit Logger
 * Structured audit logging for security-relevant events across platforms.
 */

import { createChildLogger } from "./logger.js";

const auditLogger = createChildLogger("audit");

export type AuditAction =
  | "message_received"
  | "command_executed"
  | "file_received"
  | "auth_denied"
  | "rate_limited";

export type AuditPlatform = "telegram" | "feishu";

export interface AuditEntry {
  action: AuditAction;
  platform: AuditPlatform;
  userId: string;
  chatId?: string;
  /** Additional context specific to the action */
  details?: Record<string, unknown>;
}

/**
 * Log an audit event with structured format.
 * All audit entries include timestamp automatically via pino.
 */
export function audit(entry: AuditEntry): void {
  const { action, platform, userId, chatId, details } = entry;

  auditLogger.info(
    {
      audit: true,
      action,
      platform,
      userId,
      chatId,
      ...details,
    },
    `[${platform}] ${action}: user=${userId}`
  );
}

/**
 * Convenience functions for common audit actions
 */

export function auditMessageReceived(
  platform: AuditPlatform,
  userId: string,
  chatId: string,
  messageLength?: number
): void {
  audit({
    action: "message_received",
    platform,
    userId,
    chatId,
    details: messageLength !== undefined ? { messageLength } : undefined,
  });
}

export function auditCommandExecuted(
  platform: AuditPlatform,
  userId: string,
  chatId: string,
  command: string
): void {
  audit({
    action: "command_executed",
    platform,
    userId,
    chatId,
    details: { command },
  });
}

export function auditFileReceived(
  platform: AuditPlatform,
  userId: string,
  chatId: string,
  fileName: string,
  fileType: string
): void {
  audit({
    action: "file_received",
    platform,
    userId,
    chatId,
    details: { fileName, fileType },
  });
}

export function auditAuthDenied(
  platform: AuditPlatform,
  userId: string,
  chatId?: string,
  reason?: string
): void {
  audit({
    action: "auth_denied",
    platform,
    userId,
    chatId,
    details: reason ? { reason } : undefined,
  });
}

export function auditRateLimited(
  platform: AuditPlatform,
  userId: string,
  chatId: string,
  retryAfter: number
): void {
  audit({
    action: "rate_limited",
    platform,
    userId,
    chatId,
    details: { retryAfter },
  });
}
