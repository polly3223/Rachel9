import type { Api } from "grammy";
import type { BotContext } from "../bot.ts";
import { agentPrompt } from "../../agent/index.ts";
import { timestamp } from "../lib/timestamp.ts";
import { sendFormattedMessage, splitMessage } from "../lib/format.ts";
import { enqueueForChat } from "../lib/queue.ts";
import { logger } from "../../lib/logger.ts";
import { errorMessage } from "../../lib/errors.ts";
import { appendToDailyLog } from "../../lib/memory.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { env } from "../../config/env.ts";

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
// Onboarding
// ---------------------------------------------------------------------------

const OWNER_PROFILE_PATH = join(env.SHARED_FOLDER_PATH, "rachel-memory", "context", "owner-profile.md");

const ONBOARDING_PREFIX = `[ONBOARDING MODE] This is a NEW user who just started using Rachel. The file owner-profile.md does NOT exist yet — you need to create it during this conversation.

Your job in this conversation:
1. The user just answered "What language do you speak?" — detect their language from their reply and switch to it immediately.
2. Introduce yourself briefly in their language — you're Rachel, their personal AI assistant on Telegram.
3. Ask what they do for work / their business (keep it casual, one question).
4. Based on their answer, briefly present 3-4 of your most relevant capabilities (CRM, social media content, landing pages, documents, research, scheduling, WhatsApp integration). Don't list everything — pick what fits THEIR work.
5. After you have their language and work info, IMMEDIATELY save it by writing the file $SHARED_FOLDER_PATH/rachel-memory/context/owner-profile.md with this structure:

---
language: [their language, e.g. "italiano" or "english"]
work: [what they do]
industry: [their industry/niche]
goals: [inferred from conversation]
onboarded: [ISO timestamp]
---

[Any additional notes from the conversation]

6. End with something warm like "Just message me whenever you need anything. I'm here 24/7."

Keep the whole onboarding to 2-3 exchanges MAX. Be natural, not robotic. Don't dump a wall of features — weave them into the conversation based on what they tell you.

The user's message follows:
`;

function isOnboarded(): boolean {
  return existsSync(OWNER_PROFILE_PATH);
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

  let timestampedText = `${timestamp()} ${text}`;

  // If not onboarded yet, prepend onboarding instructions
  if (!isOnboarded()) {
    timestampedText = ONBOARDING_PREFIX + timestampedText;
  }

  await processAgentPrompt(ctx, chatId, timestampedText, text);
}

/**
 * Process an agent prompt and send the response.
 *
 * Flow:
 * 1. Start typing indicator loop
 * 2. Run agent (wait for full response)
 * 3. Send final response as new message(s)
 */
export async function processAgentPrompt(
  ctx: BotContext,
  chatId: number,
  prompt: string,
  logText?: string,
): Promise<void> {
  await enqueueForChat(chatId, async () => {
    const stopTyping = startTypingLoop(ctx.api, chatId);

    try {
      void appendToDailyLog("user", logText ?? prompt);

      const result = await agentPrompt(chatId, prompt);

      stopTyping();

      // Send final response as new message(s)
      const finalText = result.response.trim() || "(No response)";
      void appendToDailyLog("assistant", finalText);

      const parts = splitMessage(finalText);
      for (const part of parts) {
        await sendFormattedMessage(ctx.api, chatId, part);
      }
    } catch (err) {
      stopTyping();

      logger.error("Message handler error", { chatId, error: errorMessage(err) });
      try {
        await ctx.reply("Sorry, something went wrong. Please try again.");
      } catch {
        // Can't even send error message — give up
      }
    }
  });
}
