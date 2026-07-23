import type { AgentMessage, ToolCallRecord, ToolDefinition, UsageMetadata } from "../runtime/types.ts";
import type { GeminiThinkingLevel } from "../thinking.ts";

export interface LlmTurnResult {
  text: string;
  toolCalls: ToolCallRecord[];
  usage: UsageMetadata;
  provider: string;
  modelVersion?: string;
  stopReason?: string;
}

export interface AgentLlmClient {
  generate(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
    thinkingLevel?: GeminiThinkingLevel,
  ): Promise<LlmTurnResult>;
}
