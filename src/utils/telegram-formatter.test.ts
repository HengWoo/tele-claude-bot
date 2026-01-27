import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  formatCodeBlock,
  formatInlineCode,
  formatToolHeader,
  formatToHtml,
  truncateHtml,
} from "./telegram-formatter.js";

describe("telegram-formatter", () => {
  describe("escapeHtml", () => {
    it("should escape HTML special characters", () => {
      expect(escapeHtml("<script>alert('xss')</script>")).toBe(
        "&lt;script&gt;alert('xss')&lt;/script&gt;"
      );
    });

    it("should escape ampersands", () => {
      expect(escapeHtml("foo & bar")).toBe("foo &amp; bar");
    });

    it("should escape angle brackets", () => {
      expect(escapeHtml("a < b > c")).toBe("a &lt; b &gt; c");
    });

    it("should handle multiple escapes", () => {
      expect(escapeHtml("<div>&</div>")).toBe("&lt;div&gt;&amp;&lt;/div&gt;");
    });

    it("should return empty string for empty input", () => {
      expect(escapeHtml("")).toBe("");
    });
  });

  describe("formatCodeBlock", () => {
    it("should format code without language", () => {
      expect(formatCodeBlock("const x = 1;")).toBe(
        "<pre>const x = 1;</pre>"
      );
    });

    it("should format code with language", () => {
      expect(formatCodeBlock("const x = 1;", "typescript")).toBe(
        '<pre><code class="language-typescript">const x = 1;</code></pre>'
      );
    });

    it("should escape HTML in code", () => {
      expect(formatCodeBlock("<div>test</div>")).toBe(
        "<pre>&lt;div&gt;test&lt;/div&gt;</pre>"
      );
    });

    it("should handle multiline code", () => {
      const code = "line1\nline2\nline3";
      expect(formatCodeBlock(code)).toBe(
        "<pre>line1\nline2\nline3</pre>"
      );
    });
  });

  describe("formatInlineCode", () => {
    it("should wrap code in code tags", () => {
      expect(formatInlineCode("variable")).toBe("<code>variable</code>");
    });

    it("should escape HTML in inline code", () => {
      expect(formatInlineCode("<T>")).toBe("<code>&lt;T&gt;</code>");
    });
  });

  describe("formatToolHeader", () => {
    it("should format tool name with emoji and bold", () => {
      expect(formatToolHeader("Bash")).toBe("\u{1F527} <b>Bash</b>");
    });

    it("should escape HTML in tool name", () => {
      expect(formatToolHeader("<script>")).toBe(
        "\u{1F527} <b>&lt;script&gt;</b>"
      );
    });
  });

  describe("formatToHtml - markdown conversion", () => {
    describe("code blocks", () => {
      it("should convert fenced code blocks without language", () => {
        const input = "```\nconst x = 1;\n```";
        const result = formatToHtml(input);
        expect(result).toBe("<pre>const x = 1;</pre>");
      });

      it("should convert fenced code blocks with language", () => {
        const input = "```typescript\nconst x = 1;\n```";
        const result = formatToHtml(input);
        expect(result).toBe('<pre><code class="language-typescript">const x = 1;</code></pre>');
      });

      it("should escape HTML in code blocks", () => {
        const input = "```\n<div>test</div>\n```";
        const result = formatToHtml(input);
        expect(result).toBe("<pre>&lt;div&gt;test&lt;/div&gt;</pre>");
      });

      it("should handle multiline code blocks", () => {
        const input = "```python\nprint(\"hello\")\nprint(\"world\")\n```";
        const result = formatToHtml(input);
        expect(result).toContain('class="language-python"');
        expect(result).toContain("print");
      });
    });

    describe("inline code", () => {
      it("should convert inline code", () => {
        const input = "Use the `console.log` function";
        const result = formatToHtml(input);
        expect(result).toBe("Use the <code>console.log</code> function");
      });

      it("should escape HTML in inline code", () => {
        const input = "The type is `Array<T>`";
        const result = formatToHtml(input);
        expect(result).toContain("<code>Array&lt;T&gt;</code>");
      });

      it("should handle multiple inline codes", () => {
        const input = "Use `foo` and `bar` together";
        const result = formatToHtml(input);
        expect(result).toContain("<code>foo</code>");
        expect(result).toContain("<code>bar</code>");
      });
    });

    describe("bold text", () => {
      it("should convert **bold** to <b>bold</b>", () => {
        const input = "This is **bold** text";
        const result = formatToHtml(input);
        expect(result).toBe("This is <b>bold</b> text");
      });

      it("should convert __bold__ to <b>bold</b>", () => {
        const input = "This is __also bold__ text";
        const result = formatToHtml(input);
        expect(result).toBe("This is <b>also bold</b> text");
      });
    });

    describe("italic text", () => {
      it("should convert *italic* to <i>italic</i>", () => {
        const input = "This is *italic* text";
        const result = formatToHtml(input);
        expect(result).toBe("This is <i>italic</i> text");
      });

      it("should convert _italic_ to <i>italic</i>", () => {
        const input = "This is _also italic_ text";
        const result = formatToHtml(input);
        expect(result).toBe("This is <i>also italic</i> text");
      });
    });

    describe("strikethrough", () => {
      it("should convert ~~strikethrough~~ to <s>strikethrough</s>", () => {
        const input = "This is ~~deleted~~ text";
        const result = formatToHtml(input);
        expect(result).toBe("This is <s>deleted</s> text");
      });
    });

    describe("mixed formatting", () => {
      it("should handle bold and italic together", () => {
        const input = "**bold** and *italic* text";
        const result = formatToHtml(input);
        expect(result).toBe("<b>bold</b> and <i>italic</i> text");
      });

      it("should handle code with bold text", () => {
        const input = "Use `code` with **emphasis**";
        const result = formatToHtml(input);
        expect(result).toContain("<code>code</code>");
        expect(result).toContain("<b>emphasis</b>");
      });

      it("should not process markdown inside code blocks", () => {
        const input = "```\n**not bold**\n```";
        const result = formatToHtml(input);
        expect(result).not.toContain("<b>");
        expect(result).toContain("**not bold**");
      });

      it("should not process markdown inside inline code", () => {
        const input = "The pattern is `**pattern**`";
        const result = formatToHtml(input);
        expect(result).toContain("<code>**pattern**</code>");
      });
    });

    describe("HTML escaping", () => {
      it("should escape HTML in regular text", () => {
        const input = "Compare a < b and c > d";
        expect(formatToHtml(input)).toBe("Compare a &lt; b and c &gt; d");
      });

      it("should escape ampersands in text", () => {
        const input = "foo & bar";
        expect(formatToHtml(input)).toBe("foo &amp; bar");
      });

      it("should escape HTML but not formatting markers", () => {
        const input = "**<script>**";
        const result = formatToHtml(input);
        expect(result).toBe("<b>&lt;script&gt;</b>");
      });
    });

    describe("list formatting", () => {
      it("should format list items with bullets", () => {
        const input = "- First item\n- Second item";
        const result = formatToHtml(input);
        expect(result).toContain("• First item");
        expect(result).toContain("• Second item");
      });

      it("should preserve indented lists", () => {
        const input = "- Item\n  - Subitem";
        const result = formatToHtml(input);
        expect(result).toContain("• Item");
        expect(result).toContain("  • Subitem");
      });
    });

    describe("tables", () => {
      it("should format tables in pre blocks", () => {
        const input = "┌───┬───┐\n│ A │ B │\n└───┴───┘";
        const result = formatToHtml(input);
        expect(result).toContain("<pre>");
        expect(result).toContain("</pre>");
        expect(result).toContain("A");
        expect(result).toContain("B");
      });

      it("should handle mixed content with tables", () => {
        const input = `Summary

┌─────┐
│ Box │
└─────┘

- Point one`;
        const result = formatToHtml(input);
        expect(result).toContain("<pre>");
        expect(result).toContain("• Point one");
      });

      it("should not double-escape HTML in tables", () => {
        const input = "┌─────────┐\n│ a < b   │\n└─────────┘";
        const result = formatToHtml(input);
        // Should have single escape (&lt;) not double (&amp;lt;)
        expect(result).toContain("&lt;");
        expect(result).not.toContain("&amp;lt;");
      });
    });
  });

  describe("truncateHtml", () => {
    it("should not truncate short text", () => {
      const input = "<b>short</b>";
      expect(truncateHtml(input, 100)).toBe(input);
    });

    it("should truncate long text", () => {
      const input = "a".repeat(200);
      const result = truncateHtml(input, 100);
      expect(result.length).toBeLessThan(200);
      expect(result).toContain("[truncated]");
    });

    it("should close unclosed tags", () => {
      const input = "<b>" + "a".repeat(200) + "</b>";
      const result = truncateHtml(input, 50);
      expect(result).toContain("</b>");
      expect(result).toContain("[truncated]");
    });

    it("should handle nested tags", () => {
      const input = "<b><i>" + "a".repeat(200) + "</i></b>";
      const result = truncateHtml(input, 50);
      // Should close both i and b tags
      expect(result).toContain("</i>");
      expect(result).toContain("</b>");
    });

    it("should not cut in the middle of a tag", () => {
      const input = "text<verylongtag>content";
      const result = truncateHtml(input, 10);
      // Should truncate before the incomplete tag
      expect(result).not.toContain("<verylongtag");
    });
  });
});
