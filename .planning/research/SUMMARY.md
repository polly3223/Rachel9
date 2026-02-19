# Rachel9 Decision Document

Executive synthesis of research findings for Rachel9 — a production Telegram AI agent on pi-mono framework.

**Date:** 2026-02-19
**Target:** Rachel8 parity + pi-mono differentiators
**Runtime:** Bun 1.3.9 + pi-mono 0.53.0

---

## 1. Stack Recommendations

### Core Dependencies (Exact Versions)

```json
{
  "@mariozechner/pi-agent-core": "0.53.0",
  "@mariozechner/pi-ai": "0.52.12",
  "grammy": "1.40.0",
  "@grammyjs/auto-chat-action": "0.1.1",
  "@whiskeysockets/baileys": "7.0.0-rc.9",
  "groq-sdk": "0.37.0",
  "openai": "^4.103.0",
  "qrcode": "^1.5.4",
  "zod": "^4.3.6"
}
```

### Critical Choices

**Database:** `bun:sqlite` (native, 3-6x faster) — NOT `better-sqlite3` (ABI incompatibility)
**Testing:** Vitest (run via `bun run test`) — NOT `bun test` (incomplete features)
**LLM:** Z.ai GLM-5 (Anthropic-compatible API) — map `claude-opus-4-6` → `GLM-5`
**Telegram:** grammY 1.40.0 (same as Rachel8, Bun-compatible)
**WhatsApp:** Baileys 7.0.0-rc.9 (pin exact version, unstable)

### Installation

```bash
bun add @mariozechner/pi-agent-core@0.53.0 \
        @mariozechner/pi-ai@0.52.12 \
        grammy@1.40.0 \
        @grammyjs/auto-chat-action@0.1.1 \
        @whiskeysockets/baileys@7.0.0-rc.9 \
        groq-sdk@0.37.0 openai qrcode zod

bun add -d @types/bun@latest @types/qrcode vitest
```

---

## 2. Table Stakes Features (Must Ship in v1)

Everything Rachel8 already does that must be ported:

### 2.1 Core Bot Runtime
- Full Telegram integration (text, photos, documents, voice, video, stickers)
- Voice message transcription (Groq Whisper)
- Audio file transcription (Groq + OpenAI fallback)
- File download to persistent storage
- Telegram file sending CLI
- Markdown formatting (Telegram-specific constraints)
- Typing indicator during processing
- Single-user authentication

### 2.2 AI Agent System
- Bash command execution (unrestricted)
- File operations (Read, Write, Edit)
- Web search and fetch
- Tool call error handling and recovery
- Multi-turn conversations
- Session management and persistence
- Context overflow recovery with session reset

### 2.3 Memory System
- MEMORY.md (core facts, loaded in system prompt)
- Daily logs (append-only conversation history)
- Context files (topic-specific knowledge)
- File-based storage in shared folder
- Memory initialization on startup

### 2.4 Task Scheduler
- One-off delayed tasks
- Recurring cron tasks
- Task types: bash, reminder, cleanup, agent
- 30-second polling loop
- SQLite persistence (survives restarts)
- Telegram integration for reminders

### 2.5 WhatsApp Bridge
- QR code + pairing code authentication
- Session persistence across restarts
- Contact name caching
- Message sending (text, files, images, videos, audio)
- Message history caching (200 per chat)
- Auto-reconnect on disconnect
- Multi-file auth state management

### 2.6 Skills System
- 12 extensible skills (PDF, Excel, Word, PowerPoint, frontend, web artifacts, skill creator, MCP builder, webapp testing, algorithmic art, canvas, Slack GIF)
- Skills are markdown files with prompts
- Port to pi-mono Agent Skills format

### 2.7 Deployment Modes
- Standalone polling mode (long polling via grammY)
- Cloud webhook mode (HTTP server receiving Telegram updates)
- Environment variable detection (RACHEL_CLOUD flag)
- Health check endpoint (/health)

### 2.8 Self-Management
- Git access to own repository
- Commit and push changes
- Systemd service restart via DBUS
- Startup message ("I'm back online!")
- Graceful shutdown on SIGTERM/SIGINT

### 2.9 Setup Wizard
- Interactive first-time setup
- Telegram bot token prompt
- Owner user ID configuration
- Systemd service installation option

**Total estimated effort for v1 table stakes:** ~30 days (single developer)

---

## 3. New Capabilities (Pi-Mono Enables)

What Rachel9 can do that Rachel8 cannot:

### 3.1 Streaming Responses (MEDIUM complexity, HIGH value)
- Edit Telegram message as AI tokens stream in
- Real-time updates during tool execution
- Throttled to 1 edit per 500ms (avoid rate limits)
- Graceful fallback on edit failures

### 3.2 Multi-Provider Hot-Switching (LOW complexity, HIGH value)
- Switch between Z.ai, Anthropic, OpenAI, Google, xAI, Groq without code changes
- Per-chat provider selection
- Telegram command: `/provider openai`
- Cost optimization and redundancy

### 3.3 Context Transformation (MEDIUM complexity, HIGH value)
- Automatic summarization of old messages
- Smart compaction before overflow
- Preserve recent N messages, summarize older
- 84% token savings vs raw history (research: 16% vs 100% for 100-turn dialogues)

### 3.4 Token and Cost Tracking (MEDIUM complexity, HIGH value)
- Tokens used per message
- Cache hit ratio (prompt caching)
- Session total cost
- Monthly spend tracking
- `/usage` command shows stats

### 3.5 Thinking/Reasoning Levels (LOW complexity, MEDIUM value)
- Adjustable reasoning depth (quick, normal, deep)
- Model-specific thinking support
- `/thinking deep` command
- Cost vs quality tradeoffs

### 3.6 Agent Event Subscriptions (MEDIUM complexity, MEDIUM value)
- Hook into agent lifecycle events
- `tool_call`, `message_start`, `message_complete`, `thinking_start`, `error`
- Custom integrations (analytics, logging, notifications)

### 3.7 Advanced Session Management (MEDIUM complexity, MEDIUM value)
- Session branching (`/fork` conversations)
- Session export/import
- Session templates (pre-loaded context)

**Defer to v1.1+:** Extensions/custom tools (HIGH complexity)

---

## 4. Architecture Overview

### 4.1 Component Structure

```
rachel9/
├── src/
│   ├── index.ts                    # Entry point (polling vs webhook)
│   ├── telegram/
│   │   ├── bot.ts                  # grammY instance + middleware
│   │   ├── context.ts              # TelegramContext adapter
│   │   ├── queue.ts                # Per-chat message queue
│   │   └── handlers/               # Message, media, voice, command
│   ├── agent/
│   │   ├── runner.ts               # AgentRunner (encapsulates Agent + events)
│   │   ├── tools/                  # Bash, Read, Write, Edit, Telegram-send
│   │   └── session.ts              # Session management (context.jsonl)
│   ├── storage/
│   │   ├── store.ts                # ChatStore (per-chat directories)
│   │   ├── logger.ts               # log.jsonl management
│   │   └── attachments.ts          # File download queue
│   └── lib/
│       ├── memory.ts               # MEMORY.md loading/saving
│       ├── tasks.ts                # SQLite task scheduler
│       └── config.ts               # Environment variables
└── data/
    ├── MEMORY.md                   # Global memory
    ├── settings.json               # Settings
    └── <chatId>/                   # Per-chat directories
        ├── MEMORY.md
        ├── log.jsonl
        ├── context.jsonl
        ├── attachments/
        └── scratch/
```

### 4.2 Data Flow

```
Telegram Update
  ↓
grammY middleware (authGuard)
  ↓
ChatQueue.enqueue (per-chat sequential processing)
  ↓
getOrCreateRunner(chatId) ← Cached Agent instances (one per chat)
  ↓
syncLogToSessionManager() ← Read log.jsonl, deduplicate, append to context.jsonl
  ↓
SessionManager.buildSessionContext() ← Load messages
  ↓
Agent.replaceMessages() ← Restore state
  ↓
TelegramContext adapter created
  ↓
Agent.prompt(userMessage, images?) ← Trigger turn
  ↓
Event stream (tool_execution_start, message_update, tool_execution_end, turn_end)
  ↓
MessageQueue.enqueue() ← Serialize Telegram API calls (rate limiting)
  ↓
Telegram API (editMessageText for streaming, sendMessage for threads)
  ↓
Log response to log.jsonl
```

### 4.3 Key Patterns (from pi-mono's "mom" Slack bot)

**AgentRunner Pattern:**
- Encapsulate Agent + SessionManager + event subscriptions
- Created once per chat, cached in Map
- Event handlers access per-run state via closure
- Each run: sync log → reload context → update system prompt → prompt

**Per-Chat Message Queue:**
- Ensures messages from same chat processed in order
- Prevents concurrent agent runs (state corruption)
- Allows parallel processing of different chats
- Stop command bypasses queue, calls `runner.abort()`

**TelegramContext Adapter:**
- Main message: streaming updates, tool labels, final response
- Thread/reply: full tool args + results (keep channel clean)
- Message accumulation state
- Queue Telegram API calls sequentially

**Session Persistence:**
- `log.jsonl`: All messages (user + bot), append-only, greppable
- `context.jsonl`: SessionManager format, compactable, loaded into Agent
- Sync flow: `syncLogToSessionManager()` before each `agent.prompt()`
- Picks up channel chatter, backfilled history, messages while bot was busy

**File Handling:**
1. Download to `C<chatId>/attachments/`
2. Log metadata in log.jsonl
3. Images: Base64 embed via `images` param
4. Other files: Include path in text prompt
5. Agent tools can access via Read

---

## 5. Critical Pitfalls (Top 10)

### 5.1 bun:sqlite vs better-sqlite3 (CRITICAL)
**Problem:** better-sqlite3 has ABI incompatibility with Bun. Code using it will crash.
**Prevention:** Use `import { Database } from 'bun:sqlite'` from day 1. Do NOT install better-sqlite3. Check if pi-mono requires it (likely stateless).
**Phase:** Phase 1 (Foundation)

### 5.2 SQLite WAL Mode + Docker Volumes (CRITICAL)
**Problem:** WAL mode can corrupt database on network filesystems or bind mounts.
**Prevention:** Use Docker named volumes (NOT bind mounts). Enable WAL. Implement graceful shutdown with `PRAGMA wal_checkpoint(TRUNCATE)`. Set `busy_timeout = 5000`.
**Phase:** Phase 1 (Foundation)

### 5.3 Agent State Not Automatically Persisted (HIGH)
**Problem:** Agent conversations live in memory. Process restart loses all context.
**Prevention:** SessionManager + context.jsonl for persistence. Sync log.jsonl → context.jsonl before each run. Store in SQLite or JSONL format.
**Phase:** Phase 1 (Foundation)

### 5.4 Tool Execution Without Sandboxing (HIGH)
**Problem:** pi-mono tools execute with full process permissions. Prompt injection leads to system compromise.
**Prevention:** NEVER run as root. Command allowlist in shell tool. Sandbox file operations to specific directories. Validate all tool arguments. Use Bun's `$` shell template. Log all tool executions.
**Phase:** Phase 1 (Foundation)

### 5.5 Streaming with Concurrent Messages (HIGH)
**Problem:** Multiple users send messages simultaneously. Streaming state gets mixed up.
**Prevention:** One Agent instance per chat_id (memory intensive but isolated). Per-chat message queue (serial processing). Filter events by chat context.
**Phase:** Phase 1 (Foundation)

### 5.6 Telegram Message Editing Rate Limits (MEDIUM)
**Problem:** Streaming responses edit messages too fast. 429 errors. Message updates stop.
**Prevention:** Throttle edits to 1 per 500ms (conservative). Buffer chunks. Respect `retry_after`. Adaptive backoff on 429.
**Phase:** Phase 2 (Telegram Integration)

### 5.7 Telegram Markdown Parsing Failures (MEDIUM)
**Problem:** LLM generates standard markdown. Telegram rejects with "Can't parse entities."
**Prevention:** Teach LLM Telegram markdown syntax in system prompt. FORBIDDEN: `**bold**`, `## headers`, `[text](url)`. ALLOWED: `*bold*`, `_italic_`, `` `code` ``, plain URLs. Implement sanitization fallback.
**Phase:** Phase 2 (Telegram Integration)

### 5.8 Memory Leaks with Long-Running Agents (MEDIUM)
**Problem:** Memory usage grows continuously over days/weeks. Eventually crashes.
**Prevention:** Conversation pruning (keep recent N messages). Compress/summarize old turns. Clear tool result caches. Monitor RSS every hour. Periodic cleanup task (every 24h).
**Phase:** Phase 3 (Memory System)

### 5.9 Session/Context Growth Without Compaction (HIGH)
**Problem:** Token costs and latency increase exponentially as conversation continues. Eventually hit context limit.
**Prevention:** Sliding window (last N messages full, summarize older). Research shows 84% token savings with context editing. Context budget: max 20K tokens per request. Structured memory in SQLite, not raw conversation.
**Phase:** Phase 3 (Memory System)

### 5.10 Container Memory Limits with Agent State (MEDIUM)
**Problem:** Container has 512MB limit. Agent state exceeds. OOM killed. Bot goes offline.
**Prevention:** Set appropriate limits (start 1GB). Log RSS every 30min. Aggressive pruning in containers. Soft limit (80%) for alerts. Test with multiple concurrent conversations.
**Phase:** Phase 1 (Foundation)

---

## 6. Build Order (Implementation Sequence)

### Phase 1: Core Infrastructure (Days 1-2)
**Goal:** Foundation without features
1. Project setup (package.json, tsconfig.json, directory structure)
2. Storage layer (ChatStore, log.jsonl, attachments)
3. Configuration (environment variables, validation)
4. SQLite setup (bun:sqlite, WAL mode, graceful shutdown)
5. Docker setup (Dockerfile, volumes, permissions)
6. Memory limits and monitoring

**Deliverable:** Empty bot that starts, connects to Telegram, handles shutdown

### Phase 2: Agent Foundation (Days 3-4)
**Goal:** Agent can think but not integrated
1. Session management (SessionManager wrapper, syncLogToSessionManager)
2. Agent tools (bash, read, write — from pi-mono examples)
3. AgentRunner (createRunner pattern, event subscription, per-run state)
4. getOrCreateRunner cache (Map of runners per chat)

**Deliverable:** Agent can process messages, call tools, stream responses (not yet connected to Telegram)

### Phase 3: Telegram Transport (Days 5-6)
**Goal:** Bot receives and responds
1. Bot setup (grammY initialization, middleware)
2. Message queue (ChatQueue, per-chat queues)
3. Context adapter (TelegramContext, message accumulation, API queue)
4. Message handlers (text only, then media)
5. Markdown sanitization (system prompt + fallback)

**Deliverable:** Bot responds to text messages, executes tools, streams responses

### Phase 4: Integration (Day 7)
**Goal:** All pieces working together
1. Main entry point (polling vs webhook mode detection)
2. Handler wiring (Telegram → queue → runner → context → API)
3. getState() pattern (per-chat state management)
4. Graceful shutdown (SIGTERM handler)
5. Basic testing (multi-turn conversation, tool execution)

**Deliverable:** Functional bot with text, tools, streaming, persistence

### Phase 5: Features (Days 8-10)
**Goal:** Rachel8 parity
1. Media handling (photo, document, voice transcription, attachments)
2. Memory system (MEMORY.md loading, system prompt injection)
3. Webhook mode (Bun.serve, health check, Rachel Cloud integration)
4. Task scheduler (SQLite-backed, cron parsing, agent tasks)
5. Telegram-specific tools (send-file CLI)

**Deliverable:** Feature-complete bot (missing WhatsApp, skills)

### Phase 6: Advanced (Days 11-14)
**Goal:** WhatsApp + Skills
1. WhatsApp bridge (Baileys integration, session persistence, contact caching)
2. Skills system (port 12 skills to Agent Skills format)
3. Self-management (git operations, systemd restart)
4. Setup wizard (interactive configuration)

**Deliverable:** v1.0 — Full Rachel8 parity

### Phase 7: Pi-Mono Differentiators (Days 15-17)
**Goal:** New capabilities
1. Provider switching (`/provider` command, config storage)
2. Cost tracking (`/usage` command, SQLite logging)
3. Context compaction (summarization, proactive triggering)
4. Thinking levels (`/thinking` command)

**Deliverable:** v1.1 — Rachel9 unique features

### Dependencies
```
Phase 1 (Storage) → Phase 2 (Agent) → Phase 3 (Telegram) → Phase 4 (Integration)
  ↓                                                              ↓
Phase 5 (Features) ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ←
  ↓
Phase 6 (Advanced) → Phase 7 (Differentiators)
```

**Critical path:** Phases 1-4 (foundation, must be done sequentially)
**Can defer:** WhatsApp (Phase 6), Skills (Phase 6), Differentiators (Phase 7)

---

## 7. Open Questions (Needs Testing)

### 7.1 Pi-Mono SQLite Dependency
**Question:** Does pi-agent-core use better-sqlite3 internally for state?
**Test:** Initialize Agent, check for better-sqlite3 errors
**Mitigation:** Create adapter or fork if needed
**Priority:** CRITICAL — blocks Phase 1

### 7.2 Baileys + grammY Conflict
**Question:** Do Baileys and grammY work together without WebSocket conflicts?
**Test:** Run both in same process, send messages on both platforms
**Priority:** HIGH — affects Phase 6

### 7.3 Z.ai Feature Compatibility
**Question:** Which Anthropic features does Z.ai support? (system prompts, tool calling, streaming, prompt caching, vision)
**Test:** Make API calls for each feature, compare responses
**Priority:** HIGH — affects Phase 2

### 7.4 Pi-Mono Provider Switching
**Question:** Can pi-ai switch providers at runtime or requires restart?
**Test:** Create Agent with Anthropic, switch to OpenAI mid-session
**Priority:** MEDIUM — affects Phase 7

### 7.5 Streaming + Telegram Edits
**Question:** Does streaming work smoothly with Telegram message editing?
**Test:** Subscribe to message_update events, edit Telegram message, measure latency and rate limits
**Priority:** MEDIUM — affects Phase 3

### 7.6 Z.ai Model Naming
**Question:** Exact mapping for Z.ai models via Anthropic endpoint. Is it `GLM-5` or `GLM-4.7`?
**Test:** Make API call with `claude-opus-4-6`, check actual model used in logs/billing
**Priority:** HIGH — affects Phase 2

### 7.7 Token Counting Accuracy
**Question:** How accurate are Z.ai's token counts vs Anthropic's?
**Test:** Send same message to both, compare reported tokens
**Priority:** MEDIUM — affects Phase 3 (context budgets)

### 7.8 Rachel8 Session Migration
**Question:** Can we extract conversation history from Claude Agent SDK sessions?
**Test:** Read Rachel8 session file format, parse messages
**Priority:** MEDIUM — affects production migration

### 7.9 Memory File Format Compatibility
**Question:** Is Rachel9 memory system backward-compatible with Rachel8 files?
**Test:** Load Rachel8 MEMORY.md, daily-logs/, context/ in Rachel9
**Priority:** MEDIUM — affects production migration

### 7.10 Vitest + Pi-Mono Compatibility
**Question:** Does Vitest work well for testing pi-mono agents?
**Test:** Write unit tests for Agent, tools, sessions
**Priority:** LOW — affects testing strategy

---

## Decision Checklist

Before starting implementation:

- [ ] **Stack:** Bun 1.3.9 + pi-mono 0.53.0 confirmed
- [ ] **Database:** bun:sqlite chosen (NOT better-sqlite3)
- [ ] **Testing:** Vitest installed, `bun run test` configured
- [ ] **LLM:** Z.ai account + API key, model mapping documented
- [ ] **Docker:** Dockerfile with oven/bun:1.3.9-alpine, named volumes
- [ ] **SQLite:** WAL mode enabled, graceful shutdown implemented
- [ ] **Security:** Non-root user, command allowlist, sandboxed file ops
- [ ] **Concurrency:** One Agent per chat, per-chat message queue
- [ ] **Memory:** Context compaction strategy defined
- [ ] **Deployment:** Polling + webhook modes supported

Before production migration:

- [ ] **Rachel8 sessions:** Export/import script tested
- [ ] **Memory files:** Backward compatibility verified
- [ ] **Tasks:** Migration script for scheduled tasks
- [ ] **Behavior:** A/B testing Rachel8 vs Rachel9 responses
- [ ] **Monitoring:** Memory, token usage, error logging in place
- [ ] **Backup:** Database backup strategy + restoration tested
- [ ] **Rollback:** Ability to revert to Rachel8 if needed

---

## References

- [STACK.md](./STACK.md) — Full dependency research (versions, compatibility, installation)
- [FEATURES.md](./FEATURES.md) — Complete feature inventory (table stakes, differentiators, anti-features)
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Component design (data flow, patterns, file layout)
- [PITFALLS.md](./PITFALLS.md) — Production issues (47 pitfalls, prevention, recovery)

**Next Step:** Run Phase 1 validation tests (pi-mono imports, bun:sqlite, Docker build) before writing code.
