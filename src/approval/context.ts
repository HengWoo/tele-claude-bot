import { readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createChildLogger } from "../utils/logger.js";
import type { Platform } from "../tmux/bridge.js";

const logger = createChildLogger("approval-context");

const CLAUDE_DIR = join(homedir(), ".claude");

/**
 * Get the pending file prefix for a platform
 */
function getPendingPrefix(platform: Platform): string {
  return `${platform}-pending-`;
}

/**
 * Check if any pending file exists for the given platform in ~/.claude/
 * Indicates a bot-initiated request is in progress
 */
export function hasPendingRequest(platform: Platform): boolean {
  try {
    if (!existsSync(CLAUDE_DIR)) {
      return false;
    }

    const prefix = getPendingPrefix(platform);
    const files = readdirSync(CLAUDE_DIR);
    return files.some((file) => file.startsWith(prefix));
  } catch (error) {
    logger.warn(
      { error: (error as Error).message, platform },
      "Failed to check for pending requests"
    );
    return false;
  }
}

/**
 * Get list of pending request files for the given platform
 */
export function getPendingFiles(platform: Platform): string[] {
  try {
    if (!existsSync(CLAUDE_DIR)) {
      return [];
    }

    const prefix = getPendingPrefix(platform);
    const files = readdirSync(CLAUDE_DIR);
    return files
      .filter((file) => file.startsWith(prefix))
      .map((file) => join(CLAUDE_DIR, file));
  } catch (error) {
    logger.warn(
      { error: (error as Error).message, platform },
      "Failed to get pending files"
    );
    return [];
  }
}

/**
 * Clean up stale pending files for the given platform older than maxAgeMs
 * Used on bot startup to remove orphaned files from crashed sessions
 *
 * @param platform The platform to clean up files for
 * @param maxAgeMs Maximum age in milliseconds before a file is considered stale (default: 10 minutes)
 * @returns Number of files removed
 */
export function cleanupStalePendingFiles(platform: Platform, maxAgeMs = 10 * 60 * 1000): number {
  const now = Date.now();
  let removedCount = 0;
  const prefix = getPendingPrefix(platform);

  try {
    if (!existsSync(CLAUDE_DIR)) {
      return 0;
    }

    const files = readdirSync(CLAUDE_DIR);
    const pendingFiles = files.filter((file) =>
      file.startsWith(prefix)
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
            { platform, file, ageMs: fileAge },
            "Removed stale pending file"
          );
        }
      } catch (fileError) {
        logger.warn(
          { platform, error: (fileError as Error).message, file },
          "Failed to process pending file during cleanup"
        );
      }
    }

    if (removedCount > 0) {
      logger.info(
        { platform, removedCount },
        "Stale pending file cleanup completed"
      );
    }

    return removedCount;
  } catch (error) {
    logger.error(
      { platform, error: (error as Error).message },
      "Failed to cleanup stale pending files"
    );
    return removedCount;
  }
}
