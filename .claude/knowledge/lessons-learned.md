# Lessons Learned

Technical debugging lessons worth remembering.

---

## tmux: Use Stable Pane IDs, Not Positional Addresses

**Date**: 2025-01-30

**Symptom**: Intermittent failures - some responses routed back to Telegram, some didn't.

**Investigation**:
1. Hook debug log showed `TARGET` flickering between `1:2.1` and `1:2.2`
2. `TMUX_PANE` env var was constant (`%4`), but positional address wasn't
3. `tmux display-message -p` without `-t` returns the "active" pane (wherever focus is), not the pane where the command runs

**Root cause**: Positional addresses (`session:window.pane`) can shift when panes are added/removed in a window. The hook was querying for current position each time, which was unstable.

**Solution**: Use stable pane IDs (`$TMUX_PANE` like `%4`) for file naming and identification. These never change for the life of a pane.

**Key insight**: "We shouldn't be querying each time - we're attached to a pane, it shouldn't change." When you find yourself re-deriving something that should be constant, question the architecture.

**tmux reference**:
```bash
# Stable pane ID (never changes)
echo $TMUX_PANE  # %4

# Positional address (can shift)
tmux display-message -p '#{session_name}:#{window_index}.#{pane_index}'  # 1:2.1

# If you must query, be explicit about which pane
tmux display-message -t "$TMUX_PANE" -p '...'

# List all panes with both identifiers
tmux list-panes -a -F '#{pane_id} -> #{session_name}:#{window_index}.#{pane_index}'
```

---

## Team Deployment Considerations

**Date**: 2025-01-31

When deploying a bot for team use (vs personal use), security requirements change significantly.

### Authorization
- **Personal**: Single user ID hardcoded in env is fine
- **Team**: Need explicit allow-list; empty list should fail, not allow all
- Always send rejection messages to unauthorized users (don't silently ignore)

### Audit Trail
- Log all security-relevant events with structured format
- Key actions: `message_received`, `command_executed`, `auth_denied`, `rate_limited`
- Include: platform, userId, chatId, timestamp
- Useful for: debugging, security review, usage analytics

### Rate Limiting
- Prevents abuse and runaway costs
- Sliding window is simpler than token bucket and works well for chat
- Send warning on first hit, silent drop on subsequent (avoid rate limit spam)

### Future considerations for public exposure:
- **Webhook signature verification**: Validate requests actually come from Feishu/Telegram
- **Group chat context isolation**: Ensure users can't see each other's sessions
- **User management workflow**: Admin commands or web UI for managing allowed users
- **Encryption at rest**: Session data and audit logs may contain sensitive info
