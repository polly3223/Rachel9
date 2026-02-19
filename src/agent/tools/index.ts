import {
  createCodingTools,
  createGrepTool,
  createFindTool,
  createLsTool,
} from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createWebSearchTool } from "./web-search.ts";
import { createWebFetchTool } from "./web-fetch.ts";
import { createTelegramSendFileTool } from "./telegram.ts";

export interface ToolDependencies {
  /** Working directory for coding tools */
  cwd: string;
  /** Function to send files via Telegram */
  sendFile: (filePath: string, caption?: string) => Promise<void>;
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
  const codingTools = createCodingTools(deps.cwd);

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
