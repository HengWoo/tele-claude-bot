import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { PolicyRule, PolicyAction, ApprovalPolicy } from "../types.js";

// Project root directory (works in both ESM and compiled scenarios)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const POLICY_FILE_PATH = path.join(PROJECT_ROOT, "data", "approval-policy.json");

/**
 * Dangerous patterns that should be auto-denied
 * These patterns match against tool input strings
 */
const DANGEROUS_PATTERNS: PolicyRule[] = [
  {
    pattern: "rm\\s+-rf\\s+/",
    action: "auto-deny",
    description: "Dangerous recursive deletion from root",
  },
  {
    pattern: "rm\\s+-rf\\s+~",
    action: "auto-deny",
    description: "Dangerous recursive deletion of home directory",
  },
  {
    pattern: "rm\\s+-rf\\s+\\*",
    action: "auto-deny",
    description: "Dangerous recursive deletion with wildcard",
  },
  {
    pattern: "sudo\\s+rm",
    action: "auto-deny",
    description: "Sudo removal commands",
  },
  {
    pattern: "mkfs\\.",
    action: "auto-deny",
    description: "Filesystem formatting commands",
  },
  {
    pattern: "dd\\s+if=.*of=/dev/",
    action: "auto-deny",
    description: "Direct disk write operations",
  },
  {
    pattern: ":(){ :|:& };:",
    action: "auto-deny",
    description: "Fork bomb",
  },
  {
    pattern: "DROP\\s+TABLE",
    action: "auto-deny",
    description: "SQL DROP TABLE",
  },
  {
    pattern: "DROP\\s+DATABASE",
    action: "auto-deny",
    description: "SQL DROP DATABASE",
  },
  {
    pattern: "TRUNCATE\\s+TABLE",
    action: "auto-deny",
    description: "SQL TRUNCATE TABLE",
  },
  {
    pattern: "DELETE\\s+FROM\\s+\\w+\\s*;?$",
    action: "auto-deny",
    description: "SQL DELETE without WHERE clause",
  },
  {
    pattern: "chmod\\s+-R\\s+777",
    action: "auto-deny",
    description: "Recursive permission change to world-writable",
  },
  {
    pattern: "curl.*\\|\\s*(ba)?sh",
    action: "auto-deny",
    description: "Piping curl to shell",
  },
  {
    pattern: "wget.*\\|\\s*(ba)?sh",
    action: "auto-deny",
    description: "Piping wget to shell",
  },
  {
    pattern: ">\\s*/dev/sda",
    action: "auto-deny",
    description: "Direct write to disk device",
  },
  {
    pattern: "shutdown",
    action: "auto-deny",
    description: "System shutdown command",
  },
  {
    pattern: "reboot",
    action: "auto-deny",
    description: "System reboot command",
  },
  {
    pattern: "init\\s+0",
    action: "auto-deny",
    description: "System halt via init",
  },
];

/**
 * Safe read-only tools that should be auto-approved
 */
const SAFE_TOOL_PATTERNS: PolicyRule[] = [
  {
    pattern: "^Read$",
    action: "auto-approve",
    description: "Read tool - file reading",
  },
  {
    pattern: "^Glob$",
    action: "auto-approve",
    description: "Glob tool - file pattern matching",
  },
  {
    pattern: "^Grep$",
    action: "auto-approve",
    description: "Grep tool - content searching",
  },
  {
    pattern: "^TaskList$",
    action: "auto-approve",
    description: "TaskList tool - listing tasks",
  },
  {
    pattern: "^TaskGet$",
    action: "auto-approve",
    description: "TaskGet tool - getting task details",
  },
  {
    pattern: "^WebSearch$",
    action: "auto-approve",
    description: "WebSearch tool - web searching",
  },
];

/**
 * Default approval policy
 */
export const DEFAULT_POLICY: ApprovalPolicy = {
  rules: [...DANGEROUS_PATTERNS, ...SAFE_TOOL_PATTERNS],
  defaultAction: "require-approval",
  timeoutSeconds: 300,
};

/**
 * Load approval policy from config file
 * Returns default policy if file doesn't exist or is invalid
 */
export function loadPolicy(): ApprovalPolicy {
  try {
    if (!fs.existsSync(POLICY_FILE_PATH)) {
      return DEFAULT_POLICY;
    }

    const content = fs.readFileSync(POLICY_FILE_PATH, "utf-8");
    const loaded = JSON.parse(content) as Partial<ApprovalPolicy>;

    // Validate and merge with defaults
    return {
      rules: Array.isArray(loaded.rules) ? loaded.rules : DEFAULT_POLICY.rules,
      defaultAction:
        loaded.defaultAction &&
        ["auto-approve", "auto-deny", "require-approval"].includes(
          loaded.defaultAction
        )
          ? loaded.defaultAction
          : DEFAULT_POLICY.defaultAction,
      timeoutSeconds:
        typeof loaded.timeoutSeconds === "number" && loaded.timeoutSeconds > 0
          ? loaded.timeoutSeconds
          : DEFAULT_POLICY.timeoutSeconds,
    };
  } catch {
    // Return defaults on any error (file not found, parse error, etc.)
    return DEFAULT_POLICY;
  }
}

/**
 * Save approval policy to config file
 */
export function savePolicy(policy: ApprovalPolicy): void {
  // Ensure data directory exists
  const dataDir = path.dirname(POLICY_FILE_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(POLICY_FILE_PATH, JSON.stringify(policy, null, 2), "utf-8");
}

/**
 * Convert tool input to a searchable string for pattern matching
 */
function toolInputToString(toolInput: unknown): string {
  if (typeof toolInput === "string") {
    return toolInput;
  }
  if (toolInput === null || toolInput === undefined) {
    return "";
  }
  if (typeof toolInput === "object") {
    // For Bash tool, check the command field
    const input = toolInput as Record<string, unknown>;
    if (typeof input.command === "string") {
      return input.command;
    }
    // For other tools, stringify the entire input
    return JSON.stringify(toolInput);
  }
  return String(toolInput);
}

/**
 * Check if a pattern matches against tool name or input
 */
function matchesPattern(
  pattern: string,
  toolName: string,
  toolInputStr: string
): boolean {
  try {
    const regex = new RegExp(pattern, "i");
    return regex.test(toolName) || regex.test(toolInputStr);
  } catch {
    // Invalid regex pattern - treat as no match
    return false;
  }
}

/**
 * Evaluate policy rules against a tool use request
 * Returns the action to take based on the first matching rule
 */
export function evaluatePolicy(
  toolName: string,
  toolInput: unknown,
  policy: ApprovalPolicy
): PolicyAction {
  const toolInputStr = toolInputToString(toolInput);

  // Check rules in order - first match wins
  for (const rule of policy.rules) {
    if (matchesPattern(rule.pattern, toolName, toolInputStr)) {
      return rule.action;
    }
  }

  // No rule matched - return default action
  return policy.defaultAction;
}

/**
 * Check if a tool use should be auto-approved
 * Uses the loaded policy (or default if not loaded)
 */
export function shouldAutoApprove(
  toolName: string,
  toolInput: unknown
): boolean {
  const policy = loadPolicy();
  return evaluatePolicy(toolName, toolInput, policy) === "auto-approve";
}

/**
 * Check if a tool use should be auto-denied
 * Uses the loaded policy (or default if not loaded)
 */
export function shouldAutoDeny(toolName: string, toolInput: unknown): boolean {
  const policy = loadPolicy();
  return evaluatePolicy(toolName, toolInput, policy) === "auto-deny";
}
