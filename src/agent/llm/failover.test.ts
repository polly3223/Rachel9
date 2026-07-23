import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "../runtime/types.ts";
import { FailoverClient } from "./failover.ts";
import type { AgentLlmClient, LlmTurnResult } from "./types.ts";

const messages: AgentMessage[] = [{
  role: "user",
  content: [{ type: "text", text: "Hello" }],
  timestamp: 1,
}];

function result(provider: string): LlmTurnResult {
  return {
    text: "OK",
    toolCalls: [],
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
    provider,
  };
}

describe("FailoverClient", () => {
  test("opens a cooldown after a monthly spending cap error", async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const primary: AgentLlmClient = {
      generate: async () => {
        primaryCalls++;
        throw new Error('{"error":{"code":429,"message":"Your project has exceeded its monthly spending cap."}}');
      },
    };
    const fallback: AgentLlmClient = {
      generate: async () => {
        fallbackCalls++;
        return result("groq");
      },
    };
    const client = new FailoverClient(primary, fallback);

    expect((await client.generate(messages, [])).provider).toBe("groq");
    expect((await client.generate(messages, [])).provider).toBe("groq");
    expect(primaryCalls).toBe(1);
    expect(fallbackCalls).toBe(2);
  });

  test("does not mask application errors", async () => {
    let fallbackCalls = 0;
    const primary: AgentLlmClient = {
      generate: async () => {
        throw new Error("Invalid tool schema");
      },
    };
    const fallback: AgentLlmClient = {
      generate: async () => {
        fallbackCalls++;
        return result("groq");
      },
    };
    const client = new FailoverClient(primary, fallback);

    await expect(client.generate(messages, [])).rejects.toThrow("Invalid tool schema");
    expect(fallbackCalls).toBe(0);
  });
});
