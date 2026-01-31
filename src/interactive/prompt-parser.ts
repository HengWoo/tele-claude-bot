/**
 * Prompt Parser for AskUserQuestion Detection
 *
 * Detects interactive prompts from Claude Code terminal output by pattern matching.
 *
 * Terminal patterns:
 * - Question header: "? Question text"
 * - Radio options (single-select): "○" (unselected) or "●" (selected)
 * - Checkbox options (multi-select): "☐" (unchecked) or "☑" (checked)
 * - Navigation hints: "Use arrow keys", "Space to select", "Enter to submit"
 */

import type { DetectedPrompt, PromptOption } from "./types.js";
import { stripAnsi } from "../tmux/index.js";

// Option markers
const RADIO_UNSELECTED = "○";
const RADIO_SELECTED = "●";
const CHECKBOX_UNCHECKED = "☐";
const CHECKBOX_CHECKED = "☑";

// Patterns for detection
const QUESTION_PATTERN = /^\s*\?\s+(.+?)\s*$/m;
const OPTION_LINE_PATTERN = /^\s*([○●☐☑])\s+(.+?)\s*$/;
const NAVIGATION_HINT_PATTERN = /Use\s+arrow\s+keys|Space\s+to\s+select|Enter\s+to|Press\s+Enter/i;
const OTHER_OPTION_PATTERN = /^Other(\s*\(.*\))?$/i;

/**
 * Detect an AskUserQuestion prompt from terminal output
 *
 * @param paneOutput - Raw terminal output (may include ANSI codes)
 * @returns DetectedPrompt if found, null otherwise
 */
export function detectAskUserPrompt(paneOutput: string): DetectedPrompt | null {
  // Strip ANSI codes for reliable pattern matching
  const cleaned = stripAnsi(paneOutput);
  const lines = cleaned.split("\n");

  // Look for navigation hints first - strong indicator of interactive prompt
  const hasNavigationHint = lines.some((line) => NAVIGATION_HINT_PATTERN.test(line));
  if (!hasNavigationHint) {
    return null;
  }

  // Find the question line
  let questionLine = -1;
  let question = "";

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(QUESTION_PATTERN);
    if (match) {
      questionLine = i;
      question = match[1].trim();
      break;
    }
  }

  if (questionLine === -1) {
    // Try to find question without the "?" prefix (some prompts use different format)
    // Look for text followed by options
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      // Check if next lines have options
      if (trimmed && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (OPTION_LINE_PATTERN.test(nextLine)) {
          questionLine = i;
          question = trimmed;
          break;
        }
      }
    }
  }

  if (!question) {
    return null;
  }

  // Parse options starting from line after question
  const options: PromptOption[] = [];
  let type: "single" | "multi" = "single";
  let hasOther = false;

  for (let i = questionLine + 1; i < lines.length; i++) {
    const line = lines[i].trim();

    // Stop at empty lines, navigation hints, or prompt
    if (!line || NAVIGATION_HINT_PATTERN.test(line) || /^[❯>]\s*$/.test(line)) {
      break;
    }

    const optionMatch = line.match(OPTION_LINE_PATTERN);
    if (optionMatch) {
      const [, marker, label] = optionMatch;

      // Determine prompt type from markers
      if (marker === CHECKBOX_CHECKED || marker === CHECKBOX_UNCHECKED) {
        type = "multi";
      }

      const selected =
        marker === RADIO_SELECTED || marker === CHECKBOX_CHECKED;

      // Check if this is "Other" option
      if (OTHER_OPTION_PATTERN.test(label)) {
        hasOther = true;
      }

      options.push({
        index: options.length,
        label: label.trim(),
        selected,
      });
    }
  }

  // Need at least 2 options for a valid prompt
  if (options.length < 2) {
    return null;
  }

  return {
    type,
    question,
    options,
    hasOther,
    rawOutput: cleaned,
  };
}

/**
 * Check if terminal output indicates Claude is waiting for input
 * This is a lighter-weight check than full prompt detection
 *
 * @param paneOutput - Raw terminal output
 * @returns true if likely waiting for interactive input
 */
export function isWaitingForInput(paneOutput: string): boolean {
  const cleaned = stripAnsi(paneOutput);

  // Check for navigation hints (strong indicator)
  if (NAVIGATION_HINT_PATTERN.test(cleaned)) {
    return true;
  }

  // Check for option markers in recent lines
  const lines = cleaned.split("\n").slice(-20);
  const hasOptionMarkers = lines.some(
    (line) =>
      line.includes(RADIO_UNSELECTED) ||
      line.includes(RADIO_SELECTED) ||
      line.includes(CHECKBOX_UNCHECKED) ||
      line.includes(CHECKBOX_CHECKED)
  );

  return hasOptionMarkers;
}

/**
 * Get current selection state from terminal output
 * Useful for syncing multi-select toggle state
 *
 * @param paneOutput - Raw terminal output
 * @returns Array of selected indices, or null if no prompt detected
 */
export function getCurrentSelections(paneOutput: string): number[] | null {
  const prompt = detectAskUserPrompt(paneOutput);
  if (!prompt) {
    return null;
  }

  return prompt.options
    .filter((opt) => opt.selected)
    .map((opt) => opt.index);
}

/**
 * Get the index of the currently highlighted option
 * (the one the cursor is on)
 *
 * For radio buttons, the selected one is highlighted.
 * For checkboxes, we look for a cursor indicator or the first selected.
 *
 * @param paneOutput - Raw terminal output
 * @returns Current cursor position, or 0 if unknown
 */
export function getCurrentCursorPosition(paneOutput: string): number {
  const prompt = detectAskUserPrompt(paneOutput);
  if (!prompt) {
    return 0;
  }

  // For single-select, selected = cursor position
  if (prompt.type === "single") {
    const selected = prompt.options.find((opt) => opt.selected);
    return selected?.index ?? 0;
  }

  // For multi-select, cursor position is harder to determine
  // Default to first option
  return 0;
}
