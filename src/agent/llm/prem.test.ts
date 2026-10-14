import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PremClient, reasoningEffort, toPremMessages } from "./prem.ts";
import { JsonlSessionStore } from "../runtime/session.ts";
import type { AgentMessage } from "../runtime/types.ts";

const originalFetch = globalThis.fetch;
function setFetch(handler: (url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => Promise<Response>) { globalThis.fetch = Object.assign(handler, { preconnect: originalFetch.preconnect }); }
afterEach(() => { globalThis.fetch = originalFetch; });
const client = new PremClient({ apiKey: "synthetic-key", model: "deepseek-v4.1-flash", systemPrompt: "test", defaultThinkingLevel: "low" });
const user: AgentMessage = { role: "user", content: [{ type: "text", text: "test" }], timestamp: 1 };
const call = { id: "legacy/id with spaces", name: "read", args: { file_path: "x" }, thoughtSignature: "google-only" };
const assistant: AgentMessage = { role: "assistant", content: [], toolCalls: [call], reasoningContent: "private-reasoning", timestamp: 2 };
const tool: AgentMessage = { role: "toolResult", content: [{ type: "text", text: "saved data" }], toolName: "read", toolCallId: call.id, timestamp: 3 };
const completion = (message: object, finish = "stop") => ({ model: "deepseek-v4.1-flash", choices: [{ finish_reason: finish, message }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 80 } } });
function respond(body: unknown, status = 200) { setFetch(async () => Response.json(body, { status })); }

test("maps supported DeepSeek reasoning levels", () => {
  expect(["minimal", "low", "medium", "high"].map((level) => reasoningEffort(level as "low"))).toEqual(["low", "low", "high", "high"]);
});
test("preserves complete tool exchanges, reasoning and tool result IDs across restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "prem-session-"));
  try {
    const store = new JsonlSessionStore(join(dir, "context.jsonl"));
    for (const message of [user, assistant, tool]) store.append(message);
    const wire = toPremMessages(store.load());
    expect(wire[1]?.reasoning_content).toBe("private-reasoning");
    expect(wire[1]?.tool_calls?.[0]?.id).toBe(wire[2]?.tool_call_id);
    expect(wire[1]?.tool_calls?.[0]?.id).toMatch(/^call_\d+_\d+$/);
    expect(JSON.stringify(wire)).not.toContain("google-only");
    expect(wire[2]?.content).toBe("saved data");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("interrupted and orphaned tool history remains text without inventing results or replaying", () => {
  const wire = toPremMessages([user, assistant, user, tool]);
  expect(wire.every((message) => !message.tool_calls && message.role !== "tool")).toBe(true);
  expect(JSON.stringify(wire)).toContain("results incomplete");
  expect(JSON.stringify(wire)).toContain("saved data");
});
test("legacy unsupported audio stays readable without sending binary to DeepSeek", () => {
  const wire = toPremMessages([{ ...user, content: [{ type: "media", mimeType: "audio/ogg", data: "SECRET_BINARY" }] }]);
  expect(JSON.stringify(wire)).not.toContain("SECRET_BINARY");
  expect(JSON.stringify(wire)).toContain("audio/ogg");
});
test("uses the exact Prem ZDR endpoint and accounts for cached usage", async () => {
  let request: RequestInit | undefined;
  setFetch(async (url, options) => { expect(url).toBe("https://gateway.prem.io/openai/chat/completions"); request = options; return Response.json(completion({ content: "done" })); });
  const result = await client.generate([user], []);
  expect(result.usage).toEqual({ input: 100, output: 20, total: 120, cacheRead: 80, cacheWrite: 0 });
  const body = JSON.parse(String(request?.body));
  expect(body.model).toBe("deepseek-v4.1-flash"); expect(body.reasoning_effort).toBe("low"); expect(body.stream).toBe(false);
});
test("returns tool arguments and keeps internal reasoning out of visible text", async () => {
  respond(completion({ content: null, reasoning_content: "internal", tool_calls: [{ id: "x", type: "function", function: { name: "read", arguments: '{"file_path":"x"}' } }] }, "tool_calls"));
  const result = await client.generate([user], []);
  expect(result.text).toBe(""); expect(result.reasoningContent).toBe("internal"); expect(result.toolCalls[0]?.args).toEqual({ file_path: "x" });
});
for (const args of ["broken json", "null", "[]", '"text"']) test(`rejects invalid tool arguments: ${args}`, async () => {
  respond(completion({ tool_calls: [{ id: "x", type: "function", function: { name: "read", arguments: args } }] }, "tool_calls"));
  await expect(client.generate([user], [])).rejects.toThrow("tool arguments");
});
for (const finish of ["length", "content_filter"]) test(`rejects incomplete ${finish} responses before tool execution`, async () => {
  respond(completion({ content: "partial" }, finish)); await expect(client.generate([user], [])).rejects.toThrow("incomplete response");
});
test("rejects malformed and empty provider completions", async () => {
  respond({ choices: [] }); await expect(client.generate([user], [])).rejects.toThrow("invalid completion");
  respond(completion({ content: "" })); await expect(client.generate([user], [])).rejects.toThrow("empty completion");
});
test("does not replay failed POSTs or expose response bodies", async () => {
  let count = 0;
  setFetch(async () => { count++; return new Response("secret-upstream-body", { status: 503 }); });
  await expect(client.generate([user], [])).rejects.toThrow("Prem ZDR HTTP 503"); expect(count).toBe(1);
});
test("passes cancellation to the request", async () => {
  const controller = new AbortController(); controller.abort();
  setFetch(async (_url, options) => { options?.signal?.throwIfAborted(); throw new Error("must not run"); });
  await expect(client.generate([user], [], controller.signal)).rejects.toThrow();
});
test("sends images directly to DeepSeek in the same request as tools", async () => {
  setFetch(async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    expect(body.model).toBe("deepseek-v4.1-flash"); expect(body.tools[0].function.name).toBe("read");
    expect(body.messages[1].content[1].image_url.url).toBe("data:image/png;base64,cGl4ZWw=");
    return Response.json(completion({ content: "A red square." }));
  });
  const result = await client.generate([{ ...user, content: [...user.content, { type: "media", mimeType: "image/png", data: "cGl4ZWw=" }] }], [{ name: "read", label: "Read", description: "Read a file", parameters: { type: "object" }, execute: async () => ({ content: [] }) }]);
  expect(result.text).toBe("A red square.");
});

test("image history survives restart and remains available alongside tool results", () => {
  const dir = mkdtempSync(join(tmpdir(), "prem-image-session-"));
  try {
    const store = new JsonlSessionStore(join(dir, "context.jsonl"));
    store.append({ ...user, content: [...user.content, { type: "media", mimeType: "image/jpeg", data: "cGl4ZWw=" }] });
    for (const message of [assistant, tool, user]) store.append(message);
    const wire = toPremMessages(store.load());
    expect(wire[0]?.content).toEqual([{ type: "text", text: "test" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,cGl4ZWw=" } }]);
    expect(wire[1]?.reasoning_content).toBe("private-reasoning");
    expect(wire[2]?.tool_call_id).toBe(wire[1]?.tool_calls?.[0]?.id);
    expect(wire[3]?.role).toBe("user");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
