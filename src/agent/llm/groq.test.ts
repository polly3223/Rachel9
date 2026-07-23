import { describe, expect, test } from "bun:test";
import type { AgentMessage, ToolDefinition } from "../runtime/types.ts";
import { GroqFallbackClient } from "./groq.ts";

const messages: AgentMessage[] = [{
  role: "user",
  content: [{ type: "text", text: "Add 19 and 23." }],
  timestamp: 1,
}];

const tools: ToolDefinition[] = [{
  name: "add",
  label: "Add",
  description: "Add two numbers",
  parameters: {
    type: "object",
    properties: {
      a: { type: "number" },
      b: { type: "number" },
    },
    required: ["a", "b"],
  },
  execute: async () => ({ content: [{ type: "text", text: "42" }] }),
}];

describe("GroqFallbackClient", () => {
  test("translates messages and tool calls", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        model: "openai/gpt-oss-120b",
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              function: { name: "add", arguments: "{\"a\":19,\"b\":23}" },
            }],
          },
        }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
        },
      });
    };

    const client = new GroqFallbackClient({
      apiKey: "test-key",
      model: "openai/gpt-oss-120b",
      systemPrompt: "System",
      fetcher,
    });
    const result = await client.generate(messages, tools);

    expect(result.provider).toBe("groq");
    expect(result.modelVersion).toBe("openai/gpt-oss-120b");
    expect(result.toolCalls).toEqual([{
      id: "call-1",
      name: "add",
      args: { a: 19, b: 23 },
    }]);
    expect(result.usage.total).toBe(120);
    expect(requestBody?.["tools"]).toHaveLength(1);
    expect(requestBody?.["messages"]).toEqual([
      { role: "system", content: "System" },
      { role: "user", content: "Add 19 and 23." },
    ]);
    expect(requestBody?.["max_completion_tokens"]).toBe(1_024);
    expect(requestBody?.["reasoning_effort"]).toBe("low");
  });

  test("sends only the current turn from a long persisted session", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const client = new GroqFallbackClient({
      apiKey: "test-key",
      model: "openai/gpt-oss-120b",
      systemPrompt: "System",
      fetcher: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return Response.json({
          choices: [{ finish_reason: "stop", message: { content: "Current answer" } }],
        });
      },
    });
    const longSession: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Old question ".repeat(10_000) }],
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Old answer" }],
        timestamp: 2,
      },
      ...messages,
    ];

    await client.generate(longSession, []);

    expect(requestBody?.["messages"]).toEqual([
      { role: "system", content: "System" },
      { role: "user", content: "Add 19 and 23." },
    ]);
  });

  test("does not pretend to inspect current media", async () => {
    const client = new GroqFallbackClient({
      apiKey: "test-key",
      model: "openai/gpt-oss-120b",
      systemPrompt: "System",
      fetcher: async () => {
        throw new Error("fetch should not run");
      },
    });
    const mediaMessages: AgentMessage[] = [{
      role: "user",
      content: [{ type: "media", data: "abc", mimeType: "image/jpeg" }],
      timestamp: 1,
    }];

    await expect(client.generate(mediaMessages, [])).rejects.toThrow(
      "cannot inspect the current media attachment",
    );
  });
});
