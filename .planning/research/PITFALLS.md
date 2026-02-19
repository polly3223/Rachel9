# Rachel9 Pitfalls Research

**Migration Context:** Rachel8 (Claude Agent SDK) → Rachel9 (pi-mono framework)
**Target Runtime:** Bun (pi-mono built for Node.js/npm)
**Primary LLM:** Z.ai (Anthropic-compatible API)
**Messaging:** Telegram (grammY), WhatsApp (Baileys)
**Deployment:** Docker containers
**Researched:** 2026-02-19
**Confidence:** HIGH

---

## 1. Bun + pi-mono Compatibility Pitfalls

### 1.1 Module Resolution Differences

**What goes wrong:**
pi-mono packages use Node.js ESM conventions that may resolve differently in Bun. Import paths that work in Node fail in Bun with "module not found" errors, particularly for package subpath imports and conditional exports.

**Why it happens:**
- Bun's module resolver is faster but less forgiving than Node's
- Different handling of `package.json` `exports` field
- Bun prioritizes `bun` field over `node` field in package.json
- pi-mono uses `@mariozechner/*` monorepo structure with internal dependencies

**Warning signs:**
- `Cannot find module '@mariozechner/pi-agent-core/...'` errors
- Imports work in Node but fail in Bun
- TypeScript resolves imports but runtime fails
- Inconsistent behavior between `bun run` and `bun --bun run`

**Prevention:**
- Use exact package entry points from package.json exports
- Avoid deep imports into package internals
- Test all imports with `bun run` early in development
- Check if packages require `--bun` flag for native compatibility
- Consider using `bunfig.toml` to configure module resolution
- Pin exact versions of pi-mono packages to avoid resolution changes

**Phase to address:** Phase 1 (Foundation) - Validate all pi-mono imports work in Bun before building features

---

### 1.2 Native Addon Incompatibilities

**What goes wrong:**
34% of projects encounter compatibility challenges with Bun. Native Node.js addons (N-API modules) may fail to load or crash Bun runtime. Common problem packages: `bcrypt`, `sharp`, some database drivers.

**Why it happens:**
- Bun uses JavaScriptCore instead of V8
- Different ABI for native modules
- Some packages check `process.version` and reject non-Node runtimes
- Native modules compiled for Node may have V8-specific dependencies

**Warning signs:**
- Segmentation faults during package initialization
- "incompatible module" errors
- `dlopen` failures in logs
- Package install succeeds but runtime crashes on import

**Prevention:**
- Audit all dependencies for native modules: `npm ls --all | grep natives`
- Check [Bun compatibility tracker](https://bun.com/docs/runtime/nodejs-compat) for known issues
- For pi-mono specifically: check if it bundles any native dependencies
- Test native dependencies in Docker container early (same as production)
- Have fallback pure-JS alternatives (e.g., `bcryptjs` instead of `bcrypt`)
- Use Bun's built-in APIs when available (sqlite, http, etc.) instead of npm packages

**Phase to address:** Phase 1 (Foundation) - Complete dependency audit before starting implementation

---

### 1.3 bun:sqlite vs better-sqlite3

**What goes wrong:**
Code written for `better-sqlite3` won't work with `bun:sqlite` without modifications. API differences cause runtime errors. Libraries expecting `better-sqlite3` (like Drizzle ORM, some ORMs) fail with Bun's native SQLite.

**Why it happens:**
- `bun:sqlite` API is "inspired by" but not 1:1 compatible with `better-sqlite3`
- Different method signatures (e.g., prepared statement syntax)
- `bun:sqlite` doesn't implement all better-sqlite3 features
- `better-sqlite3` cannot run in Bun without recompilation (ABI version differences)
- Some libraries like better-auth expect a `better-sqlite3` adapter specifically

**Warning signs:**
- Method signatures don't match (e.g., `.prepare()` behaves differently)
- Missing methods on Database object
- Type errors when passing Bun Database to libraries expecting better-sqlite3
- Drizzle Kit or other tools don't recognize bun:sqlite

**Prevention:**
- Use `bun:sqlite` from the start - don't try to port better-sqlite3 code
- Check if pi-mono has SQLite dependencies (it may use its own storage)
- Create adapter layer if you need to pass db to libraries expecting better-sqlite3
- Reference exists: [bun-better-sqlite3 compatibility layer](https://github.com/nounder/bun-better-sqlite3)
- Document which SQLite API you're using in code comments
- Test all database operations in Bun early

**Performance note:** bun:sqlite is 3-6x faster than better-sqlite3 for read queries

**Phase to address:** Phase 1 (Foundation) - Choose SQLite approach before building storage layer

---

### 1.4 TypeScript Compilation Differences

**What goes wrong:**
Bun's built-in TypeScript transpiler behaves differently from `tsc`. Some valid TypeScript compiles in Node but fails in Bun or produces different runtime behavior.

**Why it happens:**
- Bun uses its own TypeScript transpiler (not tsc)
- No type checking during transpilation (types are stripped only)
- Different handling of decorators, enums, const assertions
- Bun transpiles on-the-fly; Node typically uses pre-compiled JS

**Warning signs:**
- Code works when compiled with `tsc` but fails with `bun run`
- Enum values not what you expect at runtime
- Decorator-related errors
- Namespace resolution issues

**Prevention:**
- Use `tsc --noEmit` for type checking even if running with Bun
- Avoid complex TypeScript features (decorators, namespaces, const enums)
- Prefer interfaces over types for better compatibility
- Test compiled output behavior matches expectations
- Add npm script: `"typecheck": "tsc --noEmit"`
- Configure tsconfig.json for both Bun runtime and type safety

**Phase to address:** Phase 1 (Foundation) - Set up TypeScript tooling correctly from start

---

### 1.5 process.binding and Internal APIs

**What goes wrong:**
Some npm packages rely on Node.js internal APIs like `process.binding()` which are partially implemented or missing in Bun. Packages fail with "process.binding is not implemented" errors.

**Why it happens:**
- `process.binding()` is Node.js internal API (undocumented, discouraged)
- Bun implements core Node APIs but not all internal ones
- Legacy packages or packages doing low-level operations may use these
- pi-mono or its dependencies might use these for performance

**Warning signs:**
- `process.binding is not a function` errors
- Packages that work in Node fail mysteriously in Bun
- Low-level buffer/stream operations failing
- Native module shims breaking

**Prevention:**
- Search codebase for `process.binding` usage: `grep -r "process.binding"`
- Check if pi-mono dependencies use internal Node APIs
- Test entire dependency tree in Bun during Phase 1
- Report issues to Bun GitHub with reproduction case
- Have fallback implementations or alternative packages ready
- Monitor [Bun compatibility roadmap](https://bun.com/docs/runtime/nodejs-compat)

**Phase to address:** Phase 1 (Foundation) - Discover during dependency testing

---

## 2. pi-mono Gotchas

### 2.1 Agent State Not Automatically Persisted

**What goes wrong:**
Agent conversations live in memory. Process restart loses all conversation context unless explicitly saved. Users experience amnesia - agent forgets everything mid-conversation after restart.

**Why it happens:**
- pi-agent-core `Agent` class manages state in-memory
- No built-in persistence layer
- Long-running Telegram bot needs conversation continuity across restarts
- Different from Claude Agent SDK which has session persistence

**Warning signs:**
- After process restart, agent doesn't remember previous conversation
- No way to resume interrupted conversations
- Memory usage grows unbounded as conversation continues
- Users report "you forgot what we were talking about"

**Prevention:**
- Implement explicit conversation serialization
- Save agent state to SQLite after each turn
- Design state schema: `chat_id`, `messages[]`, `tool_results[]`, `metadata`
- Restore state on agent initialization
- Consider conversation compaction strategy (summarize old messages)
- Use sliding window: keep last N messages, summarize older ones
- Monitor memory growth per chat_id

**Migration note:** Rachel8 uses Claude Agent SDK session IDs for persistence. Rachel9 needs custom implementation.

**Phase to address:** Phase 1 (Foundation) - Design persistence layer before building agent loop

---

### 2.2 Tool Execution Without Sandboxing

**What goes wrong:**
pi-mono tools execute with full process permissions. No built-in sandboxing or command allowlisting. Agent can run arbitrary shell commands, access any file, make any network request. Prompt injection leads to system compromise.

**Why it happens:**
- pi-mono is a minimal framework - security is implementer's responsibility
- Tools are just async functions with no execution restrictions
- Designed for trusted local use (coding agent on developer machine)
- Rachel9 runs as service with external input (Telegram messages)

**Warning signs:**
- Tool definitions that use `exec` or `spawn` without validation
- No command allowlist in tool implementations
- Agent process running as root or with sudo access
- File operations don't check path boundaries

**Prevention:**
- **NEVER** run Rachel9 process with sudo/root privileges
- Implement command allowlist in shell tool: only approved commands
- Sandbox file operations: restrict to specific directories (e.g., `$SHARED_FOLDER_PATH`)
- Validate all tool arguments before execution
- Use Bun's `$` shell template (safer than raw exec)
- Log all tool executions for audit
- Consider Docker security: run container as non-root user, read-only root filesystem
- Implement user confirmation for dangerous operations

**Critical:** This is more important than Rachel8 because pi-mono has no built-in safety

**Phase to address:** Phase 1 (Foundation) - Build security layer before implementing any tools

---

### 2.3 Streaming with Concurrent Messages

**What goes wrong:**
Multiple users send messages simultaneously. Agent processes them concurrently, but streaming state gets mixed up. User A receives chunks meant for User B. Or agent crashes with "already streaming" errors.

**Why it happens:**
- Single Agent instance shared across multiple conversations
- Streaming events don't have chat-specific isolation
- Event subscribers receive all events, not filtered by context
- Race conditions in state updates when processing concurrent messages

**Warning signs:**
- Users report receiving wrong responses or partial responses
- Streaming chunks interleaved between conversations
- "State is inconsistent" errors in logs
- Message delivered to wrong chat_id

**Prevention:**
- **Option 1:** One Agent instance per chat_id (memory intensive but isolated)
- **Option 2:** Queue messages per chat, process serially
- **Option 3:** Use agent instance pool with proper locking
- Filter streaming events by conversation context before sending to Telegram
- Add chat_id to all agent events for routing
- Implement message queue with per-chat processing lanes
- Test with simulated concurrent requests early

**Architecture decision:** Must choose concurrency strategy in Phase 1

**Phase to address:** Phase 1 (Foundation) - Design concurrency model before Telegram integration

---

### 2.4 Tool Call Edge Cases

**What goes wrong:**
Agent makes malformed tool calls. Missing required parameters, wrong types, or requests non-existent tools. Framework throws uncaught errors, conversation hangs, or agent loops infinitely retrying.

**Why it happens:**
- LLM can hallucinate tool names or parameters
- TypeBox schema validation might not cover all edge cases
- No built-in retry logic for failed tool calls
- pi-mono expects implementer to handle tool errors gracefully

**Warning signs:**
- `Tool not found: <hallucinated_name>` errors
- Schema validation errors breaking conversation flow
- Agent retries same failed tool call without learning
- Conversation stuck waiting for tool that will never succeed

**Prevention:**
- Implement robust tool error handling in execute functions
- Return error messages to LLM, don't throw exceptions
- Add tool call logging: log every tool request and result
- Implement max retries per tool call
- Provide fallback responses when tools fail repeatedly
- Validate LLM's tool call JSON before execution
- Add "unknown tool" handler that guides LLM to correct tools
- Test with intentionally malformed tool calls

**Phase to address:** Phase 2 (Agent Integration) - Add comprehensive error handling around tools

---

### 2.5 Memory Leaks with Long-Running Agents

**What goes wrong:**
Agent process memory usage grows continuously over days/weeks. Eventually hits system memory limit and crashes or gets OOM killed. Affects bot availability.

**Why it happens:**
- Conversation history accumulates without pruning
- Tool execution results cached in memory forever
- Event subscribers not cleaned up
- Circular references preventing garbage collection
- LLM response buffers not freed

**Warning signs:**
- Steady memory growth in `htop` or process monitor
- RSS (Resident Set Size) increases over time
- Bun garbage collector runs more frequently
- Process crashes with out-of-memory after days of uptime

**Prevention:**
- Implement conversation pruning: keep only recent N messages
- Compress or summarize old conversation turns
- Clear tool result caches periodically
- Unsubscribe from agent events when conversation ends
- Use WeakMap for caches that should garbage collect
- Monitor memory usage: add metric to log RSS every hour
- Set up memory limit alerting
- Implement periodic cleanup task (e.g., every 24h)
- Test long-running scenarios: automated 100+ turn conversations

**Memory architecture:**
- Short-term: Last N messages in Agent state (RAM)
- Medium-term: Compressed summaries in SQLite
- Long-term: Full logs in daily-logs/ (disk)

**Phase to address:** Phase 3 (Memory System) - Design memory lifecycle with cleanup

---

### 2.6 Session/Context Growth Without Compaction

**What goes wrong:**
Token costs and latency increase exponentially as conversation continues. A week-long conversation might send 100K+ tokens per request. API costs skyrocket, responses become slow, eventually hit context limit.

**Why it happens:**
- pi-agent-core sends full conversation history to LLM each turn
- No automatic summarization or context editing
- Long-running personal assistant accumulates massive context
- Different from Claude Agent SDK which has some context management

**Warning signs:**
- API latency increasing over conversation duration
- Token usage growing linearly/exponentially
- Hitting Z.ai or Anthropic context limits (200K tokens)
- Cost per message increasing over time
- LLM responses becoming less relevant (lost in context)

**Prevention:**
- Implement sliding window: keep only last N messages as full context
- Summarize older messages: convert 10 old messages → 1 summary message
- Research shows: with context editing + memory tools, agents use only 16% of tokens otherwise required for 100-turn dialogues
- Prune tool results: keep only essential information
- Implement context budget: max X tokens per request
- Monitor token usage per request, alert on anomalies
- Consider Anthropic's context caching for repeated system prompts
- Store extracted facts in structured memory (SQLite), not raw conversation

**Architecture:**
```
Request context = system_prompt + memory_summary + recent_N_messages + current_query
Total tokens < budget (e.g., 20K for fast responses)
```

**Phase to address:** Phase 3 (Memory System) - Core requirement for production use

---

## 3. Telegram-Specific Pitfalls

### 3.1 Message Editing Rate Limits (Streaming)

**What goes wrong:**
Bot implements streaming responses by editing a message multiple times per second. Telegram rate limits kick in (429 errors). Message updates stop, bot appears frozen, user frustrated.

**Why it happens:**
- Telegram has separate rate limit bucket for `editMessageText`: 20 edits/second
- Streaming LLM responses produce chunks faster than this
- Rapid caption refreshes can proceed while send is blocked (separate buckets)
- Rachel9 likely wants streaming for better UX

**Warning signs:**
- 429 (Too Many Requests) errors in bot logs
- Telegram responses with `retry_after` header
- Messages stop updating mid-stream
- Some chunks missing from final message
- Uneven streaming: bursts then pauses

**Prevention:**
- Throttle edit calls: max 1 edit per 500ms (conservative: 2/sec instead of 20/sec)
- Buffer chunks: accumulate multiple chunks, send batched edit
- Implement adaptive throttling: back off on 429 errors
- Respect `retry_after` value from Telegram API
- Consider alternative: don't stream, send complete message (simpler, reliable)
- Use edit-based streaming only for longer responses (>10 sec generation)
- Test with rapid-fire questions to simulate rate limits
- Log edit frequency to monitor throttling effectiveness

**OpenClaw reference:** [feat(telegram): Edit-based streaming for regular DMs](https://github.com/openclaw/openclaw/issues/1876)

**Phase to address:** Phase 2 (Telegram Integration) - Decide on streaming approach

---

### 3.2 Markdown Parsing Failures

**What goes wrong:**
Bot sends message with `parse_mode: "Markdown"` or `"MarkdownV2"`. LLM response contains unescaped special characters. Telegram rejects with "Can't parse entities" error. User sees error or plain unformatted text.

**Why it happens:**
- MarkdownV2 requires escaping for: `_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!`
- LLMs don't understand Telegram's specific markdown syntax
- Special characters in code blocks or user input break parsing
- Escaping rules complex: different inside vs outside entities

**Common mistakes:**
- Using `**bold**` (standard markdown) instead of `*bold*` (Telegram)
- Not escaping `.` in URLs or text
- Missing escapes in code blocks
- Wrong escaping inside entities (must close and reopen)

**Warning signs:**
- `Bad Request: can't parse entities` errors
- Messages sent as plain text (fallback)
- Code snippets with broken formatting
- URLs not rendering as links

**Prevention:**
- **Best approach:** Use Telegram-specific markdown in system prompt (Rachel8 pattern)
- Teach LLM Telegram markdown syntax explicitly:
  - FORBIDDEN: `**bold**`, `## headers`, `[text](url)` (standard markdown)
  - ALLOWED: `*bold*`, `_italic_`, `` `code` ``, ` ```code blocks``` `, plain URLs
- Implement sanitization library: [telegram-markdown-sanitizer](https://github.com/illyakurochkin/telegram-markdown-sanitizer)
- Or use [telegram-markdown-v2](https://www.npmjs.com/package/telegram-markdown-v2) for escaping
- Always catch parse errors and retry with plain text
- Test with messages containing special chars: `test_case`, `2*2=4`, `snake_case`

**Migration note:** Rachel8 already solves this with custom system prompt. Copy that pattern.

**Phase to address:** Phase 2 (Telegram Integration) - Include Telegram markdown rules in system prompt

---

### 3.3 File Size Limits

**What goes wrong:**
User sends 2GB video file. Bot tries to download it. Process runs out of memory or disk space. Or bot tries to send large file back, Telegram rejects it.

**Why it happens:**
- Telegram file size limits:
  - Download from Telegram: 20MB via Bot API (2GB via MTProto, not available to bots)
  - Upload to Telegram: 50MB max
- Bot tries to buffer entire file in memory
- No streaming download/upload implementation
- Shared folder storage fills up

**Warning signs:**
- Out of memory errors when processing files
- "File too large" errors from Telegram
- Disk space exhaustion in container
- Upload failures for generated reports/exports

**Prevention:**
- Check file size before downloading: `file.file_size` property
- Reject files over threshold: "Files must be under 10MB"
- Stream large files instead of buffering: `fs.createReadStream()`
- Implement file cleanup: delete temp files after processing
- Set Docker volume size limits
- Compress files before sending if possible
- For files >50MB: upload to external storage, send link
- Add file size to user notification: "Processing 15MB file..."

**Phase to address:** Phase 2 (Telegram Integration) - Add file size validation to handlers

---

### 3.4 Bot API Rate Limits (Message Sending)

**What goes wrong:**
Agent sends multiple messages rapidly (e.g., scheduled reminders, bulk notifications). Hits Telegram rate limits. Messages queued or dropped. Users don't receive notifications.

**Why it happens:**
- Single chat: avoid >1 message/second (bursts allowed, 429 errors after)
- Groups: max 20 messages/minute
- Broadcasts: ~30 messages/second unless paid tier
- No built-in rate limiting in grammY (implementer's responsibility)

**Warning signs:**
- 429 errors with `retry_after` in logs
- Messages delayed or never delivered
- Telegram stops sending updates (webhook blocked)
- User reports missing notifications

**Prevention:**
- Implement token bucket rate limiter
- Use grammY plugin: [ratelimiter](https://grammy.dev/plugins/ratelimiter)
- Queue outbound messages with throttling
- Respect `retry_after` header, exponential backoff
- For bulk notifications: use `sendMessageBatch` if available
- Adaptive rate limiting based on 429 responses
- Personal assistant = single user, unlikely to hit limits, but good practice
- Test with burst scenarios: 10 rapid messages

**Phase to address:** Phase 2 (Telegram Integration) - Add rate limiting to message sender

---

### 3.5 Long-Running Operations Timeout

**What goes wrong:**
User asks agent to process large file or complex task. Takes 60+ seconds. Telegram webhook times out. Telegram re-sends update (duplicate processing) or stops sending updates to bot.

**Why it happens:**
- Telegram webhook timeout: typically 60 seconds
- grammY's internal timeout defaults to 10 seconds
- Long operations block webhook handler
- No async processing pattern

**Warning signs:**
- Webhook timeout errors in Telegram logs
- Duplicate processing of same message
- Telegram dashboard shows webhook failing
- Messages processed multiple times

**Prevention:**
- **Never** run long operations in webhook handler
- Pattern: immediate HTTP 200 response → queue work → process async → send result
- Implement job queue (in-memory or SQLite-based)
- Send "working on it..." message immediately
- Process in background, send result when done
- Use grammY's `api.sendMessage()` directly (not ctx.reply in async context)
- Implement deduplication: track processed `update_id`s
- Set explicit timeout in grammY config, but architect for async regardless

**Critical migration difference:** Claude Agent SDK handles async, pi-mono needs explicit queue

**Phase to address:** Phase 1 (Foundation) - Design async job queue architecture

---

### 3.6 Lost Update_ID Tracking

**What goes wrong:**
Bot processes same message twice due to duplicate webhook delivery. Scheduled task created twice, file downloaded twice, inconsistent state.

**Why it happens:**
- Telegram re-sends updates if webhook doesn't respond in time
- Process restart loses track of last processed update_id
- No deduplication mechanism

**Warning signs:**
- Duplicate log entries for same update_id
- Tasks scheduled twice
- User reports "bot did that twice"
- Logs show same message processed at different times

**Prevention:**
- Store last processed update_id in SQLite
- Check on each update: skip if already processed
- Use grammY's built-in duplicate detection (update_id must be sequential)
- TTL on update_id cache: keep last 10K or 24h worth
- Log all update_ids for debugging
- Test by manually re-sending same update

**Phase to address:** Phase 2 (Telegram Integration) - Add deduplication to webhook handler

---

## 4. Z.ai / Custom Provider Pitfalls

### 4.1 Model Name Mapping Confusion

**What goes wrong:**
Code requests `claude-opus-4-6` but Z.ai expects `GLM-5`. Or uses `claude-sonnet-4-5` when Z.ai maps it to `GLM-4.7`. Model selection doesn't match expectations. Unexpected costs or capabilities.

**Why it happens:**
- Z.ai uses Anthropic-compatible API but with different model names
- Mapping is not always intuitive: Opus→GLM-5, Sonnet→GLM-4.7, Haiku→GLM-4.5-Air
- Only 4 models supported via Anthropic endpoint: GLM-4.7, GLM-4.6, GLM-4.5, GLM-4.5-Air
- Documentation may lag behind actual API behavior
- Already hit this issue: GLM-4.7 vs GLM-5 confusion

**Warning signs:**
- Unexpected model used in requests (check logs/billing)
- "Model not found" errors
- Different capabilities than expected
- Cost doesn't match predictions

**Prevention:**
- Use Z.ai's native model names directly: `GLM-5`, `GLM-4.7`, etc.
- OR: implement explicit mapping layer in code
```typescript
const MODEL_MAP = {
  'claude-opus-4-6': 'GLM-5',
  'claude-sonnet-4-5': 'GLM-4.7',
  'claude-haiku-4-5': 'GLM-4.5-Air',
};
```
- Document model mapping in code comments and config
- Test with actual API early to confirm behavior
- Monitor billing to detect unexpected model usage
- Use environment variable for model selection: easy to change

**Phase to address:** Phase 1 (Foundation) - Clarify model naming before any API calls

---

### 4.2 API Compatibility Gaps

**What goes wrong:**
Z.ai's Anthropic-compatible API doesn't implement all Anthropic features. Code uses feature X (system prompts, prompt caching, etc.) which works with real Anthropic but fails/ignored by Z.ai.

**Why it happens:**
- "Anthropic-compatible" ≠ identical
- Z.ai prioritizes common use cases, may skip advanced features
- API evolves: Z.ai might lag behind Anthropic's latest features
- No official compatibility matrix

**Warning signs:**
- Feature documented in Anthropic API but doesn't work
- Silent failures: request succeeds but feature ignored
- Different response structure than expected
- Missing fields in API responses

**Prevention:**
- Test all Anthropic features you plan to use against Z.ai early
- Document which features work / don't work
- Have fallback implementations for unsupported features
- Abstract LLM provider: make it easy to switch between Z.ai and Anthropic
- Feature detection: check API capabilities programmatically if possible
- Monitor Z.ai developer docs for updates
- Maintain provider abstraction layer in code

**Critical features to test:**
- System prompts (likely supported)
- Tool/function calling (likely supported)
- Streaming (likely supported)
- Prompt caching (uncertain)
- Vision/image inputs (uncertain)
- Token counting accuracy (best-effort)

**Phase to address:** Phase 1 (Foundation) - Create provider abstraction and test features

---

### 4.3 Token Counting Differences

**What goes wrong:**
Token counts reported by Z.ai differ from Anthropic's. Budget calculations wrong. Costs higher than expected. Context management based on token counts breaks.

**Why it happens:**
- Different tokenizers: GLM models use different tokenization than Claude
- Z.ai reports tokens but may use approximation
- Different token counting for Chinese/multilingual text
- Token counts for tool calls may differ

**Warning signs:**
- API token counts don't match client-side predictions
- Context budgets exceeded unexpectedly
- Billing doesn't match token count expectations
- Different token counts for same text vs Anthropic

**Prevention:**
- Don't rely on exact token counts for logic
- Use token counts as estimates, add buffer (e.g., 20%)
- Test token counting with representative messages
- Monitor actual usage vs predictions
- Implement token counting fallback: character-based estimation
- If using pi-ai (unified LLM API), check if it normalizes token reporting
- Log token counts from API responses for analysis

**Note:** pi-ai documentation mentions "token tracking on best-effort basis" due to provider inconsistencies

**Phase to address:** Phase 3 (Memory System) - Test token counting when implementing context budgets

---

### 4.4 Streaming Format Differences

**What goes wrong:**
Streaming implementation works with Anthropic API but breaks with Z.ai. Partial responses malformed. Events arrive in different order. Connection drops mid-stream.

**Why it happens:**
- SSE (Server-Sent Events) implementation details vary
- Different event types or field names
- Timing differences: Anthropic sends tokens when, Z.ai different
- Error handling in streams may differ

**Warning signs:**
- Streaming works with Anthropic, fails with Z.ai
- Partial messages not rendering correctly
- Stream ends prematurely
- Events missing or in wrong order
- "Unexpected token" errors parsing SSE

**Prevention:**
- Test streaming with Z.ai endpoint specifically
- Abstract stream parsing: don't assume Anthropic's exact format
- Implement robust SSE parser with error recovery
- Log raw stream events for debugging
- Have fallback: non-streaming mode if streaming fails
- Use pi-ai library which may normalize streaming across providers
- Test edge cases: network interruption, long delays between chunks

**Phase to address:** Phase 2 (Agent Integration) - Test streaming when implementing agent loop

---

### 4.5 Rate Limiting Behavior

**What goes wrong:**
Z.ai rate limits differ from Anthropic. Bot hits limits unexpectedly. Retry logic designed for Anthropic doesn't work with Z.ai's rate limit responses.

**Why it happens:**
- Different rate limit policies: requests/minute, tokens/minute, concurrent requests
- Z.ai may have different tiers/quotas
- Rate limit error format might differ
- `retry_after` header may be missing or different

**Warning signs:**
- 429 errors more frequent than expected
- Rate limits hit at lower usage than Anthropic
- Retry logic not working (retries too fast or too slow)
- Different error messages/codes for rate limits

**Prevention:**
- Read Z.ai rate limit documentation carefully
- Implement conservative retry logic: exponential backoff with jitter
- Respect any `retry_after` header if present
- Fall back to fixed delay (e.g., 60s) if header missing
- Monitor rate limit errors, adjust usage patterns
- Implement request queuing to smooth out bursts
- Consider request prioritization: user messages > background tasks

**Phase to address:** Phase 2 (Agent Integration) - Add retry logic around API calls

---

## 5. Docker/Deployment Pitfalls

### 5.1 Container Memory Limits with Agent State

**What goes wrong:**
Container has 512MB memory limit. Agent conversations accumulate. Memory usage exceeds limit. Container killed by OOM killer. Bot goes offline.

**Why it happens:**
- Docker enforces hard memory limits
- Agent state grows without compaction
- Multiple concurrent conversations in memory
- No memory usage monitoring

**Warning signs:**
- Container exits with status 137 (OOM killed)
- `docker stats` shows memory at limit
- Kubernetes reports OOMKilled
- Sudden process restarts without graceful shutdown

**Prevention:**
- Set appropriate memory limits: start with 1GB, monitor, adjust
- Implement memory monitoring: log RSS every 30min
- Aggressive conversation pruning in containerized deployments
- Use memory limits as hard ceiling, implement soft limit (80%) for alerts
- Test with multiple concurrent conversations to measure memory usage
- Implement graceful degradation: reject new conversations if memory high
- Consider horizontal scaling: multiple containers with load balancing

**Memory budget per conversation:**
- If 1GB container, supporting 10 concurrent conversations
- ~100MB per conversation max
- Enforce conversation size limits to stay under budget

**Phase to address:** Phase 1 (Foundation) - Set memory limits and monitoring from start

---

### 5.2 SQLite in Docker (WAL Mode Issues)

**What goes wrong:**
SQLite database corrupts after container restart. WAL mode doesn't work properly with Docker volumes. Database locked errors under concurrent access.

**Why it happens:**
- **Critical:** WAL mode can corrupt database if given VM/Docker volume
- Docker for Windows/Mac uses CIFS mounted paths → SQLite corruption with WAL
- Network filesystems (NFS, CIFS) don't support WAL's locking requirements
- WAL requires shared memory between processes → fails across containers
- Improper shutdown doesn't checkpoint WAL

**Warning signs:**
- `database is malformed` errors after restart
- `database is locked` errors
- `.wal` file growing very large (checkpoints not happening)
- Container restarts leaving orphaned .wal files

**Prevention:**
- **Storage:** Use Docker named volumes (not bind mounts from host)
- **Journal mode:** Use WAL, but understand limitations
- **Single container:** Don't share SQLite file across containers
- **Graceful shutdown:** Implement proper SIGTERM handling:
  ```typescript
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  ```
- **Busy timeout:** Set `PRAGMA busy_timeout = 5000`
- **Monitor WAL size:** Alert if .wal file >10MB (checkpoint failing)
- **Backup strategy:** Regular backups, test restoration
- **Alternative:** Consider using Turso (LibSQL) for cloud-native approach

**Best practices for 2026:**
- Store database on named volume (not host shared path)
- Enable WAL mode for better concurrency
- Avoid sharing SQLite across containers or networked filesystems
- Single writer architecture if possible

**Phase to address:** Phase 1 (Foundation) - Configure SQLite correctly before building storage

---

### 5.3 Bun in Docker (Official Image vs Custom)

**What goes wrong:**
Custom Dockerfile with Bun installation behaves differently than Bun official image. Version mismatches. Build failures. Production bugs that don't appear in development.

**Why it happens:**
- Multiple ways to install Bun in Docker
- Official image may use different base (Alpine, Debian, etc.)
- Bun version pinning not enforced
- Build-time dependencies differ from runtime

**Warning signs:**
- Works with `oven/bun` image but not custom Dockerfile
- Different Bun version in container vs dev machine
- Native dependencies fail in container but work locally
- `node:alpine` base doesn't work well with Bun

**Prevention:**
- **Use official Bun Docker image:** `FROM oven/bun:1.1.10` (pin version)
- Or use Docker Hardened Image: `dhi/bun` for production security
- Multi-stage builds: separate install stage from runtime
```dockerfile
FROM oven/bun:1.1.10-alpine AS base
FROM base AS install
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
FROM base AS release
COPY --from=install /app/node_modules ./node_modules
COPY . .
USER bun
CMD ["bun", "run", "src/index.ts"]
```
- Pin Bun version in package.json: `"bun": "^1.1.10"`
- Use Dependabot to keep image version updated
- Test Docker build in CI before deploying

**Best practices 2026:**
- Fixed version tags (not `latest`)
- Multi-stage for small image size
- Non-root user for security
- Health checks and graceful shutdown

**Phase to address:** Phase 1 (Foundation) - Set up Dockerfile correctly before deployment

---

### 5.4 Volume Mount Permissions

**What goes wrong:**
Container can't write to mounted volumes. File operations fail with permission denied. SQLite database, memory files, logs can't be written.

**Why it happens:**
- Container runs as user `bun` (UID 1000) but volume owned by different UID
- Host filesystem permissions don't match container user
- SELinux or AppArmor restrictions
- Windows/Mac Docker Desktop uses different permission model

**Warning signs:**
- `EACCES: permission denied` errors
- SQLite can't create database file
- Log files not appearing
- Memory files can't be saved

**Prevention:**
- Run container as non-root user (security best practice)
- Match container user UID with volume permissions
- Use `docker run --user $(id -u):$(id -g)` for dev
- For production: create volume with correct permissions first
- Or: `chown` in Dockerfile/entrypoint (less secure)
- Test volume writes in health check
- Document required volume permissions

```dockerfile
# In Dockerfile
USER bun
# Ensure bun user can write
VOLUME /app/data
```

**Phase to address:** Phase 1 (Foundation) - Test volume permissions in Docker setup

---

### 5.5 Environment Variable Management

**What goes wrong:**
Secrets (API keys, tokens) hardcoded or leaked. Different configs between dev/prod cause bugs. Container can't access environment variables.

**Why it happens:**
- `.env` file committed to git
- Environment variables not passed to Docker correctly
- Bun's env loading different from Node
- Secrets in Dockerfile (cached in layers)

**Warning signs:**
- API keys in git history
- "Unauthorized" errors in production but works locally
- Environment variables undefined in container
- Different behavior dev vs prod

**Prevention:**
- Use `.env` for local dev, gitignore it
- Use Docker secrets/configs for production
- Pass env vars at runtime: `docker run -e API_KEY=...`
- Or use env file: `docker run --env-file .env.prod`
- Never put secrets in Dockerfile
- Use Bun's built-in env: `Bun.env.API_KEY`
- Validate required env vars on startup
- Different configs for dev/staging/prod

```typescript
// Validate on startup
if (!Bun.env.TELEGRAM_TOKEN) {
  throw new Error("TELEGRAM_TOKEN not set");
}
```

**Phase to address:** Phase 1 (Foundation) - Set up env management before writing config-dependent code

---

## 6. Migration Pitfalls (Rachel8 → Rachel9)

### 6.1 Session Persistence Format Mismatch

**What goes wrong:**
Rachel8 stores sessions in Claude Agent SDK format. Rachel9 can't read them. User loses all conversation history during migration. Agent forgets everything.

**Why it happens:**
- Claude Agent SDK uses internal session format (opaque session IDs)
- pi-mono uses different state structure (conversation messages array)
- No automatic migration tool
- Different serialization formats

**Warning signs:**
- Old sessions can't be loaded
- "Invalid session format" errors
- Users report conversation reset after migration
- History lost

**Prevention:**
- Design migration script from day 1
- Extract conversation messages from Rachel8 sessions
- Convert to Rachel9 format
- Test migration on copy of production data
- Document migration process
- Consider one-time migration vs gradual switchover
- Preserve old session data as backup

**Migration strategy:**
1. Export Rachel8 session data
2. Parse conversation history
3. Create Rachel9 state structure
4. Import into new system
5. Verify user can continue conversations

**Phase to address:** Phase 4 (Migration) - Design migration tooling

---

### 6.2 Tool Signature Changes

**What goes wrong:**
Rachel8 tools have different signatures than Rachel9 tools. Agent tries to call tools with old parameters. Tool execution fails. Features break.

**Why it happens:**
- Claude Agent SDK vs pi-mono have different tool definition formats
- Parameter schemas may differ
- Return value formats different
- Tool names changed

**Warning signs:**
- "Tool parameter mismatch" errors
- Tools called but don't execute
- Missing parameters in tool calls
- Different behavior for same tool

**Prevention:**
- Audit all Rachel8 tools, list parameters
- Design Rachel9 tools to match where possible
- Document differences that require changes
- Update system prompt to reflect new tool signatures
- Test all tools manually before launch
- Implement tool version detection for gradual migration

**Common tools to check:**
- File operations
- Shell commands
- Memory operations
- Telegram send-file
- WhatsApp bridge commands
- Task scheduling

**Phase to address:** Phase 2 (Tool Implementation) - Map Rachel8 tools to Rachel9

---

### 6.3 Memory System Backward Compatibility

**What goes wrong:**
Rachel8 memory files (MEMORY.md, daily-logs/, context/) stored in specific format. Rachel9 expects different format or structure. Memory loading fails or corrupts existing memories.

**Why it happens:**
- Different memory architecture between versions
- File format changes (markdown structure, metadata)
- Timestamp formats differ
- Context file naming conventions changed

**Warning signs:**
- Memory files can't be parsed
- Existing memories not loaded
- Duplicate memory entries
- Metadata lost

**Prevention:**
- Keep Rachel9 memory format compatible with Rachel8
- Same file structure: `rachel-memory/MEMORY.md`, `daily-logs/`, `context/`
- Same markdown format
- Write migration script if format must change
- Test with actual Rachel8 memory files
- Preserve original files as backup during migration

**Rachel8 memory structure to preserve:**
```
rachel-memory/
  MEMORY.md              # Core facts
  daily-logs/            # Conversation logs by date
    2026-02-19.md
  context/               # Topic-specific knowledge
    project-X.md
```

**Phase to address:** Phase 3 (Memory System) - Ensure format compatibility

---

### 6.4 Scheduled Task Migration

**What goes wrong:**
Rachel8 has pending scheduled tasks in SQLite. Rachel9 uses different task schema. Tasks lost during migration. Reminders don't fire. Recurring jobs stop.

**Why it happens:**
- Different task table schema
- Task data JSON structure changed
- Cron parsing differences
- Task execution logic different

**Warning signs:**
- Scheduled tasks don't execute after migration
- Task list empty in Rachel9
- Recurring tasks stop
- User asks "where's my reminder?"

**Prevention:**
- Export Rachel8 tasks before migration
- Map to Rachel9 task schema
- Test task execution in Rachel9
- Verify cron patterns parse correctly
- Document any unsupported task types
- Migration script: read Rachel8 tasks.db → write Rachel9 tasks

**Task migration checklist:**
- [ ] One-time tasks with execution time
- [ ] Recurring cron tasks
- [ ] Agent tasks (if format changed)
- [ ] Bash tasks
- [ ] Reminder tasks
- [ ] Cleanup tasks

**Phase to address:** Phase 4 (Migration) - Task migration script

---

### 6.5 Behavioral Differences (Hard to Replicate)

**What goes wrong:**
Rachel8 has subtle behaviors users depend on. Rachel9 behaves differently. User frustrated by changes. "It used to do X, now it doesn't."

**Why it happens:**
- Different agent frameworks have different "personalities"
- Prompt handling differs
- Tool calling patterns differ
- Response formatting different
- Error handling changed

**Warning signs:**
- User complaints: "Rachel is different now"
- Different response style
- Features work but feel different
- Workflows broken

**Prevention:**
- Document Rachel8 behaviors that users rely on
- Interview user before migration
- Test common workflows in Rachel9
- Preserve system prompt style
- A/B test responses: same input to Rachel8 and Rachel9
- Gradual rollout: run both in parallel, compare
- Collect user feedback early

**Key behaviors to preserve:**
- Response tone and style
- When to send notifications
- Error message clarity
- Proactive suggestions
- Task scheduling patterns

**Phase to address:** Phase 4 (Migration) - User acceptance testing

---

## 7. WhatsApp Integration Pitfalls (Baileys)

### 7.1 Session Persistence in Docker

**What goes wrong:**
WhatsApp session requires QR scan on every container restart. User frustrated. Session state not persisted properly. Multi-device connection lost.

**Why it happens:**
- Baileys session stored in file system
- Container filesystem is ephemeral
- `useMultiFileAuthState` creates many small files (I/O intensive)
- Volume mount not configured correctly
- Session files corrupted

**Warning signs:**
- QR scan required every restart
- "Session not found" errors
- WhatsApp disconnects frequently
- Auth files missing after restart

**Prevention:**
- **Don't use** `useMultiFileAuthState` in production (high I/O)
- Store session in database (PostgreSQL, Redis recommended in production)
- Or: mount persistent volume for session storage
- Baileys session folder → Docker volume
- Test session restoration after container restart
- Implement session backup/restore
- Monitor session health, auto-reconnect on disconnect

**Baileys session storage options:**
1. File-based (dev only): `useMultiFileAuthState('./auth_info')`
2. Database (production): Custom auth state with PostgreSQL/Redis
3. Docker volume (acceptable): Mount `./auth_info` to named volume

**Phase to address:** Phase 2 (WhatsApp Integration) - Design session persistence

---

### 7.2 WAL Mode SQLite for Message Storage

**What goes wrong:**
Baileys stores messages in SQLite. Same Docker volume issues as main database. Corruption, lock errors, performance degradation.

**Why it happens:**
- Baileys may use SQLite for message history
- Multiple processes accessing database
- Docker volume + WAL mode issues (see section 5.2)

**Warning signs:**
- Message history lost
- SQLite errors from Baileys
- WhatsApp message sync failures

**Prevention:**
- Apply same SQLite best practices as main database
- Use named volumes, not bind mounts
- WAL mode with proper shutdown
- Or: use Baileys with custom message storage (not SQLite)
- Test with high message volume

**Phase to address:** Phase 2 (WhatsApp Integration) - Configure Baileys storage

---

## Warning Signs Summary

Quick reference for detecting pitfalls in production:

| Symptom | Likely Pitfall | Section |
|---------|---------------|---------|
| Memory usage growing over days | Agent state leak, context growth | 2.5, 2.6 |
| 429 errors from Telegram | Rate limiting | 3.1, 3.4 |
| "Can't parse entities" errors | Markdown formatting | 3.2 |
| Duplicate message processing | Missing deduplication | 3.6 |
| Container OOM killed | Memory limits | 5.1 |
| SQLite corruption after restart | WAL + Docker volumes | 5.2 |
| Session data lost on restart | No persistence | 2.1, 7.1 |
| Token costs increasing | Context growth | 2.6 |
| Module not found in Bun | Import compatibility | 1.1 |
| Segfault on startup | Native addon issue | 1.2 |
| WhatsApp QR every restart | Session not persisted | 7.1 |
| Tool calls failing | Schema mismatch, sandboxing | 2.2, 2.4 |
| Different behavior from Rachel8 | Migration gap | 6.5 |

---

## Prevention Phase Mapping

When to address each pitfall category during development:

### Phase 1: Foundation & Deployment
**Must address before writing features:**
- [1.1] Module resolution testing
- [1.2] Native addon audit
- [1.3] SQLite API choice (bun:sqlite vs better-sqlite3)
- [1.4] TypeScript tooling setup
- [2.1] State persistence architecture
- [2.2] Tool sandboxing/security model
- [2.3] Concurrency strategy
- [5.1] Container memory limits
- [5.2] SQLite + Docker configuration
- [5.3] Dockerfile setup
- [5.4] Volume permissions
- [5.5] Environment variable management

### Phase 2: Telegram & WhatsApp Integration
**Address during integration:**
- [3.1] Streaming rate limits
- [3.2] Markdown formatting
- [3.3] File size validation
- [3.4] Message rate limiting
- [3.5] Async job queue
- [3.6] Deduplication
- [4.1] Model name mapping
- [4.2] API feature testing
- [7.1] WhatsApp session persistence
- [7.2] Baileys storage configuration

### Phase 3: Memory & Agent System
**Address during agent implementation:**
- [2.4] Tool error handling
- [2.5] Memory leak prevention
- [2.6] Context compaction
- [4.3] Token counting
- [4.4] Streaming format
- [4.5] Rate limiting & retry logic

### Phase 4: Migration & Production
**Address before launch:**
- [6.1] Session format migration
- [6.2] Tool signature mapping
- [6.3] Memory backward compatibility
- [6.4] Scheduled task migration
- [6.5] Behavioral testing

---

## Testing Strategy

### Unit Tests
- SQLite operations (connection, WAL, busy_timeout)
- Tool parameter validation
- Markdown sanitization
- Token counting estimates
- Rate limiter logic

### Integration Tests
- Full conversation flow in Bun
- Tool execution with sandboxing
- File upload/download with size limits
- WhatsApp session save/restore
- Container restart with state preservation

### Load Tests
- Concurrent conversations (memory usage)
- Message burst rate limiting
- Token usage over 100-turn conversation
- Stream parsing under load

### Migration Tests
- Rachel8 session import
- Memory file compatibility
- Task migration accuracy
- Behavior comparison (A/B)

---

## Recovery Strategies

When pitfalls occur in production:

| Pitfall | Recovery Time | Steps |
|---------|--------------|-------|
| Memory leak OOM | 5 min | Container auto-restart, monitor memory |
| SQLite corruption | 15 min | Restore from last backup, replay WAL if possible |
| WhatsApp session lost | 5 min | User re-scans QR code |
| Context overflow | 1 min | Clear session, start fresh (memory preserved) |
| Rate limit hit | 1-60 min | Wait for retry_after, queue messages |
| Tool execution failure | 0 min | Return error to LLM, continue conversation |
| Migration data loss | CRITICAL | Restore from Rachel8 backup, re-run migration |

---

## Sources

### pi-mono and Agent Core
- [GitHub: badlogic/pi-mono](https://github.com/badlogic/pi-mono)
- [How to Build a Custom Agent Framework with PI](https://nader.substack.com/p/how-to-build-a-custom-agent-framework)
- [What I learned building an opinionated and minimal coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
- [Pi: The Minimal Agent Within OpenClaw](https://lucumr.pocoo.org/2026/1/31/pi/)
- [AI Agent Variables Fail in Production: Fix State Management](https://nanonets.com/blog/ai-agents-state-management-guide-2026/)
- [Building a Music Agent CLI with pi-mono](https://www.mager.co/blog/2026-02-16-beatbrain-chat-pi-mono)

### Bun Compatibility and Runtime
- [Node.js Compatibility - Bun](https://bun.com/docs/runtime/nodejs-compat)
- [How to Run Node.js Apps with Bun](https://oneuptime.com/blog/post/2026-01-31-bun-nodejs-compatibility/view)
- [Bun vs Node.js in 2026](https://pas7.com.ua/blog/en/bun-ready-bun-vs-node-2026)
- [Bun Package Manager Reality Check 2026](https://vocal.media/01/bun-package-manager-reality-check-2026)

### bun:sqlite
- [SQLite - Bun](https://bun.com/docs/runtime/sqlite)
- [Bun claims their SQLite driver is 3-6x faster](https://github.com/WiseLibs/better-sqlite3/discussions/1057)
- [Make better-sqlite3 work in bun without recompilation](https://github.com/oven-sh/bun/issues/16050)
- [How to Use SQLite with Bun's Native Support](https://oneuptime.com/blog/post/2026-01-31-bun-sqlite/view)

### Telegram Bot API and grammY
- [How to solve rate limit errors from Telegram Bot API](https://gramio.dev/rate-limits)
- [Telegram Bot API Rate Limits Explained](https://hfeu-telegram.com/news/telegram-bot-api-rate-limits-explained-856782827/)
- [Deployment Checklist | grammY](https://grammy.dev/advanced/deployment)
- [Scaling Up III: Reliability | grammY](https://grammy.dev/advanced/reliability)
- [Concurrency With grammY runner](https://grammy.dev/plugins/runner)
- [feat(telegram): Edit-based streaming for regular DMs](https://github.com/openclaw/openclaw/issues/1876)

### Telegram Markdown
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [GitHub: telegram-markdown-sanitizer](https://github.com/illyakurochkin/telegram-markdown-sanitizer)
- [telegram-markdown-v2 - npm](https://www.npmjs.com/package/telegram-markdown-v2)
- [What are all the "special characters" that need to be escaped](https://github.com/telegraf/telegraf/issues/1242)

### Baileys WhatsApp Library
- [Connecting | Baileys](https://baileys.wiki/docs/socket/connecting/)
- [GitHub: Baileys-2025-Rest-API](https://github.com/PointerSoftware/Baileys-2025-Rest-API)
- [Building WhatsApp Bots & Integrations with Baileys](https://www.blog.brightcoding.dev/2025/08/28/building-whatsapp-bots-integrations-with-baileys/)

### Docker and SQLite
- [How to Run SQLite in Docker](https://oneuptime.com/blog/post/2026-02-08-how-to-run-sqlite-in-docker-when-and-how/view)
- [SQLite Performance Optimization - Guide 2026](https://forwardemail.net/en/blog/docs/sqlite-performance-optimization-pragma-chacha20-production-guide)
- [How to Set Up SQLite for Production Use](https://oneuptime.com/blog/post/2026-02-02-sqlite-production-setup/view)
- [SQLite WAL File: Complete Guide 2026](https://copyprogramming.com/howto/sqlite-wal-file-size-keeps-growing)
- [Write-Ahead Logging](https://sqlite.org/wal.html)

### Docker with Bun
- [Containerize a Bun application with Docker](https://bun.com/docs/guides/ecosystem/docker)
- [How to Deploy Bun Applications to Production](https://oneuptime.com/blog/post/2026-01-31-bun-production-deployment/view)
- [Using Bun as the Package Manager in Production-Ready Docker Images](https://andrekoenig.de/articles/using-bun-as-the-package-manager-in-production-ready-docker-images)
- [Containerize your app | Docker Docs](https://docs.docker.com/guides/bun/containerize/)

### Z.ai and Provider Compatibility
- [FAQs - Z.AI DEVELOPER DOCUMENT](https://docs.z.ai/devpack/faq)
- [Using Z AI With Roo Code](https://docs.roocode.com/providers/zai)
- [Add support for Z.ai GLM Coding Plan](https://github.com/anomalyco/opencode/issues/2431)
- [AI SDK Providers: Anthropic](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic)

### LLM Streaming and Concurrency
- [Handling Concurrent Requests](https://apxml.com/courses/how-to-build-a-large-language-model/chapter-29-serving-llms-at-scale/handling-concurrent-requests)
- [Mastering Concurrency in LLMs](https://medium.com/@jalajagr/mastering-concurrency-in-llms-why-it-matters-and-how-to-handle-it-ba30cdd0c0c7)
- [Handling long-running LLM streams in a stateful backend](https://blog.leap.new/blog/llm-streams)

---

*Research compiled for Rachel9 migration from Rachel8*
*Focus: Production-ready Telegram bot with pi-mono on Bun*
*Date: 2026-02-19*
