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
    ctx.chatAction = "typing";

    try {
      // Log user message to daily log (fire-and-forget)
      void appendToDailyLog("user", logText ?? prompt);

      // Send placeholder message for streaming
      const placeholder = await ctx.reply("...");
      const messageId = placeholder.message_id;

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

          // Throttled edit
          const now = Date.now();
          if (now - lastEditTime >= CONSTANTS.STREAM_THROTTLE_MS) {
            void doEdit(ctx.api, chatId, messageId, accumulatedText);
            lastEditTime = now;
            if (editTimer) {
              clearTimeout(editTimer);
              editTimer = null;
            }
          } else if (!editTimer) {
            const delay = CONSTANTS.STREAM_THROTTLE_MS - (now - lastEditTime);
            editTimer = setTimeout(() => {
              void doEdit(ctx.api, chatId, messageId, accumulatedText);
              lastEditTime = Date.now();
              editTimer = null;
            }, delay);
          }
        }

        if (event.type === "tool_execution_start") {
          const toolIndicator = accumulatedText
            ? `${accumulatedText}\n\n_🔧 ${event.toolName}..._`
            : `_🔧 ${event.toolName}..._`;
          void doEdit(ctx.api, chatId, messageId, toolIndicator);
          lastEditTime = Date.now();
        }
      });

      try {
        // Run agent (blocks until all turns complete)
        const result = await agentPrompt(chatId, prompt);

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
        unsub();
        if (editTimer) clearTimeout(editTimer);
        throw err;
      }
    } catch (err) {
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
 * Edit message during streaming. Swallows errors to avoid crashing the stream.
 */
async function doEdit(api: Api, chatId: number, messageId: number, text: string): Promise<void> {
  try {
    const truncated = text.length > CONSTANTS.STREAM_EDIT_TRUNCATE
      ? text.slice(0, CONSTANTS.STREAM_EDIT_TRUNCATE) + "\n\n_... (streaming)_"
      : text;
    await editFormattedMessage(api, chatId, messageId, truncated);
  } catch {
    // Swallow — streaming edits are best-effort
  }
}

/**
 * Send the final response: edit the placeholder with full text,
 * or split into multiple messages if too long.
 * If the edit fails, delete the placeholder and send a fresh message.
 */
async function sendFinalResponse(
  ctx: BotContext,
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> {
  const parts = splitMessage(text);

  // First part: try to edit the placeholder
  try {
    await editFormattedMessage(ctx.api, chatId, messageId, parts[0]!);
  } catch {
    // Edit failed — delete the stale placeholder and send fresh
    try {
      await ctx.api.deleteMessage(chatId, messageId);
    } catch {
      // Placeholder already gone — fine
    }
    await sendFormattedMessage(ctx.api, chatId, parts[0]!);
  }

  // Remaining parts: send as new messages
  for (let i = 1; i < parts.length; i++) {
    await sendFormattedMessage(ctx.api, chatId, parts[i]!);
  }
}
