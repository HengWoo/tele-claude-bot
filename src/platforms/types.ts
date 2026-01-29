/**
 * Cross-platform message types
 * Platform-agnostic representations for messages, users, and events
 */

export type PlatformType = "telegram" | "feishu";

/**
 * Unified user representation across platforms
 */
export interface PlatformUser {
  /** Platform-specific user identifier */
  id: string;
  /** Platform type */
  platform: PlatformType;
  /** User's display name (if available) */
  name?: string;
  /** User's username/handle (if available) */
  username?: string;
}

/**
 * Unified chat/conversation representation
 */
export interface PlatformChat {
  /** Platform-specific chat identifier */
  id: string;
  /** Platform type */
  platform: PlatformType;
  /** Chat type */
  type: "private" | "group" | "channel";
  /** Chat title (for groups/channels) */
  title?: string;
}

/**
 * Incoming message from any platform
 */
export interface PlatformMessage {
  /** Platform-specific message identifier */
  id: string;
  /** Platform type */
  platform: PlatformType;
  /** Chat this message belongs to */
  chat: PlatformChat;
  /** Sender of the message */
  from: PlatformUser;
  /** Message text content */
  text?: string;
  /** Message timestamp (Unix ms) */
  timestamp: number;
  /** File attachments */
  files?: PlatformFile[];
  /** Reply-to message ID (if replying) */
  replyToMessageId?: string;
}

/**
 * File attachment from any platform
 */
export interface PlatformFile {
  /** Platform-specific file identifier */
  id: string;
  /** Original filename */
  name: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** File type category */
  type: "image" | "document" | "audio" | "video" | "other";
}

/**
 * Options for sending messages
 */
export interface SendOptions {
  /** Parse mode for formatting */
  parseMode?: "html" | "markdown" | "plain";
  /** Message ID to reply to */
  replyToMessageId?: string;
  /** Inline keyboard buttons */
  buttons?: InlineButton[][];
  /** Disable link preview */
  disableLinkPreview?: boolean;
}

/**
 * Inline button for interactive messages
 */
export interface InlineButton {
  /** Button text */
  text: string;
  /** Callback data (for callback buttons) */
  callbackData?: string;
  /** URL (for URL buttons) */
  url?: string;
}

/**
 * Command parsed from message
 */
export interface ParsedCommand {
  /** Command name without leading / */
  command: string;
  /** Arguments as array */
  args: string[];
  /** Raw argument string */
  rawArgs: string;
}

/**
 * Platform event types
 */
export type PlatformEventType =
  | "message"
  | "command"
  | "callback"
  | "file";

/**
 * Base event interface
 */
export interface PlatformEvent {
  type: PlatformEventType;
  platform: PlatformType;
  timestamp: number;
}

/**
 * Message received event
 */
export interface MessageEvent extends PlatformEvent {
  type: "message";
  message: PlatformMessage;
}

/**
 * Command received event
 */
export interface CommandEvent extends PlatformEvent {
  type: "command";
  message: PlatformMessage;
  command: ParsedCommand;
}

/**
 * Callback query event (button press)
 */
export interface CallbackEvent extends PlatformEvent {
  type: "callback";
  callbackId: string;
  data: string;
  message?: PlatformMessage;
  from: PlatformUser;
  chat: PlatformChat;
}

/**
 * File received event
 */
export interface FileEvent extends PlatformEvent {
  type: "file";
  message: PlatformMessage;
  file: PlatformFile;
}

/**
 * Generate a platform-prefixed session key
 * e.g., "telegram:123456789" or "feishu:ou_xxxxx"
 */
export function getSessionKey(platform: PlatformType, userId: string): string {
  return `${platform}:${userId}`;
}

/**
 * Parse a session key back into platform and userId
 */
export function parseSessionKey(key: string): { platform: PlatformType; userId: string } | null {
  const match = key.match(/^(telegram|feishu):(.+)$/);
  if (!match) return null;
  return {
    platform: match[1] as PlatformType,
    userId: match[2],
  };
}
