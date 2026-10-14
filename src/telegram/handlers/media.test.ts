import { expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
mock.module("../lib/transcribe.ts", () => ({ transcribeAudio: async () => "Synthetic voice transcript" }));
const { prepareAttachment } = await import("../lib/attachment.ts");

test("sends audio as transcription and leaves unsupported documents on disk", async () => {
  expect(await prepareAttachment("synthetic.ogg", "audio/ogg")).toEqual({ text: "[Audio transcript]\nSynthetic voice transcript", media: [] });
  expect(await prepareAttachment("archive.zip", "application/zip")).toEqual({ text: "", media: [] });
});
test("loads images for Prem vision without interpreting them as text", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rachel-attachment-test-"));
  try {
    const path = join(dir, "image.png"); await Bun.write(path, "fixture-bytes");
    const result = await prepareAttachment(path, "image/png");
    expect(result.text).toBe("");
    expect(result.media).toEqual([{ type: "media", mimeType: "image/png", data: Buffer.from("fixture-bytes").toString("base64") }]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
