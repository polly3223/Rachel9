# Rachel9

A personal AI assistant that lives in your Telegram. Built on the [pi-mono](https://github.com/nicholasgriffintn/pi-mono) agent framework. Supports multiple LLM providers out of the box: Google Gemini, OpenAI, Anthropic, and more via pi-ai.

Rachel can read and create documents, search the web, write and run code, manage your WhatsApp, schedule tasks, remember things about you, and much more — all through a simple Telegram chat.

**Don't want to self-host?** Get a fully managed Rachel at [get-rachel.com](https://get-rachel.com) — no setup, no server, just start chatting.

## Features

- **Telegram-native** — chat naturally, send voice messages, photos, documents
- **Persistent memory** — Rachel remembers your preferences, past conversations, and important facts
- **10 built-in tools** — file I/O, bash, grep, web search, web fetch, and more
- **12 specialized skills** — PDF, Word, Excel, PowerPoint, web design, WhatsApp bridge, and more
- **Task scheduler** — cron-based reminders, bash jobs, and autonomous agent tasks
- **Auto context compaction** — handles long conversations gracefully (180K token window)
- **Voice transcription** — via Groq Whisper (free) or OpenAI Whisper
- **WhatsApp bridge** — read messages, export contacts, send files through WhatsApp
- **Streaming responses** — real-time message streaming with typing indicators
- **Self-contained** — single Bun process, SQLite database, no external services beyond the LLM

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) (v1.1+)
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- Your Telegram user ID (from [@userinfobot](https://t.me/userinfobot))
- An LLM API key (Google AI Studio, OpenAI, Anthropic, or Z.ai)

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
| `GEMINI_API_KEY` | No* | — | Google AI Studio API key (recommended, enables Gemini Flash) |
| `ZAI_API_KEY` | No* | — | Z.ai API key (fallback) |
| `GEMINI_MODEL` | No | `gemini-3-flash-preview` | Override Gemini model name |
| `NODE_ENV` | No | `production` | `development`, `production`, or `test` |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, `error` |
| `THINKING_LEVEL` | No | `off` | `off`, `minimal`, `low`, `medium`, `high` |
| `STT_PROVIDER` | No | `groq` | `groq` or `openai` (for voice messages) |
| `GROQ_API_KEY` | No | — | Required if using Groq for voice transcription |

\* At least one LLM API key is required (`GEMINI_API_KEY` or `ZAI_API_KEY`).

## Architecture

```
src/
├── agent/          # Agent system — runner, tools, compaction, system prompt
│   └── tools/      # Custom tools: web search, web fetch, telegram file send
├── config/         # Environment validation (Zod) and tunable constants
├── lib/            # Database, memory, skills, task scheduler, usage tracking
├── telegram/       # Bot setup, message handlers, media handlers, streaming
│   ├── handlers/   # Message processing, 7 media type handlers
│   ├── lib/        # Queue, formatting, timestamps, transcription
│   └── middleware/  # Auth guard (owner-only)
├── whatsapp/       # WhatsApp Web bridge via Baileys
├── setup/          # Interactive setup wizard + systemd installer
└── index.ts        # Entry point — webhook or polling mode
```

**Agent**: Uses `pi-agent-core` with 10 tools (7 coding tools from pi-coding-agent + 3 custom). Sessions persist as JSONL files.

**Memory**: Three layers — `MEMORY.md` (core facts, loaded every message), `daily-logs/` (conversation history), `context/` (deep topic knowledge).

**Database**: SQLite with WAL mode. Tables: `conversations`, `tasks`, `usage`.

**Skills**: Auto-discovered from `skills/` directory. Each skill has a `SKILL.md` with YAML frontmatter that gets injected into the system prompt.

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

The Docker image includes Python 3, UV, pip, ffmpeg, git, and curl — everything Rachel needs to execute code and create documents.

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
STREAM_THROTTLE_MS: 500           // Min ms between Telegram edits
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

## WhatsApp Bridge

Connect Rachel to your WhatsApp to read messages, export contacts, and send files:

```bash
# Generate QR code to link
bun run src/whatsapp/cli.ts connect-qr

# Export contacts from a group
bun run src/whatsapp/cli.ts contacts "Group Name"

# Send a message
bun run src/whatsapp/cli.ts send "+1234567890" "Hello!"
```

## Development

```bash
bun run dev        # Start with hot reload
bun run typecheck  # Type checking
bun run test       # Run tests
```

## License

MIT
