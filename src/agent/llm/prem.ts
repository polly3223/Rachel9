import { z } from "zod";
import type { AgentMessage, ContentPart, ToolDefinition } from "../runtime/types.ts";
import type { ThinkingLevel } from "../thinking.ts";

export const PREM_BASE_URL = "https://gateway.prem.io/openai";

const responseSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    finish_reason: z.string().nullable(),
    message: z.object({
      content: z.string().nullish(),
      reasoning_content: z.string().nullish(),
      tool_calls: z.array(z.object({
        id: z.string().min(1),
        type: z.literal("function"),
        function: z.object({ name: z.string().min(1), arguments: z.string() }),
      })).optional(),
    }),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().nonnegative(),
    completion_tokens: z.number().nonnegative(),
    total_tokens: z.number().nonnegative(),
    prompt_tokens_details: z.object({ cached_tokens: z.number().nonnegative().optional() }).nullish(),
  }).optional(),
});

type WireToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type WireMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
};

function textContent(parts: ContentPart[]): string {
  return parts.map((part) => part.type === "text" ? part.text : `[Previously attached ${part.mimeType}${part.fileName ? `: ${part.fileName}` : ""}; binary content is not included]`).join("\n");
}

function userContent(parts: ContentPart[]): WireMessage["content"] {
  return parts.map((part) => part.type === "media" && /^image\/(jpeg|png|webp|gif)$/.test(part.mimeType)
    ? { type: "image_url" as const, image_url: { url: `data:${part.mimeType};base64,${part.data}` } }
    : { type: "text" as const, text: textContent([part]) });
}

function toolText(message: Extract<AgentMessage, { role: "toolResult" }>): string {
  return textContent(message.content) + (message.details === undefined ? "" : `\nDetails: ${JSON.stringify(message.details)}`);
}

/** Preserve completed tool exchanges; interrupted/compacted legacy exchanges are context, never replayed. */
export function toPremMessages(messages: AgentMessage[]): WireMessage[] {
  const result: WireMessage[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role === "user") {
      result.push({ role: "user", content: userContent(message.content) });
      continue;
    }
    if (message.role === "toolResult") {
      result.push({ role: "assistant", content: `[Historical ${message.toolName} result]\n${toolText(message)}` });
      continue;
    }
    const content = textContent(message.content);
    const calls = message.toolCalls ?? [];
    if (!calls.length) {
      if (content) result.push({ role: message.role, content, ...(message.reasoningContent ? { reasoning_content: message.reasoningContent } : {}) });
      continue;
    }
    const results = messages.slice(index + 1, index + 1 + calls.length);
    const complete = results.length === calls.length && calls.every((call) => results.filter((entry) => entry.role === "toolResult" && entry.toolCallId === call.id).length === 1);
    if (!complete) {
      result.push({ role: "assistant", content: `${content}\n[Historical tool requests; results incomplete, do not replay automatically]\n${JSON.stringify(calls.map(({ name, args }) => ({ name, args })))}` });
      continue;
    }
    const wireCalls: WireToolCall[] = calls.map((call, n) => ({ id: `call_${index}_${n}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }));
    result.push({ role: "assistant", content: content || null, tool_calls: wireCalls, reasoning_content: message.reasoningContent ?? "" });
    for (const [n, call] of calls.entries()) {
      const entry = results.find((item) => item.role === "toolResult" && item.toolCallId === call.id)!;
      if (entry.role === "toolResult") result.push({ role: "tool", tool_call_id: wireCalls[n]!.id, content: toolText(entry) });
    }
    index += calls.length;
  }
  return result;
}

export function reasoningEffort(level: ThinkingLevel): "low" | "high" {
  return level === "minimal" || level === "low" ? "low" : "high";
}

export class PremClient {
  constructor(private readonly options: { apiKey: string; model: string; systemPrompt: string; defaultThinkingLevel: ThinkingLevel }) {}

  async generate(messages: AgentMessage[], tools: ToolDefinition[], signal?: AbortSignal, thinkingLevel = this.options.defaultThinkingLevel) {
    return this.complete({
      model: this.options.model,
      messages: [{ role: "system", content: this.options.systemPrompt }, ...toPremMessages(messages)],
      reasoning_effort: reasoningEffort(thinkingLevel),
      ...(tools.length ? { tools: tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })), tool_choice: "auto" } : {}),
    }, signal);
  }

  private async complete(body: { model: string; messages: WireMessage[]; reasoning_effort: string; tools?: unknown[]; tool_choice?: string }, signal?: AbortSignal) {
    const response = await fetch(`${PREM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        ...body,
        max_tokens: 16_384,
        stream: false,
      }),
    });
    // Never retry an ambiguous POST or expose upstream response bodies/credentials in logs.
    if (!response.ok) {
      const body = await response.text();
      const contextError = /context.{0,30}(length|limit)|maximum context|too many tokens|prompt is too long/i.test(body);
      throw new Error(`Prem ZDR HTTP ${response.status}${contextError ? ": maximum context exceeded" : ""}`);
    }
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Prem ZDR returned an invalid completion");
    const completion = parsed.data;
    const choice = completion.choices[0]!;
    if (choice.finish_reason !== "stop" && choice.finish_reason !== "tool_calls") throw new Error(`Prem ZDR incomplete response (${choice.finish_reason ?? "unknown"})`);
    const toolCalls = (choice.message.tool_calls ?? []).map((call) => {
      let args: unknown;
      try { args = JSON.parse(call.function.arguments); } catch { throw new Error("Prem ZDR returned invalid tool arguments"); }
      const parsedArgs = z.record(z.string(), z.unknown()).safeParse(args);
      if (!parsedArgs.success) throw new Error("Prem ZDR returned non-object tool arguments");
      return { id: call.id, name: call.function.name, args: parsedArgs.data };
    });
    if (new Set(toolCalls.map((call) => call.id)).size !== toolCalls.length) throw new Error("Prem ZDR returned duplicate tool call IDs");
    const text = choice.message.content ?? "";
    if (!text.trim() && !toolCalls.length) throw new Error("Prem ZDR returned an empty completion");
    return {
      text,
      toolCalls,
      reasoningContent: choice.message.reasoning_content ?? undefined,
      modelVersion: completion.model,
      stopReason: choice.finish_reason,
      usage: {
        input: completion.usage?.prompt_tokens ?? 0,
        output: completion.usage?.completion_tokens ?? 0,
        cacheRead: completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        cacheWrite: 0,
        total: completion.usage?.total_tokens ?? 0,
      },
    };
  }
}
