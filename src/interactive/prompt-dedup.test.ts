/**
 * Tests for PromptDeduplicator
 *
 * Ensures prompts are deduplicated to prevent duplicate UI elements
 * when the same prompt is detected multiple times during polling.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PromptDeduplicator } from "./prompt-dedup.js";
import type { DetectedPrompt } from "./types.js";

describe("PromptDeduplicator", () => {
  let dedup: PromptDeduplicator;

  const createPrompt = (overrides: Partial<DetectedPrompt> = {}): DetectedPrompt => ({
    type: "single",
    question: "Which option do you prefer?",
    options: [
      { index: 0, label: "Option A", selected: false },
      { index: 1, label: "Option B", selected: false },
    ],
    hasOther: false,
    ...overrides,
  });

  beforeEach(() => {
    dedup = new PromptDeduplicator();
  });

  it("should return true for first detection of a prompt", () => {
    const prompt = createPrompt();
    expect(dedup.shouldHandle(prompt)).toBe(true);
  });

  it("should return false for same prompt detected again", () => {
    const prompt = createPrompt();
    dedup.shouldHandle(prompt); // first time
    expect(dedup.shouldHandle(prompt)).toBe(false); // second time
  });

  it("should return true for different prompt question", () => {
    const prompt1 = createPrompt({ question: "First question?" });
    const prompt2 = createPrompt({ question: "Second question?" });

    dedup.shouldHandle(prompt1);
    expect(dedup.shouldHandle(prompt2)).toBe(true);
  });

  it("should return true for same question but different options", () => {
    const prompt1 = createPrompt({
      options: [
        { index: 0, label: "Option A", selected: false },
        { index: 1, label: "Option B", selected: false },
      ],
    });
    const prompt2 = createPrompt({
      options: [
        { index: 0, label: "Option X", selected: false },
        { index: 1, label: "Option Y", selected: false },
      ],
    });

    dedup.shouldHandle(prompt1);
    expect(dedup.shouldHandle(prompt2)).toBe(true);
  });

  it("should return true for same question but different type", () => {
    const prompt1 = createPrompt({ type: "single" });
    const prompt2 = createPrompt({ type: "multi" });

    dedup.shouldHandle(prompt1);
    expect(dedup.shouldHandle(prompt2)).toBe(true);
  });

  it("should return true after clear() is called", () => {
    const prompt = createPrompt();

    dedup.shouldHandle(prompt);
    expect(dedup.shouldHandle(prompt)).toBe(false); // cached

    dedup.clear();
    expect(dedup.shouldHandle(prompt)).toBe(true); // cleared
  });

  it("should return false for null prompt", () => {
    expect(dedup.shouldHandle(null)).toBe(false);
  });

  it("should return false for undefined prompt", () => {
    expect(dedup.shouldHandle(undefined)).toBe(false);
  });

  it("should differentiate based on option order", () => {
    const prompt1 = createPrompt({
      options: [
        { index: 0, label: "A", selected: false },
        { index: 1, label: "B", selected: false },
      ],
    });
    const prompt2 = createPrompt({
      options: [
        { index: 0, label: "B", selected: false },
        { index: 1, label: "A", selected: false },
      ],
    });

    dedup.shouldHandle(prompt1);
    expect(dedup.shouldHandle(prompt2)).toBe(true); // different order = different prompt
  });

  it("should not be affected by selection state changes", () => {
    const prompt1 = createPrompt({
      options: [
        { index: 0, label: "A", selected: false },
        { index: 1, label: "B", selected: false },
      ],
    });
    const prompt2 = createPrompt({
      options: [
        { index: 0, label: "A", selected: true }, // selection changed
        { index: 1, label: "B", selected: false },
      ],
    });

    dedup.shouldHandle(prompt1);
    // Same labels, just selection state changed - should be treated as same prompt
    expect(dedup.shouldHandle(prompt2)).toBe(false);
  });

  it("should handle prompts with hasOther flag", () => {
    const prompt1 = createPrompt({ hasOther: false });
    const prompt2 = createPrompt({ hasOther: true });

    dedup.shouldHandle(prompt1);
    // hasOther changes the prompt structure, should be different
    expect(dedup.shouldHandle(prompt2)).toBe(true);
  });

  it("should handle rapid successive calls with same prompt", () => {
    const prompt = createPrompt();

    // Simulate rapid polling
    expect(dedup.shouldHandle(prompt)).toBe(true);  // 1st
    expect(dedup.shouldHandle(prompt)).toBe(false); // 2nd
    expect(dedup.shouldHandle(prompt)).toBe(false); // 3rd
    expect(dedup.shouldHandle(prompt)).toBe(false); // 4th
    expect(dedup.shouldHandle(prompt)).toBe(false); // 5th
  });

  it("should allow new prompt after previous prompt was handled", () => {
    const prompt1 = createPrompt({ question: "First?" });
    const prompt2 = createPrompt({ question: "Second?" });

    expect(dedup.shouldHandle(prompt1)).toBe(true);
    dedup.clear(); // user responded to prompt1
    expect(dedup.shouldHandle(prompt2)).toBe(true);
  });
});
