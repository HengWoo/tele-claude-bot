import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  formatCodeBlock,
  formatInlineCode,
  formatToolHeader,
  formatToHtml,
  formatMarkdownTable,
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

  describe("formatMarkdownTable", () => {
    it("should format a simple table with box-drawing style", () => {
      const lines = ["| A | B |", "|---|---|", "| 1 | 2 |"];
      const result = formatMarkdownTable(lines);
      expect(result).toContain("<pre>");
      expect(result).toContain("A");
      expect(result).toContain("B");
      expect(result).toContain("│"); // Box-drawing separator
      expect(result).toContain("─"); // Box-drawing horizontal
    });

    it("should use vertical card format for wide tables", () => {
      const lines = [
        "| Column One | Column Two | Column Three | Column Four | Column Five |",
        "|------------|------------|--------------|-------------|-------------|",
        "| Value 1    | Value 2    | Value 3      | Value 4     | Value 5     |",
      ];
      const result = formatMarkdownTable(lines);
      expect(result).toContain("<pre>");
      // Card format shows header: value pairs
      expect(result).toContain("Column One");
      expect(result).toContain("│");
      expect(result).toContain("Value 1");
    });

    it("should return empty string for empty input", () => {
      const result = formatMarkdownTable([]);
      expect(result).toBe("");
    });

    it("should handle table without separator row", () => {
      const lines = ["| X | Y |", "| 3 | 4 |"];
      const result = formatMarkdownTable(lines);
      expect(result).toContain("X");
      expect(result).toContain("Y");
      expect(result).not.toContain("─┼─"); // No separator line
    });

    it("should pad columns to equal width", () => {
      const lines = ["| Short | LongerColumn |", "|-------|--------------|", "| A | B |"];
      const result = formatMarkdownTable(lines);
      // The output should have padded cells
      expect(result).toContain("Short");
      expect(result).toContain("LongerColumn");
    });

    it("should recognize separator rows with alignment colons", () => {
      const lines = ["| Left | Center | Right |", "|:-----|:------:|------:|", "| A | B | C |"];
      const result = formatMarkdownTable(lines);
      expect(result).toContain("─"); // Should have separator line after header
      expect(result).not.toContain(":"); // Colons should not appear in output
    });

    it("should handle wide table with only header row", () => {
      const lines = [
        "| Very Long Column Name One | Very Long Column Name Two | Very Long Column Name Three |",
        "|---------------------------|---------------------------|------------------------------|",
      ];
      const result = formatMarkdownTable(lines);
      expect(result).toContain("<pre>");
      expect(result).toContain("Very Long Column Name One");
      expect(result).not.toContain("undefined");
    });

    it("should handle rows with uneven column counts", () => {
      const lines = [
        "| A | B | C |",
        "|---|---|---|",
        "| 1 | 2 |",      // Missing third column
        "| X | Y | Z |",
      ];
      const result = formatMarkdownTable(lines);
      expect(result).toContain("A");
      expect(result).toContain("B");
      expect(result).toContain("C");
      expect(result).toContain("1");
      expect(result).not.toContain("undefined");
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

    describe("pipe tables", () => {
      it("should convert narrow pipe table to box-drawing style", () => {
        const input = "| Name | Age |\n|------|-----|\n| Bob  | 30  |";
        const result = formatToHtml(input);
        expect(result).toContain("<pre>");
        expect(result).toContain("</pre>");
        expect(result).toContain("Name");
        expect(result).toContain("Age");
        expect(result).toContain("Bob");
        expect(result).toContain("30");
        // Should use box-drawing characters for narrow tables
        expect(result).toContain("│");
        expect(result).toContain("─");
      });

      it("should convert wide pipe table to vertical card format", () => {
        const input = "| Column One | Column Two | Column Three | Column Four | Column Five |\n|------------|------------|--------------|-------------|-------------|\n| Value 1    | Value 2    | Value 3      | Value 4     | Value 5     |";
        const result = formatToHtml(input);
        expect(result).toContain("<pre>");
        // Card format shows header: value pairs vertically
        expect(result).toContain("Column One");
        expect(result).toContain("Value 1");
        expect(result).toContain("│"); // Separator between header and value
      });

      it("should handle pipe table without separator row", () => {
        const input = "| A | B |\n| 1 | 2 |";
        const result = formatToHtml(input);
        expect(result).toContain("<pre>");
        expect(result).toContain("A");
        expect(result).toContain("B");
        // No separator line should be added
        expect(result).not.toContain("─┼─");
      });

      it("should escape HTML in table cells", () => {
        const input = "| Tag | Example |\n|-----|----------|\n| div | <div>    |";
        const result = formatToHtml(input);
        expect(result).toContain("&lt;div&gt;");
        expect(result).not.toContain("<div>");
      });

      it("should handle mixed content with pipe table", () => {
        const input = `Some text here

| Col1 | Col2 |
|------|------|
| A    | B    |

And more text after`;
        const result = formatToHtml(input);
        expect(result).toContain("Some text here");
        expect(result).toContain("<pre>");
        expect(result).toContain("And more text after");
      });

      it("should not treat single pipe line as table", () => {
        const input = "This is a | pipe in text";
        const result = formatToHtml(input);
        expect(result).not.toContain("<pre>");
        expect(result).toContain("This is a | pipe in text");
      });

      it("should not treat single pipe table row as table", () => {
        const input = "| Header1 | Header2 |";
        const result = formatToHtml(input);
        expect(result).not.toContain("<pre>");
        expect(result).toContain("| Header1 | Header2 |");
      });

      it("should handle table at end of content", () => {
        const input = "Text before\n| A | B |\n|---|---|\n| 1 | 2 |";
        const result = formatToHtml(input);
        expect(result).toContain("Text before");
        expect(result).toContain("<pre>");
        expect(result).toContain("A");
      });
    });

    describe("box-drawing tables", () => {
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
