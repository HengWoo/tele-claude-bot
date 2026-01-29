import { describe, it, expect } from "vitest";
import {
  markdownToPlainText,
  markdownToRichText,
  truncateForFeishu,
  buildInteractiveCard,
  buildApprovalCard,
} from "./formatter.js";

describe("markdownToPlainText", () => {
  it("removes bold markers", () => {
    expect(markdownToPlainText("**bold text**")).toBe("bold text");
  });

  it("removes italic markers", () => {
    expect(markdownToPlainText("*italic text*")).toBe("italic text");
  });

  it("removes inline code", () => {
    expect(markdownToPlainText("`code here`")).toBe("code here");
  });

  it("converts links to text with url", () => {
    expect(markdownToPlainText("[Click here](https://example.com)")).toBe(
      "Click here (https://example.com)"
    );
  });

  it("removes code blocks but keeps content", () => {
    const input = "```javascript\nconst x = 1;\n```";
    // The regex removes the language identifier and backticks
    const result = markdownToPlainText(input);
    expect(result).toContain("const x = 1;");
  });

  it("handles mixed formatting", () => {
    const input = "**Bold** and *italic* with `code`";
    expect(markdownToPlainText(input)).toBe("Bold and italic with code");
  });

  it("cleans up excessive newlines", () => {
    const input = "Line 1\n\n\n\nLine 2";
    expect(markdownToPlainText(input)).toBe("Line 1\n\nLine 2");
  });
});

describe("markdownToRichText", () => {
  it("converts plain text to paragraphs", () => {
    const result = markdownToRichText("Line 1\nLine 2");
    expect(result.content).toHaveLength(2);
    expect(result.content[0][0]).toEqual({ tag: "text", text: "Line 1" });
    expect(result.content[1][0]).toEqual({ tag: "text", text: "Line 2" });
  });

  it("parses bold text", () => {
    const result = markdownToRichText("**bold**");
    expect(result.content[0][0]).toEqual({
      tag: "text",
      text: "bold",
      style: ["bold"],
    });
  });

  it("parses italic text", () => {
    const result = markdownToRichText("*italic*");
    expect(result.content[0][0]).toEqual({
      tag: "text",
      text: "italic",
      style: ["italic"],
    });
  });

  it("parses links", () => {
    const result = markdownToRichText("[link](https://example.com)");
    expect(result.content[0][0]).toEqual({
      tag: "a",
      text: "link",
      href: "https://example.com",
    });
  });

  it("includes title if provided", () => {
    const result = markdownToRichText("content", "My Title");
    expect(result.title).toBe("My Title");
  });
});

describe("truncateForFeishu", () => {
  it("returns text unchanged if under limit", () => {
    const text = "Short text";
    expect(truncateForFeishu(text)).toBe(text);
  });

  it("truncates and adds marker if over limit", () => {
    const text = "A".repeat(100);
    const result = truncateForFeishu(text, 50);
    expect(result).toBe("A".repeat(50) + "\n\n... [truncated]");
  });

  it("uses default limit of 25000", () => {
    const text = "A".repeat(30000);
    const result = truncateForFeishu(text);
    // Result is 25000 chars + truncation marker, which is less than 30000
    expect(result.length).toBeLessThan(text.length);
    expect(result).toContain("[truncated]");
    // Should start with 25000 'A's
    expect(result.startsWith("A".repeat(25000))).toBe(true);
  });
});

describe("buildInteractiveCard", () => {
  it("creates card with text content", () => {
    const card = buildInteractiveCard("Hello world");

    expect(card.config?.wide_screen_mode).toBe(true);
    expect(card.elements).toHaveLength(1);
    expect(card.elements[0]).toEqual({
      tag: "div",
      text: { tag: "lark_md", content: "Hello world" },
    });
  });

  it("creates card with buttons", () => {
    const buttons = [
      [{ text: "Button 1", callbackData: "action1" }],
      [{ text: "Button 2", callbackData: "action2" }],
    ];
    const card = buildInteractiveCard("Text", buttons);

    // Should have: div, hr, action, action
    expect(card.elements).toHaveLength(4);
    expect(card.elements[1]).toEqual({ tag: "hr" });
    expect(card.elements[2]).toHaveProperty("tag", "action");
  });

  it("includes header with title", () => {
    const card = buildInteractiveCard("Text", undefined, "Card Title");

    expect(card.header).toBeDefined();
    expect(card.header?.title.content).toBe("Card Title");
  });
});

describe("buildApprovalCard", () => {
  it("creates approval card with correct structure", () => {
    const card = buildApprovalCard("Bash", "Execute: ls -la", "req123");

    expect(card.header?.title.content).toBe("Tool Approval: Bash");
    expect(card.header?.template).toBe("orange");

    // Should have: div, hr, action with 2 buttons
    expect(card.elements).toHaveLength(3);

    const actionElement = card.elements[2];
    if (actionElement.tag === "action") {
      expect(actionElement.actions).toHaveLength(2);
      expect(actionElement.actions[0].text.content).toBe("Approve");
      expect(actionElement.actions[0].value.action).toBe("hook_approve:req123");
      expect(actionElement.actions[1].text.content).toBe("Deny");
      expect(actionElement.actions[1].value.action).toBe("hook_deny:req123");
    }
  });
});
