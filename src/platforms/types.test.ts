import { describe, it, expect } from "vitest";
import { getSessionKey, parseSessionKey } from "./types.js";

describe("getSessionKey", () => {
  it("creates telegram session key", () => {
    expect(getSessionKey("telegram", "123456789")).toBe("telegram:123456789");
  });

  it("creates feishu session key", () => {
    expect(getSessionKey("feishu", "ou_xxxxx")).toBe("feishu:ou_xxxxx");
  });
});

describe("parseSessionKey", () => {
  it("parses telegram session key", () => {
    const result = parseSessionKey("telegram:123456789");
    expect(result).toEqual({ platform: "telegram", userId: "123456789" });
  });

  it("parses feishu session key", () => {
    const result = parseSessionKey("feishu:ou_xxxxx");
    expect(result).toEqual({ platform: "feishu", userId: "ou_xxxxx" });
  });

  it("returns null for invalid key format", () => {
    expect(parseSessionKey("invalid")).toBeNull();
    expect(parseSessionKey("unknown:123")).toBeNull();
    expect(parseSessionKey("")).toBeNull();
  });

  it("handles colons in userId", () => {
    const result = parseSessionKey("feishu:ou_xxx:yyy");
    expect(result).toEqual({ platform: "feishu", userId: "ou_xxx:yyy" });
  });
});
