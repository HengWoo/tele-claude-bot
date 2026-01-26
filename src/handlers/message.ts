import type { BotContext, Session } from "../types.js";
import { streamToTelegram, sendWithRetry, sendLongMessage } from "../utils/telegram.js";
import { createChildLogger } from "../utils/logger.js";
import { getConfig } from "../config.js";

const logger = createChildLogger("message-handler");

// Interfaces for SessionManager and ClaudeBridge
// These will be implemented in separate modules

export interface SessionManager {
  getActiveSession(userId: number): Session | null;
  createSession(userId: number, name: string, workspace?: string): Session;
  setActiveSession(userId: number, sessionId: string): void;
}

export interface ClaudeBridge {
  sendMessage(session: Session, message: string): AsyncIterable<string>;
  isSessionActive(session: Session): boolean;
}

/**
 * Handle incoming text messages from Telegram
 */
export async function handleTextMessage(
  ctx: BotContext,
  sessionManager: SessionManager,
  claudeBridge: ClaudeBridge
): Promise<void> {
  const userId = ctx.from?.id;
  const messageText = ctx.message?.text;

  if (!userId) {
    logger.warn("Received message without user ID");
    return;
  }

  if (!messageText) {
    logger.warn({ userId }, "Received message without text");
    return;
  }

  logger.info({ userId, messageLength: messageText.length }, "Processing text message");

  try {
    // Get or create active session
    let session = sessionManager.getActiveSession(userId);

    if (!session) {
      const config = getConfig();
      logger.info({ userId }, "No active session, creating default");
      session = sessionManager.createSession(
        userId,
        "default",
        config.claude.defaultWorkspace
      );
      sessionManager.setActiveSession(userId, session.id);
    }

    // Update last used timestamp
    session.lastUsed = Date.now();

    // Check if Claude session is active
    if (!claudeBridge.isSessionActive(session)) {
      logger.info({ userId, sessionId: session.id }, "Starting new Claude session");
    }

    // Stream response from Claude to Telegram
    const responseStream = claudeBridge.sendMessage(session, messageText);
    await streamToTelegram(ctx, responseStream);

    logger.info({ userId, sessionId: session.id }, "Message processed successfully");
  } catch (error) {
    const err = error as Error;
    logger.error(
      { userId, error: err.message, stack: err.stack },
      "Failed to process message"
    );

    // Send error message to user
    try {
      await sendWithRetry(
        ctx,
        `Error processing your message: ${err.message}\n\nPlease try again or use /session new to start a fresh session.`
      );
    } catch (sendError) {
      logger.error(
        { error: (sendError as Error).message },
        "Failed to send error message to user"
      );
    }
  }
}

/**
 * Handle messages with files/documents
 */
export async function handleFileMessage(
  ctx: BotContext,
  sessionManager: SessionManager,
  claudeBridge: ClaudeBridge
): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    logger.warn("Received file message without user ID");
    return;
  }

  // For now, inform user that file handling will be implemented
  await sendWithRetry(
    ctx,
    "File handling is not yet implemented. Please send text messages only for now."
  );
}

/**
 * Handle photo messages
 */
export async function handlePhotoMessage(
  ctx: BotContext,
  sessionManager: SessionManager,
  claudeBridge: ClaudeBridge
): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    logger.warn("Received photo message without user ID");
    return;
  }

  // For now, inform user that photo handling will be implemented
  await sendWithRetry(
    ctx,
    "Photo handling is not yet implemented. Please send text messages only for now."
  );
}
