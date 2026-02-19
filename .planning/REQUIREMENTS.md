# Rachel9 Requirements

## v1 Requirements

### Core Runtime (CORE)
- [ ] **CORE-01**: Bot starts and connects to Telegram in polling mode (grammY)
- [ ] **CORE-02**: Bot starts in webhook mode when RACHEL_CLOUD=true (Bun.serve on port 8443)
- [ ] **CORE-03**: Health check endpoint (GET /health) returns status in webhook mode
- [ ] **CORE-04**: Environment variables validated via Zod on startup with clear error messages
- [ ] **CORE-05**: Graceful shutdown on SIGTERM/SIGINT (close DB, stop polling, drain requests)
- [ ] **CORE-06**: Startup debouncing via lock file (prevent spam during crash loops)
- [ ] **CORE-07**: Logging system with configurable levels (debug, info, warn, error)

### Telegram Integration (TG)
- [ ] **TG-01**: Receive and respond to text messages
- [ ] **TG-02**: Handle photo messages (download + inject path into prompt)
- [ ] **TG-03**: Handle document messages (download + inject filename metadata)
- [ ] **TG-04**: Handle voice messages (download + STT transcribe + inject text)
- [ ] **TG-05**: Handle audio messages (download + STT transcribe + inject text)
- [ ] **TG-06**: Handle video messages (download + inject duration metadata)
- [ ] **TG-07**: Handle video note messages (download + inject metadata)
- [ ] **TG-08**: Handle sticker messages (skip static, save animated/video)
- [ ] **TG-09**: Send files via CLI utility (images, docs, video, audio → correct Telegram API method)
- [ ] **TG-10**: Telegram-specific markdown formatting with plaintext fallback
- [ ] **TG-11**: Typing indicator ("typing" action) during AI processing
- [ ] **TG-12**: Single-user auth middleware (silent rejection of unauthorized users)
- [ ] **TG-13**: CET/CEST timestamp prefix on every user message
- [ ] **TG-14**: Streaming responses — edit Telegram message as tokens arrive (throttled 500ms)
- [ ] **TG-15**: Per-chat message queue to prevent concurrent agent runs

### AI Agent (AGENT)
- [ ] **AGENT-01**: pi-agent-core Agent class integration with tool calling
- [ ] **AGENT-02**: pi-ai unified LLM API with Z.ai as default provider
- [ ] **AGENT-03**: Tool: Bash command execution (unrestricted, with timeout)
- [ ] **AGENT-04**: Tool: File read (any file on system)
- [ ] **AGENT-05**: Tool: File write (create/overwrite files)
- [ ] **AGENT-06**: Tool: File edit (targeted string replacement)
- [ ] **AGENT-07**: Tool: Web search
- [ ] **AGENT-08**: Tool: Web fetch (URL content extraction)
- [ ] **AGENT-09**: Tool: Telegram send file (from agent context)
- [ ] **AGENT-10**: System prompt with memory injection (MEMORY.md content appended)
- [ ] **AGENT-11**: Session persistence (context.jsonl per chat, survives restarts)
- [ ] **AGENT-12**: Context overflow recovery (detect overflow, reset session, retry with notice)
- [ ] **AGENT-13**: Agent event subscriptions for streaming and tool status
- [ ] **AGENT-14**: Multi-turn conversations with full message history

### Memory System (MEM)
- [ ] **MEM-01**: MEMORY.md loading (core facts injected into system prompt every query)
- [ ] **MEM-02**: MEMORY.md writing (agent can update core memory)
- [ ] **MEM-03**: Daily logs (append-only conversation log per day, YYYY-MM-DD.md)
- [ ] **MEM-04**: Context files (topic-specific knowledge in context/ directory)
- [ ] **MEM-05**: Memory directory initialization on startup
- [ ] **MEM-06**: Backward compatibility with Rachel8 memory files

### Task Scheduler (TASK)
- [ ] **TASK-01**: SQLite-backed task storage (bun:sqlite, WAL mode)
- [ ] **TASK-02**: 30-second polling loop for due tasks
- [ ] **TASK-03**: Task type: bash (execute shell command)
- [ ] **TASK-04**: Task type: reminder (send Telegram message to owner)
- [ ] **TASK-05**: Task type: cleanup (pkill targets)
- [ ] **TASK-06**: Task type: agent (trigger AI with prompt, send response via Telegram)
- [ ] **TASK-07**: Cron pattern support for recurring tasks (minute hour dom month dow)
- [ ] **TASK-08**: One-off delayed tasks (delayMs)
- [ ] **TASK-09**: Task CRUD API (add, remove, list)

### WhatsApp Bridge (WA)
- [ ] **WA-01**: Baileys client with QR code connection
- [ ] **WA-02**: Baileys client with pairing code connection
- [ ] **WA-03**: Session persistence across restarts (multi-file auth state)
- [ ] **WA-04**: Contact name caching (persistent JSON file)
- [ ] **WA-05**: Send text messages (by name, phone, or JID)
- [ ] **WA-06**: Send files (auto-detect type: image, video, audio, document)
- [ ] **WA-07**: Recent message history cache (200 per chat)
- [ ] **WA-08**: Auto-reconnect on disconnect
- [ ] **WA-09**: CLI interface for all WhatsApp operations
- [ ] **WA-10**: Group listing and contact export (CSV)
- [ ] **WA-11**: Contact search by name or phone

### Skills System (SKILL)
- [ ] **SKILL-01**: Skills directory with SKILL.md metadata files
- [ ] **SKILL-02**: Port all 12 Rachel8 skills (PDF, Excel, Word, PowerPoint, canvas, algorithmic-art, frontend-design, web-artifacts, webapp-testing, skill-creator, mcp-builder, slack-gif)
- [ ] **SKILL-03**: Skills content injected into system prompt or available to agent

### Deployment (DEPLOY)
- [ ] **DEPLOY-01**: Standalone polling mode (single instance per bot token)
- [ ] **DEPLOY-02**: Cloud webhook mode (HTTP server, Rachel Cloud compatible)
- [ ] **DEPLOY-03**: Interactive setup wizard (bot token, owner ID, shared folder)
- [ ] **DEPLOY-04**: systemd service installation
- [ ] **DEPLOY-05**: Docker support (Dockerfile with Bun, named volumes)

### Self-Management (SELF)
- [ ] **SELF-01**: Git access to own repository (commit, push)
- [ ] **SELF-02**: systemd service restart capability
- [ ] **SELF-03**: Startup confirmation message ("I'm back online!")
- [ ] **SELF-04**: Can modify own source code and deploy changes

### New Capabilities (NEW)
- [ ] **NEW-01**: Multi-provider hot-switching via pi-ai (/provider command)
- [ ] **NEW-02**: Token and cost tracking per conversation (/usage command)
- [ ] **NEW-03**: Context compaction (smart summarization of old messages)
- [ ] **NEW-04**: Thinking/reasoning levels (/thinking command)

## v2 Requirements (Deferred)

- Session branching (/fork conversations)
- Session export/import
- Session templates
- Custom tool installation at runtime
- Multi-user auth within single instance
- Web UI dashboard
- Advanced analytics
- Plugin marketplace

## Out of Scope

- Web UI — Telegram is the only interface
- Multi-user within single instance — handled by Rachel Cloud's container-per-user architecture
- Mobile app — Telegram client is sufficient
- Voice output (TTS) — only STT input

## Traceability

| Phase | Requirements |
|-------|-------------|
| Phase 1: Foundation | CORE-01 through CORE-07 |
| Phase 2: Agent Core | AGENT-01 through AGENT-14 |
| Phase 3: Telegram Transport | TG-01 through TG-15 |
| Phase 4: Memory & Persistence | MEM-01 through MEM-06, AGENT-11, AGENT-12 |
| Phase 5: Tasks & Media | TASK-01 through TASK-09, TG-02 through TG-09 |
| Phase 6: WhatsApp & Skills | WA-01 through WA-11, SKILL-01 through SKILL-03 |
| Phase 7: Deployment & Self-Management | DEPLOY-01 through DEPLOY-05, SELF-01 through SELF-04 |
| Phase 8: Pi-Mono Differentiators | NEW-01 through NEW-04 |
