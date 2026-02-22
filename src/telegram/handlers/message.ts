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

const ONBOARDING_PREFIX = `[ONBOARDING MODE] This is a NEW user who just started using Rachel. The file owner-profile.md does NOT exist yet.

You are having a short onboarding conversation. Follow these rules strictly:

EXCHANGE 1 (user tells you their language):
- Detect their language and switch to it
- Greet them warmly in their language
- Ask ONE question: what do they do for work / their business?

EXCHANGE 2 (user tells you what they do):
- Acknowledge what they do
- MANDATORY: Present 4-5 specific things you can do for THEM based on their work. Be concrete, not generic. Examples of what you can do:
  * CRM: import contacts from WhatsApp groups, enrich with LinkedIn screenshots or business cards, track follow-ups with smart briefings
  * Social media: research trends in their niche, write posts in their voice for LinkedIn/X/Threads, coach them to capture photos at events
  * Landing pages: build and publish web pages, track who signs up, export leads
  * Documents: proposals, reports, presentations, pitch decks on demand
  * Research: find suppliers, analyze competitors, compare options
  * Scheduling: reminders, follow-ups, deadlines with context
  * WhatsApp: connect and manage their WhatsApp, extract group contacts
  * Translations, emails, content creation
- IMPORTANT: You MUST actually list these capabilities with brief explanations. Do NOT skip this. The user needs to know what you can do.
- After presenting capabilities, save the profile by writing the file $SHARED_FOLDER_PATH/rachel-memory/context/owner-profile.md:

---
language: [e.g. "italiano" or "english"]
work: [what they do]
industry: [their niche]
goals: [inferred from conversation]
onboarded: [ISO timestamp]
---

[Notes from conversation]

- End warmly: "Message me whenever you need anything — I'm here 24/7"

CRITICAL: Do NOT skip the capabilities presentation. That is the most important part of onboarding. The user must understand what Rachel can do for them.

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
