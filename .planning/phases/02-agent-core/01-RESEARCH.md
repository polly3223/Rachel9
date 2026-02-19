# Phase 2 Research: Agent Core

## Overview

Phase 2 integrates pi-agent-core, pi-ai, and pi-coding-agent to create a working AI agent with tool calling. The agent is NOT yet connected to Telegram handlers (that's Phase 3). It must be promptable programmatically.

**Requirements:** AGENT-01 through AGENT-10, AGENT-13, AGENT-14

---

## 1. Pi-Mono Package Versions & Exports

### pi-agent-core (@mariozechner/pi-agent-core)
- `Agent` class — core agent with state, events, tools, streaming
- `AgentTool<TParameters>` interface — tool definition
- `AgentMessage` type — message in conversation
- `AgentEvent` type — union of all event types
- `AgentState` — full agent state
- `AgentToolResult<T>` — tool execution result

### pi-ai (@mariozechner/pi-ai)
- `getModel(provider, modelId)` — get model from registry
- `Model<TApi>` — immutable model config
- `streamSimple()` — LLM streaming (used internally by Agent)
- `Message`, `TextContent`, `ImageContent` — LLM message types

### pi-coding-agent (@mariozechner/pi-coding-agent)
- `createCodingTools(cwd, options?)` — 4 tools: read, bash, edit, write
- `createAllTools(cwd, options?)` — 7 tools: read, bash, edit, write, grep, find, ls
- `convertToLlm` — transform AgentMessage[] → LLM Message[]
- `SessionManager` — JSONL session persistence
- `compact()`, `shouldCompact()` — context compaction
- `loadSkills()` — load skill markdown files

---

## 2. Z.ai Model Configuration (CRITICAL)

From `models.generated.ts`, the Z.ai GLM-5 model:

```typescript
"zai": {
  "glm-5": {
    id: "glm-5",
    name: "GLM-5",
    api: "openai-completions",  // ← NOT anthropic-messages!
    provider: "zai",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    compat: {"supportsDeveloperRole": false, "thinkingFormat": "zai"},
    reasoning: true,
    input: ["text"],
    cost: { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
    contextWindow: 204800,
    maxTokens: 131072,
  } satisfies Model<"openai-completions">
}
```

**Key findings:**
- Uses `openai-completions` API (NOT Anthropic — the proxy talks OpenAI format)
- baseUrl: `https://api.z.ai/api/coding/paas/v4` (different from Rachel8's proxy!)
- Z.ai has its own thinking format (`thinkingFormat: "zai"`)
- No developer role support (`supportsDeveloperRole: false`)
- 204K context window, 131K max output

**API Key:** The `getApiKey` callback receives the provider name. For "zai" provider, we need the Z.ai API key (same key Lorenzo already has as ZAI_API_KEY or in rachel-proxy).

**Usage:**
```typescript
import { getModel } from "@mariozechner/pi-ai";
const model = getModel("zai", "glm-5");
```

---

## 3. Agent Construction Pattern (from Mom bot)

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { convertToLlm, createAllTools, SessionManager } from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";

const model = getModel("zai", "glm-5");

const agent = new Agent({
  initialState: {
    systemPrompt: "You are Rachel...",
    model,
    thinkingLevel: "off",
    tools: [...allTools, ...customTools],
  },
  convertToLlm,      // Required: transforms AgentMessage[] → LLM Message[]
  getApiKey: async (provider) => {
    if (provider === "zai") return process.env.ZAI_API_KEY;
    return undefined;
  },
});
```

### Agent.prompt() — Two Signatures
```typescript
// String input
await agent.prompt("Hello, what can you do?");

// AgentMessage input
await agent.prompt({ role: "user", content: [{ type: "text", text: "Hello" }] });

// With images
await agent.prompt("What's in this image?", [{ type: "image", source: { type: "base64", data, media_type } }]);
```

### Event Subscription
```typescript
const unsub = agent.subscribe((event) => {
  switch (event.type) {
    case "message_update":     // Streaming text chunks
    case "tool_execution_start":  // Tool about to run
    case "tool_execution_end":    // Tool finished
    case "turn_end":              // One turn complete
    case "agent_end":             // All turns done
  }
});
```

### State Access
```typescript
agent.state.messages           // Full conversation history
agent.state.isStreaming         // Currently generating
agent.setSystemPrompt(newPrompt)
agent.setModel(newModel)
agent.replaceMessages(msgs)    // Replace full history
```

---

## 4. Tool System

### AgentTool Interface
```typescript
interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> {
  name: string;
  label: string;              // Human-readable label for UI
  description: string;
  parameters: TParameters;    // TypeBox JSON Schema
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
}

interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
}
```

### Pi-Coding-Agent Tools (7 total via createAllTools)
1. **read** — Read files (supports line ranges, images, PDFs)
2. **bash** — Execute shell commands (timeout, background support)
3. **edit** — Surgical file edits (old_string → new_string replacement)
4. **write** — Write/create files
5. **grep** — Search file contents (regex, glob filters)
6. **find** — Find files by glob pattern
7. **ls** — List directory contents

### Custom Tools Needed for Rachel
1. **web_search** — Web search (fetch search results)
2. **web_fetch** — Fetch URL content
3. **telegram_send_file** — Send files to owner via Telegram

These 3 custom tools need to be created as AgentTool implementations.

---

## 5. Session Management

### SessionManager
```typescript
const sessionManager = SessionManager.open(
  join(chatDir, "context.jsonl"),  // Session file path
  chatDir                           // Working directory
);

// Load existing messages
const context = sessionManager.buildSessionContext();
// Returns: { messages: AgentMessage[], thinkingLevel, model }

// Append a message entry
sessionManager.appendEntry({
  type: "message",
  id: generateUUID(),
  parentId: sessionManager.getLeafId(),
  timestamp: new Date().toISOString(),
  message: userMessage
});

// Flush to disk
sessionManager.flush();
```

### Compaction
```typescript
import { compact, shouldCompact } from "@mariozechner/pi-coding-agent";

if (shouldCompact(entries, settings)) {
  const result = await compact(entries, model, getApiKey, { maxTokens: 2000 });
  // result: { summary, firstKeptEntryId, tokensBefore }
}
```

---

## 6. Architecture Decisions for Phase 2

### A. One Agent Per Chat (from Mom pattern)
- `Map<number, AgentRunner>` keyed by chatId
- Created lazily on first message
- Loads session from context.jsonl
- Persists across messages within same process

### B. Module Structure
```
src/agent/
  ├── index.ts          # getOrCreateAgent(), agentPrompt() export
  ├── runner.ts         # AgentRunner class (agent + session + tools)
  ├── system-prompt.ts  # buildSystemPrompt() with memory injection
  └── tools/
      ├── index.ts      # combineTools() — coding + custom
      ├── web-search.ts # WebSearch AgentTool
      ├── web-fetch.ts  # WebFetch AgentTool
      └── telegram.ts   # TelegramSendFile AgentTool
```

### C. Prompt Lifecycle (for Phase 2 — no Telegram yet)
1. `agentPrompt(chatId, text)` called programmatically
2. Get or create AgentRunner for chatId
3. Rebuild system prompt (with memory)
4. Load session from context.jsonl
5. Call `agent.prompt(text)`
6. Subscribe to events for streaming/tool updates
7. On agent_end: extract response text, persist session
8. Return response string

### D. API Key Management
- Z.ai key from env: `ZAI_API_KEY`
- `getApiKey(provider)` callback returns key for matching provider
- Fallback: `ANTHROPIC_API_KEY` for Anthropic models (future multi-provider)

---

## 7. Rachel8 → Rachel9 Mapping

| Rachel8 | Rachel9 |
|---------|---------|
| `query()` from claude-agent-sdk | `agent.prompt()` from pi-agent-core |
| No native tools (all via system prompt) | 10 native tools (7 coding + 3 custom) |
| `sessions.json` per chatId | `context.jsonl` per chatId via SessionManager |
| No compaction | `compact()` + `shouldCompact()` |
| No streaming (full response only) | Event-based streaming via `subscribe()` |
| `buildSystemPromptWithMemory()` | Same pattern, injecting MEMORY.md |
| `permissionMode: "bypassPermissions"` | Tools execute directly (no permission system) |

---

## 8. Pitfalls to Avoid

1. **TypeBox vs Zod**: pi-mono tools use TypeBox (`@sinclair/typebox`) for parameters, NOT Zod. Custom tools must use TypeBox schemas.
2. **convertToLlm is REQUIRED**: Without it, Agent doesn't know how to convert AgentMessages to LLM-compatible format.
3. **Z.ai uses OpenAI format**: The API speaks openai-completions, not anthropic-messages. Don't confuse this.
4. **thinkingFormat: "zai"**: Z.ai has its own thinking token format. Pi-ai handles this automatically via the compat config.
5. **supportsDeveloperRole: false**: Z.ai doesn't support the developer/system role distinction — pi-ai handles this.
6. **SessionManager needs flush()**: Changes aren't written to disk until flush() is called.
7. **Agent.prompt() is async but streams**: It resolves when ALL turns complete (including tool calls). Use events for real-time updates.
8. **createAllTools > createCodingTools**: Use `createAllTools()` for the full 7-tool set. `createCodingTools()` only gives 4.

---

## 9. Dependencies to Add

```json
{
  "@mariozechner/pi-agent-core": "latest",
  "@mariozechner/pi-ai": "latest",
  "@mariozechner/pi-coding-agent": "latest",
  "@sinclair/typebox": "latest"
}
```

Note: pi-mono packages are published to npm. Check if they're available or if we need to use workspace links from the cloned repo.
