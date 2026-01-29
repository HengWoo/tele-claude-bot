# Lessons Learned

Hard-won lessons from building and maintaining this project.

## 2026-01-29: Platform Isolation & Hook Regression

### Don't lose features during refactoring

When converting the hook script from Telegram-only to multi-platform support, the response extraction logic was accidentally removed. The script went from ~70 lines with transcript parsing to ~30 lines that only signaled completion.

**Root cause:** Focused on the new requirement (platform prefixes) and rewrote from scratch instead of extending the existing script.

**Prevention:** When refactoring, diff against the original to ensure all functionality is preserved. Refactoring should add capabilities, not remove them.

### Validate review findings against project context

Automated code review flagged 7 issues. After manual validation, 6 were false positives:
- "Message handler loop swallows errors" → Only one handler registered, pattern is fine
- "sendMessage fallback not caught" → Caught by outer try-catch
- "Session persistence not propagated" → Intentional fire-and-forget pattern

**Root cause:** Reviewers (human or AI) without full context flag patterns that look suspicious but are actually correct for the specific design.

**Prevention:** Before fixing reported issues, trace the actual code paths and understand the design intent.

### Be consistent with Git workflow

Pushed directly to develop bypassing branch protection "because it's a small fix." This was inconsistent with how larger changes were handled via PRs.

**Prevention:** Same workflow for all changes. PRs provide traceability and review opportunity regardless of size.

### Infrastructure requires running processes

Cloudflare Tunnel was configured in the dashboard but the local `cloudflared` connector wasn't running. The tunnel showed as "DOWN" and webhooks failed silently.

**Root cause:** Assumed "configured" meant "running." The connector process had stopped and wasn't installed as a persistent service.

**Fix:** `sudo cloudflared service install <token>` makes it survive reboots.

**Prevention:** For any external connectivity, verify the full chain: process running → connection established → endpoint reachable.

### Unit tests don't catch integration failures

393 unit tests passed. Feishu bot still didn't work because the hook script (a bash file outside the test suite) was broken.

**Root cause:** The hook script is infrastructure glue between Claude Code and the bot. It's not covered by the TypeScript test suite.

**Prevention:**
- Manual end-to-end testing after infrastructure changes
- Consider integration tests that verify the full message flow
- Test the actual deployed configuration, not just the code

---

## Template for future entries

```markdown
## YYYY-MM-DD: Brief Title

### Lesson title

Description of what happened.

**Root cause:** Why it happened.

**Prevention:** How to avoid it in the future.
```
