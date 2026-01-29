# Claude Bot Bridge

A multi-platform bot that bridges Telegram and Feishu to Claude Code sessions via tmux.

## Quick Reference

```bash
# Platform-specific (recommended)
npm run dev:telegram     # Telegram bot with hot reload
npm run dev:feishu       # Feishu bot with hot reload
npm run start:telegram   # Production Telegram
npm run start:feishu     # Production Feishu

# Legacy (runs both platforms)
npm run dev              # Both platforms, hot reload
npm run start            # Both platforms, production

# Build & Test
npm run build            # Compile TypeScript
npm run test             # Tests in watch mode
npm run test:run         # Tests once
npm run typecheck        # Type checking only
```

## Project Structure

```
src/
├── telegram-main.ts     # Telegram entry point
├── feishu-main.ts       # Feishu entry point
├── index.ts             # Legacy multi-platform entry (deprecated)
├── config.ts            # Configuration loading
├── types.ts             # TypeScript interfaces
├── platforms/           # Platform abstraction layer
│   ├── interface.ts     # PlatformAdapter interface
│   ├── types.ts         # Cross-platform message types
│   ├── telegram/        # Telegram adapter (Grammy)
│   └── feishu/          # Feishu adapter (Lark SDK)
├── tmux/                # tmux session management
│   └── bridge.ts        # Platform-isolated tmux bridges
├── claude/              # Claude interaction
│   ├── bridge.ts        # Approval queue management
│   └── stream-parser.ts
├── approval/            # Approval system for dangerous ops
├── sessions/            # Session persistence
├── handlers/            # Telegram-specific handlers
└── utils/               # Helpers (logger, formatters)

scripts/
└── claude-bot-hook.sh   # Stop hook for response delivery
```

## Architecture

- **Platform adapters** abstract messaging (Telegram via Grammy, Feishu via Lark SDK)
- **tmux bridge** injects messages into Claude Code sessions with platform isolation
- **Stop hook** extracts responses from Claude transcript and signals completion
- **Pino** for structured logging
- Each platform runs independently with its own state files

## Platform Isolation

Telegram and Feishu run as separate processes with isolated state:
- State files: `~/.claude/telegram-bridge.json`, `~/.claude/feishu-bridge.json`
- Marker files: `{platform}-pending-*`, `{platform}-done-*`, `{platform}-response-*`
- Each can attach to different Claude sessions simultaneously

## Deployment Model

**Intentionally local-only.** Personal AI assistant designed to run on your own machine.

Why local > VPS:
- No exposed ports/SSH - only messaging platforms as remote interface
- Physical control over tmux sessions and Claude instances
- Authorization + approval system = only you can interact

**Recommended:** Use git worktrees to separate stable (main) and development (develop) instances.

**Feishu requires Cloudflare Tunnel** (or similar) to receive webhooks:
```bash
sudo cloudflared service install <token>  # Persistent tunnel
```

## Environment

**Telegram** (in `.env`):
```
TELEGRAM_TOKEN=xxx       # Required - from @BotFather
ALLOWED_USER_ID=123      # Required - comma-separated user IDs
```

**Feishu** (in `.env`):
```
FEISHU_ENABLED=true      # Enable Feishu bot
FEISHU_APP_ID=xxx        # Required when enabled
FEISHU_APP_SECRET=xxx    # Required when enabled
FEISHU_WEBHOOK_PORT=8847 # Webhook server port
FEISHU_ALLOWED_USERS=ou_xxx  # Comma-separated (optional, allows all if empty)
FEISHU_DOMAIN=feishu     # or "lark" for international
```

**Optional**:
```
LOG_LEVEL=info           # debug/info/warn/error
DEFAULT_WORKSPACE=~/projects
```

## Key Patterns

- Async generators for streaming responses (`AsyncGenerator<string>`)
- Platform adapter interface for unified messaging API
- Session manager with file-based persistence
- Stop hook reads transcript and writes response to marker file

## Testing

Tests use Vitest and are colocated with source files (`*.test.ts`).

**Important:** Unit tests don't cover the hook script or integration flows. Always manually test end-to-end after infrastructure changes.

## Lessons Learned

See [docs/lessons-learned.md](docs/lessons-learned.md) for hard-won lessons from building this project. Read before making significant changes.
