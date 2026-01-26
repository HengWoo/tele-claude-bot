import { v4 as uuidv4 } from "uuid";
import type { Session, NotificationLevel } from "../types.js";
import { createChildLogger } from "../utils/logger.js";
import { saveSessionsToFile, loadSessionsFromFile } from "./storage.js";

const logger = createChildLogger("session-manager");

/**
 * Options for creating a new session
 */
export interface CreateSessionOptions {
  name: string;
  workspace: string;
  approveAll?: boolean;
  notifyLevel?: NotificationLevel;
}

/**
 * Manages multiple Claude sessions with persistence
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private activeSessionName: string | null = null;
  private persistPath: string;
  private initialized = false;

  constructor(persistPath: string) {
    this.persistPath = persistPath;
  }

  /**
   * Initialize the session manager by loading persisted sessions
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const { sessions, activeSessionName } = await loadSessionsFromFile(this.persistPath);
    this.sessions = sessions;
    this.activeSessionName = activeSessionName;
    this.initialized = true;

    logger.info(
      { sessionCount: this.sessions.size, activeSession: this.activeSessionName },
      "Session manager initialized"
    );
  }

  /**
   * Create a new session
   */
  async create(options: CreateSessionOptions): Promise<Session> {
    const { name, workspace, approveAll = false, notifyLevel = "status" } = options;

    if (this.sessions.has(name)) {
      throw new Error(`Session "${name}" already exists`);
    }

    const now = Date.now();
    const session: Session = {
      id: uuidv4(),
      name,
      workspace,
      createdAt: now,
      lastUsed: now,
      approveAll,
      attached: false,
      notifyLevel,
    };

    this.sessions.set(name, session);

    // If this is the first session, make it active
    if (this.sessions.size === 1) {
      this.activeSessionName = name;
    }

    await this.persist();
    logger.info({ sessionName: name, workspace }, "Session created");

    return session;
  }

  /**
   * Switch to a session by name or index
   * Supports numbered access (0, 1, 2...) and named access
   */
  async switch(nameOrIndex: string | number): Promise<Session> {
    let session: Session | undefined;

    if (typeof nameOrIndex === "number") {
      // Access by index
      const sessionList = this.list();
      if (nameOrIndex < 0 || nameOrIndex >= sessionList.length) {
        throw new Error(`Session index ${nameOrIndex} out of range (0-${sessionList.length - 1})`);
      }
      session = sessionList[nameOrIndex];
    } else {
      // Try to parse as number first
      const index = parseInt(nameOrIndex, 10);
      if (!isNaN(index) && index.toString() === nameOrIndex) {
        return this.switch(index);
      }

      // Access by name
      session = this.sessions.get(nameOrIndex);
      if (!session) {
        throw new Error(`Session "${nameOrIndex}" not found`);
      }
    }

    this.activeSessionName = session.name;
    await this.updateLastUsed(session.name);

    logger.info({ sessionName: session.name }, "Switched to session");
    return session;
  }

  /**
   * Get the currently active session
   * Auto-creates a "default" session if none exists
   */
  async getActive(): Promise<Session | null> {
    // Auto-create default session if no sessions exist
    if (this.sessions.size === 0) {
      logger.info("No sessions exist, creating default session");
      const defaultWorkspace = process.cwd();
      await this.create({ name: "default", workspace: defaultWorkspace });
    }

    if (!this.activeSessionName) {
      // If no active session but sessions exist, activate the first one
      const firstSession = this.list()[0];
      if (firstSession) {
        this.activeSessionName = firstSession.name;
        await this.persist();
      }
    }

    if (!this.activeSessionName) {
      return null;
    }

    return this.sessions.get(this.activeSessionName) ?? null;
  }

  /**
   * Get a session by name
   */
  get(name: string): Session | undefined {
    return this.sessions.get(name);
  }

  /**
   * List all sessions sorted by lastUsed (most recent first)
   */
  list(): Session[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.lastUsed - a.lastUsed);
  }

  /**
   * Delete a session by name
   */
  async delete(name: string): Promise<boolean> {
    if (!this.sessions.has(name)) {
      return false;
    }

    this.sessions.delete(name);

    // If the deleted session was active, switch to another or clear
    if (this.activeSessionName === name) {
      const remaining = this.list();
      this.activeSessionName = remaining.length > 0 ? remaining[0].name : null;
    }

    await this.persist();
    logger.info({ sessionName: name }, "Session deleted");

    return true;
  }

  /**
   * Update the lastUsed timestamp for a session
   */
  async updateLastUsed(name: string): Promise<void> {
    const session = this.sessions.get(name);
    if (session) {
      session.lastUsed = Date.now();
      await this.persist();
    }
  }

  /**
   * Update session properties
   */
  async update(name: string, updates: Partial<Pick<Session, "approveAll" | "attached" | "notifyLevel" | "workspace">>): Promise<Session | null> {
    const session = this.sessions.get(name);
    if (!session) {
      return null;
    }

    Object.assign(session, updates);
    await this.persist();
    logger.debug({ sessionName: name, updates }, "Session updated");

    return session;
  }

  /**
   * Get session count
   */
  get count(): number {
    return this.sessions.size;
  }

  /**
   * Check if a session exists
   */
  has(name: string): boolean {
    return this.sessions.has(name);
  }

  /**
   * Persist sessions to storage
   */
  private async persist(): Promise<void> {
    await saveSessionsToFile(this.sessions, this.activeSessionName, this.persistPath);
  }
}

/**
 * Create a session manager instance
 */
export function createSessionManager(persistPath: string): SessionManager {
  return new SessionManager(persistPath);
}
