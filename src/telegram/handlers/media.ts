import type { BotContext } from "../bot.ts";
import type { ImageContent } from "@mariozechner/pi-ai";
import { downloadTelegramFile } from "../lib/file.ts";
import { transcribeAudio } from "../lib/transcribe.ts";
import { timestamp } from "../lib/timestamp.ts";
import { processAgentPrompt } from "./message.ts";
import { logger } from "../../lib/logger.ts";
import { errorMessage } from "../../lib/errors.ts";
import { env } from "../../config/env.ts";

/**
 * Check if we're using a natively multimodal model (Gemini).
 * When true, images and audio are sent inline as base64 instead of file paths.
 */
function isNativeMultimodal(): boolean {
  return !!env.GEMINI_API_KEY;
}

/**
 * Read a local file and return as base64 ImageContent for pi-ai.
 */
async function fileToImageContent(filePath: string, mimeType: string): Promise<ImageContent> {
  const file = Bun.file(filePath);
  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  return { type: "image", data: base64, mimeType };
}

// ---------------------------------------------------------------------------
// Error handling wrapper
// ---------------------------------------------------------------------------

function withErrorHandling(
  mediaType: string,
  handler: (ctx: BotContext) => Promise<void>,
): (ctx: BotContext) => Promise<void> {
  return async (ctx: BotContext): Promise<void> => {
    try {
      await handler(ctx);
    } catch (err) {
      logger.error(`Failed to handle ${mediaType}`, { error: errorMessage(err) });
      try {
        await ctx.reply(`Sorry, I couldn't process that ${mediaType}. Please try again.`);
      } catch {
        // Can't even send error — give up
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Photo handler (TG-02)
// ---------------------------------------------------------------------------

export const handlePhoto = withErrorHandling("image", async (ctx) => {
  const photos = ctx.message?.photo;
  const chatId = ctx.chat?.id;
  if (!photos?.length || !chatId) return;

  // Telegram sends multiple resolutions — take highest quality (last)
  const photo = photos[photos.length - 1]!;
  const localPath = await downloadTelegramFile(photo.file_id, "photo.jpg");

  const caption = ctx.message?.caption ?? "I sent you an image. What do you see?";
  const ts = timestamp();

  if (isNativeMultimodal()) {
    // Send image inline as base64 — Gemini processes it natively
    const imageContent = await fileToImageContent(localPath, "image/jpeg");
    const prompt = `${ts} [User sent an image — also saved at: ${localPath}]\n\n${caption}`;
    await processAgentPrompt(ctx, chatId, prompt, `[Photo] ${caption}`, [imageContent]);
  } else {
    // Fallback: just reference the file path (agent reads it via tools)
    const prompt = `${ts} [User sent an image saved at: ${localPath}]\n\n${caption}`;
    await processAgentPrompt(ctx, chatId, prompt, `[Photo] ${caption}`);
  }
});

// ---------------------------------------------------------------------------
// Document handler (TG-03)
// ---------------------------------------------------------------------------

export const handleDocument = withErrorHandling("file", async (ctx) => {
  const doc = ctx.message?.document;
  const chatId = ctx.chat?.id;
  if (!doc || !chatId) return;

  const fileName = doc.file_name ?? "document";
  const localPath = await downloadTelegramFile(doc.file_id, fileName);

  const caption = ctx.message?.caption ?? `I sent you a file: ${fileName}`;
  const ts = timestamp();
  const prompt = `${ts} [User sent a file saved at: ${localPath} (filename: ${fileName})]\n\n${caption}`;

  await processAgentPrompt(ctx, chatId, prompt, `[File: ${fileName}] ${caption}`);
});

// ---------------------------------------------------------------------------
// Voice handler (TG-04)
// ---------------------------------------------------------------------------

export const handleVoice = withErrorHandling("voice message", async (ctx) => {
  const voice = ctx.message?.voice;
  const chatId = ctx.chat?.id;
  if (!voice || !chatId) return;

  const localPath = await downloadTelegramFile(voice.file_id, "voice.ogg");

  if (isNativeMultimodal()) {
    // Send audio inline to Gemini — it understands speech natively
    const audioContent = await fileToImageContent(localPath, "audio/ogg");
    const caption = ctx.message?.caption;
    const ts = timestamp();
    const prompt = caption
      ? `${ts} [User sent a voice message — listen and respond]\n\n${caption}`
      : `${ts} [User sent a voice message — listen and respond to what they said]`;
    await processAgentPrompt(ctx, chatId, prompt, "[Voice message]", [audioContent]);
  } else {
    // Fallback: transcribe with STT then send as text
    const transcription = await transcribeAudio(localPath);
    logger.info("Voice message transcribed", { transcription: transcription.slice(0, 100) });

    const caption = ctx.message?.caption;
    const ts = timestamp();
    const prompt = caption
      ? `${ts} [Voice message transcribed: "${transcription}"]\n\n${caption}`
      : `${ts} ${transcription}`;

    await processAgentPrompt(ctx, chatId, prompt, transcription);
  }
});

// ---------------------------------------------------------------------------
// Audio handler (TG-05)
// ---------------------------------------------------------------------------

export const handleAudio = withErrorHandling("audio file", async (ctx) => {
  const audio = ctx.message?.audio;
  const chatId = ctx.chat?.id;
  if (!audio || !chatId) return;

  const extension = audio.mime_type?.split("/")[1] ?? "mp3";
  const mimeType = audio.mime_type ?? "audio/mpeg";
  const fileName = audio.file_name ?? `audio.${extension}`;
  const localPath = await downloadTelegramFile(audio.file_id, fileName);

  if (isNativeMultimodal()) {
    const audioContent = await fileToImageContent(localPath, mimeType);
    const caption = ctx.message?.caption ?? `I sent you an audio file: ${fileName}`;
    const ts = timestamp();
    const prompt = `${ts} [User sent an audio file: ${fileName} — listen and respond]\n\n${caption}`;
    await processAgentPrompt(ctx, chatId, prompt, `[Audio: ${fileName}]`, [audioContent]);
  } else {
    const transcription = await transcribeAudio(localPath);
    logger.info("Audio file transcribed", { fileName, transcription: transcription.slice(0, 100) });

    const caption = ctx.message?.caption ?? `I sent you an audio file: ${fileName}`;
    const ts = timestamp();
    const prompt = `${ts} [Audio file "${fileName}" transcribed: "${transcription}"]\n\n${caption}`;

    await processAgentPrompt(ctx, chatId, prompt, `[Audio: ${fileName}] ${transcription}`);
  }
});

// ---------------------------------------------------------------------------
// Video handler (TG-06)
// ---------------------------------------------------------------------------

export const handleVideo = withErrorHandling("video", async (ctx) => {
  const video = ctx.message?.video;
  const chatId = ctx.chat?.id;
  if (!video || !chatId) return;

  const fileName = video.file_name ?? "video.mp4";
  const localPath = await downloadTelegramFile(video.file_id, fileName);

  const caption = ctx.message?.caption ?? `I sent you a video: ${fileName}`;
  const ts = timestamp();
  const prompt = `${ts} [User sent a video saved at: ${localPath} (filename: ${fileName}, duration: ${video.duration}s)]\n\n${caption}`;

  await processAgentPrompt(ctx, chatId, prompt, `[Video: ${fileName}] ${caption}`);
});

// ---------------------------------------------------------------------------
// Video note handler (TG-07)
// ---------------------------------------------------------------------------

export const handleVideoNote = withErrorHandling("video note", async (ctx) => {
  const videoNote = ctx.message?.video_note;
  const chatId = ctx.chat?.id;
  if (!videoNote || !chatId) return;

  const localPath = await downloadTelegramFile(videoNote.file_id, "video_note.mp4");

  const ts = timestamp();
  const prompt = `${ts} [User sent a video note (round video) saved at: ${localPath} (duration: ${videoNote.duration}s)]\n\nI sent you a video note.`;

  await processAgentPrompt(ctx, chatId, prompt, "[Video note]");
});

// ---------------------------------------------------------------------------
// Sticker handler (TG-08)
// ---------------------------------------------------------------------------

export const handleSticker = withErrorHandling("sticker", async (ctx) => {
  const sticker = ctx.message?.sticker;
  const chatId = ctx.chat?.id;
  if (!sticker || !chatId) return;

  const emoji = sticker.emoji ?? "";
  const setName = sticker.set_name ?? "unknown";
  const ts = timestamp();

  let prompt: string;
  if (sticker.is_animated || sticker.is_video) {
    // Animated/video stickers: metadata only (can't be analyzed without rendering)
    prompt = `${ts} [User sent a sticker: emoji ${emoji}, from set "${setName}"]`;
  } else {
    // Static stickers: download and include path for visual analysis
    const localPath = await downloadTelegramFile(sticker.file_id, "sticker.webp");
    prompt = `${ts} [User sent a sticker saved at: ${localPath} (emoji: ${emoji}, set: "${setName}")]`;
  }

  await processAgentPrompt(ctx, chatId, prompt, `[Sticker: ${emoji}]`);
});
