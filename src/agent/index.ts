import { AgentRunner, type PromptResult, type AgentEventCallback } from "./runner.ts";
import type { ToolDependencies } from "./tools/index.ts";
import { logger } from "../lib/logger.ts";

/**
 * Cache of active agent runners, keyed by chatId.
 * Each chat gets its own agent with isolated session.
 */
const runners = new Map<number, AgentRunner>();

let _toolDeps: ToolDependencies | null = null;

/**
 * Initialize the agent system with tool dependencies.
 * Must be called before any agent operations.
 */
export function initAgentSystem(deps: ToolDependencies): void {
  _toolDeps = deps;
  logger.info("Agent system initialized", { cwd: deps.cwd });
}

/**
 * Get or create an AgentRunner for a chat.
 */
function getOrCreateRunner(chatId: number): AgentRunner {
  if (!_toolDeps) {
    throw new Error("Agent system not initialized. Call initAgentSystem() first.");
  }

  const existing = runners.get(chatId);
  if (existing) return existing;

  const runner = new AgentRunner({ chatId, toolDeps: _toolDeps });
  runners.set(chatId, runner);
  return runner;
}

/**
 * Send a message to the agent for a specific chat and get a response.
 * Creates an AgentRunner lazily if one doesn't exist.
 */
export async function agentPrompt(chatId: number, text: string): Promise<PromptResult> {
  const runner = getOrCreateRunner(chatId);
  return runner.prompt(text);
}

/**
 * Subscribe to agent events for a specific chat.
 * Creates the runner if it doesn't exist.
 * Returns unsubscribe function.
 */
export function subscribeToAgent(chatId: number, callback: AgentEventCallback): () => void {
  const runner = getOrCreateRunner(chatId);
  return runner.onEvent(callback);
}

/**
 * Get info about an active agent runner.
 */
export function getRunnerInfo(chatId: number): { model: string; messages: number; streaming: boolean } | null {
  const runner = runners.get(chatId);
  if (!runner) return null;
  return {
    model: runner.modelName,
    messages: runner.messageCount,
    streaming: runner.isStreaming,
  };
}

// Re-export types
export type { PromptResult, AgentEventCallback } from "./runner.ts";
export type { ToolDependencies } from "./tools/index.ts";
