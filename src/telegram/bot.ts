import { Bot, type Context, GrammyError, HttpError } from "grammy";
import { autoChatAction, type AutoChatActionFlavor } from "@grammyjs/auto-chat-action";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { authGuard } from "./middleware/auth.ts";
import { handleTextMessage } from "./handlers/message.ts";
import { abortAgent, getAgentStatus } from "../agent/index.ts";
import { getRuntimeHealth } from "../lib/runtime-state.ts";
import {
  handlePhoto,
  handleDocument,
  handleVoice,
  handleAudio,
  handleVideo,
  handleVideoNote,
  handleSticker,
} from "./handlers/media.ts";

export type BotContext = Context & AutoChatActionFlavor;

export const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);

// Middleware (order matters: auth first, then typing indicator)
bot.use(authGuard);
bot.use(autoChatAction());

// Commands
bot.command("start", (ctx) => ctx.reply(
  "Hey! I'm Rachel, your personal AI assistant 👋\n\nWhat language do you speak?"
));

bot.command("status", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const health = getRuntimeHealth();
  const status = getAgentStatus(chatId);
  const run = status.latestRun;

  const lines = [
    `Status: ${health.status}`,
    status.runner
      ? `Runner: ${status.runner.model}, ${status.runner.messages} messages${status.runner.streaming ? ", streaming" : ""}`
      : "Runner: not loaded",
  ];

  if (run) {
    const ageSeconds = Math.round((Date.now() - run.startedAt) / 1000);
    const idleSeconds = Math.round((Date.now() - run.lastActivityAt) / 1000);
    lines.push(`Last run: ${run.status}, age ${ageSeconds}s, idle ${idleSeconds}s`);
    if (run.activeTool) lines.push(`Tool: ${run.activeTool}`);
    if (run.error) lines.push(`Error: ${run.error}`);
  }

  if (status.recentEvents.length > 0) {
    lines.push("Recent events:");
    for (const event of status.recentEvents.slice(-5)) {
      const ageSeconds = Math.round((Date.now() - event.createdAt) / 1000);
      const tool = event.toolName ? ` (${event.toolName})` : "";
      lines.push(`- ${event.type}${tool}, ${ageSeconds}s ago`);
    }
  }

  const queued = health.queue.filter((item) => item.chatId === chatId);
  if (queued.length > 0) {
    lines.push(`Queue: ${queued.map((item) => item.status).join(", ")}`);
  }

  await ctx.reply(lines.join("\n"));
});

bot.command("stop", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  const stopped = abortAgent(chatId);
  await ctx.reply(stopped ? "Stopped the active run." : "No active run to stop.");
});

// Message handlers
bot.on("message:text", handleTextMessage);
bot.on("message:photo", handlePhoto);
bot.on("message:document", handleDocument);
bot.on("message:voice", handleVoice);
bot.on("message:audio", handleAudio);
bot.on("message:video", handleVideo);
bot.on("message:video_note", handleVideoNote);
bot.on("message:sticker", handleSticker);

// Error handler
function formatBotError(e: unknown): string {
  if (e instanceof GrammyError) return e.description;
  if (e instanceof HttpError) return `Network error: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

bot.catch((err) => {
  logger.error(`Error handling update ${err.ctx.update.update_id}`, {
    error: formatBotError(err.error),
  });
});
