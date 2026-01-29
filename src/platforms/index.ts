/**
 * Platform module exports
 */

// Types
export type {
  PlatformType,
  PlatformUser,
  PlatformChat,
  PlatformMessage,
  PlatformFile,
  SendOptions,
  InlineButton,
  ParsedCommand,
  PlatformEventType,
  PlatformEvent,
  MessageEvent,
  CommandEvent,
  CallbackEvent,
  FileEvent,
} from "./types.js";

export { getSessionKey, parseSessionKey } from "./types.js";

// Interfaces
export type {
  PlatformAdapter,
  PlatformConfig,
  PlatformEventEmitter,
  MessageHandler,
  CommandHandler,
  CallbackHandler,
  FileHandler,
  SentMessage,
} from "./interface.js";

export { createPlatformMessage, parseCommand } from "./interface.js";
