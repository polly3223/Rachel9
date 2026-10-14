import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import type { ContentPart } from "../../agent/runtime/types.ts";
import { transcribeAudio } from "./transcribe.ts";

async function command(args: string[]): Promise<string> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "ignore", timeout: 60_000 });
  const [output, status] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (status !== 0) throw new Error(`Attachment conversion failed (${args[0]})`);
  return output;
}

async function imagePart(path: string, mimeType: string): Promise<ContentPart> {
  return { type: "media", data: Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64"), mimeType };
}

/** Convert unsupported input locally; only images go to Prem vision and audio to STT. */
export async function prepareAttachment(path: string, mimeType: string): Promise<{ text: string; media: ContentPart[] }> {
  if (/^image\/(jpeg|png|webp|gif)$/.test(mimeType)) return { text: "", media: [await imagePart(path, mimeType)] };
  if (mimeType.startsWith("audio/")) return { text: `[Audio transcript]\n${await transcribeAudio(path)}`, media: [] };
  if (mimeType !== "application/pdf" && !mimeType.startsWith("video/")) return { text: "", media: [] };

  const dir = await mkdtemp(join(tmpdir(), "rachel-media-"));
  try {
    let text = "";
    if (mimeType === "application/pdf") {
      const extracted = await command(["pdftotext", "-layout", path, "-"]);
      if (extracted.trim()) return { text: `[PDF text]\n${extracted.slice(0, 100_000)}${extracted.length > 100_000 ? "\n[Text truncated; full PDF remains at the saved path]" : ""}`, media: [] };
      await command(["pdftoppm", "-f", "1", "-l", "8", "-scale-to", "1400", "-png", path, join(dir, "page")]);
      text = "[Scanned PDF: images of the first 8 pages at most; additional pages are not included]";
    } else {
      const info = z.object({ format: z.object({ duration: z.coerce.number().positive() }), streams: z.array(z.object({ codec_type: z.string() })) }).parse(JSON.parse(await command(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", path])));
      const duration = info.format.duration;
      await command(["ffmpeg", "-v", "error", "-i", path, "-vf", `fps=${6 / duration},scale=1024:1024:force_original_aspect_ratio=decrease`, "-frames:v", "6", join(dir, "frame-%02d.png")]);
      text = `[Video: up to 6 sampled frames across ${duration.toFixed(1)} seconds; not every moment is visible]`;
      if (info.streams.some((stream) => stream.codec_type === "audio")) {
        const audio = join(dir, "audio.ogg");
        await command(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", audio]);
        text += `\n[Video audio transcript]\n${await transcribeAudio(audio)}`;
      }
    }
    const images = (await readdir(dir)).filter((name) => name.endsWith(".png")).sort();
    if (!images.length) throw new Error("Attachment contains no readable images");
    return { text, media: await Promise.all(images.map((name) => imagePart(join(dir, name), "image/png"))) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
