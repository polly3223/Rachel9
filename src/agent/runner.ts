import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { errorMessage } from "../lib/errors.ts";
import { recordUsage } from "../lib/usage.ts";
import {
  markAgentPromptEnded,
  markAgentPromptStarted,
  markToolEnded,
  markToolStarted,
} from "../lib/runtime-state.ts";
import { createRun, finishRun, touchRun } from "../lib/agent-runtime-store.ts";
import { killManagedProcessesForChat, killManagedProcessesForScope } from "../lib/process-registry.ts";
import { buildDynamicPromptContext, buildStaticSystemPrompt } from "./system-prompt.ts";
import { createAgentTools, type ToolDependencies } from "./tools/index.ts";
import { compactMessages } from "./compaction.ts";
import { GeminiNativeClient } from "./llm/gemini.ts";
import { JsonlSessionStore } from "./runtime/session.ts";
import type { AgentEvent, AgentEventCallback, AgentMessage, ContentPart, ToolDefinition } from "./runtime/types.ts";
import { textPart } from "./runtime/types.ts";

const AGENT_PROMPT_TIMEOUT_MS = Number(Bun.env["AGENT_PROMPT_TIMEOUT_MS"] ?? 10 * 60_000);
const MAX_TOOL_ROUNDS = Number(Bun.env["AGENT_MAX_TOOL_ROUNDS"] ?? 32);

export interface AgentRunnerOptions {
  chatId: number;
  toolDeps: ToolDependencies;
}

export interface PromptResult {
  response: string;
  toolsUsed: string[];
}

function resolveDefaultModel(): string {
  const modelName = env.GEMINI_MODEL ?? "gemini-3.5-flash";
  logger.info("Using Gemini native model", { model: modelName });
  return modelName;
}

function textFromMessage(message: AgentMessage | undefined): string {
  if (!message) return "";
  return message.content
    .filter((part): part is Extract<ContentPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export class AgentRunner {
  readonly chatId: number;
  private readonly tools: ToolDefinition[];
  private readonly model: string;
  private readonly client: GeminiNativeClient;
  private readonly sessionStore: JsonlSessionStore;
  private readonly eventCallbacks: AgentEventCallback[] = [];
  private messages: AgentMessage[] = [];
  private currentRunId: string | null = null;
  private currentAbortController: AbortController | null = null;
  private streaming = false;

  constructor(opts: AgentRunnerOptions) {
    if (!env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is required for Rachel9 Gemini-native runtime");
    }

    this.chatId = opts.chatId;
    this.model = resolveDefaultModel();

    const sessionDir = join(env.SHARED_FOLDER_PATH, "rachel9", "sessions", String(opts.chatId));
    if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });

    this.sessionStore = new JsonlSessionStore(join(sessionDir, "context.jsonl"));
    this.messages = this.sessionStore.load();

    this.tools = createAgentTools({
      ...opts.toolDeps,
      chatId: opts.chatId,
      getRunId: () => this.currentRunId,
    });

    this.client = new GeminiNativeClient({
      apiKey: env.GEMINI_API_KEY,
      model: this.model,
      systemPrompt: buildStaticSystemPrompt(),
    });

    if (this.messages.length > 0) {
      logger.info("Loaded session from disk", { chatId: opts.chatId, messageCount: this.messages.length });
      this.compactOnLoad(opts.chatId);
    } else {
      logger.info("No previous session found, starting fresh", { chatId: opts.chatId });
    }

    logger.info("Gemini-native AgentRunner created", { chatId: opts.chatId, toolCount: this.tools.length });
  }

  onEvent(callback: AgentEventCallback): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      const idx = this.eventCallbacks.indexOf(callback);
      if (idx >= 0) this.eventCallbacks.splice(idx, 1);
    };
  }

  async prompt(text: string, media?: ContentPart[]): Promise<PromptResult> {
    const promptText = this.prependMessageTimestamp(text);
    const toolsUsed: string[] = [];
    let timedOut = false;
    let promptError: string | undefined;

    const runId = createRun({
      chatId: this.chatId,
      prompt: promptText,
      model: this.modelName,
      metadata: {
        mediaCount: media?.length ?? 0,
        messageCount: this.messages.length,
        runtime: "gemini-native",
      },
    });
    this.currentRunId = runId;

    const abortController = new AbortController();
    this.currentAbortController = abortController;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      logger.info("Agent prompt starting", {
        chatId: this.chatId,
        textLength: text.length,
        media: media?.length ?? 0,
        existingMessages: this.messages.length,
        runtime: "gemini-native",
      });

      markAgentPromptStarted(this.chatId, text.length);
      this.streaming = true;
      this.emit({ type: "turn_start" });

      timeout = setTimeout(() => {
        timedOut = true;
        logger.warn("Agent prompt timed out, aborting", { chatId: this.chatId, timeoutMs: AGENT_PROMPT_TIMEOUT_MS });
        touchRun(runId, {
          chatId: this.chatId,
          eventType: "run_timeout_requested",
          data: { timeoutMs: AGENT_PROMPT_TIMEOUT_MS },
        });
        killManagedProcessesForScope(runId, "agent_prompt_timeout");
        abortController.abort("agent_prompt_timeout");
      }, AGENT_PROMPT_TIMEOUT_MS);

      const userMessage: AgentMessage = {
        role: "user",
        content: [textPart(promptText), ...(media ?? [])],
        timestamp: Date.now(),
      };
      this.messages.push(userMessage);
      this.sessionStore.append(userMessage);

      const compacted = await compactMessages(this.messages, abortController.signal);
      if (compacted.length < this.messages.length) {
        this.messages = compacted;
        this.sessionStore.rewrite(this.messages);
      }

      let lastAssistant: AgentMessage | undefined;

      let hitToolRoundLimit = false;

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        touchRun(runId, { chatId: this.chatId, eventType: "message_start", data: { round } });
        this.emit({ type: "message_start" });

        const result = await this.client.generate(this.messages, this.tools, abortController.signal);
        const assistantMessage: AgentMessage = {
          role: "assistant",
          content: result.text ? [textPart(result.text)] : [],
          timestamp: Date.now(),
          model: result.modelVersion ?? this.model,
          provider: "google",
          usage: result.usage,
          stopReason: result.stopReason,
          toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
        };

        this.messages.push(assistantMessage);
        this.sessionStore.append(assistantMessage);
        lastAssistant = assistantMessage;
        this.trackUsage(assistantMessage);

        this.emit({ type: "message_end" });
        touchRun(runId, { chatId: this.chatId, eventType: "message_end", data: { round } });

        if (result.toolCalls.length === 0) break;

        for (const call of result.toolCalls) {
          const tool = this.tools.find((candidate) => candidate.name === call.name);
          if (!tool) {
            const missingResult: AgentMessage = {
              role: "toolResult",
              content: [textPart(`Tool not found: ${call.name}`)],
              timestamp: Date.now(),
              toolCallId: call.id,
              toolName: call.name,
              details: { error: "tool_not_found" },
              isError: true,
            };
            this.messages.push(missingResult);
            this.sessionStore.append(missingResult);
            continue;
          }

          toolsUsed.push(tool.name);
          markToolStarted(this.chatId, tool.name);
          this.emit({ type: "tool_execution_start", toolCallId: call.id, toolName: tool.name, args: call.args });
          touchRun(runId, {
            activeTool: tool.name,
            chatId: this.chatId,
            eventType: "tool_started",
            data: { toolCallId: call.id, args: call.args },
          });

          const toolResult = await tool.execute(call.id, call.args, abortController.signal);
          const isError = Boolean((toolResult.details as { error?: unknown } | undefined)?.error);
          const toolMessage: AgentMessage = {
            role: "toolResult",
            content: toolResult.content,
            timestamp: Date.now(),
            toolCallId: call.id,
            toolName: tool.name,
            details: toolResult.details,
            isError,
          };

          this.messages.push(toolMessage);
          this.sessionStore.append(toolMessage);
          markToolEnded(this.chatId);
          this.emit({ type: "tool_execution_end", toolCallId: call.id, toolName: tool.name, result: toolResult, isError });
          touchRun(runId, {
            activeTool: null,
            chatId: this.chatId,
            eventType: isError ? "tool_failed" : "tool_completed",
            data: { toolCallId: call.id, result: toolResult },
          });
        }

        if (round === MAX_TOOL_ROUNDS - 1) {
          hitToolRoundLimit = true;
        }
      }

      if (hitToolRoundLimit) {
        const finalPrompt: AgentMessage = {
          role: "user",
          content: [textPart(
            "The tool round budget has been reached. Do not call more tools. Give the user the best final answer from the work completed so far. If you created files, mention their paths. If you started a server or tunnel but did not retrieve the URL, say that plainly.",
          )],
          timestamp: Date.now(),
        };
        this.messages.push(finalPrompt);
        this.sessionStore.append(finalPrompt);

        const finalResult = await this.client.generate(this.messages, [], abortController.signal);
        const forcedFinalMessage: AgentMessage = {
          role: "assistant",
          content: finalResult.text ? [textPart(finalResult.text)] : [textPart("I reached the tool limit before producing a final answer.")],
          timestamp: Date.now(),
          model: finalResult.modelVersion ?? this.model,
          provider: "google",
          usage: finalResult.usage,
          stopReason: finalResult.stopReason,
        };
        this.messages.push(forcedFinalMessage);
        this.sessionStore.append(forcedFinalMessage);
        this.trackUsage(forcedFinalMessage);
        lastAssistant = forcedFinalMessage;
      }

      const response = timedOut
        ? "That operation took too long and I stopped it. Please try again with a smaller request, or ask me to continue from a specific point."
        : (textFromMessage(lastAssistant).trim() || "(No response)");

      if (lastAssistant) this.emit({ type: "turn_end", message: lastAssistant });
      finishRun(runId, {
        chatId: this.chatId,
        status: timedOut ? "timeout" : "completed",
        response,
        data: { toolsUsed, runtime: "gemini-native" },
      });

      return { response, toolsUsed };
    } catch (err) {
      const msg = errorMessage(err);
      promptError = msg;
      logger.error("Agent prompt error", { chatId: this.chatId, error: msg });

      if (this.isContextOverflow(msg)) {
        finishRun(runId, {
          chatId: this.chatId,
          status: "failed",
          error: err,
          data: { reason: "context_overflow", runtime: "gemini-native" },
        });
        return this.handleContextOverflow(text);
      }

      finishRun(runId, {
        chatId: this.chatId,
        status: timedOut ? "timeout" : "failed",
        error: err,
        data: { runtime: "gemini-native" },
      });
      throw err;
    } finally {
      if (timeout) clearTimeout(timeout);
      this.streaming = false;
      this.currentAbortController = null;
      this.currentRunId = null;
      markAgentPromptEnded(this.chatId, timedOut ? "timeout" : promptError);
    }
  }

  abort(reason = "aborted"): void {
    const runId = this.currentRunId;
    if (runId) {
      finishRun(runId, { chatId: this.chatId, status: "aborted", error: reason });
      killManagedProcessesForScope(runId, reason);
    } else {
      killManagedProcessesForChat(this.chatId, reason);
    }
    this.currentAbortController?.abort(reason);
  }

  get modelName(): string {
    return this.model;
  }

  get messageCount(): number {
    return this.messages.length;
  }

  get isStreaming(): boolean {
    return this.streaming;
  }

  private emit(event: AgentEvent): void {
    for (const cb of this.eventCallbacks) {
      try {
        cb(event);
      } catch (err) {
        logger.error("Event callback error", { error: errorMessage(err) });
      }
    }
  }

  private trackUsage(message: AgentMessage): void {
    if (message.role !== "assistant" || !message.usage) return;

    recordUsage(this.chatId, {
      model: message.model ?? this.model,
      provider: message.provider ?? "google",
      inputTokens: message.usage.input,
      outputTokens: message.usage.output,
      cacheRead: message.usage.cacheRead,
      cacheWrite: message.usage.cacheWrite,
      costTotal: 0,
    });
  }

  private compactOnLoad(chatId: number): void {
    const messages = [...this.messages];
    compactMessages(messages).then((compacted) => {
      if (compacted.length < messages.length) {
        this.messages = compacted;
        this.sessionStore.rewrite(this.messages);
        logger.info("Proactive compaction on load succeeded", { chatId, before: messages.length, after: compacted.length });
      } else {
        logger.info("Proactive compaction not needed", { chatId, messageCount: messages.length });
      }
    }).catch((err) => {
      logger.warn("Proactive compaction on load failed", { chatId, error: errorMessage(err) });
    });
  }

  private isContextOverflow(error: string): boolean {
    const lower = error.toLowerCase();
    return [
      "prompt is too long",
      "too many tokens",
      "context length",
      "request too large",
      "maximum context",
      "token limit",
    ].some((pattern) => lower.includes(pattern));
  }

  private async handleContextOverflow(originalText: string): Promise<PromptResult> {
    this.messages = [];
    this.sessionStore.rewrite(this.messages);
    const recoveryMessage = `[System: Previous conversation context was too large and has been reset. Memory files are intact. The user's original message follows.]\n\n${this.prependMessageTimestamp(originalText)}`;
    return this.prompt(recoveryMessage);
  }

  private prependMessageTimestamp(text: string): string {
    const now = new Date();
    const dynamicContext = buildDynamicPromptContext();
    const cet = now.toLocaleString("en-GB", {
      timeZone: "Europe/Berlin",
      dateStyle: "full",
      timeStyle: "medium",
    });

    return `[Current date/time: ${cet} CET]\n${dynamicContext}\n\n${text}`;
  }
}

export type { AgentEventCallback };
