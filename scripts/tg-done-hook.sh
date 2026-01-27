#!/bin/bash
# Claude Code Stop Hook for Telegram Bot
# This script signals that Claude has finished processing a request.
#
# SETUP:
# 1. Copy this file to ~/.claude/hooks/stop.sh
#    cp scripts/tg-done-hook.sh ~/.claude/hooks/stop.sh
#    chmod +x ~/.claude/hooks/stop.sh
#
# 2. Add to ~/.claude/settings.json:
#    {
#      "hooks": {
#        "Stop": [
#          {
#            "matcher": ".*",
#            "hooks": [
#              {
#                "type": "command",
#                "command": "~/.claude/hooks/stop.sh"
#              }
#            ]
#          }
#        ]
#      }
#    }
#
# 3. Restart Claude Code to load the hook

LOG_FILE="$HOME/.claude/tg-hook-debug.log"

# Always log that hook was called
echo "=== Stop hook triggered at $(date) ===" >> "$LOG_FILE"
echo "PWD: $(pwd)" >> "$LOG_FILE"

# Get current tmux target (session:window.pane)
if [ -n "$TMUX_PANE" ]; then
    TARGET=$(tmux display-message -p '#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null)
    echo "TMUX_PANE: $TMUX_PANE, TARGET: $TARGET" >> "$LOG_FILE"
else
    echo "Not in tmux (TMUX_PANE not set)" >> "$LOG_FILE"
    echo "---" >> "$LOG_FILE"
    exit 0
fi

if [ -z "$TARGET" ]; then
    echo "Could not determine tmux target" >> "$LOG_FILE"
    echo "---" >> "$LOG_FILE"
    exit 0
fi

# Sanitize target for filename (replace : and . with -)
SAFE_TARGET=$(echo "$TARGET" | tr ':.' '-')

PENDING_FILE="$HOME/.claude/tg-pending-$SAFE_TARGET"
DONE_FILE="$HOME/.claude/tg-done-$SAFE_TARGET"

echo "PENDING_FILE: $PENDING_FILE" >> "$LOG_FILE"
echo "PENDING_FILE exists: $([ -f "$PENDING_FILE" ] && echo 'yes' || echo 'no')" >> "$LOG_FILE"

# Only signal if bot is waiting for a response for this target
if [ -f "$PENDING_FILE" ]; then
    cp "$PENDING_FILE" "$DONE_FILE"
    echo "Created DONE_FILE: $DONE_FILE" >> "$LOG_FILE"
fi

echo "---" >> "$LOG_FILE"

# Always exit 0 - don't block Claude
exit 0
