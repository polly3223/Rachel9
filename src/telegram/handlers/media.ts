import type { BotContext } from "../bot.ts";
import { downloadTelegramFile } from "../lib/file.ts";
import { prepareAttachment } from "../lib/attachment.ts";
import { timestamp } from "../lib/timestamp.ts";
import { processAgentPrompt } from "./message.ts";
import { logger } from "../../lib/logger.ts";
import { errorMessage } from "../../lib/errors.ts";

function withErrorHandling(mediaType: string, handler: (ctx: BotContext) => Promise<void>): (ctx: BotContext) => Promise<void> {
  return async (ctx) => {
    try {
      await handler(ctx);
    } catch (err) {
      logger.error(`Failed to handle ${mediaType}`, { error: errorMessage(err) });
      try { await ctx.reply(`Sorry, I couldn't process that ${mediaType}. Please try again.`); } catch { /* Telegram may be unavailable. */ }
    }
  };
}

async function processFile(ctx: BotContext, fileId: string, fileName: string, mimeType: string, caption: string, label: string): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  const path = await downloadTelegramFile(fileId, fileName);
  const attachment = await prepareAttachment(path, mimeType);
  const prompt = `${timestamp()} [User sent ${label}; saved at: ${path}]\n\n${caption}${attachment.text ? `\n\n${attachment.text}` : ""}`;
  await processAgentPrompt(ctx, chatId, prompt, `[${label}] ${caption}`, attachment.media);
}

export const handlePhoto = withErrorHandling("image", async (ctx) => {
  const photo = ctx.message?.photo?.at(-1);
  if (photo) await processFile(ctx, photo.file_id, "photo.jpg", "image/jpeg", ctx.message?.caption ?? "What do you see in this image?", "Photo");
});

export const handleDocument = withErrorHandling("file", async (ctx) => {
  const doc = ctx.message?.document;
  if (!doc) return;
  const name = doc.file_name ?? "document";
  await processFile(ctx, doc.file_id, name, doc.mime_type ?? "application/octet-stream", ctx.message?.caption ?? `I sent you a file: ${name}`, `File: ${name}`);
});

export const handleVoice = withErrorHandling("voice message", async (ctx) => {
  const voice = ctx.message?.voice;
  if (voice) await processFile(ctx, voice.file_id, "voice.ogg", "audio/ogg", ctx.message?.caption ?? "Respond to my voice message.", "Voice message");
});

export const handleAudio = withErrorHandling("audio file", async (ctx) => {
  const audio = ctx.message?.audio;
  if (!audio) return;
  const name = audio.file_name ?? `audio.${audio.mime_type?.split("/")[1] ?? "mp3"}`;
  await processFile(ctx, audio.file_id, name, audio.mime_type ?? "audio/mpeg", ctx.message?.caption ?? "Respond to this audio.", `Audio: ${name}`);
});

export const handleVideo = withErrorHandling("video", async (ctx) => {
  const video = ctx.message?.video;
  if (video) await processFile(ctx, video.file_id, video.file_name ?? "video.mp4", video.mime_type ?? "video/mp4", ctx.message?.caption ?? "Describe this video.", "Video");
});

export const handleVideoNote = withErrorHandling("video note", async (ctx) => {
  const video = ctx.message?.video_note;
  if (video) await processFile(ctx, video.file_id, "video_note.mp4", "video/mp4", "Respond to this video note.", "Video note");
});

export const handleSticker = withErrorHandling("sticker", async (ctx) => {
  const sticker = ctx.message?.sticker;
  const chatId = ctx.chat?.id;
  if (!sticker || !chatId) return;
  const label = `Sticker: ${sticker.emoji ?? ""}, set ${sticker.set_name ?? "unknown"}`;
  if (sticker.is_animated || sticker.is_video) {
    await processAgentPrompt(ctx, chatId, `${timestamp()} [${label}]`, label);
    return;
  }
  await processFile(ctx, sticker.file_id, "sticker.webp", "image/webp", label, "Sticker");
});
