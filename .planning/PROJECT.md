# Rachel9 — Next-Gen AI Personal Assistant

## Vision

Rachel9 is a ground-up rewrite of Rachel8, replacing the Claude Agent SDK with the **pi-mono** framework (@mariozechner/pi-agent-core + @mariozechner/pi-ai). The goal is a more flexible, provider-agnostic AI personal assistant that runs on Telegram, with full system access (bash, files, web), persistent memory, task scheduling, WhatsApp bridge, STT, skills system, and dual deployment (standalone + Rachel Cloud containers).

## Core Value

A personal AI assistant that lives on Telegram, can do anything on the machine it runs on, remembers everything, and works with any LLM provider — not locked to one SDK.

## Why Rewrite

1. **Provider flexibility**: pi-ai supports 20+ LLM providers with unified API. Switch between Claude, GPT, Gemini, GLM, etc. without code changes
2. **Better agent architecture**: pi-agent-core provides proper Agent class with event system, tool calling, state management, streaming — vs Claude Agent SDK's opaque `query()` API
3. **Open source foundation**: pi-mono is MIT-licensed, actively maintained (13.9k stars), vs proprietary Claude SDK
4. **Cost optimization**: Can route to cheaper models for simple tasks, use powerful models for complex ones
5. **Future-proofing**: Not dependent on Anthropic's SDK roadmap

## Technical Stack

- **Runtime**: Bun (TypeScript)
- **Agent Framework**: @mariozechner/pi-agent-core (Agent class, tool calling, events)
- **Coding Agent SDK**: @mariozechner/pi-coding-agent (battle-tested tools, session management, compaction, skills)
- **LLM API**: @mariozechner/pi-ai (unified multi-provider API)
- **Primary LLM**: Z.ai (GLM-5) via pi-ai's provider system, with ability to switch to any supported provider
- **Telegram**: grammY (keep from Rachel8 — battle-tested)
- **WhatsApp**: Baileys (keep from Rachel8)
- **Database**: SQLite via bun:sqlite (keep from Rachel8)
- **STT**: Groq Whisper / OpenAI Whisper (keep from Rachel8)

### Why pi-coding-agent

The coding-agent SDK provides production-grade implementations we'd otherwise build from scratch:
- `createCodingTools(cwd)` — 7 tools (bash, read, write, edit, find, grep, ls) with proper truncation, error handling, output limiting
- `SessionManager` — JSONL session persistence with migration support
- `compact()` / `shouldCompact()` — automatic context compaction with summarization
- `loadSkills()` — skills system with frontmatter parsing
- `convertToLlm()` — message format conversion
- `AuthStorage` — API key management per provider

This means Rachel9 inherits world-class coding capabilities out of the box. Regular business users can ask Rachel to build whole websites, financial scripts, data analysis — Rachel ships it without them needing to know how to code.

## Architecture Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use pi-mono instead of Claude Agent SDK | Provider flexibility, open source, better agent API | Confirmed |
| Keep Bun as runtime | Team familiarity, speed, built-in SQLite, TS-first | Confirmed |
| Keep grammY for Telegram | Works well in Rachel8, mature library | Confirmed |
| Keep Baileys for WhatsApp | Only viable WA library, complex to replace | Confirmed |
| Fresh codebase, reference Rachel8 | Clean architecture, avoid tech debt, but port ALL features | Confirmed |
| Z.ai as primary provider | Current working setup, $30/mo Pro plan | Confirmed |
| Multi-provider support | pi-ai makes this trivial, key differentiator | Confirmed |

## Constraints

- Must run on Bun (not Node) — team preference
- Must support dual deployment: standalone (polling) and cloud (webhook)
- Must be backward-compatible with Rachel8's memory system (MEMORY.md, context/, daily-logs/)
- Must work with existing Rachel Cloud infrastructure (Docker containers, shared bot webhook routing)
- Skills folder must be portable from Rachel8

## Target Users

1. **Lorenzo** (primary) — personal AI assistant
2. **Rachel Cloud customers** — each gets their own containerized instance

## What Rachel Must Be Able To Do

(Full feature parity with Rachel8 + improvements)

### Telegram Integration
- Receive and respond to text messages
- Handle photos, documents, voice, audio, video, video notes, stickers
- Send files (images, documents, videos, audio) via CLI utility
- Smart Markdown formatting with fallback
- Typing indicators
- CET/CEST timestamps on every message

### AI/Agent Core
- Full tool calling (bash, file read/write/edit, web search, web fetch)
- Streaming responses (pi-agent-core event system)
- Multi-provider LLM support via pi-ai
- System prompt with memory injection
- Session management with context overflow recovery
- Custom tools (Telegram-specific: send_photo, send_file, etc.)

### Memory System
- MEMORY.md (core facts, loaded every query)
- context/ directory (topic-specific deep knowledge)
- daily-logs/ (conversation history by date)
- Proactive memory saving by the agent
- Backward-compatible with Rachel8 memory files

### Task Scheduler
- SQLite-backed with polling (30s interval)
- Task types: bash, reminder, cleanup, agent
- Cron support for recurring tasks
- One-off delayed tasks
- Agent tasks that trigger autonomous AI execution

### WhatsApp Bridge
- Full Baileys integration via CLI
- QR code and pairing code connection
- Send/receive messages
- Group management and contact export
- File sending

### STT (Speech-to-Text)
- Groq Whisper (default, free)
- OpenAI Whisper (optional, paid)
- Automatic transcription of voice/audio messages

### Skills System
- 12 portable skills from Rachel8
- Skill discovery via SKILL.md metadata
- Extensible framework

### Deployment
- Standalone mode (polling, single instance)
- Cloud mode (webhook, multi-tenant via Rachel Cloud)
- systemd service installation
- Interactive setup wizard
- Health check endpoint (cloud mode)

### Self-Management
- Can modify own code, commit, push, restart
- Graceful shutdown handling
- Startup debouncing (crash loop protection)

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Telegram bot with all message type handlers (text, photo, doc, voice, audio, video, sticker)
- [ ] pi-agent-core Agent integration with tool calling
- [ ] pi-ai multi-provider LLM API with Z.ai as default
- [ ] Custom tools: bash, file read/write/edit, web search, web fetch
- [ ] Telegram-specific tools: send_file, send_photo
- [ ] Streaming responses via agent event system
- [ ] System prompt with memory injection
- [ ] Session management with context overflow recovery
- [ ] Memory system (MEMORY.md, context/, daily-logs/)
- [ ] SQLite task scheduler (bash, reminder, cleanup, agent tasks)
- [ ] Cron support for recurring tasks
- [ ] WhatsApp bridge (CLI + Baileys client)
- [ ] STT integration (Groq + OpenAI Whisper)
- [ ] Skills system (portable from Rachel8)
- [ ] Dual deployment (polling + webhook)
- [ ] Setup wizard and systemd service installer
- [ ] Auth middleware (single-user guard)
- [ ] File download and send utilities
- [ ] Graceful shutdown and startup debouncing
- [ ] Configuration via Zod-validated env vars
- [ ] Logging system

### Out of Scope

- Multi-user auth within single instance — handled by Rachel Cloud routing
- Web UI — Telegram is the interface
- Database migration from Rachel8 — memory files are already compatible

## Key Differences from Rachel8

1. **Agent class instead of SDK query()**: Proper state management, event subscriptions, tool results
2. **Streaming**: Real-time token streaming to Telegram (edit messages as they come)
3. **Provider switching**: Change LLM provider with a config change, not a code rewrite
4. **Better tool architecture**: TypeBox schemas, proper error handling, streaming tool results
5. **Event-driven**: Subscribe to agent events (turn_start, message_update, tool_execution, etc.)
6. **Reference implementation**: pi-mono's `mom` (Slack bot) is the architectural template

---
*Last updated: 2026-02-19 after initialization*
