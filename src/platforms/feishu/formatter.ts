/**
 * Feishu Message Formatter
 * Converts markdown/plain text to Feishu rich text format
 */

import type { RichTextParagraph, RichTextContent, InteractiveCard, CardElement, CardAction } from "./client.js";
import type { InlineButton } from "../types.js";

/**
 * Escape special characters for Feishu text
 */
export function escapeFeishu(text: string): string {
  // Feishu uses minimal escaping
  return text;
}

/**
 * Convert plain text to rich text paragraphs
 */
export function textToRichText(text: string): RichTextParagraph[][] {
  const lines = text.split("\n");
  return lines.map((line) => [{ tag: "text", text: line }]);
}

/**
 * Convert markdown to Feishu rich text content
 * Supports: **bold**, *italic*, `code`, [link](url)
 */
export function markdownToRichText(markdown: string, title?: string): RichTextContent {
  const lines = markdown.split("\n");
  const content: RichTextParagraph[][] = [];

  for (const line of lines) {
    const paragraph: RichTextParagraph[] = [];
    let remaining = line;
    let pos = 0;

    while (pos < remaining.length) {
      // Check for bold **text**
      const boldMatch = remaining.slice(pos).match(/^\*\*(.+?)\*\*/);
      if (boldMatch) {
        paragraph.push({ tag: "text", text: boldMatch[1], style: ["bold"] });
        pos += boldMatch[0].length;
        continue;
      }

      // Check for italic *text*
      const italicMatch = remaining.slice(pos).match(/^\*([^*]+)\*/);
      if (italicMatch) {
        paragraph.push({ tag: "text", text: italicMatch[1], style: ["italic"] });
        pos += italicMatch[0].length;
        continue;
      }

      // Check for inline code `code`
      const codeMatch = remaining.slice(pos).match(/^`([^`]+)`/);
      if (codeMatch) {
        // Feishu doesn't have inline code style, use plain text
        paragraph.push({ tag: "text", text: codeMatch[1] });
        pos += codeMatch[0].length;
        continue;
      }

      // Check for links [text](url)
      const linkMatch = remaining.slice(pos).match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        paragraph.push({ tag: "a", text: linkMatch[1], href: linkMatch[2] });
        pos += linkMatch[0].length;
        continue;
      }

      // Regular character
      const nextSpecial = remaining.slice(pos).search(/[\*`\[]/);
      if (nextSpecial === -1) {
        // No more special chars, add rest of line
        paragraph.push({ tag: "text", text: remaining.slice(pos) });
        break;
      } else if (nextSpecial === 0) {
        // Special char that didn't match a pattern, treat as text
        paragraph.push({ tag: "text", text: remaining[pos] });
        pos++;
      } else {
        // Add text up to next special char
        paragraph.push({ tag: "text", text: remaining.slice(pos, pos + nextSpecial) });
        pos += nextSpecial;
      }
    }

    // Empty line becomes empty paragraph
    if (paragraph.length === 0) {
      paragraph.push({ tag: "text", text: "" });
    }

    content.push(paragraph);
  }

  return { title, content };
}

/**
 * Convert markdown to plain text (strip formatting)
 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    // Remove bold
    .replace(/\*\*(.+?)\*\*/g, "$1")
    // Remove italic
    .replace(/\*([^*]+)\*/g, "$1")
    // Remove inline code
    .replace(/`([^`]+)`/g, "$1")
    // Convert links to text + url
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    // Remove code blocks but keep content
    .replace(/```[\w]*\n([\s\S]*?)```/g, "$1")
    // Clean up excessive newlines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Build an interactive card with buttons
 */
export function buildInteractiveCard(
  text: string,
  buttons?: InlineButton[][],
  title?: string
): InteractiveCard {
  const elements: CardElement[] = [];

  // Add text content
  elements.push({
    tag: "div",
    text: {
      tag: "lark_md",
      content: text,
    },
  });

  // Add buttons if provided
  if (buttons && buttons.length > 0) {
    elements.push({ tag: "hr" });

    for (const row of buttons) {
      const actions: CardAction[] = row.map((button): CardAction => ({
        tag: "button",
        text: { tag: "plain_text", content: button.text },
        type: "default",
        value: { action: button.callbackData || "" },
      }));

      if (actions.length > 0) {
        elements.push({ tag: "action", actions });
      }
    }
  }

  const card: InteractiveCard = {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    elements,
  };

  if (title) {
    card.header = {
      title: { tag: "plain_text", content: title },
      template: "blue",
    };
  }

  return card;
}

/**
 * Build approval card with approve/deny buttons
 */
export function buildApprovalCard(
  toolName: string,
  description: string,
  requestId: string
): InteractiveCard {
  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: { tag: "plain_text", content: `Tool Approval: ${toolName}` },
      template: "orange",
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: description,
        },
      },
      { tag: "hr" },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "Approve" },
            type: "primary",
            value: { action: `hook_approve:${requestId}` },
          },
          {
            tag: "button",
            text: { tag: "plain_text", content: "Deny" },
            type: "danger",
            value: { action: `hook_deny:${requestId}` },
          },
        ],
      },
    ],
  };
}

/**
 * Truncate text to Feishu's limits
 * Feishu has a ~30KB limit for messages
 */
export function truncateForFeishu(text: string, maxLength = 25000): string {
  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength) + "\n\n... [truncated]";
}
