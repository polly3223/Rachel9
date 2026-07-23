import { logger } from "../../lib/logger.ts";
import type { AgentMessage, ContentPart, ToolCallRecord, ToolDefinition, UsageMetadata } from "../runtime/types.ts";
import type { AgentLlmClient, LlmTurnResult } from "./types.ts";

const DEFAULT_MAX_OUTPUT_TOKENS = 1_024;
const MAX_TOOL_RESULT_CHARS = 6_000;
const TOOL_LIMIT_FINAL_PROMPT = "The tool round budget has been reached.";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface GroqClientOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  fetcher?: FetchLike;
}

interface GroqToolCall {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface GroqResponse {
  model?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: GroqToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

function textFromParts(parts: ContentPart[]): string {
  return parts
    .map((part) => part.type === "text"
      ? part.text
      : `[Attached ${part.mimeType} media is unavailable to the backup text model.]`)
    .join("\n");
}

function toolResultText(message: Extract<AgentMessage, { role: "toolResult" }>): string {
  const text = textFromParts(message.content);
  return text.length > MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n\n[Tool result truncated for backup provider.]`
    : text;
}

function messageText(message: AgentMessage | undefined): string {
  return message ? textFromParts(message.content) : "";
}

/**
 * Groq's emergency tier has a small TPM budget. The latest user turn contains
 * Rachel's dynamic memory context, so older persisted turns are unnecessary
 * and can make an otherwise valid fallback request fail.
 */
function currentTurnMessages(messages: AgentMessage[]): AgentMessage[] {
  let start = messages.findLastIndex((message) => message.role === "user");
  if (start < 0) return messages;

  if (messageText(messages[start]).startsWith(TOOL_LIMIT_FINAL_PROMPT)) {
    const previousUser = messages.findLastIndex(
      (message, index) => index < start && message.role === "user",
    );
    if (previousUser >= 0) start = previousUser;
  }

  return messages.slice(start);
}

function toGroqMessages(messages: AgentMessage[]): Array<Record<string, unknown>> {
  return currentTurnMessages(messages).map((message) => {
    if (message.role === "user") {
      return { role: "user", content: textFromParts(message.content) };
    }

    if (message.role === "toolResult") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        name: message.toolName,
        content: toolResultText(message),
      };
    }

    return {
      role: "assistant",
      content: textFromParts(message.content) || null,
      tool_calls: message.toolCalls?.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.args),
        },
      })),
    };
  });
}

function toGroqTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? { type: "object", properties: {} },
    },
  }));
}

function parseArguments(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    logger.warn("Groq returned invalid tool arguments", { value: value.slice(0, 300) });
    return {};
  }
}

function toToolCalls(calls: GroqToolCall[] | undefined): ToolCallRecord[] {
  return (calls ?? [])
    .filter((call) => call.function?.name)
    .map((call, index) => ({
      id: call.id ?? `groq-tool-${Date.now()}-${index}`,
      name: call.function!.name!,
      args: parseArguments(call.function?.arguments),
    }));
}

function toUsage(response: GroqResponse): UsageMetadata {
  return {
    input: response.usage?.prompt_tokens ?? 0,
    output: response.usage?.completion_tokens ?? 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: response.usage?.total_tokens ?? 0,
  };
}

export class GroqFallbackClient implements AgentLlmClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly systemPrompt: string;
  private readonly fetcher: FetchLike;

  constructor(opts: GroqClientOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.systemPrompt = opts.systemPrompt;
    this.fetcher = opts.fetcher ?? fetch;
  }

  async generate(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
  ): Promise<LlmTurnResult> {
    const latestUser = messages.findLast((message) => message.role === "user");
    if (latestUser?.content.some((part) => part.type === "media")) {
      throw new Error("The backup Groq model cannot inspect the current media attachment");
    }

    const response = await this.fetcher("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: this.systemPrompt },
          ...toGroqMessages(messages),
        ],
        tools: tools.length > 0 ? toGroqTools(tools) : undefined,
        tool_choice: tools.length > 0 ? "auto" : undefined,
        parallel_tool_calls: tools.length > 0 ? true : undefined,
        reasoning_effort: "low",
        max_completion_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
        stream: false,
      }),
      signal,
    });

    const payload = await response.json() as GroqResponse;
    if (!response.ok) {
      throw new Error(`Groq returned ${response.status}: ${payload.error?.message ?? "unknown error"}`);
    }

    const message = payload.choices?.[0]?.message;
    return {
      text: message?.content ?? "",
      toolCalls: toToolCalls(message?.tool_calls),
      usage: toUsage(payload),
      provider: "groq",
      modelVersion: payload.model ?? this.model,
      stopReason: payload.choices?.[0]?.finish_reason,
    };
  }
}
