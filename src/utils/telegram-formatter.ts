/**
 * Markdown to Telegram HTML formatting utilities
 * Converts Claude's markdown output to Telegram-compatible HTML
 */

import { html } from "telegram-format";

// Re-export escape for external use
export const escapeHtml = html.escape;

/**
 * Check if a line is a markdown table separator row (e.g., |---|---|)
 */
function isSeparatorRow(line: string): boolean {
  // Must start and end with |, contain only |, -, :, and whitespace
  if (!line.startsWith("|") || !line.endsWith("|")) return false;
  // After removing |, should only have -, :, and whitespace
  const inner = line.slice(1, -1);
  return /^[\s\-:|]+$/.test(inner) && inner.includes("-");
}

/**
 * Format a markdown pipe table into monospace pre block
 * - Narrow tables (≤40 chars): horizontal box-drawing style
 * - Wide tables (>40 chars): vertical card format for mobile readability
 */
export function formatMarkdownTable(tableLines: string[]): string {
  // Parse rows into cells
  const rows: string[][] = [];
  let hasSeparator = false;

  for (let i = 0; i < tableLines.length; i++) {
    const line = tableLines[i].trim();
    // Check if this is a separator row (|---|---|)
    if (isSeparatorRow(line)) {
      if (i === 1) hasSeparator = true; // Only mark if it's right after header
      continue; // Skip separator row in output
    }
    // Parse cells: split by |, trim, remove first and last empty elements
    const parts = line.split("|");
    const cells: string[] = [];
    for (let j = 1; j < parts.length - 1; j++) {
      cells.push(parts[j].trim());
    }
    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  if (rows.length === 0) {
    return "";
  }

  // Calculate column widths
  const colCount = Math.max(...rows.map(r => r.length));
  const colWidths: number[] = [];
  for (let col = 0; col < colCount; col++) {
    const maxWidth = Math.max(...rows.map(r => (r[col] || "").length));
    colWidths.push(maxWidth);
  }

  // Calculate total width (columns + separators + padding)
  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0) + (colCount - 1) * 3;

  // Wide tables: use vertical card format for mobile readability
  if (totalWidth > 40 && rows.length > 1) {
    return formatAsCards(rows, hasSeparator);
  }

  // Narrow tables: use horizontal box-drawing style
  const colSep = " │ ";
  const rowSep = "─";
  const crossSep = "─┼─";

  const outputLines: string[] = [];

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    // Pad each cell to column width
    const paddedCells = colWidths.map((width, colIdx) => {
      const cell = row[colIdx] || "";
      return cell.padEnd(width);
    });
    outputLines.push(paddedCells.join(colSep));

    // Add separator after header row if original had one
    if (rowIdx === 0 && hasSeparator) {
      const sepLine = colWidths.map(w => rowSep.repeat(w)).join(crossSep);
      outputLines.push(sepLine);
    }
  }

  return html.monospaceBlock(outputLines.join("\n"));
}

/**
 * Format table rows as vertical cards (for wide tables on mobile)
 */
function formatAsCards(rows: string[][], hasHeader: boolean): string {
  const headers = hasHeader ? rows[0] : rows[0].map((_, i) => `Col ${i + 1}`);
  const dataRows = hasHeader ? rows.slice(1) : rows;

  if (dataRows.length === 0) {
    // Only header, no data - just show header as a simple list
    return html.monospaceBlock(headers.join("\n"));
  }

  // Find max header length for alignment
  const maxHeaderLen = Math.max(...headers.map(h => h.length));

  const cards: string[] = [];
  for (const row of dataRows) {
    const lines: string[] = [];
    for (let i = 0; i < headers.length; i++) {
      const header = (headers[i] || "").padEnd(maxHeaderLen);
      const value = row[i] || "";
      lines.push(`${header} │ ${value}`);
    }
    cards.push(lines.join("\n"));
  }

  // Join cards with separator line
  const separatorWidth = Math.min(maxHeaderLen + 10, 30);
  const cardSeparator = "─".repeat(separatorWidth);

  return html.monospaceBlock(cards.join(`\n${cardSeparator}\n`));
}

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
 * - Pipe tables: | A | B | (converted to monospace)
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

  // Step 3a: Extract and protect markdown pipe tables BEFORE escaping
  const pipeTables: { placeholder: string; html: string }[] = [];
  let pipeTableIndex = 0;

  // Process line by line to find pipe table blocks
  const pipeTableLines = processed.split("\n");
  const afterPipeTableLines: string[] = [];
  let currentPipeTable: string[] = [];
  let inPipeTable = false;

  for (const line of pipeTableLines) {
    const trimmedLine = line.trim();
    // Detect pipe table row: starts and ends with |, has content between
    const isPipeTableRow = /^\|.+\|$/.test(trimmedLine);
    // Detect separator row: |---|---|
    const isSeparator = /^\|[\s:-]+\|[\s:-|]*$/.test(trimmedLine);

    if (isPipeTableRow || isSeparator) {
      if (!inPipeTable) {
        inPipeTable = true;
        currentPipeTable = [];
      }
      currentPipeTable.push(trimmedLine);
    } else {
      if (inPipeTable && currentPipeTable.length >= 2) {
        // Valid table: at least header + separator or header + data
        const placeholder = `\x00PIPETABLE${pipeTableIndex++}\x00`;
        const formatted = formatMarkdownTable(currentPipeTable);
        if (formatted) {
          pipeTables.push({ placeholder, html: formatted });
          afterPipeTableLines.push(placeholder);
        }
      } else if (currentPipeTable.length > 0) {
        // Not a valid table, restore lines
        afterPipeTableLines.push(...currentPipeTable);
      }
      afterPipeTableLines.push(line);
      currentPipeTable = [];
      inPipeTable = false;
    }
  }

  // Flush remaining pipe table
  if (inPipeTable && currentPipeTable.length >= 2) {
    const placeholder = `\x00PIPETABLE${pipeTableIndex++}\x00`;
    const formatted = formatMarkdownTable(currentPipeTable);
    if (formatted) {
      pipeTables.push({ placeholder, html: formatted });
      afterPipeTableLines.push(placeholder);
    }
  } else if (currentPipeTable.length > 0) {
    afterPipeTableLines.push(...currentPipeTable);
  }

  processed = afterPipeTableLines.join("\n");

  // Step 3b: Extract and protect tables (box-drawing characters) BEFORE escaping
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

  // Step 8: Restore pipe tables
  for (const { placeholder, html: htmlContent } of pipeTables) {
    processed = processed.replace(placeholder, htmlContent);
  }

  // Step 9: Restore box-drawing tables
  for (const { placeholder, html: htmlContent } of tables) {
    processed = processed.replace(placeholder, htmlContent);
  }

  // Step 10: Convert list markers to bullets
  processed = processed.replace(/^(\s*)[-•]\s+/gm, "$1• ");

  // Step 11: Clean up excessive newlines
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
