# Rachel9 Architecture Research

Architecture for a Telegram AI agent bot built on pi-mono framework.

**Context:**
- **pi-mono** provides: `Agent` class (state management, tool calling, events), `pi-ai` (unified LLM API), `AgentTool` interface
- **Rachel8** is the reference implementation (~2,400 lines TypeScript): uses claude-agent-sdk, grammy.js, custom sessions
- **pi-mono's "mom"** is a Slack bot reference implementation with similar patterns adaptable to Telegram
- **Runtime:** Bun, **Database:** SQLite
- **Deployment modes:** Standalone (polling) + cloud (webhook)

---

## 1. Component Architecture

### 1.1 Agent Strategy: Singleton with Per-Chat State

**Decision: One Agent instance per chat, cached in a Map**

Based on mom's pattern (`getOrCreateRunner` in `/tmp/pi-mono/packages/mom/src/agent.ts:398-405`):

```typescript
// Cache runners per channel
const channelRunners = new Map<string, AgentRunner>();

export function getOrCreateRunner(channelId: string, channelDir: string): AgentRunner {
  const existing = channelRunners.get(channelId);
  if (existing) return existing;

  const runner = createRunner(channelId, channelDir);
  channelRunners.set(channelId, runner);
  return runner;
}
```

**Why per-chat agents:**
- Each chat needs isolated context/history (context.jsonl per chat)
- Tools are scoped per-chat (session state, file paths)
- Allows concurrent processing of different chats
- SessionManager and AgentSession are designed for persistence per session

**Agent lifecycle:**
1. Created on first message from a chat
2. Persists in memory for the process lifetime
3. Loads existing messages from `context.jsonl` on creation
4. Each incoming message: sync from `log.jsonl` → reload context → prompt

### 1.2 Tool Registration and Scoping

**Tools are registered once per Agent instance, scoped to chat directory**

From mom (`/tmp/pi-mono/packages/mom/src/agent.ts:412-416`):

```typescript
function createRunner(channelId: string, channelDir: string): AgentRunner {
  const tools = createMomTools(executor);  // Create tools once

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: "off",
      tools,  // Tools bound to this agent
    },
    convertToLlm,
    getApiKey: async () => getAnthropicApiKey(authStorage),
  });
```

**Rachel9 tool scope:**
- Tools created with chat-specific context (chatId, chatDir)
- File paths resolved relative to chat directory
- Each tool has access to Telegram-specific upload functions via closure

**Tool implementation pattern** (from mom `/tmp/pi-mono/packages/mom/src/tools/index.ts`):
```typescript
export function createTelegramTools(chatId: number, chatDir: string): AgentTool[] {
  return [
    createBashTool(chatDir),
    createReadTool(chatDir),
    createWriteTool(chatDir),
    createEditTool(chatDir),
    createTelegramSendTool(chatId),  // Telegram-specific
  ];
}
```

### 1.3 Telegram Transport ↔ Agent Interface

**Pattern: TelegramContext adapter + event subscription**

Based on mom's SlackContext adapter (`/tmp/pi-mono/packages/mom/src/main.ts:114-230`):

```typescript
interface TelegramContext {
  message: {
    text: string;
    user: number;
    userName?: string;
    chatId: number;
    messageId: number;
    timestamp: number;
    attachments: { local: string; type: string }[];
  };

  // Response methods
  respond: (text: string, shouldLog?: boolean) => Promise<void>;
  replaceMessage: (text: string) => Promise<void>;
  respondInThread: (text: string) => Promise<void>;  // Reply to message
  setTyping: (isTyping: boolean) => Promise<void>;
  sendFile: (filePath: string, caption?: string) => Promise<void>;
  setWorking: (working: boolean) => Promise<void>;
}
```

**Key pattern from mom:**
- Adapter maintains message accumulation state
- Queues Telegram API calls sequentially
- Handles streaming updates (main message gets updated chunks)
- Thread messages for tool details (Telegram: reply to original message)

### 1.4 Message Queue Pattern: Per-Chat Sequential Processing

**Pattern: ChannelQueue from mom** (`/tmp/pi-mono/packages/mom/src/slack.ts:94-119`)

```typescript
class ChatQueue {
  private queue: QueuedWork[] = [];
  private processing = false;

  enqueue(work: QueuedWork): void {
    this.queue.push(work);
    this.processNext();
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    const work = this.queue.shift()!;
    try {
      await work();
    } catch (err) {
      log.error("Queue error", err);
    }
    this.processing = false;
    this.processNext();
  }
}

// Per-chat queues
const chatQueues = new Map<number, ChatQueue>();
```

**Why per-chat queues:**
- Ensures messages from same chat processed in order
- Prevents concurrent agent runs for same chat (state corruption)
- Allows parallel processing of different chats
- Handles "stop" command interruptions cleanly

**Queue behavior:**
- New message arrives → enqueue → process when current finishes
- If agent running: reject new message ("Already working")
- Stop command: bypass queue, call `runner.abort()` directly

---

## 2. Data Flow

### 2.1 Message Ingestion Flow

**Telegram message → handler → Agent.prompt() → event stream → Telegram response**

```
1. Telegram Update
   ↓
2. grammy.js middleware (authGuard)
   ↓
3. Handler checks queue
   ↓
4. Enqueue work or reject
   ↓
5. Queue processes:
   ├─ Load chat state (getOrCreateRunner)
   ├─ Sync log.jsonl → context.jsonl
   ├─ Create TelegramContext adapter
   ├─ Subscribe to agent events
   ├─ Call agent.prompt(userMessage, images?)
   └─ Stream events → Telegram API
   ↓
6. Log response to log.jsonl
```

**Pattern from mom** (`/tmp/pi-mono/packages/mom/src/main.ts:254-286`):

```typescript
async handleEvent(event: TelegramUpdate, bot: TelegramBot): Promise<void> {
  const state = getState(event.chatId);

  // Start run
  state.running = true;

  try {
    // Create context adapter
    const ctx = createTelegramContext(event, bot, state);

    // Run the agent
    await ctx.setTyping(true);
    await ctx.setWorking(true);
    const result = await state.runner.run(ctx);
    await ctx.setWorking(false);

    if (result.stopReason === "aborted" && state.stopRequested) {
      await bot.sendMessage(event.chatId, "Stopped");
    }
  } catch (err) {
    log.warning("Run error", err.message);
  } finally {
    state.running = false;
  }
}
```

### 2.2 Tool Execution Flow

**Agent decides to call tool → tool_execution_start → execute → tool_execution_end → LLM sees result**

From pi-mono Agent docs (`/tmp/pi-mono/packages/agent/README.md:79-100`):

```
prompt("Read config.json")
├─ agent_start
├─ turn_start
├─ message_start/end  { userMessage }
├─ message_start      { assistantMessage with toolCall }
├─ message_update...
├─ message_end        { assistantMessage }
├─ tool_execution_start  { toolCallId, toolName, args }
├─ tool_execution_update { partialResult }  // If tool streams
├─ tool_execution_end    { toolCallId, result }
├─ message_start/end  { toolResultMessage }
├─ turn_end           { message, toolResults }
│
├─ turn_start                              // Next turn
├─ message_start      { assistantMessage } // LLM responds to tool result
├─ message_update...
├─ message_end
├─ turn_end
└─ agent_end
```

**Event handler from mom** (`/tmp/pi-mono/packages/mom/src/agent.ts:506-550`):

```typescript
session.subscribe(async (event) => {
  if (event.type === "tool_execution_start") {
    const { toolName, toolCallId, args } = event;
    const label = args.label || toolName;

    // Update main message
    queue.enqueue(() => ctx.respond(`_→ ${label}_`, false), "tool label");
  }

  else if (event.type === "tool_execution_end") {
    const { toolCallId, result, isError } = event;

    // Post detailed result to thread
    const threadMessage = `*${isError ? "✗" : "✓"} ${toolName}*: ${label}\n` +
                         `\`\`\`\n${result}\n\`\`\``;
    queue.enqueueMessage(threadMessage, "thread", "tool result");

    if (isError) {
      queue.enqueue(() => ctx.respond(`_Error: ${result}_`, false), "tool error");
    }
  }
});
```

**Rachel9 pattern:**
- Main message: show tool label ("→ Reading file...")
- Thread/reply: full args + result (formatted)
- Errors: show truncated error in main + full in thread

### 2.3 Memory Loading/Saving Flow

**Pattern from mom: Sync log.jsonl → SessionManager before each run**

Mom's sync function (`/tmp/pi-mono/packages/mom/src/context.ts:42-142`):

```typescript
export function syncLogToSessionManager(
  sessionManager: SessionManager,
  channelDir: string,
  excludeSlackTs?: string,  // Current message, will be added via prompt()
): number {
  const logFile = join(channelDir, "log.jsonl");

  // Build set of existing messages from session
  const existingMessages = new Set<string>();
  for (const entry of sessionManager.getEntries()) {
    if (entry.type === "message" && entry.message.role === "user") {
      // Extract normalized text for deduplication
      existingMessages.add(normalizeMessage(entry.message.content));
    }
  }

  // Read log.jsonl and find new messages
  const logLines = readFileSync(logFile, "utf-8").trim().split("\n");
  const newMessages: UserMessage[] = [];

  for (const line of logLines) {
    const logMsg = JSON.parse(line);

    // Skip current message (added via prompt())
    if (logMsg.ts === excludeSlackTs) continue;

    // Skip bot messages (added through agent flow)
    if (logMsg.isBot) continue;

    const messageText = `[${logMsg.userName}]: ${logMsg.text}`;
    if (existingMessages.has(messageText)) continue;

    newMessages.push({
      role: "user",
      content: [{ type: "text", text: messageText }],
      timestamp: new Date(logMsg.date).getTime(),
    });
  }

  // Add to session in chronological order
  newMessages.sort((a, b) => a.timestamp - b.timestamp);
  for (const msg of newMessages) {
    sessionManager.appendMessage(msg);
  }

  return newMessages.length;
}
```

**Rachel9 adaptation:**
- `log.jsonl`: All messages (user + bot), append-only, greppable
- `context.jsonl`: SessionManager format, compactable, loaded into Agent
- Sync flow: `syncLogToSessionManager()` before each `agent.prompt()`
- Picks up: channel chatter, backfilled history, messages while bot was busy

**Memory files:**
```
data/
├── MEMORY.md              # Global memory (all chats)
├── settings.json          # Compaction/retry settings
└── C<chatId>/             # Per-chat directory
    ├── MEMORY.md          # Chat-specific memory
    ├── log.jsonl          # Full history (no tool results)
    ├── context.jsonl      # LLM context (with tool results)
    ├── attachments/       # Downloaded files
    └── scratch/           # Working directory
```

### 2.4 File Handling Flow

**Telegram → Download → Local path → Attach to prompt → Agent uses Read tool**

From Rachel8 pattern (`/home/rachel/rachel8/src/telegram/handlers/message.ts:68-94`):

```typescript
export const handlePhoto = async (ctx: BotContext) => {
  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  const localPath = await downloadTelegramFile(ctx, photo.file_id, "photo.jpg");

  const caption = ctx.message.caption ?? "I sent you an image.";
  const prompt = `[User sent image at: ${localPath}]\n\n${caption}`;

  const response = await generateResponse(ctx.chat.id, prompt);
  await ctx.reply(response);
};
```

**Mom's attachment pattern** (`/tmp/pi-mono/packages/mom/src/agent.ts:747-771`):

```typescript
// Build user message with attachments
let userMessage = `[${timestamp}] [${userName}]: ${text}`;

const imageAttachments: ImageContent[] = [];
const nonImagePaths: string[] = [];

for (const attachment of ctx.message.attachments) {
  const fullPath = `${workspacePath}/${attachment.local}`;
  const mimeType = getImageMimeType(attachment.local);

  if (mimeType && existsSync(fullPath)) {
    // Embed image in prompt
    imageAttachments.push({
      type: "image",
      mimeType,
      data: readFileSync(fullPath).toString("base64"),
    });
  } else {
    // Reference file path in text
    nonImagePaths.push(fullPath);
  }
}

if (nonImagePaths.length > 0) {
  userMessage += `\n\n<attachments>\n${nonImagePaths.join("\n")}\n</attachments>`;
}

await agent.prompt(userMessage, imageAttachments.length > 0 ? { images: imageAttachments } : undefined);
```

**Rachel9 file handling:**
1. **Download:** Queue attachment download (background, like mom's store)
2. **Log:** Store metadata in log.jsonl (`{ original: "photo.jpg", local: "C123/attachments/12345_photo.jpg" }`)
3. **Attach:**
   - Images: Base64 embed in prompt via `images` param
   - Other files: Include path in text prompt
4. **Agent tools:** Read tool can access downloaded files

---

## 3. Module Structure

### 3.1 Suggested File Layout

```
rachel9/
├── src/
│   ├── index.ts                    # Entry point (polling vs webhook mode)
│   │
│   ├── telegram/
│   │   ├── bot.ts                  # grammy.js bot instance + middleware
│   │   ├── context.ts              # TelegramContext adapter
│   │   ├── queue.ts                # ChatQueue implementation
│   │   ├── handlers/
│   │   │   ├── message.ts          # Text message handler
│   │   │   ├── media.ts            # Photo/video/document handlers
│   │   │   ├── voice.ts            # Voice message + transcription
│   │   │   └── command.ts          # /start, /stop commands
│   │   └── middleware/
│   │       ├── auth.ts             # User authorization
│   │       └── logging.ts          # Request logging
│   │
│   ├── agent/
│   │   ├── runner.ts               # AgentRunner (like mom's agent.ts)
│   │   ├── tools/
│   │   │   ├── index.ts            # createTelegramTools()
│   │   │   ├── bash.ts             # Bash execution
│   │   │   ├── read.ts             # File reading
│   │   │   ├── write.ts            # File writing
│   │   │   ├── edit.ts             # File editing
│   │   │   └── telegram-send.ts    # Send files/messages via Telegram
│   │   └── session.ts              # Session management (context.jsonl)
│   │
│   ├── storage/
│   │   ├── store.ts                # ChatStore (like mom's store.ts)
│   │   ├── logger.ts               # log.jsonl management
│   │   └── attachments.ts          # File download queue
│   │
│   ├── lib/
│   │   ├── memory.ts               # MEMORY.md loading/saving
│   │   ├── tasks.ts                # SQLite task scheduler
│   │   ├── logger.ts               # Logging
│   │   └── config.ts               # Environment variables
│   │
│   └── setup/
│       ├── auth.ts                 # OAuth setup (like mom)
│       └── migrate.ts              # Database migrations
│
├── data/                           # Data directory (like mom)
│   ├── MEMORY.md                   # Global memory
│   ├── settings.json               # Settings
│   └── <chatId>/                   # Per-chat directories
│       ├── MEMORY.md
│       ├── log.jsonl
│       ├── context.jsonl
│       ├── attachments/
│       └── scratch/
│
├── package.json
├── tsconfig.json
└── README.md
```

### 3.2 Clear Separation of Concerns

**Transport layer (telegram/):**
- grammy.js bot
- Update handlers
- Telegram API calls
- Queue management
- Context adapter

**Agent layer (agent/):**
- pi-mono Agent creation
- Tool implementations
- Session management
- Event handling

**Storage layer (storage/):**
- log.jsonl append-only logging
- Attachment downloads
- File persistence

**Business logic (lib/):**
- Memory system
- Task scheduler
- Configuration

### 3.3 Pi-Mono Integration vs Custom Code

**Use pi-mono:**
- `@mariozechner/pi-agent-core`: Agent class, event system
- `@mariozechner/pi-ai`: LLM API (Anthropic)
- `@mariozechner/pi-coding-agent`: SessionManager, AgentSession, AuthStorage, convertToLlm

**Custom Rachel9 code:**
- Telegram transport (grammy.js)
- TelegramContext adapter
- ChatQueue
- ChatStore (attachment downloads, log.jsonl)
- Telegram-specific tools (send-file)
- Task scheduler
- Memory system integration

**Integration points:**
```typescript
// agent/runner.ts
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { SessionManager, AgentSession, convertToLlm } from "@mariozechner/pi-coding-agent";

// Custom
import { createTelegramTools } from "./tools/index.ts";
import { TelegramContext } from "../telegram/context.ts";
import { ChatStore } from "../storage/store.ts";
```

---

## 4. Key Design Patterns from pi-mono's mom

### 4.1 AgentRunner Pattern

**Pattern: Encapsulate Agent + SessionManager + event subscription**

From mom (`/tmp/pi-mono/packages/mom/src/agent.ts:411-863`):

```typescript
function createRunner(channelId: string, channelDir: string): AgentRunner {
  // 1. Create executor (sandbox)
  const executor = createExecutor(sandboxConfig);

  // 2. Create tools
  const tools = createMomTools(executor);

  // 3. Create SessionManager
  const contextFile = join(channelDir, "context.jsonl");
  const sessionManager = SessionManager.open(contextFile, channelDir);

  // 4. Create Agent
  const agent = new Agent({
    initialState: { systemPrompt, model, tools },
    convertToLlm,
    getApiKey: async () => getAnthropicApiKey(authStorage),
  });

  // 5. Load existing messages
  const loadedSession = sessionManager.buildSessionContext();
  agent.replaceMessages(loadedSession.messages);

  // 6. Create AgentSession wrapper
  const session = new AgentSession({
    agent,
    sessionManager,
    settingsManager,
    cwd: process.cwd(),
    modelRegistry,
    resourceLoader,
    baseToolsOverride,
  });

  // 7. Subscribe to events ONCE
  session.subscribe(async (event) => {
    // Handle tool_execution_start, tool_execution_end, etc.
  });

  // 8. Return runner interface
  return {
    async run(ctx: TelegramContext): Promise<{ stopReason: string }> {
      // Sync log → context
      syncLogToSessionManager(sessionManager, channelDir, ctx.message.messageId);

      // Reload context
      const reloadedSession = sessionManager.buildSessionContext();
      agent.replaceMessages(reloadedSession.messages);

      // Update system prompt (fresh memory)
      const systemPrompt = buildSystemPrompt(memory, skills, channels);
      agent.setSystemPrompt(systemPrompt);

      // Prompt agent
      await session.prompt(userMessage, imageAttachments);

      // Return stop reason
      return { stopReason: runState.stopReason };
    },

    abort(): void {
      session.abort();
    },
  };
}
```

**Key insights:**
- Event subscription happens ONCE at creation
- Each run: sync log → reload context → update system prompt → prompt
- Mutable per-run state stored in closure (`runState`)
- Event handlers access per-run state via closure

### 4.2 Event Subscription for Streaming

**Pattern: Subscribe once, use queue to serialize Telegram API calls**

From mom (`/tmp/pi-mono/packages/mom/src/agent.ts:704-730`):

```typescript
// Per-run mutable state
const runState = {
  ctx: null as TelegramContext | null,
  queue: null as MessageQueue | null,
  pendingTools: new Map(),
  totalUsage: { input: 0, output: 0, cost: 0 },
};

// Create queue for this run
runState.queue = {
  enqueue(fn: () => Promise<void>, errorContext: string): void {
    queueChain = queueChain.then(async () => {
      try {
        await fn();
      } catch (err) {
        log.warning(`API error (${errorContext})`, err.message);
      }
    });
  },
  enqueueMessage(text: string, target: "main" | "thread"): void {
    const parts = splitForTelegram(text);  // Split long messages
    for (const part of parts) {
      this.enqueue(
        () => target === "main" ? ctx.respond(part) : ctx.respondInThread(part),
        errorContext,
      );
    }
  },
};

// Event handler enqueues Telegram updates
session.subscribe(async (event) => {
  if (!runState.ctx || !runState.queue) return;  // Skip if no active run

  if (event.type === "tool_execution_start") {
    runState.queue.enqueue(() => ctx.respond(`_→ ${label}_`, false), "tool label");
  }

  if (event.type === "message_end") {
    runState.queue.enqueueMessage(text, "main", "response main");
  }
});
```

**Why this pattern:**
- Agent events fire async (parallel tool executions)
- Telegram API calls must be sequential (avoid race conditions)
- Queue ensures message order: tool labels → results → final response
- Per-run state prevents cross-contamination between concurrent runs

### 4.3 Context/Session Management

**Pattern: SessionManager persists to context.jsonl**

From pi-mono coding-agent:

```typescript
// Create session manager
const sessionManager = SessionManager.open(contextFile, workingDir);

// Build context from file
const sessionContext = sessionManager.buildSessionContext();
// → { messages: AgentMessage[], stats: { messageCount, tokenEstimate } }

// Load into agent
agent.replaceMessages(sessionContext.messages);

// Append new messages (saved automatically)
sessionManager.appendMessage(userMessage);
sessionManager.appendMessage(assistantMessage);
```

**SessionManager features:**
- Appends to context.jsonl atomically
- Supports compaction (keeps recent, summarizes old)
- Token estimation for context tracking
- Entries: message, compaction, continuation

**Mom's sync pattern** (critical for Rachel9):
- Before each run: sync log.jsonl → SessionManager
- Picks up channel chatter, backfilled messages
- Deduplicates by message content (normalized)
- Excludes current message (will be added via prompt())

### 4.4 Per-Channel File Storage

**Pattern: Each channel gets isolated directory**

From mom:

```
data/
├── MEMORY.md
├── settings.json
├── skills/              # Global skills
└── C<channelId>/        # Per-channel
    ├── MEMORY.md        # Channel-specific memory
    ├── log.jsonl        # Message history
    ├── context.jsonl    # LLM context
    ├── attachments/     # Downloaded files
    ├── scratch/         # Working directory
    └── skills/          # Channel-specific skills
```

**File path translation** (Docker mode):
- Host: `/path/to/data/C123/scratch/file.txt`
- Container: `/workspace/C123/scratch/file.txt`
- System prompt references container paths
- Upload function translates back to host paths

**Rachel9 adaptation:**
```
data/
├── MEMORY.md
├── settings.json
└── <chatId>/           # Per-chat (numeric ID)
    ├── MEMORY.md
    ├── log.jsonl
    ├── context.jsonl
    ├── attachments/
    └── scratch/
```

---

## 5. Build Order (Implementation Sequence)

### Phase 1: Core Infrastructure (Days 1-2)

1. **Project setup**
   - `package.json` with pi-mono dependencies
   - TypeScript config
   - Basic directory structure

2. **Storage layer** (`storage/`)
   - `store.ts`: ChatStore (manage chat directories)
   - `logger.ts`: log.jsonl append/read
   - `attachments.ts`: Download queue

3. **Configuration** (`lib/config.ts`)
   - Environment variables
   - Telegram bot token
   - Data directory path

### Phase 2: Agent Foundation (Days 3-4)

4. **Session management** (`agent/session.ts`)
   - SessionManager wrapper
   - syncLogToSessionManager() port from mom
   - Settings manager

5. **Agent tools** (`agent/tools/`)
   - Start with: bash, read, write
   - Use mom's tool implementations as reference
   - Add edit later

6. **AgentRunner** (`agent/runner.ts`)
   - createRunner() pattern from mom
   - Event subscription
   - Per-run state management
   - getOrCreateRunner() cache

### Phase 3: Telegram Transport (Days 5-6)

7. **Bot setup** (`telegram/bot.ts`)
   - grammy.js initialization
   - Middleware (auth, logging)
   - Basic command handlers

8. **Message queue** (`telegram/queue.ts`)
   - ChatQueue implementation
   - Per-chat queue Map
   - Stop command handling

9. **Context adapter** (`telegram/context.ts`)
   - TelegramContext interface
   - Message accumulation
   - API call queuing
   - Telegram markdown formatting

10. **Message handlers** (`telegram/handlers/`)
    - message.ts: Text messages
    - Start with text only
    - Add media handlers later

### Phase 4: Integration (Day 7)

11. **Main entry point** (`index.ts`)
    - Polling mode setup
    - Handler wiring
    - getState() pattern from mom
    - Graceful shutdown

12. **Basic testing**
    - Send text message
    - Agent responds
    - Tool execution
    - Multi-turn conversation

### Phase 5: Features (Days 8-10)

13. **Media handling** (`telegram/handlers/media.ts`)
    - Photo handler
    - Document handler
    - Attachment download

14. **Memory system** (`lib/memory.ts`)
    - MEMORY.md loading
    - System prompt injection
    - Port from Rachel8

15. **Webhook mode** (`index.ts`)
    - Webhook server (Bun.serve)
    - Health check endpoint
    - Rachel Cloud integration

### Phase 6: Polish (Days 11-12)

16. **Task scheduler** (`lib/tasks.ts`)
    - SQLite-backed scheduler
    - Port from Rachel8
    - Agent tasks

17. **Telegram-specific tools** (`agent/tools/telegram-send.ts`)
    - Send file via bot API
    - Send message

18. **Error handling**
    - Session overflow handling
    - API error recovery
    - Logging

### Dependencies Between Components

```
Phase 1 (Storage)
  ↓
Phase 2 (Agent) ← depends on Storage
  ↓
Phase 3 (Telegram) ← depends on Agent
  ↓
Phase 4 (Integration) ← depends on Telegram + Agent
  ↓
Phase 5 (Features) ← depends on Integration
  ↓
Phase 6 (Polish) ← depends on all
```

**Critical path:**
1. Storage layer (needed for agent)
2. Agent foundation (needed for Telegram)
3. Telegram transport (needed for integration)
4. Integration (needed for testing)

**Can be deferred:**
- Media handling (start with text)
- Task scheduler (add after basic bot works)
- Webhook mode (start with polling)

---

## 6. Critical Design Decisions

### 6.1 Use pi-mono's AgentSession vs Direct Agent

**Decision: Use AgentSession wrapper (like mom)**

Rationale:
- AgentSession provides compaction, retry, session persistence
- Integrates with SessionManager for context.jsonl
- Handles model/provider switching
- Worth the extra abstraction

### 6.2 Telegram Message Accumulation

**Decision: Accumulate in main message, details in thread (like mom)**

Pattern:
- Main message: Streaming updates, tool labels, final response
- Thread (reply): Tool args + results, usage summary

Rationale:
- Keeps channel clean
- Users can expand details if needed
- Similar to Slack threading

### 6.3 File Storage Strategy

**Decision: Per-chat directories (like mom)**

Structure:
```
data/<chatId>/
├── log.jsonl          # All messages
├── context.jsonl      # LLM context
├── attachments/       # Downloads
└── scratch/           # Working directory
```

Rationale:
- Isolated state per chat
- Easy to backup/migrate individual chats
- Tools scoped to chat directory

### 6.4 Session Persistence

**Decision: SQLite for sessions (like Rachel8), context.jsonl for history**

- Sessions map stored in SQLite or JSON (Rachel8 uses JSON)
- Context stored in context.jsonl (pi-mono format)
- log.jsonl as source of truth (append-only)

Rationale:
- Leverage SessionManager's compaction
- Sessions file is lightweight
- log.jsonl provides infinite history via grep

### 6.5 Deployment Modes

**Decision: Support both polling and webhook (like Rachel8)**

Polling mode:
- For standalone instances
- Uses grammy.js built-in polling
- Simpler for single-user setups

Webhook mode:
- For Rachel Cloud containers
- Bun.serve HTTP server
- Receives updates from central router

Implementation:
```typescript
if (isWebhookMode) {
  await bot.init();  // Don't start polling
  Bun.serve({ port: 8443, fetch: webhookHandler });
} else {
  await bot.start();  // Start long polling
}
```

---

## Summary

**Rachel9 architecture:**
- One Agent per chat (cached Map)
- Per-chat queues for sequential message processing
- SessionManager + context.jsonl for persistence
- log.jsonl as source of truth, synced before each run
- TelegramContext adapter for streaming responses
- grammy.js for Telegram transport
- pi-mono Agent/SessionManager for core logic
- Bun runtime + SQLite for tasks

**Key patterns from mom:**
- AgentRunner encapsulation
- Event subscription with per-run state
- Message queue for API call serialization
- Sync log → context before each run
- Per-channel file storage

**Build order:**
1. Storage (log.jsonl, ChatStore)
2. Agent (tools, runner, session)
3. Telegram (bot, queue, context adapter)
4. Integration (main entry point)
5. Features (media, memory, tasks)
6. Polish (webhook mode, error handling)

This architecture provides a clean separation of concerns, leverages pi-mono's proven patterns, and adapts mom's Slack bot design for Telegram while maintaining Rachel8's feature set.
