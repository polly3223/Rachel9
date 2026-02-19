import { Bot, type Context, GrammyError, HttpError } from "grammy";
import { autoChatAction, type AutoChatActionFlavor } from "@grammyjs/auto-chat-action";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";

export type BotContext = Context & AutoChatActionFlavor;

export const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);

// Middleware
bot.use(autoChatAction());

// Commands
bot.command("start", (ctx) => ctx.reply("Hello! I'm Rachel, your personal AI assistant."));

// Message handlers (placeholder -- real handlers added in later phases)
bot.on("message:text", async (ctx) => {
  logger.debug("Received text message", { text: ctx.message.text, from: ctx.from?.id });
  await ctx.reply("I heard you! (Rachel9 is still being set up)");
});

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
