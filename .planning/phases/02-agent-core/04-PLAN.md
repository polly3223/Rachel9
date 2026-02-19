---
wave: 2
depends_on:
  - 01-PLAN.md
  - 02-PLAN.md
  - 03-PLAN.md
files_modified:
  - src/agent/runner.ts
  - src/agent/index.ts
requirements:
  - AGENT-01
  - AGENT-02
  - AGENT-03
  - AGENT-08
  - AGENT-09
  - AGENT-10
  - AGENT-11
  - AGENT-13
  - AGENT-14
autonomous: true
---

# Plan 04: Agent Runner + Public API

## Goal
Create the AgentRunner class that wraps pi-agent-core Agent with session management, tool registration, and event handling. Create the public API module that manages per-chat runners.

This is the core of Phase 2 — after this plan, the agent can be prompted programmatically and returns responses.

## Tasks

### Task 1: Create AgentRunner class
<task>
Create `/home/rachel/rachel9/src/agent/runner.ts`:

```typescript
import { Agent, type AgentEvent, type AgentMessage } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { convertToLlm, SessionManager } from "@mariozechner/pi-coding-agent";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { errorMessage } from "../lib/errors.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { createAgentTools, type ToolDependencies } from "./tools/index.ts";

// Z.ai GLM-5 via pi-ai model registry
const DEFAULT_MODEL = getModel("zai", "glm-5");

export interface AgentRunnerOptions {
  chatId: number;
  toolDeps: ToolDependencies;
}

export interface PromptResult {
  response: string;
  toolsUsed: string[];
}

export type AgentEventCallback = (event: AgentEvent) => void;

export class AgentRunner {
  readonly chatId: number;
  private agent: Agent;
  private sessionManager: SessionManager;
  private eventCallbacks: AgentEventCallback[] = [];

  constructor(opts: AgentRunnerOptions) {
    this.chatId = opts.chatId;

    // Session directory: $SHARED_FOLDER_PATH/rachel9/sessions/<chatId>/
    const sessionDir = join(env.SHARED_FOLDER_PATH, "rachel9", "sessions", String(opts.chatId));
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    // Create session manager
    const contextFile = join(sessionDir, "context.jsonl");
    this.sessionManager = SessionManager.open(contextFile, sessionDir);

    // Create tools
    const tools = createAgentTools(opts.toolDeps);

    // Create agent
    this.agent = new Agent({
      initialState: {
        systemPrompt: buildSystemPrompt(),
        model: DEFAULT_MODEL,
        thinkingLevel: "off",
        tools,
      },
      convertToLlm,
      getApiKey: async (provider: string) => {
        if (provider === "zai") return env.ZAI_API_KEY;
        // Support Anthropic fallback for multi-provider future
        if (provider === "anthropic") return Bun.env["ANTHROPIC_API_KEY"] ?? undefined;
        return undefined;
      },
    });

    // Load existing session messages
    const loaded = this.sessionManager.buildSessionContext();
    if (loaded.messages.length > 0) {
      this.agent.replaceMessages(loaded.messages);
      logger.debug("Loaded session", { chatId: opts.chatId, messageCount: loaded.messages.length });
    }

    // Wire up event forwarding
    this.agent.subscribe((event: AgentEvent) => {
      for (const cb of this.eventCallbacks) {
        try {
          cb(event);
        } catch (err) {
          logger.error("Event callback error", { error: errorMessage(err) });
        }
      }
    });

    logger.info("AgentRunner created", { chatId: opts.chatId });
  }

  /**
   * Subscribe to agent events (streaming, tool execution, etc.)
   * Returns unsubscribe function.
   */
  onEvent(callback: AgentEventCallback): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      const idx = this.eventCallbacks.indexOf(callback);
      if (idx >= 0) this.eventCallbacks.splice(idx, 1);
    };
  }

  /**
   * Send a message to the agent and get a response.
   * Handles session persistence, system prompt refresh, and error recovery.
   */
  async prompt(text: string): Promise<PromptResult> {
    // Refresh system prompt (memory might have changed)
    this.agent.setSystemPrompt(buildSystemPrompt());

    const toolsUsed: string[] = [];

    // Track tools used during this prompt
    const unsub = this.agent.subscribe((event: AgentEvent) => {
      if (event.type === "tool_execution_end") {
        toolsUsed.push(event.toolName);
      }
    });

    try {
      // Run agent
      await this.agent.prompt(text);

      // Extract response text from last assistant message
      const messages = this.agent.state.messages;
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      const response = lastAssistant
        ? lastAssistant.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("\n")
        : "(No response)";

      // Persist session
      this.persistSession();

      return { response, toolsUsed };
    } catch (err) {
      const msg = errorMessage(err);
      logger.error("Agent prompt error", { chatId: this.chatId, error: msg });

      // Check for context overflow
      if (this.isContextOverflow(msg)) {
        logger.warn("Context overflow detected, resetting session", { chatId: this.chatId });
        return this.handleContextOverflow(text);
      }

      throw err;
    } finally {
      unsub();
    }
  }

  /**
   * Check if an error indicates context overflow.
   */
  private isContextOverflow(error: string): boolean {
    const patterns = [
      "prompt is too long",
      "too many tokens",
      "context length",
      "request too large",
      "maximum context",
      "token limit",
    ];
    const lower = error.toLowerCase();
    return patterns.some((p) => lower.includes(p));
  }

  /**
   * Handle context overflow: clear messages, create fresh session, retry.
   */
  private async handleContextOverflow(originalText: string): Promise<PromptResult> {
    // Clear agent messages
    this.agent.clearMessages();

    // Create new session (SessionManager handles the file)
    const sessionDir = join(env.SHARED_FOLDER_PATH, "rachel9", "sessions", String(this.chatId));
    const contextFile = join(sessionDir, "context.jsonl");
    this.sessionManager = SessionManager.open(contextFile, sessionDir);

    // Prepend notice to the user's message
    const recoveryMessage = `[System: Previous conversation context was too large and has been reset. Your memory files (MEMORY.md, context/, daily-logs/) are intact. The user's original message follows.]\n\n${originalText}`;

    try {
      await this.agent.prompt(recoveryMessage);

      const messages = this.agent.state.messages;
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      const response = lastAssistant
        ? lastAssistant.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("\n")
        : "(No response after context reset)";

      this.persistSession();
      return { response, toolsUsed: [] };
    } catch (retryErr) {
      logger.error("Failed even after context reset", { error: errorMessage(retryErr) });
      return {
        response: "I encountered an error and couldn't recover. Please try again.",
        toolsUsed: [],
      };
    }
  }

  /**
   * Persist current agent messages to context.jsonl
   */
  private persistSession(): void {
    try {
      // The SessionManager tracks entries internally via appendEntry.
      // After agent.prompt(), messages are in agent.state.messages.
      // We need to sync these to the session file.
      //
      // For now, we write the full message list as entries.
      // A more sophisticated approach would track deltas.
      this.sessionManager.flush();
      logger.debug("Session persisted", { chatId: this.chatId });
    } catch (err) {
      logger.warn("Failed to persist session", { chatId: this.chatId, error: errorMessage(err) });
    }
  }

  /**
   * Get the current model name.
   */
  get modelName(): string {
    return this.agent.state.model?.name ?? "unknown";
  }

  /**
   * Get current message count.
   */
  get messageCount(): number {
    return this.agent.state.messages.length;
  }

  /**
   * Check if agent is currently streaming.
   */
  get isStreaming(): boolean {
    return this.agent.state.isStreaming;
  }
}
```

Key design decisions:
- One AgentRunner per chatId (matches Mom pattern)
- Session stored at `$SHARED_FOLDER_PATH/rachel9/sessions/<chatId>/context.jsonl`
- System prompt refreshed before every query (memory might have changed)
- Context overflow detection and recovery (reset + retry with notice)
- Event forwarding to external callbacks (used by Phase 3 for streaming)
- Tracks tools used during each prompt for logging
- `convertToLlm` from pi-coding-agent handles message transformation
- `getModel("zai", "glm-5")` for Z.ai default model

Requirements satisfied:
- **AGENT-01**: pi-agent-core Agent class integration with tool calling
- **AGENT-02**: pi-ai with Z.ai as default provider
- **AGENT-08**: SessionManager for persistence (context.jsonl)
- **AGENT-10**: Context overflow recovery
- **AGENT-11**: Agent event subscriptions
</task>

### Task 2: Create public agent API
<task>
Create `/home/rachel/rachel9/src/agent/index.ts`:

```typescript
import { AgentRunner, type PromptResult, type AgentEventCallback } from "./runner.ts";
import type { ToolDependencies } from "./tools/index.ts";
import { logger } from "../lib/logger.ts";

/**
 * Cache of active agent runners, keyed by chatId.
 * Each chat gets its own agent with isolated session.
 */
const runners = new Map<number, AgentRunner>();

let _toolDeps: ToolDependencies | null = null;

/**
 * Initialize the agent system with tool dependencies.
 * Must be called before any agent operations.
 */
export function initAgentSystem(deps: ToolDependencies): void {
  _toolDeps = deps;
  logger.info("Agent system initialized", { cwd: deps.cwd });
}

/**
 * Get or create an AgentRunner for a chat.
 */
function getOrCreateRunner(chatId: number): AgentRunner {
  if (!_toolDeps) {
    throw new Error("Agent system not initialized. Call initAgentSystem() first.");
  }

  const existing = runners.get(chatId);
  if (existing) return existing;

  const runner = new AgentRunner({ chatId, toolDeps: _toolDeps });
  runners.set(chatId, runner);
  return runner;
}

/**
 * Send a message to the agent for a specific chat and get a response.
 * Creates an AgentRunner lazily if one doesn't exist.
 */
export async function agentPrompt(chatId: number, text: string): Promise<PromptResult> {
  const runner = getOrCreateRunner(chatId);
  return runner.prompt(text);
}

/**
 * Subscribe to agent events for a specific chat.
 * Creates the runner if it doesn't exist.
 * Returns unsubscribe function.
 */
export function subscribeToAgent(chatId: number, callback: AgentEventCallback): () => void {
  const runner = getOrCreateRunner(chatId);
  return runner.onEvent(callback);
}

/**
 * Get info about an active agent runner.
 */
export function getRunnerInfo(chatId: number): { model: string; messages: number; streaming: boolean } | null {
  const runner = runners.get(chatId);
  if (!runner) return null;
  return {
    model: runner.modelName,
    messages: runner.messageCount,
    streaming: runner.isStreaming,
  };
}

// Re-export types
export type { PromptResult, AgentEventCallback } from "./runner.ts";
export type { ToolDependencies } from "./tools/index.ts";
```

Key design decisions:
- `initAgentSystem()` sets up tool dependencies once (called from index.ts)
- `agentPrompt()` is the main public API — give it chatId + text, get response
- `subscribeToAgent()` for Phase 3 streaming integration
- Runners are cached in a Map, created lazily
- Module-level dependency injection avoids circular imports
</task>

## Verification
- [ ] `src/agent/runner.ts` exists and exports `AgentRunner` class
- [ ] `src/agent/index.ts` exists and exports `agentPrompt`, `initAgentSystem`, `subscribeToAgent`
- [ ] `AgentRunner` creates Agent with Z.ai GLM-5 model
- [ ] `AgentRunner` uses `convertToLlm` from pi-coding-agent
- [ ] `AgentRunner` loads session from context.jsonl
- [ ] `AgentRunner` refreshes system prompt before each query
- [ ] Context overflow is detected and recovered with session reset
- [ ] `bunx tsc --noEmit` passes
- [ ] Runner Map caches per-chatId instances

## must_haves
- Agent uses `getModel("zai", "glm-5")` (not hardcoded model object)
- `convertToLlm` passed to Agent constructor
- `getApiKey` returns `env.ZAI_API_KEY` for "zai" provider
- Session dir is `$SHARED_FOLDER_PATH/rachel9/sessions/<chatId>/`
- Context overflow patterns match Rachel8's detection strings
- `agentPrompt()` is the single entry point for sending messages
- `initAgentSystem()` must be called before `agentPrompt()` (throws otherwise)
