# Rachel9

A personal AI assistant that lives in your Telegram. Rachel9 runs directly on Prem’s OpenAI-compatible ZDR API, with durable local sessions, persistent memory, tools, skills, media handling, and task scheduling in one Bun process.

Rachel can read and create documents, search the web, write and run code, schedule tasks, remember things about you, and much more — all through a simple Telegram chat.

**Don't want to self-host?** Get a fully managed Rachel at [get-rachel.com](https://get-rachel.com) — no setup, no server, just start chatting.

## Features

- **Telegram-native** — chat naturally, send voice messages, photos, documents; replies and scheduled results support native rich Markdown tables, headings, quotes, code and formulas
- **Persistent memory** — Rachel remembers your preferences, past conversations, and important facts
- **Built-in tools** — file I/O, bash, grep, web search, web fetch, Telegram file sending, and more
- **Specialized skills** — PDF, Word, Excel, PowerPoint, web design, and more
- **Task scheduler** — cron-based reminders, bash jobs, and autonomous agent tasks
- **Auto context compaction** — handles long conversations gracefully
- **Media** — DeepSeek V4.1 Flash 1017 handles text and images directly through Prem ZDR; Groq Whisper handles voice. PDFs use local text extraction or up to eight scanned pages; videos use six sampled frames and a separate audio transcript.
- **Self-contained** — single Bun process, SQLite database, Prem for inference and Groq for speech

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) (v1.1+)
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- Your Telegram user ID (from [@userinfobot](https://t.me/userinfobot))
- A Prem API key; optionally a Groq key for speech

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
| `PREM_API_KEY` | Yes | — | Prem API key |
| `PREM_MODEL` | No | `deepseek-v4.1-flash-1017` | Override text and image model name |
| `GROQ_API_KEY` | For voice | — | Groq Whisper speech key |
| `STT_PROVIDER` | No | `groq` | Speech provider (`groq` or `openai`) |
| `NODE_ENV` | No | `production` | `development`, `production`, or `test` |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, `error` |
| `THINKING_LEVEL` | No | `dynamic` | `dynamic`, or static thinking effort (minimal/low → DeepSeek low; medium/high → high): `minimal`, `low`, `medium`, `high` |

## Architecture

```
src/
├── agent/          # Prem ZDR runner, tools, compaction, system prompt
│   ├── llm/        # Prem JSON adapter + validation
│   ├── runtime/    # Durable JSONL session storage
│   └── tools/      # Custom tools: web search, web fetch, telegram file send
├── config/         # Environment validation (Zod) and tunable constants
├── lib/            # Database, memory, skills, task scheduler, usage tracking
├── telegram/       # Bot setup, message handlers, media handlers
│   ├── handlers/   # Message processing, 7 media type handlers
│   ├── lib/        # Queue, formatting, timestamps
│   └── middleware/  # Auth guard (owner-only)
├── setup/          # Interactive setup wizard + systemd installer
└── index.ts        # Entry point — webhook or polling mode
```

**Agent**: Calls `https://gateway.prem.io/openai/chat/completions` with DeepSeek V4.1 Flash 1017. The runner stores durable JSONL sessions, retains reasoning for tool continuations, and executes tools in rounds. Legacy Gemini sessions remain readable. Failed or ambiguous inference POSTs are not automatically replayed; there is no Google fallback.

**Memory**: Three layers — `MEMORY.md` (core facts, loaded every message), `daily-logs/` (conversation history), `context/` (deep topic knowledge).

**Database**: SQLite with WAL mode. Tables: `conversations`, `tasks`, `usage`.

**Skills**: Auto-discovered from `skills/` directory. Each skill has a `SKILL.md` with YAML frontmatter that gets injected into the system prompt. Skills can include their own local scripts and dependency/setup instructions.

**Compaction**: Implemented in `src/agent/compaction.ts` and triggered by `src/agent/runner.ts`. When estimated retained history exceeds `MAX_CONTEXT_TOKENS * COMPACTION_THRESHOLD`, older turns are summarized with the same Prem model while the most recent turn pairs are kept verbatim.

## Docker

```bash
docker build -t rachel9 .

docker run -d \
  --name rachel \
  -v rachel-data:/data \
  -e TELEGRAM_BOT_TOKEN=... \
  -e OWNER_TELEGRAM_USER_ID=... \
  -e PREM_API_KEY=... \
  -e SHARED_FOLDER_PATH=/data \
  rachel9
```

The Docker image includes Bun, Python 3, UV, ffmpeg, poppler-utils, git, curl, and sudo — enough for Rachel to execute code, create documents, and install skill-specific dependencies inside the container when needed.

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
MAX_CONTEXT_TOKENS: 500_000      // Hard context limit
COMPACTION_THRESHOLD: 0.70        // Trigger compaction at 70%
COMPACTION_KEEP_RECENT_TURNS: 10  // Always keep last 10 exchanges
STREAM_THROTTLE_MS: 300           // Legacy throttle constant
TELEGRAM_MAX_MESSAGE_LENGTH: 32768 // Native rich-message limit
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

## Development

```bash
bun run dev        # Start with hot reload
bun run typecheck  # Type checking
bun run test       # Run tests
```

## License

MIT
