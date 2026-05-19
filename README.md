# Rachel9

A personal AI assistant that lives in your Telegram. Rachel9 runs directly on Google's native Gemini SDK, with durable local sessions, persistent memory, tools, skills, media handling, and task scheduling in one Bun process.

Rachel can read and create documents, search the web, write and run code, manage your WhatsApp, schedule tasks, remember things about you, and much more — all through a simple Telegram chat.

**Don't want to self-host?** Get a fully managed Rachel at [get-rachel.com](https://get-rachel.com) — no setup, no server, just start chatting.

## Features

- **Telegram-native** — chat naturally, send voice messages, photos, documents
- **Persistent memory** — Rachel remembers your preferences, past conversations, and important facts
- **Built-in tools** — file I/O, bash, grep, web search, web fetch, Telegram file sending, and more
- **Specialized skills** — PDF, Word, Excel, PowerPoint, web design, WhatsApp bridge, and more
- **Task scheduler** — cron-based reminders, bash jobs, and autonomous agent tasks
- **Auto context compaction** — handles long conversations gracefully (180K token window)
- **Voice transcription** — via Groq Whisper (free) or OpenAI Whisper
- **WhatsApp bridge skill** — read messages, export contacts, send files through WhatsApp
- **Native multimodal Gemini** — forwards Telegram photos and documents directly to the model
- **Self-contained** — single Bun process, SQLite database, no external services beyond Gemini and optional STT

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) (v1.1+)
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- Your Telegram user ID (from [@userinfobot](https://t.me/userinfobot))
- A Google AI Studio API key for Gemini

### Setup

```bash
git clone https://github.com/polly3223/Rachel9.git
cd Rachel9
bun install

# Interactive setup wizard — creates .env and optionally installs as systemd service
bun run setup
```

Or manually:

```bash
cp .env.example .env
# Edit .env with your values
bun run start
```

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Bot token from @BotFather |
| `OWNER_TELEGRAM_USER_ID` | Yes | — | Your Telegram user ID |
| `SHARED_FOLDER_PATH` | Yes | — | Path for persistent data (memory, database, sessions) |
| `GEMINI_API_KEY` | Yes | — | Google AI Studio API key |
| `GEMINI_MODEL` | No | `gemini-3.5-flash` | Override Gemini model name |
| `NODE_ENV` | No | `production` | `development`, `production`, or `test` |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, `error` |
| `THINKING_LEVEL` | No | `off` | `off`, `minimal`, `low`, `medium`, `high` |
| `STT_PROVIDER` | No | `groq` | `groq` or `openai` (for voice messages) |
| `GROQ_API_KEY` | No | — | Required if using Groq for voice transcription |
| `OPENAI_API_KEY` | No | — | Required if using OpenAI for voice transcription |

## Architecture

```
src/
├── agent/          # Native Gemini runner, tools, compaction, system prompt
│   ├── llm/        # Gemini SDK adapter + retries
│   ├── runtime/    # Durable JSONL session storage
│   └── tools/      # Custom tools: web search, web fetch, telegram file send
├── config/         # Environment validation (Zod) and tunable constants
├── lib/            # Database, memory, skills, task scheduler, usage tracking
├── telegram/       # Bot setup, message handlers, media handlers
│   ├── handlers/   # Message processing, 7 media type handlers
│   ├── lib/        # Queue, formatting, timestamps, transcription
│   └── middleware/  # Auth guard (owner-only)
├── setup/          # Interactive setup wizard + systemd installer
└── index.ts        # Entry point — webhook or polling mode
```

**Agent**: Uses `@google/genai` directly. The runner stores durable JSONL sessions, calls Gemini with the full retained history, executes tool calls in rounds, and retries transient Gemini errors.

**Memory**: Three layers — `MEMORY.md` (core facts, loaded every message), `daily-logs/` (conversation history), `context/` (deep topic knowledge).

**Database**: SQLite with WAL mode. Tables: `conversations`, `tasks`, `usage`.

**Skills**: Auto-discovered from `skills/` directory. Each skill has a `SKILL.md` with YAML frontmatter that gets injected into the system prompt. Skills can include local scripts, for example the WhatsApp bridge lives under `skills/whatsapp-bridge/scripts/`.

**Compaction**: Implemented in `src/agent/compaction.ts` and triggered by `src/agent/runner.ts`. When estimated retained history exceeds `MAX_CONTEXT_TOKENS * COMPACTION_THRESHOLD`, older turns are summarized with Gemini while the most recent turn pairs are kept verbatim.

## Docker

```bash
docker build -t rachel9 .

docker run -d \
  --name rachel \
  -v rachel-data:/data \
  -e TELEGRAM_BOT_TOKEN=... \
  -e OWNER_TELEGRAM_USER_ID=... \
  -e GEMINI_API_KEY=... \
  -e SHARED_FOLDER_PATH=/data \
  rachel9
```

The Docker image includes Bun, Python 3, UV, ffmpeg, git, curl, and sudo — enough for Rachel to execute code, create documents, and install skill-specific dependencies inside the container when needed.

### Webhook Mode (Rachel Cloud)

When deployed as part of [Rachel Cloud](https://get-rachel.com), set `RACHEL_CLOUD=true` to enable webhook mode. The container listens on port 8443 for updates forwarded by the central router.

```bash
docker run -d \
  -e RACHEL_CLOUD=true \
  -e WEBHOOK_PORT=8443 \
  # ... other env vars
  rachel9
```

Health check: `GET /health` returns `{"status":"ok"}`

## Tunable Constants

All magic numbers live in `src/config/constants.ts`:

```typescript
MAX_CONTEXT_TOKENS: 180_000      // Hard context limit
COMPACTION_THRESHOLD: 0.70        // Trigger compaction at 70%
COMPACTION_KEEP_RECENT_TURNS: 10  // Always keep last 10 exchanges
STREAM_THROTTLE_MS: 300           // Legacy throttle constant
TELEGRAM_MAX_MESSAGE_LENGTH: 4096 // Telegram's hard limit
TASK_POLL_INTERVAL_MS: 30_000     // Task scheduler poll interval
```

## Skills

| Skill | Description |
|---|---|
| `pdf` | Read, create, merge, split, watermark, OCR PDFs |
| `docx` | Create and edit Word documents |
| `xlsx` | Create and manipulate Excel spreadsheets |
| `pptx` | Create PowerPoint presentations |
| `canvas-design` | Generate HTML canvas graphics |
| `algorithmic-art` | Create generative art |
| `frontend-design` | Design web frontends |
| `web-artifacts-builder` | Build web components |
| `webapp-testing` | Playwright-based web testing |
| `mcp-builder` | Guide for creating MCP servers |
| `skill-creator` | Create new skills |
| `slack-gif-creator` | Generate Slack GIFs |
| `crm` | Build lightweight CRM workflows |
| `social-media` | Social media planning and content workflows |
| `whatsapp-bridge` | Connect and operate WhatsApp via Baileys |

## WhatsApp Bridge

WhatsApp is a skill, not core runtime code. The bridge scripts live under `skills/whatsapp-bridge/scripts/`, and the skill explains how to install dependencies if copied into a minimal container.

```bash
# Generate QR code to link
bun run skills/whatsapp-bridge/scripts/cli.ts connect-qr

# Export contacts from a group
bun run skills/whatsapp-bridge/scripts/cli.ts contacts "Group Name"

# Send a message
bun run skills/whatsapp-bridge/scripts/cli.ts send "+1234567890" "Hello!"
```

## Development

```bash
bun run dev        # Start with hot reload
bun run typecheck  # Type checking
bun run test       # Run tests
```

## License

MIT
