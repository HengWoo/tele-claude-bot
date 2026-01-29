# Olive - Personal AI Assistant

## Identity

@.claude/soul.md

## Knowledge

Reference `.claude/knowledge/` for project-specific lessons:

| Topic | File | When to load |
|-------|------|--------------|
| Lessons learned | `lessons-learned.md` | tmux automation, debugging intermittent failures |

---

# Telegram-Claude Bridge

A Telegram bot that bridges to Claude Code sessions via tmux.

## Quick Reference

```bash
npm run dev          # Development with hot reload
npm run build        # Compile TypeScript
npm run start        # Run compiled JS
npm run test         # Run tests in watch mode
npm run test:run     # Run tests once
npm run typecheck    # Type checking only
```

## Project Structure

```
src/
├── index.ts           # Entry point, graceful shutdown
├── bot.ts             # Grammy bot setup, middleware, commands
├── config.ts          # Configuration loading (env + default.json)
├── types.ts           # TypeScript interfaces
├── claude/            # Claude interaction
│   ├── bridge.ts      # Approval queue management
│   ├── stream-parser.ts
│   └── approval.ts
├── tmux/              # tmux session management
│   ├── bridge.ts      # Core tmux<->Claude bridge
│   └── index.ts
├── sessions/          # Session persistence
│   ├── manager.ts
│   └── storage.ts
├── handlers/          # Telegram message/command handlers
│   ├── commands.ts
│   ├── message.ts
│   ├── callbacks.ts
│   └── files.ts
└── utils/             # Helpers (logger, telegram, files)
```

## Architecture

- **Grammy** for Telegram bot framework
- **tmux bridge** injects messages into running Claude Code sessions
- **Pino** for structured logging
- User authorization via `ALLOWED_USER_ID` in .env

## Deployment Model

**Intentionally local-only.** This is a personal AI assistant designed to run on your own machine.

Why local > VPS for this use case:
- No exposed ports/SSH - only Telegram as remote interface
- Physical control over tmux sessions and Claude instances
- `ALLOWED_USER_ID` + approval system = only you can interact
- No cloud provider trust required

Worktree layout:
- `tele_bot/` (main) - stable running instance
- `tele_bot-dev/` (develop) - sandbox for experiments

**When to reconsider:** If you need always-on availability, multi-user access, or mobile-only usage without your laptop running.

## Key Patterns

- Async generators for streaming responses (`AsyncGenerator<string>`)
- Middleware pattern for auth and logging
- Session manager with file-based persistence
- Commands registered before message handlers (order matters in Grammy)

## Environment

Required in `.env`:
- `TELEGRAM_TOKEN` - Bot token from @BotFather
- `ALLOWED_USER_ID` - Comma-separated user IDs

Optional:
- `LOG_LEVEL` - debug/info/warn/error
- `DEFAULT_WORKSPACE` - Default working directory
- `CLAUDE_MODEL` - Claude model override
- `CLAUDE_TIMEOUT` - Response timeout (ms)

## Testing

Tests use Vitest and are colocated with source files (`*.test.ts`).
