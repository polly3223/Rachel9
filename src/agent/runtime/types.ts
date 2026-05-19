export type ContentPart =
  | { type: "text"; text: string }
  | { type: "media"; data: string; mimeType: string; fileName?: string };

export interface UsageMetadata {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  thoughtSignature?: string;
}

export type AgentMessage =
  | {
      role: "user";
      content: ContentPart[];
      timestamp: number;
    }
  | {
      role: "assistant";
      content: ContentPart[];
      timestamp: number;
      model?: string;
      provider?: string;
      usage?: UsageMetadata;
      stopReason?: string;
      errorMessage?: string;
      toolCalls?: ToolCallRecord[];
    }
  | {
      role: "toolResult";
      content: ContentPart[];
      timestamp: number;
      toolCallId: string;
      toolName: string;
      details?: unknown;
      isError?: boolean;
    };

export type AgentEvent =
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage }
  | { type: "message_start" }
  | { type: "message_end" }
  | { type: "message_update"; assistantMessageEvent: { type: "text_delta"; delta: string } }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: ToolResult<unknown>; isError: boolean };

export type AgentEventCallback = (event: AgentEvent) => void;

export interface ToolResult<TDetails = unknown> {
  content: ContentPart[];
  details?: TDetails;
}

export type ToolUpdateCallback = (update: unknown) => void;

export interface ToolDefinition<TParams = unknown> {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: TParams,
    signal?: AbortSignal,
    onUpdate?: ToolUpdateCallback,
  ) => Promise<ToolResult<unknown>>;
}

export function textPart(text: string): ContentPart {
  return { type: "text", text };
}
