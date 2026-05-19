import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";
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
  }
}
