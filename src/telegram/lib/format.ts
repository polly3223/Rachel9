import type { Api } from "grammy";
import { logger } from "../../lib/logger.ts";
import { CONSTANTS } from "../../config/constants.ts";

/**
 * Sanitize text for Telegram's legacy Markdown parser.
 * - Strips language identifiers from code fences (```ts → ```)
 *   because Telegram Markdown only supports plain ``` blocks.
 */
function sanitizeForTelegram(text: string): string {
  // Replace ```<lang> with just ``` (Telegram doesn't support language hints)
  return text.replace(/```[a-zA-Z0-9_+-]+\n/g, "```\n");
}

/**
 * Send a new message with Markdown formatting, falling back to plain text.
 * Returns the message_id.
 */
export async function sendFormattedMessage(
  api: Api,
  chatId: number,
  text: string,
): Promise<number> {
  const sanitized = sanitizeForTelegram(text);
  try {
    const msg = await api.sendMessage(chatId, sanitized, { parse_mode: "Markdown" });
    return msg.message_id;
  } catch {
    const msg = await api.sendMessage(chatId, text);
    return msg.message_id;
  }
}

/**
 * Edit an existing message with Markdown formatting, falling back to plain text.
 * Silently handles "message is not modified" and other edit errors.
 */
export async function editFormattedMessage(
  api: Api,
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> {
  if (!text.trim()) return; // Never edit with empty text

  const sanitized = sanitizeForTelegram(text);
  try {
    await api.editMessageText(chatId, messageId, sanitized, { parse_mode: "Markdown" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // "message is not modified" — ignore (text unchanged)
    if (msg.includes("message is not modified")) return;
    // "message to edit not found" — message was deleted
    if (msg.includes("message to edit not found")) {
      logger.debug("Message was deleted, can't edit", { chatId, messageId });
      return;
    }
    // Markdown parse failed — retry without formatting
    try {
      await api.editMessageText(chatId, messageId, text);
    } catch (retryErr) {
      const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      if (retryMsg.includes("message is not modified")) return;
      logger.debug("Edit failed entirely", { chatId, messageId, error: retryMsg });
    }
  }
}

/**
 * Split a long message into chunks that fit Telegram's 4096 char limit.
 * Tries to split at newlines for clean breaks.
 */
export function splitMessage(text: string, maxLen = CONSTANTS.TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLen) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      parts.push(remaining);
      break;
    }
    // Find last newline before maxLen
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx < maxLen / 2) splitIdx = maxLen; // No good split point, hard cut
    parts.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return parts;
}
