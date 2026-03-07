import { GoogleGenAI } from "@google/genai";
import {
  streamSimple,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import { calculateCost } from "@mariozechner/pi-ai/dist/models.js";
import {
  convertMessages,
  convertTools,
  isThinkingPart,
  mapStopReason,
  mapToolChoice,
  retainThoughtSignature,
} from "@mariozechner/pi-ai/dist/providers/google-shared.js";
import { buildBaseOptions, clampReasoning } from "@mariozechner/pi-ai/dist/providers/simple-options.js";
import { AssistantMessageEventStream } from "@mariozechner/pi-ai/dist/utils/event-stream.js";
import { sanitizeSurrogates } from "@mariozechner/pi-ai/dist/utils/sanitize-unicode.js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";

const CACHE_METADATA_VERSION = 1;
const CACHE_TTL = "3600s";
const MIN_CACHEABLE_INPUT_TOKENS = 1024;

type GoogleModel = Model<"google-generative-ai">;
type GoogleOptions = SimpleStreamOptions & {
  apiKey?: string;
  headers?: Record<string, string>;
  toolChoice?: "auto" | "none" | "any";
  thinking?: {
    enabled?: boolean;
    level?: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
    budgetTokens?: number;
  };
};

interface CacheMetadata {
  version: number;
  name: string;
  fingerprint: string;
  model: string;
  prefixMessageCount: number;
  updatedAt: number;
}

interface PreparedRequest {
  cachedContentName?: string;
  prefixMessageCount: number;
  suffixMessages: Message[];
}

interface CachedRequestConfig {
  systemInstruction?: string;
  tools?: ReturnType<typeof convertTools>;
  toolConfig?: {
    functionCallingConfig: {
      mode: ReturnType<typeof mapToolChoice>;
    };
  };
}

function isGoogleGenerativeAiModel(model: Model<any>): model is GoogleModel {
  return model.provider === "google" && model.api === "google-generative-ai";
}

function getSessionDir(chatId: number): string {
  return join(env.SHARED_FOLDER_PATH, "rachel9", "sessions", String(chatId));
}

function createClient(model: GoogleModel, apiKey: string, optionsHeaders?: Record<string, string>): GoogleGenAI {
  const httpOptions: { baseUrl?: string; apiVersion?: string; headers?: Record<string, string> } = {};

  if (model.baseUrl) {
    httpOptions.baseUrl = model.baseUrl;
    httpOptions.apiVersion = "";
  }

  if (model.headers || optionsHeaders) {
    httpOptions.headers = { ...model.headers, ...optionsHeaders };
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: Object.keys(httpOptions).length > 0 ? httpOptions : undefined,
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

class GeminiChatCache {
  private readonly metadataPath: string;

  constructor(private readonly chatId: number) {
    this.metadataPath = join(getSessionDir(chatId), "gemini-cache.json");
  }

  load(): CacheMetadata | undefined {
    if (!existsSync(this.metadataPath)) return undefined;

    try {
      const parsed = JSON.parse(readFileSync(this.metadataPath, "utf-8")) as CacheMetadata;
      if (parsed.version !== CACHE_METADATA_VERSION) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  save(metadata: CacheMetadata): void {
    writeFileSync(this.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
  }

  clear(): void {
    try {
      writeFileSync(this.metadataPath, "", "utf-8");
    } catch {
      // Best effort only.
    }
  }

  async prepareRequest(model: GoogleModel, context: Context, options: GoogleOptions = {}): Promise<PreparedRequest> {
    const metadata = this.load();
    if (!metadata) {
      return {
        prefixMessageCount: 0,
        suffixMessages: context.messages,
      };
    }

    if (metadata.model !== model.id) {
      return {
        prefixMessageCount: 0,
        suffixMessages: context.messages,
      };
    }

    if (metadata.prefixMessageCount <= 0 || metadata.prefixMessageCount >= context.messages.length) {
      return {
        prefixMessageCount: 0,
        suffixMessages: context.messages,
      };
    }

    const prefixMessages = context.messages.slice(0, metadata.prefixMessageCount);
    const fingerprint = this.fingerprint(model, prefixMessages, context.systemPrompt, context.tools, options.toolChoice);
    if (fingerprint !== metadata.fingerprint) {
      return {
        prefixMessageCount: 0,
        suffixMessages: context.messages,
      };
    }

    return {
      cachedContentName: metadata.name,
      prefixMessageCount: metadata.prefixMessageCount,
      suffixMessages: context.messages.slice(metadata.prefixMessageCount),
    };
  }

  async refresh(
    client: GoogleGenAI,
    model: GoogleModel,
    context: Context,
    assistantMessage: AssistantMessage,
    options: GoogleOptions = {},
  ): Promise<void> {
    const inputTokens = assistantMessage.usage.input ?? 0;
    if (inputTokens < MIN_CACHEABLE_INPUT_TOKENS) return;

    const prefixMessages = [...context.messages, assistantMessage];
    if (prefixMessages.length === 0) return;

    const contents = convertMessages(model, { messages: prefixMessages });
    if (contents.length === 0) return;

    const previous = this.load();

    try {
      const cachedRequestConfig = buildCachedRequestConfig(context.systemPrompt, context.tools, options);
      const created = await client.caches.create({
        model: model.id,
        config: {
          contents,
          ttl: CACHE_TTL,
          displayName: `rachel9-chat-${this.chatId}`,
          ...(cachedRequestConfig.systemInstruction && { systemInstruction: cachedRequestConfig.systemInstruction }),
          ...(cachedRequestConfig.tools && { tools: cachedRequestConfig.tools }),
          ...(cachedRequestConfig.toolConfig && { toolConfig: cachedRequestConfig.toolConfig }),
        },
      });
      if (!created.name) return;

      const next: CacheMetadata = {
        version: CACHE_METADATA_VERSION,
        name: created.name,
        fingerprint: this.fingerprint(model, prefixMessages, context.systemPrompt, context.tools, options.toolChoice),
        model: model.id,
        prefixMessageCount: prefixMessages.length,
        updatedAt: Date.now(),
      };
      this.save(next);

      if (previous?.name && previous.name !== created.name) {
        try {
          await client.caches.delete({ name: previous.name });
        } catch (error) {
          logger.warn("Failed to delete previous Gemini cache", {
            chatId: this.chatId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.debug("Refreshed Gemini explicit cache", {
        chatId: this.chatId,
        prefixMessageCount: prefixMessages.length,
        cacheName: created.name,
      });
    } catch (error) {
      logger.warn("Failed to refresh Gemini explicit cache", {
        chatId: this.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private fingerprint(
    model: GoogleModel,
    messages: Message[],
    systemPrompt?: string,
    tools?: Context["tools"],
    toolChoice?: GoogleOptions["toolChoice"],
  ): string {
    return sha256(
      JSON.stringify({
        model: model.id,
        systemPrompt,
        tools,
        toolChoice,
        messages,
      }),
    );
  }
}

function buildCachedRequestConfig(
  systemPrompt: string | undefined,
  tools: Context["tools"],
  options: GoogleOptions = {},
): CachedRequestConfig {
  const config: CachedRequestConfig = {};

  if (systemPrompt) {
    config.systemInstruction = sanitizeSurrogates(systemPrompt);
  }

  if (tools && tools.length > 0) {
    config.tools = convertTools(tools);
  }

  if (tools && tools.length > 0 && options.toolChoice) {
    config.toolConfig = {
      functionCallingConfig: {
        mode: mapToolChoice(options.toolChoice),
      },
    };
  }

  return config;
}

function buildParams(
  model: GoogleModel,
  systemPrompt: string | undefined,
  messages: Message[],
  tools: Context["tools"],
  options: GoogleOptions = {},
  cachedContentName?: string,
) {
  const contents = convertMessages(model, { messages });
  const generationConfig: Record<string, unknown> = {};

  if (options.temperature !== undefined) {
    generationConfig["temperature"] = options.temperature;
  }

  if (options.maxTokens !== undefined) {
    generationConfig["maxOutputTokens"] = options.maxTokens;
  }

  const config: Record<string, unknown> = {
    ...(Object.keys(generationConfig).length > 0 && generationConfig),
    ...(!cachedContentName && systemPrompt && { systemInstruction: sanitizeSurrogates(systemPrompt) }),
    ...(!cachedContentName && tools && tools.length > 0 && { tools: convertTools(tools) }),
    ...(cachedContentName && { cachedContent: cachedContentName }),
  };

  if (!cachedContentName && tools && tools.length > 0 && options.toolChoice) {
    config["toolConfig"] = {
      functionCallingConfig: {
        mode: mapToolChoice(options.toolChoice),
      },
    };
  }

  if (options.thinking?.enabled && model.reasoning) {
    const thinkingConfig: Record<string, unknown> = { includeThoughts: true };
    if (options.thinking.level !== undefined) {
      thinkingConfig["thinkingLevel"] = options.thinking.level;
    } else if (options.thinking.budgetTokens !== undefined) {
      thinkingConfig["thinkingBudget"] = options.thinking.budgetTokens;
    }
    config["thinkingConfig"] = thinkingConfig;
  }

  if (options.signal) {
    if (options.signal.aborted) {
      throw new Error("Request aborted");
    }
    config["abortSignal"] = options.signal;
  }

  return {
    model: model.id,
    contents,
    config,
  };
}

function isGemini3ProModel(model: GoogleModel): boolean {
  return model.id.includes("3-pro");
}

function isGemini3FlashModel(model: GoogleModel): boolean {
  return model.id.includes("3-flash");
}

function getGemini3ThinkingLevel(
  effort: "minimal" | "low" | "medium" | "high",
  model: GoogleModel,
): "MINIMAL" | "LOW" | "MEDIUM" | "HIGH" {
  if (isGemini3ProModel(model)) {
    switch (effort) {
      case "minimal":
      case "low":
        return "LOW";
      case "medium":
      case "high":
        return "HIGH";
    }
  }

  switch (effort) {
    case "minimal":
      return "MINIMAL";
    case "low":
      return "LOW";
    case "medium":
      return "MEDIUM";
    case "high":
      return "HIGH";
  }
}

function getGoogleBudget(
  model: GoogleModel,
  effort: "minimal" | "low" | "medium" | "high",
  customBudgets?: SimpleStreamOptions["thinkingBudgets"],
): number {
  if (customBudgets?.[effort] !== undefined) {
    return customBudgets[effort]!;
  }

  if (model.id.includes("2.5-pro")) {
    const budgets = { minimal: 128, low: 2048, medium: 8192, high: 32768 };
    return budgets[effort];
  }

  if (model.id.includes("2.5-flash")) {
    const budgets = { minimal: 128, low: 2048, medium: 8192, high: 24576 };
    return budgets[effort];
  }

  return -1;
}

function streamGoogleWithCache(chatId: number, model: GoogleModel, context: Context, options: GoogleOptions = {}) {
  const stream = new AssistantMessageEventStream();

  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "google-generative-ai",
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    try {
      const apiKey = options.apiKey ?? env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("No Gemini API key configured");
      }

      const cache = new GeminiChatCache(chatId);
      const client = createClient(model, apiKey, options.headers);
      let prepared = await cache.prepareRequest(model, context, options);
      let params = buildParams(
        model,
        context.systemPrompt,
        prepared.suffixMessages,
        context.tools,
        options,
        prepared.cachedContentName,
      );

      options.onPayload?.(params);

      let googleStream;
      try {
        googleStream = await client.models.generateContentStream(params);
      } catch (error) {
        if (!prepared.cachedContentName) throw error;

        logger.warn("Gemini cached content failed; retrying without cache", {
          chatId,
          cacheName: prepared.cachedContentName,
          error: error instanceof Error ? error.message : String(error),
        });

        cache.clear();
        prepared = {
          prefixMessageCount: 0,
          suffixMessages: context.messages,
        };
        params = buildParams(model, context.systemPrompt, context.messages, context.tools, options);
        options.onPayload?.(params);
        googleStream = await client.models.generateContentStream(params);
      }

      stream.push({ type: "start", partial: output });

      let currentBlock: any = null;
      const blocks = output.content;
      const blockIndex = () => blocks.length - 1;

      for await (const chunk of googleStream) {
        const candidate = chunk.candidates?.[0];

        if (candidate?.content?.parts) {
          for (const part of candidate.content.parts) {
            if (part.text !== undefined) {
              const isThinking = isThinkingPart(part);
              if (
                !currentBlock ||
                (isThinking && currentBlock.type !== "thinking") ||
                (!isThinking && currentBlock.type !== "text")
              ) {
                if (currentBlock) {
                  if (currentBlock.type === "text") {
                    stream.push({
                      type: "text_end",
                      contentIndex: blocks.length - 1,
                      content: currentBlock.text,
                      partial: output,
                    });
                  } else {
                    stream.push({
                      type: "thinking_end",
                      contentIndex: blockIndex(),
                      content: currentBlock.thinking,
                      partial: output,
                    });
                  }
                }

                if (isThinking) {
                  currentBlock = { type: "thinking", thinking: "", thinkingSignature: undefined };
                  output.content.push(currentBlock);
                  stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
                } else {
                  currentBlock = { type: "text", text: "" };
                  output.content.push(currentBlock);
                  stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
                }
              }

              if (currentBlock.type === "thinking") {
                currentBlock.thinking += part.text;
                currentBlock.thinkingSignature = retainThoughtSignature(
                  currentBlock.thinkingSignature,
                  part.thoughtSignature,
                );
                stream.push({
                  type: "thinking_delta",
                  contentIndex: blockIndex(),
                  delta: part.text,
                  partial: output,
                });
              } else {
                currentBlock.text += part.text;
                currentBlock.textSignature = retainThoughtSignature(
                  currentBlock.textSignature,
                  part.thoughtSignature,
                );
                stream.push({
                  type: "text_delta",
                  contentIndex: blockIndex(),
                  delta: part.text,
                  partial: output,
                });
              }
            }

            if (part.functionCall) {
              if (currentBlock) {
                if (currentBlock.type === "text") {
                  stream.push({
                    type: "text_end",
                    contentIndex: blockIndex(),
                    content: currentBlock.text,
                    partial: output,
                  });
                } else {
                  stream.push({
                    type: "thinking_end",
                    contentIndex: blockIndex(),
                    content: currentBlock.thinking,
                    partial: output,
                  });
                }
                currentBlock = null;
              }

              const toolCall = {
                type: "toolCall",
                id: part.functionCall.id || `${part.functionCall.name}_${Date.now()}_${blocks.length}`,
                name: part.functionCall.name || "",
                arguments: part.functionCall.args ?? {},
                ...(part.thoughtSignature && { thoughtSignature: part.thoughtSignature }),
              } as const;

              output.content.push(toolCall as any);
              stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
              stream.push({
                type: "toolcall_delta",
                contentIndex: blockIndex(),
                delta: JSON.stringify(toolCall.arguments),
                partial: output,
              });
              stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall: toolCall as any, partial: output });
            }
          }
        }

        if (candidate?.finishReason) {
          output.stopReason = mapStopReason(candidate.finishReason);
          if (output.content.some((block) => block.type === "toolCall")) {
            output.stopReason = "toolUse";
          }
        }

        if (chunk.usageMetadata) {
          output.usage = {
            input: chunk.usageMetadata.promptTokenCount || 0,
            output: (chunk.usageMetadata.candidatesTokenCount || 0) + (chunk.usageMetadata.thoughtsTokenCount || 0),
            cacheRead: chunk.usageMetadata.cachedContentTokenCount || 0,
            cacheWrite: 0,
            totalTokens: chunk.usageMetadata.totalTokenCount || 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          };
          calculateCost(model, output.usage);
        }
      }

      if (currentBlock) {
        if (currentBlock.type === "text") {
          stream.push({
            type: "text_end",
            contentIndex: blockIndex(),
            content: currentBlock.text,
            partial: output,
          });
        } else {
          stream.push({
            type: "thinking_end",
            contentIndex: blockIndex(),
            content: currentBlock.thinking,
            partial: output,
          });
        }
      }

      if (options.signal?.aborted) {
        throw new Error("Request was aborted");
      }

      if (output.stopReason === "aborted" || output.stopReason === "error") {
        throw new Error("An unknown error occurred");
      }

      await cache.refresh(client, model, context, output, options);

      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options.signal?.aborted ? "aborted" : "error";
      (output as AssistantMessage & { errorMessage?: string }).errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}

function streamSimpleGoogleWithCache(
  chatId: number,
  model: GoogleModel,
  context: Context,
  options?: SimpleStreamOptions,
) {
  const apiKey = options?.apiKey ?? env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(`No API key for provider: ${model.provider}`);
  }

  const base = buildBaseOptions(model, options, apiKey) as GoogleOptions;

  if (!options?.reasoning) {
    return streamGoogleWithCache(chatId, model, context, {
      ...base,
      thinking: { enabled: false },
    });
  }

  const effort = clampReasoning(options.reasoning);
  if (!effort) {
    return streamGoogleWithCache(chatId, model, context, {
      ...base,
      thinking: { enabled: false },
    });
  }

  if (isGemini3ProModel(model) || isGemini3FlashModel(model)) {
    return streamGoogleWithCache(chatId, model, context, {
      ...base,
      thinking: {
        enabled: true,
        level: getGemini3ThinkingLevel(effort, model),
      },
    });
  }

  return streamGoogleWithCache(chatId, model, context, {
    ...base,
    thinking: {
      enabled: true,
      budgetTokens: getGoogleBudget(model, effort, options.thinkingBudgets),
    },
  });
}

export function createGeminiCachedStreamFn(chatId: number) {
  return (model: Model<any>, context: Context, options?: SimpleStreamOptions) => {
    if (!isGoogleGenerativeAiModel(model)) {
      return streamSimple(model, context, options);
    }

    return streamSimpleGoogleWithCache(chatId, model, context, options);
  };
}
