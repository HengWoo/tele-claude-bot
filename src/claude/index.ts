// Main bridge exports
export {
  spawnClaude,
  streamClaude,
  type SpawnClaudeOptions,
  type ClaudeProcess,
} from "./bridge.js";

// Stream parser exports
export {
  parseStreamLine,
  extractEventText,
  extractTextContent,
  isToolUseEvent,
  isToolResultEvent,
  isFinalMessage,
  isPartialMessage,
  formatToolUse,
} from "./stream-parser.js";

// Approval queue exports
export { ApprovalQueue, approvalQueue } from "./approval.js";
