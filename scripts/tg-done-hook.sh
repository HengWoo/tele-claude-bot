#!/bin/bash
# Claude Code Stop Hook for Telegram Bot
# This script should be called from a Claude Code "Stop" hook.
# It signals that Claude has finished processing a request.
#
# Usage: Add to ~/.claude/settings.json:
# {
#   "hooks": {
#     "Stop": [
#       {
#         "matcher": "",
#         "hooks": ["bash /path/to/tele_bot/scripts/tg-done-hook.sh"]
#       }
#     ]
#   }
# }

CLAUDE_DIR="$HOME/.claude"

# Get current tmux target (session:window.pane)
if [ -n "$TMUX_PANE" ]; then
    # We're inside tmux, get our target
    TARGET=$(tmux display-message -p '#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null)
else
    # Not in tmux, exit silently
    exit 0
fi

if [ -z "$TARGET" ]; then
    exit 0
fi

# Sanitize target for filename (replace : and . with -)
SAFE_TARGET=$(echo "$TARGET" | tr ':.' '-')

PENDING_FILE="$CLAUDE_DIR/tg-pending-$SAFE_TARGET"
DONE_FILE="$CLAUDE_DIR/tg-done-$SAFE_TARGET"

# If there's a pending request for this target, copy it to done
if [ -f "$PENDING_FILE" ]; then
    cp "$PENDING_FILE" "$DONE_FILE"
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Signaled done for target $TARGET" >> "$CLAUDE_DIR/tg-hook.log"
fi
