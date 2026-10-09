import { describe, expect, test } from "bun:test";
import { Api } from "grammy";
import type { Message } from "grammy/types";
import { messageText, sendFormattedChunks, sendFormattedMessage, splitMessage } from "./format.ts";

function fakeApi(fail?: { code: number; description: string } | Error) {
  const api = new Api("123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi");
  const calls: { method: string; payload: unknown }[] = [];
  api.config.use(async (_previous, method, payload) => {
    calls.push({ method, payload });
    if (calls.length === 1 && fail) {
      if (fail instanceof Error) throw fail;
      return { ok: false, error_code: fail.code, description: fail.description } as never;
    }
    return { ok: true, result: { message_id: 42 } } as never;
  });
  return { api, calls };
}

const table = "| Model | Result |\n| --- | --- |\n" + "| Example | **Pass** |\n".repeat(200);

describe("native rich Markdown", () => {
  test("sends a native table above the old limit intact, without HTML conversion", async () => {
    const { api, calls } = fakeApi();
    const text = `## Results\n\n${table}\n\n\`\`\`ts\nconst x = a < b;\n\`\`\``;
    await sendFormattedChunks(api, 1, text);
    expect(calls).toEqual([{ method: "sendRichMessage", payload: { chat_id: 1, rich_message: { markdown: text } } }]);
  });
  test("returns the receipt and falls back only after explicit formatting rejection", async () => {
    const { api, calls } = fakeApi({ code: 400, description: "Bad Request: can't parse rich message" });
    expect(await sendFormattedMessage(api, 1, table)).toBe(42);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ method: "sendRichMessage", payload: {
      chat_id: 1, rich_message: { blocks: [{ type: "paragraph", text: table }] },
    } });
  });
  test.each([
    new Error("connection lost after acceptance"),
    { code: 429, description: "Too Many Requests" },
    { code: 500, description: "rich message failed" },
    { code: 400, description: "Bad Request: chat not found" },
  ])("does not retry an unrelated delivery failure", async (error) => {
    const { api, calls } = fakeApi(error);
    await expect(sendFormattedMessage(api, 1, "**Hello**")).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
  test("delivers long scheduled results in order without the old 4000-character truncation", async () => {
    const { api, calls } = fakeApi();
    const text = "A".repeat(40000);
    await sendFormattedChunks(api, 1, text);
    expect(calls).toEqual(splitMessage(text).map((markdown) => ({
      method: "sendRichMessage", payload: { chat_id: 1, rich_message: { markdown } },
    })));
    expect(calls).toHaveLength(2);
  });
  test("does not send whitespace-only messages", async () => {
    const { api, calls } = fakeApi();
    await sendFormattedChunks(api, 1, "\n  ");
    expect(calls).toHaveLength(0);
  });
});

describe("splitMessage", () => {
  test("keeps tables intact within the rich-message limit", () => {
    expect(splitMessage(table)).toEqual([table]);
  });
  test("prefers paragraph boundaries before a table that fits in the next message", () => {
    const intro = "A".repeat(32000) + "\n\n";
    expect(splitMessage(intro + table)).toEqual([intro, table]);
  });
  test("preserves Unicode and code indentation across splits", () => {
    const text = "a".repeat(32767) + "😀\n  indented\n\n" + "🧪".repeat(18000);
    const parts = splitMessage(text);
    expect(parts.join("")).toBe(text);
    expect(parts.every((part) => part.length <= 32768 && part.isWellFormed())).toBe(true);
  });
  test("omits empty chunks from blank paragraphs", () => {
    expect(splitMessage("\n\n" + "x".repeat(20) + "\n\n", 10)).toEqual(["x".repeat(10), "x".repeat(10)]);
  });
  test.each([0, 1, -1, 1.5, NaN])("rejects invalid limits", (limit) => {
    expect(() => splitMessage("hello", limit)).toThrow();
  });
});

test("quoted or forwarded rich messages retain structured context", () => {
  const message: Message.RichMessageMessage = {
    message_id: 1, date: 1, chat: { id: 1, type: "private", first_name: "Test" },
    rich_message: { blocks: [
      { type: "heading", size: 2, text: "Decision" },
      { type: "paragraph", text: { type: "bold", text: "Use this option" } },
    ] },
  };
  expect(messageText(message)).toBe(JSON.stringify(message.rich_message));
  expect(messageText({ ...message, rich_message: undefined, text: "Plain reply" })).toBe("Plain reply");
  expect(messageText()).toBe("");
});
