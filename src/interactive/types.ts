/**
 * Types for interactive prompt handling
 * Supports AskUserQuestion prompts from Claude Code
 */

/**
 * Detected option from terminal output
 */
export interface PromptOption {
  /** Zero-based index for navigation */
  index: number;
  /** Display label (e.g., "Option A - description") */
  label: string;
  /** Whether currently selected in terminal */
  selected: boolean;
  /** Optional description text */
  description?: string;
}

/**
 * Detected interactive prompt from terminal
 */
export interface DetectedPrompt {
  /** Prompt type: single-select (radio) or multi-select (checkbox) */
  type: "single" | "multi";
  /** Question header text */
  question: string;
  /** Available options */
  options: PromptOption[];
  /** Whether "Other" free-text option is available */
  hasOther: boolean;
  /** Raw terminal output for debugging */
  rawOutput?: string;
}

/**
 * User's response to an interactive prompt
 */
export interface PromptResponse {
  /** Selected option indices (single element for single-select) */
  selectedIndices: number[];
  /** True if user chose "Other" option */
  isOther: boolean;
  /** Custom text if user chose "Other" */
  customText?: string;
}

/**
 * State for tracking pending prompts per user
 */
export interface PendingPrompt {
  /** The detected prompt */
  prompt: DetectedPrompt;
  /** User ID who triggered the prompt */
  userId: string;
  /** tmux pane ID for injection */
  paneId: string;
  /** tmux target for navigation */
  target: string;
  /** Chat ID for messaging */
  chatId: string;
  /** Message ID of the prompt message (for editing) */
  messageId?: string | number;
  /** Timestamp for timeout tracking */
  timestamp: number;
  /** For multi-select: currently toggled indices */
  toggledIndices?: Set<number>;
  /** For "Other": waiting for custom text input */
  awaitingTextInput?: boolean;
}

/**
 * Callback function type for interactive prompts
 * Called by the tmux bridge when a prompt is detected
 *
 * @param prompt - The detected prompt
 * @param userId - User ID
 * @param paneId - Stable pane ID (e.g., "%4")
 * @param target - tmux target (e.g., "1:0.0")
 * @param chatId - Platform chat ID
 * @returns Promise that resolves when user responds
 */
export type InteractiveCallback = (
  prompt: DetectedPrompt,
  userId: string,
  paneId: string,
  target: string,
  chatId: number
) => Promise<PromptResponse | null>;
