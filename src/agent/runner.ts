import { Agent, type AgentEvent, type AgentMessage } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { AssistantMessage, ImageContent, Message } from "@mariozechner/pi-ai";
import { convertToLlm, SessionManager } from "@mariozechner/pi-coding-agent";
import { join } from "node:path";
import { mkdirSync, existsSync, unlinkSync } from "node:fs";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { errorMessage } from "../lib/errors.ts";
import { recordUsage } from "../lib/usage.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { createAgentTools, type ToolDependencies } from "./tools/index.ts";
import { createContextTransform, compactMessages } from "./compaction.ts";

// Pick model based on available API keys
function resolveDefaultModel() {
  if (env.GEMINI_API_KEY) {
    const modelName = env.GEMINI_MODEL ?? "gemini-3-flash-preview";
    logger.info("Using Gemini model", { model: modelName });
    return getModel("google", modelName);
  }
  return getModel("zai", "glm-5");
}

const DEFAULT_MODEL = resolveDefaultModel();

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
  private lastPersistedCount = 0;

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

    // Resolve thinking level from env (default: "off")
    const thinkingLevel = env.THINKING_LEVEL ?? "off";

    // Create agent with context compaction
    this.agent = new Agent({
      initialState: {
        systemPrompt: buildSystemPrompt(),
        model: DEFAULT_MODEL,
        thinkingLevel,
        tools,
      },
      convertToLlm,
      transformContext: createContextTransform(),
      getApiKey: async (provider: string) => {
        if (provider === "google") return env.GEMINI_API_KEY ?? undefined;
        if (provider === "zai") return env.ZAI_API_KEY ?? undefined;
        if (provider === "anthropic") return Bun.env["ANTHROPIC_API_KEY"] ?? undefined;
        if (provider === "openai") return Bun.env["OPENAI_API_KEY"] ?? undefined;
        if (provider === "groq") return Bun.env["GROQ_API_KEY"] ?? undefined;
        return undefined;
      },
    });

    // Load existing session messages
    const loaded = this.sessionManager.buildSessionContext();
    if (loaded.messages.length > 0) {
      this.agent.replaceMessages(loaded.messages);
      this.lastPersistedCount = loaded.messages.length;
      logger.info("Loaded session from disk", { chatId: opts.chatId, messageCount: loaded.messages.length });

      // Proactive compaction: run transformContext on loaded messages immediately.
      // Without this, compaction only runs when the agent makes an LLM call —
      // if the context is already too large, the LLM returns empty responses
      // instead of throwing a clear error, causing "(No response)" silently.
      this.compactOnLoad(opts.chatId);
    } else {
      logger.info("No previous session found, starting fresh", { chatId: opts.chatId });
    }

    // Wire up event forwarding + usage tracking
    this.agent.subscribe((event: AgentEvent) => {
      // Log key events for debugging
      if (event.type === "turn_start") {
        logger.info("Agent turn started", { chatId: opts.chatId });
      } else if (event.type === "turn_end") {
        logger.info("Agent turn ended", { chatId: opts.chatId });
        this.trackUsage(event.message);
      } else if (event.type === "tool_execution_start") {
        logger.info("Tool execution started", { chatId: opts.chatId, tool: event.toolName });
      } else if (event.type === "tool_execution_end") {
        logger.info("Tool execution ended", { chatId: opts.chatId, tool: event.toolName });
      }

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
   * Extract usage from an assistant message and record it.
   */
  private trackUsage(message: AgentMessage): void {
    if (!message || message.role !== "assistant") return;

    const assistantMsg = message as unknown as AssistantMessage;
    const usage = assistantMsg.usage;
    if (!usage) return;

    recordUsage(this.chatId, {
      model: assistantMsg.model ?? this.modelName,
      provider: assistantMsg.provider ?? "unknown",
      inputTokens: usage.input ?? 0,
      outputTokens: usage.output ?? 0,
      cacheRead: usage.cacheRead ?? 0,
      cacheWrite: usage.cacheWrite ?? 0,
      costTotal: usage.cost?.total ?? 0,
    });
  }

  /**
   * Proactive compaction: run after loading session from disk.
   * If context exceeds threshold, compact immediately and rewrite session file.
   * Runs async (fire-and-forget) so it doesn't block constructor.
   */
  private compactOnLoad(chatId: number): void {
    const messages = [...this.agent.state.messages];
    compactMessages(messages).then((compacted) => {
      if (compacted.length < messages.length) {
        logger.info("Proactive compaction on load succeeded", {
          chatId,
          before: messages.length,
          after: compacted.length,
        });
        this.agent.replaceMessages(compacted);

        // Rewrite session file: delete old, create fresh, write compacted messages
        const sessionDir = join(env.SHARED_FOLDER_PATH, "rachel9", "sessions", String(chatId));
        const contextFile = join(sessionDir, "context.jsonl");
        try {
          unlinkSync(contextFile);
        } catch {
          // File might not exist
        }
        this.sessionManager = SessionManager.open(contextFile, sessionDir);
        for (const msg of compacted) {
          this.sessionManager.appendMessage(msg as unknown as Message);
        }
        this.lastPersistedCount = compacted.length;
        logger.info("Session file rewritten with compacted context", { chatId });
      } else {
        logger.info("Proactive compaction not needed", { chatId, messageCount: messages.length });
      }
    }).catch((err) => {
      logger.warn("Proactive compaction on load failed", { chatId, error: errorMessage(err) });
    });
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
  async prompt(text: string, images?: ImageContent[]): Promise<PromptResult> {
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
      // Run agent — no timeout, let it work as long as it needs
      logger.info("Agent prompt starting", { chatId: this.chatId, textLength: text.length, images: images?.length ?? 0, existingMessages: this.agent.state.messages.length });
      await this.agent.prompt(text, images);
      logger.info("Agent prompt completed", { chatId: this.chatId });

      // Extract response text from last assistant message
      const messages = this.agent.state.messages;
      const lastAssistant = [...messages].reverse().find((m: AgentMessage) => m.role === "assistant");

      let response = "(No response)";
      if (lastAssistant) {
        // Check if the model returned an error (e.g. timeout, rate limit)
        const stopReason = (lastAssistant as Record<string, unknown>).stopReason;
        const errorMsg = (lastAssistant as Record<string, unknown>).errorMessage;

        if (stopReason === "error" && errorMsg) {
          logger.warn("Agent response ended with error", { chatId: this.chatId, error: String(errorMsg) });
          response = `Sorry, the AI model returned an error: ${String(errorMsg)}\nPlease try again.`;
        } else {
          const textParts = lastAssistant.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("\n");
          response = textParts || "(No response)";
        }
      }

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

    // Create new session
    const sessionDir = join(env.SHARED_FOLDER_PATH, "rachel9", "sessions", String(this.chatId));
    const contextFile = join(sessionDir, "context.jsonl");
    this.sessionManager = SessionManager.open(contextFile, sessionDir);

    const recoveryMessage = `[System: Previous conversation context was too large and has been reset. Your memory files (MEMORY.md, context/, daily-logs/) are intact. The user's original message follows.]\n\n${originalText}`;

    try {
      await this.agent.prompt(recoveryMessage);

      const messages = this.agent.state.messages;
      const lastAssistant = [...messages].reverse().find((m: AgentMessage) => m.role === "assistant");
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
   * Persist new agent messages to context.jsonl via SessionManager.
   * SessionManager auto-writes to disk on appendMessage().
   */
  private persistSession(): void {
    try {
      const messages = this.agent.state.messages;
      const newMessages = messages.slice(this.lastPersistedCount);

      for (const msg of newMessages) {
        // SessionManager.appendMessage expects pi-ai Message type
        // AgentMessage is compatible — both have role + content
        this.sessionManager.appendMessage(msg as unknown as Message);
      }

      this.lastPersistedCount = messages.length;
      logger.debug("Session persisted", { chatId: this.chatId, newMessages: newMessages.length });
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
