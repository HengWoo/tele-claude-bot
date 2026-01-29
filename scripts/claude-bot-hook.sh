#!/bin/bash
# Claude Code Stop Hook for Bot Platforms (Telegram, Feishu)
# This script signals that Claude has finished processing a request.
#
# SETUP:
# 1. Copy this file to ~/.claude/hooks/stop.sh
#    cp scripts/claude-bot-hook.sh ~/.claude/hooks/stop.sh
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

LOG_FILE="$HOME/.claude/bot-hook-debug.log"

# All supported platforms
PLATFORMS="telegram feishu"

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

# Check all platforms for pending requests
for PLATFORM in $PLATFORMS; do
    PENDING_FILE="$HOME/.claude/${PLATFORM}-pending-$SAFE_TARGET"
    DONE_FILE="$HOME/.claude/${PLATFORM}-done-$SAFE_TARGET"

    if [ -f "$PENDING_FILE" ]; then
        cp "$PENDING_FILE" "$DONE_FILE"
        echo "Signaled completion for $PLATFORM: $DONE_FILE" >> "$LOG_FILE"
    fi
done

echo "---" >> "$LOG_FILE"

# Always exit 0 - don't block Claude
exit 0
