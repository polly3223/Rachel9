import { logger } from "../../lib/logger.ts";
import type { AgentMessage, ToolDefinition } from "../runtime/types.ts";
import type { GeminiThinkingLevel } from "../thinking.ts";
import { isPermanentGeminiQuotaError, isTransientGeminiError } from "./gemini.ts";
import type { AgentLlmClient, LlmTurnResult } from "./types.ts";

const PERMANENT_QUOTA_COOLDOWN_MS = 15 * 60_000;
const TRANSIENT_COOLDOWN_MS = 30_000;

export class FailoverClient implements AgentLlmClient {
  private primaryDisabledUntil = 0;

  constructor(
    private readonly primary: AgentLlmClient,
    private readonly fallback: AgentLlmClient,
  ) {}

  async generate(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
    thinkingLevel?: GeminiThinkingLevel,
  ): Promise<LlmTurnResult> {
    if (Date.now() < this.primaryDisabledUntil) {
      return this.fallback.generate(messages, tools, signal, thinkingLevel);
    }

    try {
      return await this.primary.generate(messages, tools, signal, thinkingLevel);
    } catch (error) {
      if (!isPermanentGeminiQuotaError(error) && !isTransientGeminiError(error)) {
        throw error;
      }

      const cooldownMs = isPermanentGeminiQuotaError(error)
        ? PERMANENT_QUOTA_COOLDOWN_MS
        : TRANSIENT_COOLDOWN_MS;
      this.primaryDisabledUntil = Date.now() + cooldownMs;

      logger.warn("Primary Gemini provider unavailable, using Groq fallback", {
        cooldownMs,
        error: String(error).slice(0, 500),
      });
      return this.fallback.generate(messages, tools, signal, thinkingLevel);
    }
  }
}
