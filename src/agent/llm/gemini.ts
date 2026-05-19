import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";
import { logger } from "../../lib/logger.ts";
import type { AgentMessage, ContentPart, ToolCallRecord, ToolDefinition, UsageMetadata } from "../runtime/types.ts";

export interface GeminiTurnResult {
  text: string;
  toolCalls: ToolCallRecord[];
  usage: UsageMetadata;
  modelVersion?: string;
  stopReason?: string;
}

export interface GeminiClientOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
}

function contentPartToGemini(part: ContentPart): Part {
  if (part.type === "text") return { text: part.text };
  return {
    inlineData: {
      data: part.data,
      mimeType: part.mimeType,
    },
  };
}

function toolResultToText(message: Extract<AgentMessage, { role: "toolResult" }>): string {
  const content = message.content
    .filter((part): part is Extract<ContentPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");

  if (message.details === undefined) return content;
  return `${content}\n\nDetails:\n${JSON.stringify(message.details)}`;
}

function messageToGemini(message: AgentMessage): Content {
  if (message.role === "user") {
    return {
      role: "user",
      parts: message.content.map(contentPartToGemini),
    };
  }

  if (message.role === "assistant") {
    const parts: Part[] = message.content.map(contentPartToGemini);
    for (const call of message.toolCalls ?? []) {
      parts.push({
        functionCall: {
          id: call.id,
          name: call.name,
          args: call.args,
        },
        thoughtSignature: call.thoughtSignature,
      });
    }
    return { role: "model", parts };
  }

  return {
    role: "user",
    parts: [{
      functionResponse: {
        id: message.toolCallId,
        name: message.toolName,
        response: message.isError
          ? { error: toolResultToText(message) }
          : { output: toolResultToText(message) },
      },
    }],
  };
}

function toFunctionDeclaration(tool: ToolDefinition): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: JSON.parse(JSON.stringify(tool.parameters ?? { type: "object", properties: {} })),
  };
}

function toUsage(response: GenerateContentResponse): UsageMetadata {
  const usage = response.usageMetadata;
  return {
    input: usage?.promptTokenCount ?? 0,
    output: usage?.candidatesTokenCount ?? 0,
    cacheRead: usage?.cachedContentTokenCount ?? 0,
    cacheWrite: 0,
    total: usage?.totalTokenCount ?? 0,
  };
}

function toToolCall(call: FunctionCall, index: number, thoughtSignature?: string): ToolCallRecord | null {
  if (!call.name) return null;
  return {
    id: call.id ?? `${call.name}-${Date.now()}-${index}`,
    name: call.name,
    args: call.args ?? {},
    thoughtSignature,
  };
}

function extractToolCalls(response: GenerateContentResponse): ToolCallRecord[] {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((part, index) => part.functionCall ? toToolCall(part.functionCall, index, part.thoughtSignature) : null)
    .filter((call): call is ToolCallRecord => call !== null);
}

function extractText(response: GenerateContentResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => part.text && !part.thought)
    .map((part) => part.text)
    .join("");
}

const TRANSIENT_RETRY_DELAYS_MS = [800, 1_600, 3_200];

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (error instanceof Error) {
    return error.name === "AbortError" || error.message.toLowerCase().includes("abort");
  }
  return false;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isTransientGeminiError(error: unknown): boolean {
  const lower = errorText(error).toLowerCase();
  return [
    "\"code\":429",
    "\"code\":500",
    "\"code\":502",
    "\"code\":503",
    "\"code\":504",
    "too many requests",
    "internal server error",
    "bad gateway",
    "service unavailable",
    "gateway timeout",
    "resource_exhausted",
    "unavailable",
    "temporarily unavailable",
  ].some((pattern) => lower.includes(pattern));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }

    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new Error("Aborted"));
    }, { once: true });
  });
}

export class GeminiNativeClient {
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly systemPrompt: string;

  constructor(opts: GeminiClientOptions) {
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
    this.model = opts.model;
    this.systemPrompt = opts.systemPrompt;
  }

  async generate(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
  ): Promise<GeminiTurnResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt++) {
      try {
        const response = await this.ai.models.generateContent({
          model: this.model,
          contents: messages.map(messageToGemini),
          config: {
            abortSignal: signal,
            systemInstruction: this.systemPrompt,
            tools: tools.length > 0
              ? [{ functionDeclarations: tools.map(toFunctionDeclaration) }]
              : undefined,
            toolConfig: tools.length > 0
              ? { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } }
              : undefined,
          },
        });

        return {
          text: extractText(response),
          toolCalls: extractToolCalls(response),
          usage: toUsage(response),
          modelVersion: response.modelVersion,
          stopReason: response.candidates?.[0]?.finishReason,
        };
      } catch (err) {
        lastError = err;
        if (isAbortError(err, signal) || !isTransientGeminiError(err) || attempt >= TRANSIENT_RETRY_DELAYS_MS.length) {
          throw err;
        }

        const delayMs = TRANSIENT_RETRY_DELAYS_MS[attempt]!;
        logger.warn("Transient Gemini error, retrying", {
          attempt: attempt + 1,
          delayMs,
          error: errorText(err).slice(0, 500),
        });
        await sleep(delayMs, signal);
      }
    }

    throw lastError;
  }
}
