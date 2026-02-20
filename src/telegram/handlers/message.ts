import type { Api } from "grammy";
import type { BotContext } from "../bot.ts";
import { agentPrompt, subscribeToAgent } from "../../agent/index.ts";
import { timestamp } from "../lib/timestamp.ts";
import { editFormattedMessage, sendFormattedMessage, splitMessage } from "../lib/format.ts";
import { enqueueForChat } from "../lib/queue.ts";
import { logger } from "../../lib/logger.ts";
import { errorMessage } from "../../lib/errors.ts";
import { appendToDailyLog } from "../../lib/memory.ts";
import { CONSTANTS } from "../../config/constants.ts";

/** Interval for refreshing the "typing" indicator (Telegram expires it after ~5s). */
const TYPING_INTERVAL_MS = 4000;

/**
 * Start a self-managed typing indicator loop.
 * Returns a stop function. Sends immediately, then every 4s.
 */
function startTypingLoop(api: Api, chatId: number): () => void {
  const send = () => { void api.sendChatAction(chatId, "typing").catch(() => {}); };
  send(); // fire immediately
  const interval = setInterval(send, TYPING_INTERVAL_MS);
  return () => clearInterval(interval);
}

/**
 * Handle incoming text messages.
 * Routes to agent, streams response back via message editing.
 */
export async function handleTextMessage(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text;
  const chatId = ctx.chat?.id;
  if (!text || !chatId) return;

  const timestampedText = `${timestamp()} ${text}`;
  await processAgentPrompt(ctx, chatId, timestampedText, text);
}

/**
 * Shared streaming agent prompt handler.
 * Used by both text and media handlers.
 *
 * @param ctx - grammY context
 * @param chatId - Telegram chat ID
 * @param prompt - Full prompt to send to agent (with timestamp, metadata, etc.)
 * @param logText - Human-readable version for daily log (optional, defaults to prompt)
 */
export async function processAgentPrompt(
  ctx: BotContext,
  chatId: number,
  prompt: string,
  logText?: string,
): Promise<void> {
  await enqueueForChat(chatId, async () => {
    // Self-managed typing loop — works inside queued callbacks unlike the plugin
    const stopTyping = startTypingLoop(ctx.api, chatId);

    try {
      // Log user message to daily log (fire-and-forget)
      void appendToDailyLog("user", logText ?? prompt);

      // No placeholder message — typing indicator is enough.
      // We'll send the first message when we have real text to show.
      let messageId: number | null = null;

      // State for throttled editing
      let accumulatedText = "";
      let lastEditTime = 0;
      let editTimer: ReturnType<typeof setTimeout> | null = null;

      // Subscribe to agent events for streaming
      const unsub = subscribeToAgent(chatId, (event) => {
        if (event.type === "message_update") {
          const msg = event.message;
          if (!("content" in msg) || !Array.isArray(msg.content)) return;
          const textParts = (msg.content as { type: string; text?: string }[])
            .filter((c) => c.type === "text" && c.text)
            .map((c) => c.text as string);
          accumulatedText = textParts.join("\n");

          // Throttled edit (or first send)
          const now = Date.now();
          if (now - lastEditTime >= CONSTANTS.STREAM_THROTTLE_MS) {
            void doStreamUpdate(ctx.api, chatId, accumulatedText, messageId, (id) => { messageId = id; });
            lastEditTime = now;
            if (editTimer) {
              clearTimeout(editTimer);
              editTimer = null;
            }
          } else if (!editTimer) {
            const delay = CONSTANTS.STREAM_THROTTLE_MS - (now - lastEditTime);
            editTimer = setTimeout(() => {
              void doStreamUpdate(ctx.api, chatId, accumulatedText, messageId, (id) => { messageId = id; });
              lastEditTime = Date.now();
              editTimer = null;
            }, delay);
          }
        }

        if (event.type === "tool_execution_start") {
          const toolIndicator = accumulatedText
            ? `${accumulatedText}\n\n_🔧 ${event.toolName}..._`
            : `_🔧 ${event.toolName}..._`;
          void doStreamUpdate(ctx.api, chatId, toolIndicator, messageId, (id) => { messageId = id; });
          lastEditTime = Date.now();
        }
      });

      try {
        // Run agent (blocks until all turns complete)
        const result = await agentPrompt(chatId, prompt);

        // Stop typing immediately
        stopTyping();

        // Clean up streaming state
        if (editTimer) {
          clearTimeout(editTimer);
          editTimer = null;
        }
        unsub();

        // Send final response
        const finalText = result.response.trim() || "(No response)";

        // Log assistant response to daily log (fire-and-forget)
        void appendToDailyLog("assistant", finalText);

        await sendFinalResponse(ctx, chatId, messageId, finalText);
      } catch (err) {
        stopTyping();
        unsub();
        if (editTimer) clearTimeout(editTimer);
        throw err;
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

/**
 * Send or edit a streaming update.
 * If no message exists yet, sends a new one and reports the ID via callback.
 * If a message exists, edits it.
 */
async function doStreamUpdate(
  api: Api,
  chatId: number,
  text: string,
  messageId: number | null,
  onNewMessage: (id: number) => void,
): Promise<void> {
  try {
    const truncated = text.length > CONSTANTS.STREAM_EDIT_TRUNCATE
      ? text.slice(0, CONSTANTS.STREAM_EDIT_TRUNCATE) + "\n\n_... (streaming)_"
      : text;

    if (messageId === null) {
      // First chunk — send a new message
      const id = await sendFormattedMessage(api, chatId, truncated);
      onNewMessage(id);
    } else {
      // Subsequent chunks — edit existing
      await editFormattedMessage(api, chatId, messageId, truncated);
    }
  } catch {
    // Swallow — streaming updates are best-effort
  }
}

/**
 * Send the final response.
 * If we already have a streaming message, edit it. Otherwise send new.
 * Falls back to deleting stale message and sending fresh if edit fails.
 */
async function sendFinalResponse(
  ctx: BotContext,
  chatId: number,
  messageId: number | null,
  text: string,
): Promise<void> {
  const parts = splitMessage(text);

  if (messageId !== null) {
    // Edit the streaming message with final content
    try {
      await editFormattedMessage(ctx.api, chatId, messageId, parts[0]!);
    } catch {
      // Edit failed — delete stale message and send fresh
      try {
        await ctx.api.deleteMessage(chatId, messageId);
      } catch { /* already gone */ }
      await sendFormattedMessage(ctx.api, chatId, parts[0]!);
    }
  } else {
    // No streaming message was sent — send the full response as new
    await sendFormattedMessage(ctx.api, chatId, parts[0]!);
  }

  // Remaining parts: send as new messages
  for (let i = 1; i < parts.length; i++) {
    await sendFormattedMessage(ctx.api, chatId, parts[i]!);
  }
}
