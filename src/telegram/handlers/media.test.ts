import { describe, expect, test } from "bun:test";
import { canSendInlineToGemini } from "../lib/mime.ts";

describe("canSendInlineToGemini", () => {
  test("allows native media and PDFs", () => {
    expect(canSendInlineToGemini("image/jpeg")).toBe(true);
    expect(canSendInlineToGemini("audio/ogg")).toBe(true);
    expect(canSendInlineToGemini("video/mp4")).toBe(true);
    expect(canSendInlineToGemini("application/pdf")).toBe(true);
  });

  test("rejects archive and generic document MIME types", () => {
    expect(canSendInlineToGemini("application/zip")).toBe(false);
    expect(canSendInlineToGemini("application/octet-stream")).toBe(false);
    expect(canSendInlineToGemini("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(false);
  });
});
