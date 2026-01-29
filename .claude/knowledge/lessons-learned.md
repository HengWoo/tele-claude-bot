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
