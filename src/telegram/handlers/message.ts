import type { Api } from "grammy";
import type { BotContext } from "../bot.ts";
import { agentPrompt } from "../../agent/index.ts";
import { timestamp } from "../lib/timestamp.ts";
import { sendFormattedMessage, splitMessage } from "../lib/format.ts";
import { enqueueForChat } from "../lib/queue.ts";
import { logger } from "../../lib/logger.ts";
import { errorMessage } from "../../lib/errors.ts";
import { appendToDailyLog } from "../../lib/memory.ts";

// ---------------------------------------------------------------------------
// Typing indicator
// ---------------------------------------------------------------------------

const TYPING_INTERVAL_MS = 4000;

function startTypingLoop(api: Api, chatId: number): () => void {
  const send = () => { void api.sendChatAction(chatId, "typing").catch(() => {}); };
  send();
  const interval = setInterval(send, TYPING_INTERVAL_MS);
  return () => clearInterval(interval);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Handle incoming text messages.
 */
export async function handleTextMessage(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text;
  const chatId = ctx.chat?.id;
  if (!text || !chatId) return;

  const timestampedText = `${timestamp()} ${text}`;
  await processAgentPrompt(ctx, chatId, timestampedText, text);
}

/**
 * Process an agent prompt and send the response.
 *
 * Flow:
 * 1. Send "…" placeholder immediately (user sees we're working)
 * 2. Start typing indicator loop
 * 3. Run agent (no streaming — wait for full response)
 * 4. Delete "…" placeholder
 * 5. Send final response as new message(s) — triggers notification, auto-splits
 */
export async function processAgentPrompt(
  ctx: BotContext,
  chatId: number,
  prompt: string,
  logText?: string,
): Promise<void> {
  await enqueueForChat(chatId, async () => {
    // Send "…" placeholder immediately
    let placeholderId: number | null = null;
    try {
      const msg = await ctx.api.sendMessage(chatId, "…");
      placeholderId = msg.message_id;
    } catch {
      // Failed to send placeholder — continue anyway
    }

    const stopTyping = startTypingLoop(ctx.api, chatId);

    try {
      void appendToDailyLog("user", logText ?? prompt);

      const result = await agentPrompt(chatId, prompt);

      stopTyping();

      // Delete placeholder
      if (placeholderId !== null) {
        try {
          await ctx.api.deleteMessage(chatId, placeholderId);
        } catch { /* already gone */ }
      }

      // Send final response as new message(s)
      const finalText = result.response.trim() || "(No response)";
      void appendToDailyLog("assistant", finalText);

      const parts = splitMessage(finalText);
      for (const part of parts) {
        await sendFormattedMessage(ctx.api, chatId, part);
      }
    } catch (err) {
      stopTyping();

      // Delete placeholder on error too
      if (placeholderId !== null) {
        try {
          await ctx.api.deleteMessage(chatId, placeholderId);
        } catch { /* already gone */ }
      }

      logger.error("Message handler error", { chatId, error: errorMessage(err) });
      try {
        await ctx.reply("Sorry, something went wrong. Please try again.");
      } catch {
        // Can't even send error message — give up
      }
    }
  });
}
