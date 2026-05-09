import {
  createBashTool,
  createEditTool,
  createGrepTool,
  createFindTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@mariozechner/pi-coding-agent";
import type { AgentTool, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";
import { createWebSearchTool } from "./web-search.ts";
import { createWebFetchTool } from "./web-fetch.ts";
import { createTelegramSendFileTool } from "./telegram.ts";
import { logger } from "../../lib/logger.ts";
import { errorMessage } from "../../lib/errors.ts";
import { execManagedCommand } from "../../lib/process-registry.ts";

export interface ToolDependencies {
  /** Working directory for coding tools */
  cwd: string;
  /** Function to send files via Telegram */
  sendFile: (filePath: string, caption?: string) => Promise<void>;
  /** Chat that owns this tool set. Used for tracing/policy decisions. */
  chatId?: number;
}

const DEFAULT_BASH_TIMEOUT_SECONDS = Number(Bun.env["BASH_TOOL_TIMEOUT_SECONDS"] ?? "180");
const DEFAULT_TOOL_TIMEOUT_MS = Number(Bun.env["TOOL_TIMEOUT_MS"] ?? 180_000);
const TOOL_OUTPUT_MAX_CHARS = Number(Bun.env["TOOL_OUTPUT_MAX_CHARS"] ?? 50_000);

const TOOL_POLICIES: Record<string, { timeoutMs?: number; mutating?: boolean }> = {
  bash: { timeoutMs: DEFAULT_BASH_TIMEOUT_SECONDS * 1000, mutating: true },
  edit: { mutating: true },
  write: { mutating: true },
  telegram_send_file: { mutating: true },
  web_fetch: { timeoutMs: 20_000 },
  web_search: { timeoutMs: 20_000 },
};

function withDefaultBashTimeout(tool: AgentTool<any>): AgentTool<any> {
  if (tool.name !== "bash") return tool;

  const execute = tool.execute.bind(tool);
  return {
    ...tool,
    description: `${tool.description}\n\nIf no timeout is provided, Rachel applies a default timeout of ${DEFAULT_BASH_TIMEOUT_SECONDS} seconds.`,
    execute: async (
      toolCallId: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ) => {
      const nextParams = {
        ...params,
        timeout: params["timeout"] ?? DEFAULT_BASH_TIMEOUT_SECONDS,
      };
      return execute(toolCallId, nextParams, signal, onUpdate);
    },
  } as AgentTool;
}

function trimText(value: string): string {
  return value.length > TOOL_OUTPUT_MAX_CHARS
    ? `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n\n[...tool output truncated at ${TOOL_OUTPUT_MAX_CHARS} chars]`
    : value;
}

function capOutput<T>(result: Awaited<ReturnType<AgentTool<any>["execute"]>>): Awaited<ReturnType<AgentTool<any>["execute"]>> {
  return {
    ...result,
    content: result.content.map((part) => {
      if (part.type !== "text") return part;
      return { ...part, text: trimText(part.text) } satisfies TextContent;
    }),
    details: typeof result.details === "string"
      ? trimText(result.details) as T
      : result.details,
  };
}

function makeTimeoutSignal(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(`Tool timed out after ${timeoutMs}ms`), timeoutMs);
  const onAbort = () => controller.abort(parent?.reason ?? "Parent signal aborted");
  if (parent) {
    if (parent.aborted) onAbort();
    else parent.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

async function withHardTimeout<T>(promise: Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Tool ${toolName} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function withToolRuntimePolicy(tool: AgentTool<any>, chatId?: number): AgentTool<any> {
  const execute = tool.execute.bind(tool);
  const policy = TOOL_POLICIES[tool.name] ?? {};
  const timeoutMs = policy.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;

  return {
    ...tool,
    description: `${tool.description}\n\nRachel runtime policy: timeout=${Math.round(timeoutMs / 1000)}s, output cap=${TOOL_OUTPUT_MAX_CHARS} chars${policy.mutating ? ", mutating tool" : ""}.`,
    execute: async (
      toolCallId: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ) => {
      const startedAt = Date.now();
      const { signal: timeoutSignal, cleanup } = makeTimeoutSignal(signal, timeoutMs);
      logger.info("Tool runtime start", {
        chatId,
        tool: tool.name,
        toolCallId,
        timeoutMs,
        mutating: policy.mutating ?? false,
      });

      try {
        const result = await withHardTimeout(
          execute(toolCallId, params, timeoutSignal, onUpdate),
          timeoutMs + 250,
          tool.name,
        );
        logger.info("Tool runtime end", {
          chatId,
          tool: tool.name,
          toolCallId,
          durationMs: Date.now() - startedAt,
        });
        return capOutput(result);
      } catch (err) {
        logger.warn("Tool runtime error", {
          chatId,
          tool: tool.name,
          toolCallId,
          durationMs: Date.now() - startedAt,
          error: errorMessage(err),
        });
        return {
          content: [{ type: "text", text: `Tool ${tool.name} failed: ${errorMessage(err)}` }],
          details: { error: errorMessage(err) },
        };
      } finally {
        cleanup();
      }
    },
  } as AgentTool;
}

/**
 * Create all tools for an agent instance.
 * Combines pi-coding-agent tools (7) with custom Rachel tools (3).
 * Total: 10 tools.
 *
 * Coding tools (from pi-coding-agent):
 * - createCodingTools(cwd): read, bash, edit, write (4)
 * - createGrepTool(cwd): grep (1)
 * - createFindTool(cwd): find (1)
 * - createLsTool(cwd): ls (1)
 *
 * Custom tools:
 * - web_search: DuckDuckGo search
 * - web_fetch: URL content extraction
 * - telegram_send_file: Send files to user
 */
export function createAgentTools(deps: ToolDependencies): AgentTool[] {
  // 4 core coding tools: read, bash, edit, write
  const codingTools = [
    createReadTool(deps.cwd),
    createBashTool(deps.cwd, {
      operations: {
        exec: execManagedCommand,
      },
    }),
    createEditTool(deps.cwd),
    createWriteTool(deps.cwd),
  ].map(withDefaultBashTimeout);

  // 3 additional coding tools
  const extraCodingTools = [
    createGrepTool(deps.cwd),
    createFindTool(deps.cwd),
    createLsTool(deps.cwd),
  ];

  // 3 custom Rachel tools
  const customTools = [
    createWebSearchTool(),
    createWebFetchTool(),
    createTelegramSendFileTool(deps.sendFile),
  ];

  return [...codingTools, ...extraCodingTools, ...customTools]
    .map((tool) => withToolRuntimePolicy(tool, deps.chatId)) as AgentTool[];
}
