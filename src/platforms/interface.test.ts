import { describe, it, expect } from "vitest";
import { parseCommand, createPlatformMessage } from "./interface.js";

describe("parseCommand", () => {
  it("parses simple command", () => {
    const result = parseCommand("/start");
    expect(result).toEqual({
      command: "start",
      args: [],
      rawArgs: "",
    });
  });

  it("parses command with single argument", () => {
    const result = parseCommand("/attach 1:0.0");
    expect(result).toEqual({
      command: "attach",
      args: ["1:0.0"],
      rawArgs: "1:0.0",
    });
  });

  it("parses command with multiple arguments", () => {
    const result = parseCommand("/new myproject ~/projects/app");
    expect(result).toEqual({
      command: "new",
      args: ["myproject", "~/projects/app"],
      rawArgs: "myproject ~/projects/app",
    });
  });

  it("converts command to lowercase", () => {
    const result = parseCommand("/START");
    expect(result?.command).toBe("start");
  });

  it("returns null for non-command text", () => {
    expect(parseCommand("hello world")).toBeNull();
    expect(parseCommand("")).toBeNull();
    expect(parseCommand("/ start")).toBeNull();
  });

  it("handles extra whitespace", () => {
    const result = parseCommand("/cmd   arg1   arg2");
    expect(result).toEqual({
      command: "cmd",
      args: ["arg1", "arg2"],
      rawArgs: "arg1   arg2",
    });
  });
});

describe("createPlatformMessage", () => {
  it("creates message with all fields", () => {
    const chat = { id: "chat1", platform: "telegram" as const, type: "private" as const };
    const from = { id: "user1", platform: "telegram" as const, name: "Test User" };
    const timestamp = Date.now();

    const message = createPlatformMessage(
      "telegram",
      "msg1",
      chat,
      from,
      "Hello world",
      timestamp
    );

    expect(message).toEqual({
      id: "msg1",
      platform: "telegram",
      chat,
      from,
      text: "Hello world",
      timestamp,
      files: undefined,
    });
  });

  it("uses current time if timestamp not provided", () => {
    const chat = { id: "chat1", platform: "feishu" as const, type: "private" as const };
    const from = { id: "user1", platform: "feishu" as const };
    const before = Date.now();

    const message = createPlatformMessage("feishu", "msg1", chat, from, "Hi");

    expect(message.timestamp).toBeGreaterThanOrEqual(before);
    expect(message.timestamp).toBeLessThanOrEqual(Date.now());
  });

  it("handles undefined text", () => {
    const chat = { id: "chat1", platform: "telegram" as const, type: "group" as const };
    const from = { id: "user1", platform: "telegram" as const };

    const message = createPlatformMessage("telegram", "msg1", chat, from, undefined);

    expect(message.text).toBeUndefined();
  });
});
