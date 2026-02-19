# Rachel9 Roadmap

## Overview

**8 phases** | **68 requirements** | Full Rachel8 parity + pi-mono differentiators

Strategy: Ship a deployable bot as early as Phase 4 (basic chat works). Then layer features. Deploy to Lorenzo's container after Phase 5 for slow rollout testing alongside Rachel8.

---

## Phase 1: Foundation

**Goal:** Project setup, configuration, storage layer, and core infrastructure that everything else depends on.

**Requirements:** CORE-01, CORE-02, CORE-03, CORE-04, CORE-05, CORE-06, CORE-07

**Success Criteria:**
1. `bun run start` launches without errors, connects to Telegram (even if no message handling yet)
2. Environment variables validated with clear error messages for missing/invalid values
3. SQLite database opens with WAL mode, creates tasks table
4. SIGTERM triggers clean shutdown (DB closed, no orphan processes)
5. Both polling and webhook modes start based on RACHEL_CLOUD env var

**Deliverable:** Skeleton bot that starts, validates config, connects to Telegram, handles shutdown cleanly.

---

## Phase 2: Agent Core

**Goal:** Integrate pi-agent-core and pi-ai to create a working AI agent with tool calling — not yet connected to Telegram handlers.

**Requirements:** AGENT-01, AGENT-02, AGENT-03, AGENT-04, AGENT-05, AGENT-06, AGENT-07, AGENT-08, AGENT-09, AGENT-10, AGENT-13, AGENT-14

**Success Criteria:**
1. Agent class instantiated with Z.ai provider via pi-ai
2. All 7 tools registered and callable (bash, read, write, edit, web search, web fetch, telegram send)
3. Agent can process a text prompt and return a response with tool calls
4. Event subscriptions fire correctly (message_update, tool_execution_start/end, turn_end)
5. System prompt includes memory injection placeholder

**Deliverable:** Agent module that can be prompted programmatically and executes tools.

---

## Phase 3: Telegram Transport

**Goal:** Wire Telegram message handling to the Agent, with streaming responses and message queuing.

**Requirements:** TG-01, TG-10, TG-11, TG-12, TG-13, TG-14, TG-15

**Success Criteria:**
1. Text messages received and routed to Agent
2. Responses streamed back with Telegram message editing (throttled 500ms)
3. Auth middleware silently rejects unauthorized users
4. Per-chat message queue prevents concurrent agent runs
5. Telegram-specific markdown with plaintext fallback works reliably

**Deliverable:** Bot that responds to text messages with AI, streams responses, calls tools.

---

## Phase 4: Memory & Persistence

**Goal:** Session management, memory system, and context overflow handling — making the bot remember across restarts.

**Requirements:** MEM-01, MEM-02, MEM-03, MEM-04, MEM-05, MEM-06, AGENT-11, AGENT-12

**Success Criteria:**
1. Conversations persist to context.jsonl, restored on restart
2. MEMORY.md loaded into system prompt every query
3. Agent can read/write MEMORY.md and context/ files
4. Daily logs append automatically on every message
5. Context overflow detected and recovered (fresh session + notice)
6. Rachel8 memory files load without modification

**Deliverable:** Bot with persistent memory and conversation history. *This is the minimum viable product for deployment testing.*

---

## Phase 5: Tasks & Media

**Goal:** Task scheduler and all media message types — making Rachel fully functional for daily use.

**Requirements:** TASK-01 through TASK-09, TG-02 through TG-09, TG-09

**Success Criteria:**
1. All media types handled (photo, doc, voice, audio, video, video note, sticker)
2. Voice/audio messages transcribed via Groq Whisper STT
3. Files downloaded to persistent shared folder
4. Send-file CLI utility works (images, docs, video, audio)
5. Task scheduler polls every 30s, executes due tasks
6. Cron and one-off delayed tasks work correctly
7. Agent tasks trigger AI autonomously and send response via Telegram

**Deliverable:** Feature-rich bot ready for daily use. *Deploy to Lorenzo's container for slow rollout.*

---

## Phase 6: WhatsApp & Skills

**Goal:** Port WhatsApp bridge and skills system from Rachel8.

**Requirements:** WA-01 through WA-11, SKILL-01 through SKILL-03

**Success Criteria:**
1. WhatsApp connects via QR code and pairing code
2. Messages can be sent/received via CLI
3. Contact export and group listing work
4. Session persists across bot restarts
5. All 12 skills portable from Rachel8 skills/ directory
6. Skills referenced in system prompt

**Deliverable:** Full Rachel8 feature parity.

---

## Phase 7: Deployment & Self-Management

**Goal:** Production deployment support — setup wizard, systemd, Docker, self-management.

**Requirements:** DEPLOY-01 through DEPLOY-05, SELF-01 through SELF-04

**Success Criteria:**
1. Setup wizard guides new users through configuration
2. systemd service installs and auto-restarts on failure
3. Dockerfile builds and runs correctly
4. Bot can modify own code, commit, push, and restart
5. Startup confirmation message sent after restart
6. Works in Rachel Cloud containers (webhook mode, shared bot routing)

**Deliverable:** Production-ready deployment for both standalone and Rachel Cloud.

---

## Phase 8: Pi-Mono Differentiators

**Goal:** New capabilities that pi-mono enables beyond Rachel8.

**Requirements:** NEW-01 through NEW-04

**Success Criteria:**
1. `/provider` command switches LLM provider at runtime
2. `/usage` command shows token counts and estimated costs
3. Context compaction triggers automatically before overflow
4. `/thinking` command adjusts reasoning depth

**Deliverable:** v1.1 — Rachel9 with unique capabilities beyond Rachel8.

---

## Timeline & Deployment Strategy

| Phase | Estimated | Cumulative | Deployable? |
|-------|-----------|------------|-------------|
| Phase 1: Foundation | 1-2 days | Day 2 | No |
| Phase 2: Agent Core | 2-3 days | Day 5 | No |
| Phase 3: Telegram Transport | 1-2 days | Day 7 | Barely (text only) |
| Phase 4: Memory & Persistence | 1-2 days | Day 9 | *Yes — MVP* |
| Phase 5: Tasks & Media | 2-3 days | Day 12 | *Yes — daily use* |
| Phase 6: WhatsApp & Skills | 2-3 days | Day 15 | Yes — full parity |
| Phase 7: Deployment & Self-Mgmt | 1-2 days | Day 17 | Yes — production |
| Phase 8: Differentiators | 2-3 days | Day 20 | Yes — v1.1 |

**Slow rollout plan:**
- After Phase 5: Deploy Rachel9 to Lorenzo's container alongside Rachel8
- Compare behavior, catch edge cases
- If good enough → migrate Rachel Cloud containers
- If not → iterate before wider rollout

---

## Dependencies

```
Phase 1 (Foundation)
  ↓
Phase 2 (Agent Core)
  ↓
Phase 3 (Telegram Transport)
  ↓
Phase 4 (Memory & Persistence) ──→ DEPLOY TO LORENZO'S CONTAINER
  ↓
Phase 5 (Tasks & Media) ──→ SLOW ROLLOUT TESTING
  ↓
Phase 6 (WhatsApp & Skills)    [can run parallel with Phase 7]
Phase 7 (Deployment & Self-Mgmt) [can run parallel with Phase 6]
  ↓
Phase 8 (Differentiators)
```
