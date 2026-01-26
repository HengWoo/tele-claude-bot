import * as fs from "node:fs";
import * as path from "node:path";
import type { Session } from "../types.js";
import { createChildLogger } from "../utils/logger.js";

const logger = createChildLogger("storage");

/**
 * Serializable session data for persistence
 */
interface SessionsData {
  sessions: Session[];
  activeSessionName: string | null;
}

/**
 * Save sessions to a JSON file
 * Creates the directory if it doesn't exist
 */
export async function saveSessionsToFile(
  sessions: Map<string, Session>,
  activeSessionName: string | null,
  filePath: string
): Promise<void> {
  const dir = path.dirname(filePath);

  // Create directory if it doesn't exist
  if (!fs.existsSync(dir)) {
    logger.info({ dir }, "Creating data directory");
    fs.mkdirSync(dir, { recursive: true });
  }

  const data: SessionsData = {
    sessions: Array.from(sessions.values()),
    activeSessionName,
  };

  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, json, "utf-8");
  logger.debug({ filePath, sessionCount: sessions.size }, "Sessions saved to file");
}

/**
 * Load sessions from a JSON file
 * Returns empty data if file doesn't exist
 */
export async function loadSessionsFromFile(
  filePath: string
): Promise<{ sessions: Map<string, Session>; activeSessionName: string | null }> {
  if (!fs.existsSync(filePath)) {
    logger.debug({ filePath }, "Sessions file not found, returning empty");
    return { sessions: new Map(), activeSessionName: null };
  }

  try {
    const json = fs.readFileSync(filePath, "utf-8");
    const data: SessionsData = JSON.parse(json);

    const sessions = new Map<string, Session>();
    for (const session of data.sessions) {
      sessions.set(session.name, session);
    }

    logger.info({ filePath, sessionCount: sessions.size }, "Sessions loaded from file");
    return { sessions, activeSessionName: data.activeSessionName };
  } catch (error) {
    logger.error({ error, filePath }, "Failed to load sessions file");
    return { sessions: new Map(), activeSessionName: null };
  }
}

/**
 * Delete the sessions file
 */
export async function deleteSessionsFile(filePath: string): Promise<void> {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    logger.info({ filePath }, "Sessions file deleted");
  }
}
