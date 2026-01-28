import { readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createChildLogger } from "../utils/logger.js";

const logger = createChildLogger("approval-context");

const CLAUDE_DIR = join(homedir(), ".claude");
const PENDING_FILE_PREFIX = "tg-pending-";

/**
 * Check if any tg-pending-* file exists in ~/.claude/
 * Indicates a bot-initiated request is in progress
 */
export function hasPendingTelegramRequest(): boolean {
  try {
    if (!existsSync(CLAUDE_DIR)) {
      return false;
    }

    const files = readdirSync(CLAUDE_DIR);
    return files.some((file) => file.startsWith(PENDING_FILE_PREFIX));
  } catch (error) {
    logger.warn(
      { error: (error as Error).message },
      "Failed to check for pending telegram requests"
    );
    return false;
  }
}

/**
 * Get list of pending telegram request files
 */
export function getPendingTelegramFiles(): string[] {
  try {
    if (!existsSync(CLAUDE_DIR)) {
      return [];
    }

    const files = readdirSync(CLAUDE_DIR);
    return files
      .filter((file) => file.startsWith(PENDING_FILE_PREFIX))
      .map((file) => join(CLAUDE_DIR, file));
  } catch (error) {
    logger.warn(
      { error: (error as Error).message },
      "Failed to get pending telegram files"
    );
    return [];
  }
}

/**
 * Clean up stale tg-pending-* files older than maxAgeMs
 * Used on bot startup to remove orphaned files from crashed sessions
 *
 * @param maxAgeMs Maximum age in milliseconds before a file is considered stale (default: 10 minutes)
 * @returns Number of files removed
 */
export function cleanupStalePendingFiles(maxAgeMs = 10 * 60 * 1000): number {
  const now = Date.now();
  let removedCount = 0;

  try {
    if (!existsSync(CLAUDE_DIR)) {
      return 0;
    }

    const files = readdirSync(CLAUDE_DIR);
    const pendingFiles = files.filter((file) =>
      file.startsWith(PENDING_FILE_PREFIX)
    );

    for (const file of pendingFiles) {
      const filePath = join(CLAUDE_DIR, file);
      try {
        const stats = statSync(filePath);
        const fileAge = now - stats.mtimeMs;

        if (fileAge > maxAgeMs) {
          unlinkSync(filePath);
          removedCount++;
          logger.info(
            { file, ageMs: fileAge },
            "Removed stale pending file"
          );
        }
      } catch (fileError) {
        logger.warn(
          { error: (fileError as Error).message, file },
          "Failed to process pending file during cleanup"
        );
      }
    }

    if (removedCount > 0) {
      logger.info(
        { removedCount },
        "Stale pending file cleanup completed"
      );
    }

    return removedCount;
  } catch (error) {
    logger.error(
      { error: (error as Error).message },
      "Failed to cleanup stale pending files"
    );
    return removedCount;
  }
}
