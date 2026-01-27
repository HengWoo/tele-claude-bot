/**
 * Markdown to Telegram HTML formatting utilities
 * Converts Claude's markdown output to Telegram-compatible HTML
 */

import { html } from "telegram-format";

// Re-export escape for external use
export const escapeHtml = html.escape;

/**
 * Format a code block with optional language
 */
export function formatCodeBlock(code: string, lang?: string): string {
  return html.monospaceBlock(code, lang);
}

/**
 * Format inline code
 */
export function formatInlineCode(code: string): string {
  return html.monospace(code);
}

/**
 * Format tool invocation header
 */
export function formatToolHeader(toolName: string): string {
  return `🔧 ${html.bold(html.escape(toolName))}`;
}

/**
 * Convert markdown to Telegram HTML
 * Handles:
 * - Code blocks: ```lang\ncode\n```
 * - Inline code: `code`
 * - Bold: **text** or __text__
 * - Italic: *text* or _text_ (single)
 * - Strikethrough: ~~text~~
 * - Tables (box-drawing characters)
 * - Escape HTML in non-code text
 */
export function formatToHtml(text: string): string {
  // Step 1: Extract and protect code blocks
  const codeBlocks: { placeholder: string; html: string }[] = [];
  let blockIndex = 0;

  // Match fenced code blocks: ```lang\ncode\n```
  let processed = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const placeholder = `\x00CODEBLOCK${blockIndex++}\x00`;
    // Don't escape HTML inside code blocks - telegram-format handles it
    const formatted = lang
      ? html.monospaceBlock(code.trim(), lang)
      : html.monospaceBlock(code.trim());
    codeBlocks.push({ placeholder, html: formatted });
    return placeholder;
  });

  // Step 2: Extract and protect inline code: `code`
  const inlineCodes: { placeholder: string; html: string }[] = [];
  let inlineIndex = 0;

  processed = processed.replace(/`([^`\n]+)`/g, (_match, code) => {
    const placeholder = `\x00INLINE${inlineIndex++}\x00`;
    const formatted = html.monospace(code);
    inlineCodes.push({ placeholder, html: formatted });
    return placeholder;
  });

  // Step 3: Extract and protect tables (box-drawing characters) BEFORE escaping
  // This prevents double-escaping when wrapping tables in <pre>
  const tables: { placeholder: string; html: string }[] = [];
  let tableIndex = 0;

  // Process line by line to find table blocks
  const lines = processed.split("\n");
  const processedLines: string[] = [];
  let tableLines: string[] = [];
  let inTable = false;

  for (const line of lines) {
    // Detect table lines (box-drawing chars only - not markdown pipes which have formatting inside)
    const isTableLine = /[│┌┐└┘├┤┬┴┼─═║╔╗╚╝╠╣╦╩╬]/.test(line);

    if (isTableLine) {
      if (!inTable) {
        inTable = true;
        tableLines = [];
      }
      // Clean the line for display
      let cleaned = line
        .replace(/[┌┐└┘├┤┬┴┼─═╔╗╚╝╠╣╦╩╬]/g, "")
        .replace(/[│]/g, " │ ")
        .replace(/ +/g, " ")
        .trim();
      if (cleaned && !/^[│\s]*$/.test(cleaned)) {
        tableLines.push(cleaned);
      }
    } else {
      if (inTable && tableLines.length > 0) {
        // Create placeholder for table and format it now (before HTML escaping)
        const placeholder = `\x00TABLE${tableIndex++}\x00`;
        const formatted = html.monospaceBlock(tableLines.join("\n"));
        tables.push({ placeholder, html: formatted });
        processedLines.push(placeholder);
        tableLines = [];
        inTable = false;
      }
      processedLines.push(line);
    }
  }

  // Flush remaining table
  if (inTable && tableLines.length > 0) {
    const placeholder = `\x00TABLE${tableIndex++}\x00`;
    const formatted = html.monospaceBlock(tableLines.join("\n"));
    tables.push({ placeholder, html: formatted });
    processedLines.push(placeholder);
  }

  processed = processedLines.join("\n");

  // Step 4: Escape HTML in remaining text (before applying formatting)
  processed = html.escape(processed);

  // Step 5: Apply markdown formatting (order matters!)

  // Bold: **text** or __text__
  processed = processed.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  processed = processed.replace(/__(.+?)__/g, '<b>$1</b>');

  // Strikethrough: ~~text~~
  processed = processed.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // Italic: *text* or _text_
  // Since bold (**) is already processed, remaining single * are italic
  processed = processed.replace(/\*([^*]+)\*/g, '<i>$1</i>');
  processed = processed.replace(/(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, '<i>$1</i>');

  // Step 6: Restore inline code
  for (const { placeholder, html: htmlContent } of inlineCodes) {
    processed = processed.replace(placeholder, htmlContent);
  }

  // Step 7: Restore code blocks
  for (const { placeholder, html: htmlContent } of codeBlocks) {
    processed = processed.replace(placeholder, htmlContent);
  }

  // Step 8: Restore tables
  for (const { placeholder, html: htmlContent } of tables) {
    processed = processed.replace(placeholder, htmlContent);
  }

  // Step 9: Convert list markers to bullets
  processed = processed.replace(/^(\s*)[-•]\s+/gm, "$1• ");

  // Step 10: Clean up excessive newlines
  processed = processed.replace(/\n{3,}/g, "\n\n");

  return processed.trim();
}

/**
 * Truncate HTML safely, preserving tag balance
 */
export function truncateHtml(htmlText: string, maxLength: number): string {
  if (htmlText.length <= maxLength) {
    return htmlText;
  }

  let truncated = htmlText.slice(0, maxLength);

  // Don't cut in the middle of an HTML tag
  const lastOpen = truncated.lastIndexOf("<");
  const lastClose = truncated.lastIndexOf(">");
  if (lastOpen > lastClose) {
    truncated = truncated.slice(0, lastOpen);
  }

  // Track and close open tags
  const openTags: string[] = [];
  const tagPattern = /<\/?(\w+)[^>]*>/g;
  let match;

  while ((match = tagPattern.exec(truncated)) !== null) {
    const [fullMatch, tagName] = match;
    if (fullMatch.startsWith("</")) {
      const idx = openTags.lastIndexOf(tagName.toLowerCase());
      if (idx !== -1) openTags.splice(idx, 1);
    } else if (!fullMatch.endsWith("/>")) {
      openTags.push(tagName.toLowerCase());
    }
  }

  const closingTags = openTags.reverse().map(t => `</${t}>`).join("");
  return truncated + "\n\n... [truncated]" + closingTags;
}
