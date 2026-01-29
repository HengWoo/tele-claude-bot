/**
 * Platform adapter interface
 * Defines the contract for messaging platform implementations
 */

import type {
  PlatformType,
  PlatformMessage,
  PlatformFile,
  SendOptions,
  MessageEvent,
  CommandEvent,
  CallbackEvent,
  FileEvent,
  PlatformUser,
  PlatformChat,
} from "./types.js";

/**
 * Message handler callback
 */
export type MessageHandler = (event: MessageEvent) => Promise<void>;

/**
 * Command handler callback
 */
export type CommandHandler = (event: CommandEvent) => Promise<void>;

/**
 * Callback query handler
 */
export type CallbackHandler = (event: CallbackEvent) => Promise<void>;

/**
 * File handler callback
 */
export type FileHandler = (event: FileEvent) => Promise<void>;

/**
 * Sent message result
 */
export interface SentMessage {
  /** Platform-specific message ID */
  id: string;
  /** Chat ID where message was sent */
  chatId: string;
}

/**
 * Platform adapter interface
 * Implement this interface to add support for a new messaging platform
 */
export interface PlatformAdapter {
  /** Platform identifier */
  readonly platform: PlatformType;

  /** Platform display name */
  readonly name: string;

  /**
   * Start the adapter (connect, start polling, etc.)
   */
  start(): Promise<void>;

  /**
   * Stop the adapter gracefully
   */
  stop(): Promise<void>;

  /**
   * Check if adapter is running
   */
  isRunning(): boolean;

  /**
   * Send a text message
   * @param chatId Platform-specific chat identifier
   * @param text Message text
   * @param options Send options (formatting, reply, buttons)
   * @returns Sent message info
   */
  sendMessage(chatId: string, text: string, options?: SendOptions): Promise<SentMessage>;

  /**
   * Edit an existing message
   * @param chatId Chat identifier
   * @param messageId Message identifier to edit
   * @param text New message text
   * @param options Send options
   */
  editMessage(chatId: string, messageId: string, text: string, options?: SendOptions): Promise<void>;

  /**
   * Delete a message
   * @param chatId Chat identifier
   * @param messageId Message identifier to delete
   */
  deleteMessage(chatId: string, messageId: string): Promise<void>;

  /**
   * Download a file to local path
   * @param fileId Platform-specific file identifier
   * @param destPath Local destination path
   * @returns Local file path
   */
  downloadFile(fileId: string, destPath: string): Promise<string>;

  /**
   * Answer a callback query (acknowledge button press)
   * @param callbackId Callback query identifier
   * @param text Optional toast text
   * @param showAlert Show as alert dialog instead of toast
   */
  answerCallback(callbackId: string, text?: string, showAlert?: boolean): Promise<void>;

  /**
   * Register a message handler
   * Called for all non-command text messages
   */
  onMessage(handler: MessageHandler): void;

  /**
   * Register a command handler
   * @param command Command name (without leading /)
   * @param handler Command handler
   */
  onCommand(command: string, handler: CommandHandler): void;

  /**
   * Register a callback query handler
   * @param pattern Regex or string pattern to match callback data
   * @param handler Callback handler
   */
  onCallback(pattern: string | RegExp, handler: CallbackHandler): void;

  /**
   * Register a file handler
   * Called when files are received
   */
  onFile(handler: FileHandler): void;

  /**
   * Check if a user is authorized
   * @param userId Platform-specific user identifier
   */
  isUserAuthorized(userId: string): boolean;

  /**
   * Get platform-specific info about the bot
   */
  getBotInfo(): Promise<{ id: string; name: string; username?: string }>;
}

/**
 * Platform adapter configuration base
 */
export interface PlatformConfig {
  /** Whether this platform is enabled */
  enabled: boolean;
  /** Authorized user IDs for this platform */
  allowedUsers: string[];
}

/**
 * Event emitter style interface for platforms that need it
 */
export interface PlatformEventEmitter {
  emit(event: "message", data: MessageEvent): void;
  emit(event: "command", data: CommandEvent): void;
  emit(event: "callback", data: CallbackEvent): void;
  emit(event: "file", data: FileEvent): void;
}

/**
 * Helper to create a unified message from platform-specific data
 */
export function createPlatformMessage(
  platform: PlatformType,
  id: string,
  chat: PlatformChat,
  from: PlatformUser,
  text?: string,
  timestamp?: number,
  files?: PlatformFile[]
): PlatformMessage {
  return {
    id,
    platform,
    chat,
    from,
    text,
    timestamp: timestamp ?? Date.now(),
    files,
  };
}

/**
 * Helper to parse command from message text
 */
export function parseCommand(text: string): { command: string; args: string[]; rawArgs: string } | null {
  if (!text.startsWith("/")) return null;

  const match = text.match(/^\/(\S+)\s*(.*)/);
  if (!match) return null;

  const command = match[1].toLowerCase();
  const rawArgs = match[2].trim();
  const args = rawArgs ? rawArgs.split(/\s+/) : [];

  return { command, args, rawArgs };
}
