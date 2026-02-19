# Rachel9 Feature Research

A comprehensive analysis of features for Rachel9 — a rewrite of Rachel8 using the pi-mono framework.

## Research Context

**Rachel8 Foundation:** Personal AI agent bot on Telegram with Claude Agent SDK, full tool access (bash, files, web), memory system, task scheduler, WhatsApp bridge, STT, 12 skills, dual deployment modes, and self-management capabilities.

**Pi-Mono Framework:** TypeScript AI agent toolkit with unified multi-provider LLM API, streaming support, coding agent CLI, extensibility system, session management, and context compaction.

**Sources:**
- [pi-mono GitHub Repository](https://github.com/badlogic/pi-mono)
- [pi-mono coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)
- [Pi-Mono Overview](https://www.toolworthy.ai/tool/pi-mono)
- Rachel8 codebase analysis

---

## 1. Table Stakes (Must Have for v1)

Everything Rachel8 already does that must be ported to Rachel9.

### 1.1 Core Telegram Bot (High Complexity)

**What:** Full Telegram integration with media handling
- Text message handling
- Photo/image processing with vision
- Document/file upload handling
- Voice message transcription
- Audio file transcription
- Video and video note handling
- Sticker handling (static/animated/video)
- Telegram file download to persistent storage
- Telegram file sending utility (CLI for agent)
- Caption support for all media types
- Markdown formatting for responses (Telegram-specific constraints)
- Typing indicator (chat action) during processing
- Single-user authentication middleware

**Complexity:** HIGH
- Requires deep grammY integration
- Media handling and transcription pipeline
- File I/O with persistent storage management
- Telegram-specific markdown constraints

### 1.2 AI Agent with Full Tool Calling (Medium Complexity)

**What:** Complete agent runtime with tool access
- Bash command execution (unrestricted)
- File system operations (Read, Write, Edit)
- Web search and fetch capabilities
- Tool call error handling and recovery
- Multi-turn conversations
- Session management and persistence
- Permission bypass mode (no confirmations)
- Context overflow recovery with session reset

**Complexity:** MEDIUM
- Pi-mono provides agent runtime out of box
- Need to map Claude SDK permissions to pi-mono
- Session continuation logic already in pi-mono
- Tool implementations may need adaptation

### 1.3 Memory System (Medium Complexity)

**What:** Persistent memory across conversations
- MEMORY.md (core facts, loaded in system prompt)
- Daily logs (auto-logged conversations by date)
- Context files (deep topic knowledge, indexed by topic)
- Memory initialization on startup
- System prompt injection with memory content
- File-based storage in shared folder

**Complexity:** MEDIUM
- File system operations straightforward
- System prompt building needs integration
- Memory compaction strategy to prevent bloat

### 1.4 Task Scheduler (High Complexity)

**What:** SQLite-backed autonomous task system
- One-off delayed tasks
- Recurring cron tasks (cron pattern parsing)
- Task types: bash, reminder, cleanup, agent
- Agent tasks (autonomous execution with full tools)
- Reminder tasks (Telegram notifications)
- Bash tasks (scheduled commands)
- Cleanup tasks (process management)
- 30-second polling loop
- SQLite persistence (survives restarts)
- Task management API (add, remove, list)
- Telegram integration for reminders
- Agent executor integration for agent tasks

**Complexity:** HIGH
- Requires custom SQLite implementation
- Cron parser and scheduler logic
- Agent task execution needs pi-mono integration
- Background polling process management

### 1.5 WhatsApp Bridge (Very High Complexity)

**What:** Full WhatsApp Web integration via Baileys
- QR code authentication
- Pairing code authentication (phone number)
- Session persistence across restarts
- Contact name caching and persistence
- Group listing and metadata
- Group contact export (CSV)
- Message sending (text, files, images, videos, audio)
- Message history caching (200 per chat)
- Recent message retrieval
- Contact search (fuzzy matching)
- Auto-reconnect on disconnect
- Multi-file auth state management
- History sync for full contact list

**Complexity:** VERY HIGH
- Baileys integration is complex and fragile
- QR code generation and handling
- Session state management
- WebSocket connection handling
- Contact resolution (LID vs phone JID)
- Reconnection logic for 515 errors

### 1.6 Speech-to-Text (Low Complexity)

**What:** Audio/voice transcription
- Groq Whisper API integration
- OpenAI Whisper API fallback
- Voice message (.ogg) support
- Audio file (.mp3, .m4a, etc.) support
- Transcription result injection into prompts

**Complexity:** LOW
- API call wrapper
- File format handling already in Telegram handlers

### 1.7 Skills System (Medium Complexity)

**What:** 12 extensible skills
- PDF generation and manipulation
- Excel (XLSX) creation and editing
- Word (DOCX) creation and editing
- PowerPoint (PPTX) creation and editing
- Frontend/web design
- Web artifacts builder
- Skill creator (meta-skill)
- MCP builder
- Webapp testing
- Algorithmic art (Three.js)
- Canvas design
- Slack GIF creator
- WhatsApp bridge (skill wrapper)

**Complexity:** MEDIUM
- Pi-mono has Agent Skills standard
- Skills are markdown files with prompts
- Need to port 12 skills to pi-mono format
- Some skills may need TypeScript extensions

### 1.8 Dual Deployment (Medium Complexity)

**What:** Two deployment modes
- Standalone polling mode (long polling via grammY)
- Cloud webhook mode (HTTP server receiving Telegram updates)
- Environment variable detection (RACHEL_CLOUD flag)
- Health check endpoint (/health)
- Webhook endpoint (/webhook)
- Bot initialization without polling in webhook mode
- Port configuration (default 8443)

**Complexity:** MEDIUM
- HTTP server with Bun.serve
- Webhook signature validation (optional)
- Mode detection and conditional startup

### 1.9 Self-Management (Medium Complexity)

**What:** Bot can modify and restart itself
- Git access to own repository (~/rachel8)
- Commit and push changes
- Systemd service restart via DBUS
- Startup message ("I'm back online!")
- Startup message debouncing (30s lock)
- Graceful shutdown on SIGTERM/SIGINT
- Restart delay (60s message delivery window)

**Complexity:** MEDIUM
- Git operations via bash tools
- Systemd integration requires careful handling
- DBUS environment variable setup
- Lock file management for debouncing

### 1.10 File Sending CLI (Low Complexity)

**What:** CLI utility for sending files via Telegram
- Send images with caption
- Send documents with caption
- Send videos with caption
- Send audio files
- Automatic file type detection
- Telegram Bot API integration

**Complexity:** LOW
- Simple HTTP API wrapper
- File reading and multipart upload

### 1.11 Session Management with Context Overflow Recovery (Medium Complexity)

**What:** Long-lived conversations with context limits
- Session ID persistence to file (.sessions.json)
- Session restoration on restart
- Context overflow detection (error message parsing)
- Automatic session reset on overflow
- Fresh session retry with same prompt
- User notification of context reset
- Memory system intact across sessions

**Complexity:** MEDIUM
- Pi-mono already handles context compaction
- Need to integrate with Telegram chat IDs
- Session continuation prompt generation

### 1.12 Environment Configuration (Low Complexity)

**What:** Zod-validated environment variables
- TELEGRAM_BOT_TOKEN
- OWNER_TELEGRAM_USER_ID
- SHARED_FOLDER_PATH
- NODE_ENV
- LOG_LEVEL
- CLAUDE_MODEL (override)
- RACHEL_CLOUD (deployment mode)
- WEBHOOK_PORT

**Complexity:** LOW
- Zod schema definition
- Environment loading with dotenv

### 1.13 Logging System (Low Complexity)

**What:** Structured logging
- Log levels (debug, info, warn, error)
- Structured JSON output
- Context metadata support
- Error message extraction utility

**Complexity:** LOW
- Simple logger implementation
- Console output with timestamps

### 1.14 Setup Wizard (Medium Complexity)

**What:** Interactive first-time setup
- Telegram bot token prompt
- Owner user ID prompt
- Shared folder path configuration
- Systemd service installation option
- Service file generation from template
- Service enable and start
- Validation helpers (token format, user ID format)

**Complexity:** MEDIUM
- @clack/prompts integration
- File system operations
- Service file templating
- Systemd commands execution

---

## 2. Differentiators (New Capabilities Pi-Mono Enables)

Features that Rachel8 doesn't have but pi-mono enables out of the box or with minimal effort.

### 2.1 Streaming Responses (Medium Complexity)

**What:** Edit Telegram message as AI tokens stream in
- Real-time message updates as agent thinks
- Progressive disclosure of long responses
- Visual feedback during tool execution
- Transport selection (SSE, WebSocket, auto)

**Why valuable:** Immediate user feedback, perceived performance improvement, transparency into agent reasoning

**Complexity:** MEDIUM
- Pi-mono provides streaming primitives
- Telegram editMessageText API integration
- Rate limiting to avoid Telegram API limits
- Graceful fallback on edit failures

**Implementation notes:**
- Buffer tokens into sentences/paragraphs before editing
- Throttle edits to ~1-2 per second max
- Handle Telegram message length limits (4096 chars)
- Fall back to new message if edit fails

### 2.2 Multi-Provider Hot-Switching (Low Complexity)

**What:** Switch between AI providers without code changes
- OpenAI, Anthropic, Google, xAI, Groq, Cerebras, OpenRouter
- Per-chat provider selection
- Model selection UI (Telegram inline keyboard)
- Provider authentication storage
- Cost comparison across providers
- Fallback chain on provider failures

**Why valuable:** Cost optimization, redundancy, feature access (some providers have better vision/audio), experimentation

**Complexity:** LOW
- Pi-mono unified API abstracts providers
- Need Telegram UI for selection (/model command)
- Provider credentials management
- Session storage for per-chat preferences

**Implementation notes:**
- Store provider preference in chat session
- Telegram command: `/provider openai` or `/provider anthropic`
- Show current provider in status message
- Auto-fallback on rate limits or errors

### 2.3 Advanced Tool Error Handling and Retry (Low Complexity)

**What:** Intelligent error recovery beyond Rachel8's basic retry
- Automatic retry with exponential backoff
- Tool-specific error handlers
- Context-aware error messages to agent
- Error history tracking
- User notification of retries

**Why valuable:** More reliable tool execution, less user intervention, better debugging

**Complexity:** LOW
- Pi-mono may have some error handling built-in
- Custom retry logic for Telegram-specific failures
- Error type classification and routing

**Implementation notes:**
- Wrap tool calls with retry decorators
- Log error patterns for debugging
- Inject error context back to agent for self-correction

### 2.4 Agent Event Subscriptions (Medium Complexity)

**What:** Hook into agent lifecycle events
- `tool_call` - before/after tool execution
- `message_start` - new user message received
- `message_complete` - agent response finished
- `thinking_start` - agent reasoning begins
- `thinking_complete` - reasoning finishes
- `context_compact` - compaction triggered
- `error` - any error during execution

**Why valuable:** Observability, custom integrations (analytics, logging, notifications), extensibility

**Complexity:** MEDIUM
- Pi-mono has event system (`pi.on(...)`)
- Need to wire Telegram events to agent events
- Persistent event handlers across sessions

**Implementation notes:**
- Use for custom logging, metrics collection
- Telegram typing indicator on `thinking_start`
- Analytics events on tool usage patterns
- Custom notifications on long-running tasks

### 2.5 Thinking/Reasoning Levels (Low Complexity)

**What:** Adjustable reasoning depth
- Different thinking modes (quick, normal, deep)
- Model-specific thinking level support
- Token budget adjustment per level
- Visual indicator of current level
- Per-chat thinking preference

**Why valuable:** Cost control, speed vs quality tradeoffs, user preference

**Complexity:** LOW
- Pi-mono supports thinking levels via model config
- Telegram command to select level: `/thinking deep`
- Store preference in session
- Show current level in status

**Implementation notes:**
- Map to provider-specific parameters
- Claude extended thinking, O1 reasoning mode, etc.
- Default to "normal" for cost efficiency

### 2.6 Token and Cost Tracking Per Conversation (Medium Complexity)

**What:** Detailed usage analytics
- Tokens used per message
- Cache hit ratio (prompt caching)
- Cost calculation per provider
- Session total cost
- Monthly spend tracking
- Per-chat spend limits
- Export usage reports (CSV, JSON)

**Why valuable:** Budget control, cost attribution, usage patterns analysis

**Complexity:** MEDIUM
- Pi-mono tracks tokens in session footer
- Need persistent storage (SQLite?)
- Provider-specific cost formulas
- Telegram commands to query usage

**Implementation notes:**
- `/usage` command shows current session stats
- `/usage weekly` for rolling window
- Alert on budget thresholds
- Integrate with task scheduler for monthly reports

### 2.7 Custom Message Types for Telegram Metadata (Low Complexity)

**What:** Richer message context beyond text
- Sender metadata (username, first name, chat type)
- Reply-to message threading
- Forward metadata (original sender)
- Edit history
- Reaction tracking
- Message metadata injection into prompts

**Why valuable:** Better context for agent decisions, conversation threading, attribution

**Complexity:** LOW
- grammY provides full message objects
- Extract relevant metadata
- Format into structured prompts
- Optional: store in daily logs

**Implementation notes:**
- Include metadata in timestamp prefix
- Example: `15/02 14:32CET [reply to: "previous message"] User message`
- Track conversation threads for better context

### 2.8 Context Transformation and Smart Compaction (Medium Complexity)

**What:** Intelligent context management beyond simple reset
- Automatic summarization of old messages
- Retention of recent N messages in full
- Custom compaction instructions
- Manual compaction trigger
- Lossy history with full JSONL backup
- Context budget monitoring
- Proactive compaction before overflow

**Why valuable:** Longer conversations without resets, preserve important context, reduce costs

**Complexity:** MEDIUM
- Pi-mono has built-in compaction
- Need to integrate with Telegram sessions
- Custom compaction prompts for domain-specific summarization
- Balance between context retention and cost

**Implementation notes:**
- Trigger compaction at 70-80% of context limit
- Preserve: system prompt, memory, last N messages
- Summarize: older conversation turns, tool results
- Telegram command: `/compact` with optional instructions
- Show compaction success message with stats

### 2.9 Extensions and Custom Tools (High Complexity)

**What:** TypeScript-based extensibility system
- Custom tool registration
- Extension marketplace (npm packages)
- Hot-reload of extensions
- Extension configuration UI
- Sandboxed execution
- Extension permissions system

**Why valuable:** Community contributions, specialized workflows, domain-specific tools

**Complexity:** HIGH
- Pi-mono has extension system
- Need Telegram UI for extension management
- Security concerns with user-installed extensions
- Extension discovery and installation

**Implementation notes:**
- Start with admin-only extensions
- Allowlist of safe extensions
- Extension commands: `/ext install name`, `/ext list`, `/ext remove name`
- Extensions stored in shared folder for persistence

### 2.10 Advanced Session Management (Medium Complexity)

**What:** Beyond simple session persistence
- Session branching (fork conversations)
- Session merging
- Session tree visualization
- Session export/import
- Session sharing (between users or instances)
- Session templates (pre-loaded context)

**Why valuable:** Experimentation, collaboration, context reuse, conversation management

**Complexity:** MEDIUM
- Pi-mono has session branching (`/fork`)
- Telegram UI for session management
- JSONL storage already in pi-mono
- Export to Telegram as document

**Implementation notes:**
- `/fork` command creates new branch
- `/sessions` lists past sessions with previews
- `/export` sends session JSONL to Telegram
- Session templates for common workflows (e.g., "research mode", "coding mode")

---

## 3. Anti-features (Deliberately Exclude or Defer)

Things to avoid building in v1 to maintain focus and simplicity.

### 3.1 Multi-User Support (Defer)

**Why exclude:** Rachel is a personal AI assistant, not a multi-tenant platform
- Adds auth complexity
- Requires user management, permissions, quotas
- Session isolation challenges
- Data privacy concerns

**Alternative:** Users deploy their own instance (Rachel8 model)

**Complexity if built:** VERY HIGH

### 3.2 Built-in MCP Support (Defer)

**Why exclude:** Pi-mono philosophy - keep core minimal, add via extensions
- MCP is complex and evolving
- Can be added as extension later
- Most use cases covered by existing tools
- Skills system provides similar extensibility

**Alternative:** Build as extension/skill when needed

**Complexity if built:** HIGH

### 3.3 Plan Mode / Autonomous Agents (Defer)

**Why exclude:** Out of scope for v1, high complexity
- Requires planning, execution, verification loops
- Multi-agent coordination
- Long-running autonomous tasks better handled by task scheduler
- Risk of runaway costs/tokens

**Alternative:** Use task scheduler for scheduled agent tasks

**Complexity if built:** VERY HIGH

### 3.4 Web UI (Defer)

**Why exclude:** Telegram is the interface
- Telegram already provides excellent UI
- Web UI adds maintenance burden
- Mobile experience worse than native Telegram
- Authentication and security concerns

**Alternative:** Use Telegram for everything (Rachel8 model)

**Complexity if built:** HIGH

### 3.5 Voice Output / TTS (Defer)

**Why exclude:** Not core to v1, limited use cases
- Most users prefer text responses
- TTS quality varies
- Telegram voice message API is complex
- Increases hosting costs (audio processing)

**Alternative:** Users can use Telegram's built-in TTS if needed

**Complexity if built:** MEDIUM

### 3.6 Image Generation (Defer)

**Why exclude:** Can be added as skill later
- DALL-E, Midjourney, Stable Diffusion via APIs
- Not core agent functionality
- Cost and quota management needed
- Skills system can handle this

**Alternative:** Build as skill when needed

**Complexity if built:** LOW (skill), MEDIUM (built-in)

### 3.7 Database for Memory (Defer)

**Why exclude:** File-based memory is simpler
- SQLite adds complexity
- File-based is human-readable and debuggable
- Git-friendly for version control
- Search can be handled by agent with grep/search tools

**Alternative:** Stick with markdown files (Rachel8 model)

**Complexity if built:** MEDIUM

### 3.8 Analytics Dashboard (Defer)

**Why exclude:** Query via agent is sufficient
- Agent can analyze its own logs/usage with tools
- Dedicated dashboard is overkill for single user
- Can export data and visualize externally if needed

**Alternative:** Agent self-service queries, export to CSV

**Complexity if built:** HIGH

### 3.9 Marketplace for Skills (Defer)

**Why exclude:** Too early, manual installation is fine
- Small user base initially
- GitHub repos sufficient for sharing
- Quality control challenges
- Security vetting needed

**Alternative:** Curated GitHub repos, manual installation

**Complexity if built:** VERY HIGH

### 3.10 Fine-tuning / Custom Models (Defer)

**Why exclude:** Out of scope, use general models
- Very high complexity
- Maintenance burden
- Most users won't benefit
- Provider APIs evolve too fast

**Alternative:** Prompt engineering, system prompts, skills

**Complexity if built:** VERY HIGH

---

## Feature Summary

### Must Have (Table Stakes): 14 features
- Core Telegram Bot ✓
- AI Agent with Full Tool Calling ✓
- Memory System ✓
- Task Scheduler ✓
- WhatsApp Bridge ✓
- Speech-to-Text ✓
- Skills System ✓
- Dual Deployment ✓
- Self-Management ✓
- File Sending CLI ✓
- Session Management ✓
- Environment Configuration ✓
- Logging System ✓
- Setup Wizard ✓

### Differentiators (Pi-Mono Enables): 10 features
- Streaming Responses (MEDIUM) - High value
- Multi-Provider Hot-Switching (LOW) - High value
- Advanced Tool Error Handling (LOW) - Medium value
- Agent Event Subscriptions (MEDIUM) - Medium value
- Thinking/Reasoning Levels (LOW) - Medium value
- Token and Cost Tracking (MEDIUM) - High value
- Custom Message Types (LOW) - Low value
- Context Transformation (MEDIUM) - High value
- Extensions and Custom Tools (HIGH) - High value (defer to v1.1?)
- Advanced Session Management (MEDIUM) - Medium value

### Anti-features (Defer): 10 features
- Multi-User Support
- Built-in MCP Support
- Plan Mode / Autonomous Agents
- Web UI
- Voice Output / TTS
- Image Generation
- Database for Memory
- Analytics Dashboard
- Marketplace for Skills
- Fine-tuning / Custom Models

---

## Recommended v1 Feature Set

### Phase 1: Core Migration (Table Stakes)
1. Core Telegram Bot
2. AI Agent with Full Tool Calling
3. Memory System
4. Session Management
5. Environment Configuration
6. Logging System

### Phase 2: Essential Integrations
7. Speech-to-Text
8. File Sending CLI
9. Setup Wizard
10. Dual Deployment

### Phase 3: Advanced Features
11. Task Scheduler
12. WhatsApp Bridge
13. Skills System (port existing 12 skills)
14. Self-Management

### Phase 4: Pi-Mono Differentiators (v1.1)
15. Streaming Responses
16. Multi-Provider Hot-Switching
17. Token and Cost Tracking
18. Context Transformation
19. Thinking/Reasoning Levels

### Defer to v2+
- Advanced Session Management
- Agent Event Subscriptions
- Extensions and Custom Tools
- All Anti-features

---

## Technical Decisions Needed

1. **Pi-mono package choice:**
   - Use `@mariozechner/pi-agent-core` as runtime
   - Use `@mariozechner/pi-ai` for provider abstraction
   - Use skills system for extensibility
   - Skip `pi-coding-agent` CLI (too opinionated for Telegram bot)

2. **Session storage:**
   - JSONL format (pi-mono native)
   - Map Telegram chat ID to session file
   - Store in shared folder: `$SHARED_FOLDER_PATH/sessions/chat-{id}.jsonl`

3. **Memory integration:**
   - Keep Rachel8 file-based approach
   - Inject MEMORY.md into system prompt
   - Use pi-mono compaction for conversation history
   - Daily logs separate from session JSONL

4. **Tool mapping:**
   - Map pi-mono tools to Claude SDK equivalents
   - Bash, Read, Write, Edit already in pi-mono
   - Add Web (search, fetch) as custom tools
   - Telegram file operations as custom tools

5. **Streaming implementation:**
   - Use pi-mono streaming events
   - Buffer tokens into sentences
   - Rate-limit Telegram edits (1 per second)
   - Fall back to new message on edit failure

6. **Provider management:**
   - Store provider credentials in shared folder
   - Per-chat provider preference in session metadata
   - Default to Anthropic (Claude) for compatibility
   - Add Telegram commands for switching

---

## Migration Path from Rachel8 to Rachel9

1. **Direct ports (minimal changes):**
   - Environment configuration
   - Logging system
   - Memory system (file structure)
   - File sending CLI
   - Setup wizard
   - STT integration

2. **Adaptations (moderate changes):**
   - Telegram handlers (grammY → grammY + pi-mono events)
   - Session management (custom → JSONL)
   - Agent runtime (Claude SDK → pi-mono)
   - Skills (markdown → Agent Skills format)

3. **Rewrites (significant changes):**
   - Task scheduler (if integrating with pi-mono events)
   - WhatsApp bridge (maintain as-is, might need event integration)
   - Self-management (adapt to new repo structure)

---

## Complexity Matrix

| Feature | Complexity | Priority | Effort (days) |
|---------|-----------|----------|---------------|
| Core Telegram Bot | HIGH | P0 | 5 |
| AI Agent Runtime | MEDIUM | P0 | 3 |
| Memory System | MEDIUM | P0 | 2 |
| Session Management | MEDIUM | P0 | 3 |
| Task Scheduler | HIGH | P1 | 4 |
| WhatsApp Bridge | VERY HIGH | P1 | 6 |
| Skills System | MEDIUM | P1 | 3 |
| STT Integration | LOW | P1 | 1 |
| Dual Deployment | MEDIUM | P1 | 2 |
| Self-Management | MEDIUM | P2 | 2 |
| Setup Wizard | MEDIUM | P2 | 2 |
| Streaming Responses | MEDIUM | P2 | 3 |
| Multi-Provider | LOW | P2 | 2 |
| Cost Tracking | MEDIUM | P3 | 3 |
| Context Compaction | MEDIUM | P3 | 2 |

**Total estimated effort for v1:** ~40 days (single developer)

---

## Open Questions

1. **Pi-mono session compatibility:** Can we resume Claude SDK sessions in pi-mono, or start fresh?
2. **Thinking levels:** Which providers support which levels? Need mapping.
3. **Cost formulas:** Pi-mono tracks tokens, but cost calculation needs provider pricing data.
4. **Extension security:** How to safely allow user-installed extensions?
5. **WhatsApp + pi-mono events:** Should WhatsApp messages trigger agent events?
6. **Streaming rate limits:** What's optimal Telegram edit frequency?
7. **Skills format:** Exact Agent Skills spec and examples needed.
8. **Context compaction:** Pi-mono compaction vs Rachel8 memory system - how to integrate?

---

## Next Steps

1. **Set up pi-mono development environment**
   - Install packages: `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`
   - Create test project with Telegram integration
   - Verify streaming works with Telegram edits

2. **Prototype core loop**
   - Telegram message → pi-mono agent → streaming response
   - Session persistence to JSONL
   - Memory injection into system prompt

3. **Port one skill as proof-of-concept**
   - Choose simple skill (PDF generation?)
   - Convert to Agent Skills format
   - Test invocation from Telegram

4. **Document architecture decisions**
   - File structure
   - Deployment model
   - Configuration management
   - Testing strategy

5. **Create migration plan**
   - Data migration (sessions, memory)
   - User communication
   - Rollback strategy
   - Parallel deployment period
