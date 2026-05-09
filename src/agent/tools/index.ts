import {
  createCodingTools,
  createGrepTool,
  createFindTool,
  createLsTool,
} from "@mariozechner/pi-coding-agent";
import type { AgentTool, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import { createWebSearchTool } from "./web-search.ts";
import { createWebFetchTool } from "./web-fetch.ts";
import { createTelegramSendFileTool } from "./telegram.ts";

export interface ToolDependencies {
  /** Working directory for coding tools */
  cwd: string;
  /** Function to send files via Telegram */
  sendFile: (filePath: string, caption?: string) => Promise<void>;
}

const DEFAULT_BASH_TIMEOUT_SECONDS = Number(Bun.env["BASH_TOOL_TIMEOUT_SECONDS"] ?? "180");

function withDefaultBashTimeout(tool: AgentTool): AgentTool {
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
  const codingTools = createCodingTools(deps.cwd).map(withDefaultBashTimeout);

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

  return [...codingTools, ...extraCodingTools, ...customTools] as AgentTool[];
}
