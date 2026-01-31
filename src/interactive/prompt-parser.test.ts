/**
 * Tests for prompt parser
 */

import { describe, it, expect } from "vitest";
import { detectAskUserPrompt, isWaitingForInput, getCurrentSelections } from "./prompt-parser.js";

describe("detectAskUserPrompt", () => {
  it("should detect single-select radio button prompt", () => {
    const output = `
? Which approach do you prefer?
○ Option A - Use the existing pattern
● Option B - Create new abstraction
○ Option C - Refactor everything
○ Other

Use arrow keys to navigate, Enter to select
`;

    const result = detectAskUserPrompt(output);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("single");
    expect(result?.question).toBe("Which approach do you prefer?");
    expect(result?.options).toHaveLength(4);
    expect(result?.options[0].label).toBe("Option A - Use the existing pattern");
    expect(result?.options[0].selected).toBe(false);
    expect(result?.options[1].label).toBe("Option B - Create new abstraction");
    expect(result?.options[1].selected).toBe(true);
    expect(result?.hasOther).toBe(true);
  });

  it("should detect multi-select checkbox prompt", () => {
    const output = `
? Which features do you want to enable?
☑ Logging
☐ Metrics
☑ Tracing
☐ Profiling

Use Space to toggle, Enter to submit
`;

    const result = detectAskUserPrompt(output);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("multi");
    expect(result?.question).toBe("Which features do you want to enable?");
    expect(result?.options).toHaveLength(4);
    expect(result?.options[0].label).toBe("Logging");
    expect(result?.options[0].selected).toBe(true);
    expect(result?.options[1].label).toBe("Metrics");
    expect(result?.options[1].selected).toBe(false);
    expect(result?.options[2].selected).toBe(true);
    expect(result?.hasOther).toBe(false);
  });

  it("should return null for non-prompt output", () => {
    const output = `
Running tests...
✓ All tests passed
❯
`;

    const result = detectAskUserPrompt(output);
    expect(result).toBeNull();
  });

  it("should return null for output without navigation hints", () => {
    const output = `
? Which option?
○ Option A
● Option B
`;

    const result = detectAskUserPrompt(output);
    expect(result).toBeNull();
  });

  it("should handle prompt with ANSI escape codes", () => {
    // Simulated ANSI codes (colors, etc.)
    const output = `
\x1b[1m? Which library?\x1b[0m
\x1b[32m●\x1b[0m React
\x1b[90m○\x1b[0m Vue
\x1b[90m○\x1b[0m Angular

Use arrow keys, Enter to select
`;

    const result = detectAskUserPrompt(output);

    expect(result).not.toBeNull();
    expect(result?.question).toBe("Which library?");
    expect(result?.options).toHaveLength(3);
    expect(result?.options[0].label).toBe("React");
    expect(result?.options[0].selected).toBe(true);
  });

  it("should detect Other option variants", () => {
    const output = `
? Pick one
○ First
○ Second
○ Other (type custom)

Use arrow keys
`;

    const result = detectAskUserPrompt(output);

    expect(result).not.toBeNull();
    expect(result?.hasOther).toBe(true);
  });

  it("should handle question without explicit ? prefix", () => {
    const output = `
Which option do you prefer?
○ Option 1
○ Option 2

Use arrow keys to navigate
`;

    const result = detectAskUserPrompt(output);

    // Question text followed immediately by options should be detected
    expect(result).not.toBeNull();
    expect(result?.question).toBe("Which option do you prefer?");
    expect(result?.options).toHaveLength(2);
  });
});

describe("isWaitingForInput", () => {
  it("should return true when navigation hints present", () => {
    const output = `
Some output
Use arrow keys to navigate
`;

    expect(isWaitingForInput(output)).toBe(true);
  });

  it("should return true when option markers present", () => {
    const output = `
○ Option A
● Option B
`;

    expect(isWaitingForInput(output)).toBe(true);
  });

  it("should return false for regular output", () => {
    const output = `
Processing...
Done!
`;

    expect(isWaitingForInput(output)).toBe(false);
  });

  it("should detect checkbox markers", () => {
    const output = `
☐ Unchecked
☑ Checked
`;

    expect(isWaitingForInput(output)).toBe(true);
  });
});

describe("getCurrentSelections", () => {
  it("should return selected indices for single-select", () => {
    const output = `
? Question
○ A
● B
○ C

Use arrow keys
`;

    const result = getCurrentSelections(output);
    expect(result).toEqual([1]);
  });

  it("should return multiple selected indices for multi-select", () => {
    const output = `
? Features
☑ One
☐ Two
☑ Three
☐ Four

Use Space to toggle, Enter to submit
`;

    const result = getCurrentSelections(output);
    expect(result).toEqual([0, 2]);
  });

  it("should return null for non-prompt output", () => {
    const output = "Just some text";
    expect(getCurrentSelections(output)).toBeNull();
  });
});
