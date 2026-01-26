import type { BotContext, Session, DownloadedFile } from "../types.js";
import {
  downloadFile,
  getFileType,
  ensureDirectoryExists,
  readTextFile,
  formatFileForPrompt,
  generateTempFileName,
} from "../utils/files.js";
import { createChildLogger } from "../utils/logger.js";
import { getConfig } from "../config.js";
import { join } from "node:path";

const logger = createChildLogger("file-handler");

/**
 * Construct the Telegram file download URL
 */
export function getTelegramFileUrl(filePath: string, token: string): string {
  return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

/**
 * Ensure the downloads directory exists within the session workspace
 */
export function ensureDownloadDir(workspace: string): string {
  const downloadDir = join(workspace, "downloads");
  ensureDirectoryExists(downloadDir);
  return downloadDir;
}

/**
 * Handle photo messages - get highest resolution and download
 */
export async function handlePhotoMessage(
  ctx: BotContext,
  session: Session
): Promise<string | null> {
  const photos = ctx.message?.photo;

  if (!photos || photos.length === 0) {
    logger.warn("No photos found in photo message");
    return null;
  }

  // Get the highest resolution photo (last element in array)
  const photo = photos[photos.length - 1];
  const fileId = photo.file_id;

  logger.info(
    { fileId, width: photo.width, height: photo.height },
    "Processing photo message"
  );

  try {
    // Get file info from Telegram
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) {
      logger.error({ fileId }, "No file_path returned from Telegram");
      return null;
    }

    // Construct download URL
    const config = getConfig();
    const downloadUrl = getTelegramFileUrl(file.file_path, config.telegram.token);

    // Generate filename with timestamp
    const originalName = file.file_path.split("/").pop() || "photo.jpg";
    const fileName = generateTempFileName(originalName);

    // Ensure download directory exists
    const downloadDir = ensureDownloadDir(session.workspace);

    // Download the file
    const savedPath = await downloadFile(downloadUrl, downloadDir, fileName);

    const downloadedFile: DownloadedFile = {
      path: savedPath,
      mimeType: "image/jpeg", // Telegram photos are always JPEG
      fileName,
      size: file.file_size || 0,
    };

    logger.info({ savedPath, fileName }, "Photo downloaded successfully");

    // Return formatted prompt text for images
    return formatFileForPrompt(downloadedFile);
  } catch (error) {
    const err = error as Error;
    logger.error(
      { fileId, error: err.message, stack: err.stack },
      "Failed to download photo"
    );
    return null;
  }
}

/**
 * Handle document messages - download and detect file type
 */
export async function handleDocumentMessage(
  ctx: BotContext,
  session: Session
): Promise<string | null> {
  const document = ctx.message?.document;

  if (!document) {
    logger.warn("No document found in document message");
    return null;
  }

  const fileId = document.file_id;
  const mimeType = document.mime_type || "application/octet-stream";
  const originalFileName = document.file_name || "document";

  logger.info(
    { fileId, mimeType, originalFileName, size: document.file_size },
    "Processing document message"
  );

  try {
    // Get file info from Telegram
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) {
      logger.error({ fileId }, "No file_path returned from Telegram");
      return null;
    }

    // Construct download URL
    const config = getConfig();
    const downloadUrl = getTelegramFileUrl(file.file_path, config.telegram.token);

    // Generate filename with timestamp
    const fileName = generateTempFileName(originalFileName);

    // Ensure download directory exists
    const downloadDir = ensureDownloadDir(session.workspace);

    // Download the file
    const savedPath = await downloadFile(downloadUrl, downloadDir, fileName);

    const downloadedFile: DownloadedFile = {
      path: savedPath,
      mimeType,
      fileName,
      size: document.file_size || 0,
    };

    logger.info({ savedPath, fileName, mimeType }, "Document downloaded successfully");

    // Detect file type and format accordingly
    const fileType = getFileType(mimeType, fileName);

    if (fileType === "text") {
      // For text files, read content and include in prompt
      try {
        const content = readTextFile(savedPath);
        return `File: ${fileName}\n\`\`\`\n${content}\n\`\`\``;
      } catch (readError) {
        logger.warn(
          { error: (readError as Error).message },
          "Failed to read text file, returning path reference"
        );
        return formatFileForPrompt(downloadedFile);
      }
    }

    // For other file types, return formatted reference
    return formatFileForPrompt(downloadedFile);
  } catch (error) {
    const err = error as Error;
    logger.error(
      { fileId, error: err.message, stack: err.stack },
      "Failed to download document"
    );
    return null;
  }
}

/**
 * Handle audio messages - download and save
 */
export async function handleAudioMessage(
  ctx: BotContext,
  session: Session
): Promise<string | null> {
  // Check for audio, voice, or audio_note (video note without video)
  const audio = ctx.message?.audio || ctx.message?.voice;

  if (!audio) {
    logger.warn("No audio found in audio message");
    return null;
  }

  const fileId = audio.file_id;
  const mimeType = audio.mime_type || "audio/ogg";
  // For voice messages, generate a name; for audio files, use title or filename
  let originalFileName = `audio-${Date.now()}.ogg`;
  if ("file_name" in audio && typeof audio.file_name === "string") {
    originalFileName = audio.file_name;
  } else if ("title" in audio && typeof audio.title === "string") {
    originalFileName = audio.title;
  }

  logger.info(
    { fileId, mimeType, originalFileName, duration: audio.duration },
    "Processing audio message"
  );

  try {
    // Get file info from Telegram
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) {
      logger.error({ fileId }, "No file_path returned from Telegram");
      return null;
    }

    // Construct download URL
    const config = getConfig();
    const downloadUrl = getTelegramFileUrl(file.file_path, config.telegram.token);

    // Generate filename with timestamp
    const fileName = generateTempFileName(originalFileName);

    // Ensure download directory exists
    const downloadDir = ensureDownloadDir(session.workspace);

    // Download the file
    const savedPath = await downloadFile(downloadUrl, downloadDir, fileName);

    const downloadedFile: DownloadedFile = {
      path: savedPath,
      mimeType,
      fileName,
      size: file.file_size || 0,
    };

    logger.info({ savedPath, fileName }, "Audio downloaded successfully");

    return formatFileForPrompt(downloadedFile);
  } catch (error) {
    const err = error as Error;
    logger.error(
      { fileId, error: err.message, stack: err.stack },
      "Failed to download audio"
    );
    return null;
  }
}

/**
 * Handle video messages - download and save
 */
export async function handleVideoMessage(
  ctx: BotContext,
  session: Session
): Promise<string | null> {
  const video = ctx.message?.video || ctx.message?.video_note;

  if (!video) {
    logger.warn("No video found in video message");
    return null;
  }

  const fileId = video.file_id;
  const mimeType =
    "mime_type" in video && typeof video.mime_type === "string"
      ? video.mime_type
      : "video/mp4";
  const originalFileName =
    "file_name" in video && typeof video.file_name === "string"
      ? video.file_name
      : `video-${Date.now()}.mp4`;

  logger.info(
    { fileId, mimeType, originalFileName, duration: video.duration },
    "Processing video message"
  );

  try {
    // Get file info from Telegram
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) {
      logger.error({ fileId }, "No file_path returned from Telegram");
      return null;
    }

    // Construct download URL
    const config = getConfig();
    const downloadUrl = getTelegramFileUrl(file.file_path, config.telegram.token);

    // Generate filename with timestamp
    const fileName = generateTempFileName(originalFileName);

    // Ensure download directory exists
    const downloadDir = ensureDownloadDir(session.workspace);

    // Download the file
    const savedPath = await downloadFile(downloadUrl, downloadDir, fileName);

    const downloadedFile: DownloadedFile = {
      path: savedPath,
      mimeType,
      fileName,
      size: file.file_size || 0,
    };

    logger.info({ savedPath, fileName }, "Video downloaded successfully");

    return formatFileForPrompt(downloadedFile);
  } catch (error) {
    const err = error as Error;
    logger.error(
      { fileId, error: err.message, stack: err.stack },
      "Failed to download video"
    );
    return null;
  }
}

/**
 * Main entry point - process any incoming file in the message
 * Returns formatted string to append to user prompt, or null if no file
 */
export async function processIncomingFile(
  ctx: BotContext,
  session: Session
): Promise<string | null> {
  const message = ctx.message;

  if (!message) {
    return null;
  }

  // Check message type and call appropriate handler
  // Priority: photo > document > audio/voice > video

  if (message.photo && message.photo.length > 0) {
    logger.debug("Detected photo message");
    return handlePhotoMessage(ctx, session);
  }

  if (message.document) {
    logger.debug("Detected document message");
    return handleDocumentMessage(ctx, session);
  }

  if (message.audio || message.voice) {
    logger.debug("Detected audio/voice message");
    return handleAudioMessage(ctx, session);
  }

  if (message.video || message.video_note) {
    logger.debug("Detected video message");
    return handleVideoMessage(ctx, session);
  }

  // No file detected
  return null;
}
