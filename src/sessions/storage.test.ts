import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveSessionsToFile, loadSessionsFromFile, deleteSessionsFile } from "./storage.js";
import type { Session } from "../types.js";

describe("session storage", () => {
  const testDir = join(tmpdir(), "tele-bot-test-" + Date.now());
  const testFile = join(testDir, "sessions.json");

  beforeEach(() => {
    // Create test directory
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test file
    if (existsSync(testFile)) {
      unlinkSync(testFile);
    }
  });

  // Helper to create a session
  const createSession = (overrides: Partial<Session> = {}): Session => ({
    id: overrides.id ?? "session-1",
    name: overrides.name ?? "test-session",
    workspace: overrides.workspace ?? "/home/user/projects",
    createdAt: overrides.createdAt ?? Date.now(),
    lastUsed: overrides.lastUsed ?? Date.now(),
    approveAll: overrides.approveAll ?? false,
    attached: overrides.attached ?? false,
    notifyLevel: overrides.notifyLevel ?? "status",
  });

  describe("saveSessionsToFile", () => {
    it("should save sessions to file", async () => {
      const sessions = new Map<string, Session>();
      sessions.set("project-a", createSession({ name: "project-a" }));

      await saveSessionsToFile(sessions, null, testFile);
      expect(existsSync(testFile)).toBe(true);
    });

    it("should save multiple sessions", async () => {
      const sessions = new Map<string, Session>();
      sessions.set("project-a", createSession({ id: "1", name: "project-a" }));
      sessions.set("project-b", createSession({ id: "2", name: "project-b" }));

      await saveSessionsToFile(sessions, "project-a", testFile);
      expect(existsSync(testFile)).toBe(true);
    });

    it("should create parent directories if they don't exist", async () => {
      const nestedFile = join(testDir, "nested", "dir", "sessions.json");
      const sessions = new Map<string, Session>();

      await saveSessionsToFile(sessions, null, nestedFile);
      expect(existsSync(nestedFile)).toBe(true);

      // Cleanup
      unlinkSync(nestedFile);
      rmdirSync(join(testDir, "nested", "dir"));
      rmdirSync(join(testDir, "nested"));
    });
  });

  describe("loadSessionsFromFile", () => {
    it("should load sessions from file", async () => {
      const sessions = new Map<string, Session>();
      const session = createSession({ name: "project-a", workspace: "/projects/a" });
      sessions.set("project-a", session);

      await saveSessionsToFile(sessions, "project-a", testFile);
      const loaded = await loadSessionsFromFile(testFile);

      expect(loaded.sessions.size).toBe(1);
      expect(loaded.sessions.get("project-a")).toBeDefined();
      expect(loaded.sessions.get("project-a")?.workspace).toBe("/projects/a");
      expect(loaded.activeSessionName).toBe("project-a");
    });

    it("should return empty map if file doesn't exist", async () => {
      const loaded = await loadSessionsFromFile("/non/existent/file.json");
      expect(loaded.sessions.size).toBe(0);
      expect(loaded.activeSessionName).toBeNull();
    });

    it("should preserve all session properties", async () => {
      const sessions = new Map<string, Session>();
      const session = createSession({
        id: "uuid-123",
        name: "test",
        workspace: "/test",
        createdAt: 1234567890,
        lastUsed: 1234567899,
        approveAll: true,
        attached: true,
        notifyLevel: "verbose",
      });
      sessions.set("test", session);

      await saveSessionsToFile(sessions, "test", testFile);
      const loaded = await loadSessionsFromFile(testFile);

      const loadedSession = loaded.sessions.get("test");
      expect(loadedSession).toEqual(session);
    });
  });

  describe("deleteSessionsFile", () => {
    it("should delete existing file", async () => {
      const sessions = new Map<string, Session>();
      await saveSessionsToFile(sessions, null, testFile);
      expect(existsSync(testFile)).toBe(true);

      await deleteSessionsFile(testFile);
      expect(existsSync(testFile)).toBe(false);
    });

    it("should not throw if file doesn't exist", async () => {
      await expect(deleteSessionsFile("/non/existent/file.json")).resolves.not.toThrow();
    });
  });

  describe("round-trip", () => {
    it("should preserve data through save and load cycle", async () => {
      const sessions = new Map<string, Session>();
      sessions.set("alpha", createSession({
        id: "uuid-1",
        name: "alpha",
        workspace: "/projects/alpha",
        notifyLevel: "minimal",
      }));
      sessions.set("beta", createSession({
        id: "uuid-2",
        name: "beta",
        workspace: "/projects/beta",
        approveAll: true,
        notifyLevel: "verbose",
      }));

      await saveSessionsToFile(sessions, "alpha", testFile);
      const loaded = await loadSessionsFromFile(testFile);

      expect(loaded.sessions.size).toBe(2);
      expect(loaded.activeSessionName).toBe("alpha");
      expect(loaded.sessions.get("alpha")?.notifyLevel).toBe("minimal");
      expect(loaded.sessions.get("beta")?.approveAll).toBe(true);
    });
  });
});
