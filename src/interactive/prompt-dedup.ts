/**
 * Prompt Deduplicator
 *
 * Prevents duplicate prompt detection during polling loops.
 * When the same prompt is detected multiple times, only the first
 * detection triggers the callback - subsequent detections are ignored
 * until the prompt is cleared (after user responds).
 */

import type { DetectedPrompt } from "./types.js";

/**
 * Tracks active prompts to prevent duplicate handling
 */
export class PromptDeduplicator {
  private activePromptHash: string | null = null;

  /**
   * Generate a hash for a prompt based on its content
   * Hash includes: type, question, option labels (in order), and hasOther
   * Does NOT include selection state (which can change during interaction)
   */
  private hashPrompt(prompt: DetectedPrompt): string {
    const optionLabels = prompt.options.map((o) => o.label).join("|");
    return `${prompt.type}:${prompt.question}:${optionLabels}:${prompt.hasOther}`;
  }

  /**
   * Check if a prompt should be handled (is new or changed)
   *
   * @param prompt - The detected prompt, or null/undefined if none detected
   * @returns true if this prompt should be handled, false if it's a duplicate
   */
  shouldHandle(prompt: DetectedPrompt | null | undefined): boolean {
    if (!prompt) {
      return false;
    }

    const hash = this.hashPrompt(prompt);
    if (hash === this.activePromptHash) {
      return false; // Already handling this prompt
    }

    this.activePromptHash = hash;
    return true;
  }

  /**
   * Clear the active prompt hash
   * Call this after a prompt has been responded to or cancelled
   */
  clear(): void {
    this.activePromptHash = null;
  }
}
