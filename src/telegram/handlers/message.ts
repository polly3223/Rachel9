import type { Api } from "grammy";
import type { BotContext } from "../bot.ts";
import { agentPrompt, subscribeToAgent } from "../../agent/index.ts";
import { timestamp } from "../lib/timestamp.ts";
import { editFormattedMessage, sendFormattedMessage, splitMessage } from "../lib/format.ts";
import { enqueueForChat } from "../lib/queue.ts";
import { logger } from "../../lib/logger.ts";
import { errorMessage } from "../../lib/errors.ts";

/** Minimum ms between message edits during streaming */
const EDIT_THROTTLE_MS = 500;

/**
 * Handle incoming text messages.
 * Routes to agent, streams response back via message editing.
 */
export async function handleTextMessage(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text;
  const chatId = ctx.chat?.id;
  if (!text || !chatId) return;

  // Enqueue to prevent concurrent agent runs for same chat
  await enqueueForChat(chatId, async () => {
    ctx.chatAction = "typing";

    try {
      await processMessage(ctx, chatId, text);
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

async function processMessage(ctx: BotContext, chatId: number, text: string): Promise<void> {
  // Prepend CET/CEST timestamp
  const timestampedText = `${timestamp()} ${text}`;

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
      // Extract accumulated text from the streaming message
      const msg = event.message;
      if (!("content" in msg) || !Array.isArray(msg.content)) return;
      const textParts = (msg.content as { type: string; text?: string }[])
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text as string);
      accumulatedText = textParts.join("\n");

      // Throttled edit
      const now = Date.now();
      if (now - lastEditTime >= EDIT_THROTTLE_MS) {
        void doEdit(ctx.api, chatId, messageId, accumulatedText);
        lastEditTime = now;
        if (editTimer) {
          clearTimeout(editTimer);
          editTimer = null;
        }
      } else if (!editTimer) {
        const delay = EDIT_THROTTLE_MS - (now - lastEditTime);
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
    const result = await agentPrompt(chatId, timestampedText);

    // Clean up streaming state
    if (editTimer) {
      clearTimeout(editTimer);
      editTimer = null;
    }
    unsub();

    // Send final response
    const finalText = result.response.trim() || "(No response)";
    await sendFinalResponse(ctx, chatId, messageId, finalText);
  } catch (err) {
    unsub();
    if (editTimer) clearTimeout(editTimer);
    throw err;
  }
}

/**
 * Edit message during streaming. Swallows errors to avoid crashing the stream.
 */
async function doEdit(api: Api, chatId: number, messageId: number, text: string): Promise<void> {
  try {
    // Truncate if too long for Telegram during streaming
    const truncated = text.length > 4000
      ? text.slice(0, 4000) + "\n\n_... (streaming)_"
      : text;
    await editFormattedMessage(api, chatId, messageId, truncated);
  } catch {
    // Swallow — streaming edits are best-effort
  }
}

/**
 * Send the final response: edit the placeholder with full text,
 * or split into multiple messages if too long.
 */
async function sendFinalResponse(
  ctx: BotContext,
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> {
  const parts = splitMessage(text);

  // First part: edit the placeholder
  await editFormattedMessage(ctx.api, chatId, messageId, parts[0]!);

  // Remaining parts: send as new messages
  for (let i = 1; i < parts.length; i++) {
    await sendFormattedMessage(ctx.api, chatId, parts[i]!);
  }
}
