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

// ---------------------------------------------------------------------------
// Typing indicator
// ---------------------------------------------------------------------------

/**
 * Interval for refreshing the "typing" indicator.
 * Telegram's typing indicator expires after ~5s, so we resend every 4s.
 *
 * Why self-managed instead of @grammyjs/auto-chat-action?
 * The plugin ties its lifecycle to grammY's middleware chain. In Rachel9,
 * message processing runs inside enqueueForChat() — a queued callback that
 * is NOT part of the middleware chain. The plugin's finally-block cleanup
 * fires when the middleware returns, which is decoupled from when our queue
 * callback finishes. This caused two bugs:
 * - Typing indicator lingering after the response was sent
 * - Typing indicator not showing at all (middleware returned before queue ran)
 *
 * The self-managed loop gives us precise control: start immediately when
 * processing begins, stop the instant the agent finishes (before sending
 * the final message). No framework timing issues.
 */
const TYPING_INTERVAL_MS = 4000;

function startTypingLoop(api: Api, chatId: number): () => void {
  const send = () => { void api.sendChatAction(chatId, "typing").catch(() => {}); };
  send();
  const interval = setInterval(send, TYPING_INTERVAL_MS);
  return () => clearInterval(interval);
}

// ---------------------------------------------------------------------------
// Streaming message manager
// ---------------------------------------------------------------------------

/**
 * Manages the single streaming message during agent response.
 *
 * Why this exists: Without a placeholder message, we send a new message on
 * the first streaming chunk and edit it on subsequent chunks. But events
 * fire rapidly (message_update, tool_execution_start) and doStreamUpdate is
 * async. If two events fire before the first sendFormattedMessage resolves,
 * both see messageId=null and both try to send a new message → duplicates.
 *
 * This class serializes all updates through a promise chain, ensuring only
 * one message is ever created, and subsequent updates wait for it.
 */
class StreamingMessage {
  private messageId: number | null = null;
  private pending: Promise<void> = Promise.resolve();
  private creating = false;

  constructor(
    private api: Api,
    private chatId: number,
  ) {}

  /**
   * Queue a streaming update. If no message exists yet, creates one.
   * All calls are serialized — no duplicate messages possible.
   */
  update(text: string): void {
    this.pending = this.pending.then(() => this.doUpdate(text)).catch(() => {});
  }

  private async doUpdate(text: string): Promise<void> {
    if (!text.trim()) return; // Skip empty updates

    const truncated = text.length > CONSTANTS.STREAM_EDIT_TRUNCATE
      ? text.slice(0, CONSTANTS.STREAM_EDIT_TRUNCATE) + "\n\n_... (streaming)_"
      : text;

    if (this.messageId === null && !this.creating) {
      // First chunk — send a new message
      this.creating = true;
      try {
        this.messageId = await sendFormattedMessage(this.api, this.chatId, truncated);
      } finally {
        this.creating = false;
      }
    } else if (this.messageId !== null) {
      // Subsequent chunks — edit existing
      await editFormattedMessage(this.api, this.chatId, this.messageId, truncated);
    }
    // If creating is true but messageId is null, we're mid-creation — skip
    // (the next queued update will catch up with the latest text)
  }

  /** Wait for all pending updates to finish. */
  async flush(): Promise<void> {
    await this.pending;
  }

  /** Get the current message ID (may be null if no text was streamed). */
  getId(): number | null {
    return this.messageId;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

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
 * Flow:
 * 1. Start typing indicator loop (every 4s)
 * 2. Subscribe to agent events for streaming
 * 3. On first text chunk → send new message
 * 4. On subsequent chunks → edit that message (throttled)
 * 5. On tool execution → append tool indicator to message
 * 6. When agent finishes → stop typing, send final clean response
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
    const stopTyping = startTypingLoop(ctx.api, chatId);

    try {
      void appendToDailyLog("user", logText ?? prompt);

      // Serialized streaming message — prevents duplicate sends
      const stream = new StreamingMessage(ctx.api, chatId);

      // State for throttled editing
      let accumulatedText = "";
      let lastEditTime = 0;
      let editTimer: ReturnType<typeof setTimeout> | null = null;

      const unsub = subscribeToAgent(chatId, (event) => {
        if (event.type === "message_update") {
          const msg = event.message;
          if (!("content" in msg) || !Array.isArray(msg.content)) return;
          const textParts = (msg.content as { type: string; text?: string }[])
            .filter((c) => c.type === "text" && c.text)
            .map((c) => c.text as string);
          accumulatedText = textParts.join("\n");

          const now = Date.now();
          if (now - lastEditTime >= CONSTANTS.STREAM_THROTTLE_MS) {
            stream.update(accumulatedText);
            lastEditTime = now;
            if (editTimer) {
              clearTimeout(editTimer);
              editTimer = null;
            }
          } else if (!editTimer) {
            const delay = CONSTANTS.STREAM_THROTTLE_MS - (now - lastEditTime);
            editTimer = setTimeout(() => {
              stream.update(accumulatedText);
              lastEditTime = Date.now();
              editTimer = null;
            }, delay);
          }
        }

        if (event.type === "tool_execution_start") {
          const toolIndicator = accumulatedText
            ? `${accumulatedText}\n\n🔧 ${event.toolName}...`
            : `🔧 ${event.toolName}...`;
          stream.update(toolIndicator);
          lastEditTime = Date.now();
        }
      });

      try {
        const result = await agentPrompt(chatId, prompt);

        // Stop typing FIRST — before any message work
        stopTyping();

        if (editTimer) {
          clearTimeout(editTimer);
          editTimer = null;
        }
        unsub();

        // Wait for any in-flight streaming updates to finish
        await stream.flush();

        const finalText = result.response.trim() || "(No response)";
        void appendToDailyLog("assistant", finalText);

        await sendFinalResponse(ctx, chatId, stream.getId(), finalText);
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

// ---------------------------------------------------------------------------
// Final response
// ---------------------------------------------------------------------------

/**
 * Send the final response.
 * Always sends as a NEW message (not an edit) so the user gets a Telegram
 * notification and long responses auto-split into multiple messages.
 * If a streaming message exists, delete it first (it was just progress).
 */
async function sendFinalResponse(
  ctx: BotContext,
  chatId: number,
  streamingMessageId: number | null,
  text: string,
): Promise<void> {
  // Delete the streaming progress message (if any)
  if (streamingMessageId !== null) {
    try {
      await ctx.api.deleteMessage(chatId, streamingMessageId);
    } catch { /* already gone */ }
  }

  // Send final response as new message(s) — triggers notification
  const parts = splitMessage(text);
  for (const part of parts) {
    await sendFormattedMessage(ctx.api, chatId, part);
  }
}
