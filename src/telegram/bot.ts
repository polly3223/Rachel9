import { Bot, type Context, GrammyError, HttpError } from "grammy";
import { autoChatAction, type AutoChatActionFlavor } from "@grammyjs/auto-chat-action";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { authGuard } from "./middleware/auth.ts";
import { handleTextMessage } from "./handlers/message.ts";
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
`Hey! I'm Rachel, your personal AI assistant 👋

Here's what I can do for you:

📇 *CRM* — Send me contacts from WhatsApp groups, LinkedIn screenshots, or business cards and I'll organize them for you. I track follow-ups and brief you with full context when it's time to reach out.

🌐 *Landing pages* — Tell me what you need and I'll build it, publish it, and track who signs up.

📄 *Documents* — Proposals, reports, presentations — just describe what you need.

🔍 *Research* — Find suppliers, analyze competitors, compare options — I deliver a summary in minutes.

✍️ *Content* — Emails, social posts, translations — all from a quick message.

⏰ *Scheduling* — Reminders, follow-ups, deadlines — I keep track so you don't have to.

Just message me what you need. I'm here 24/7.`, { parse_mode: "Markdown" }
));

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
