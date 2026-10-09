import { type Api, GrammyError } from "grammy";
import type { Message } from "grammy/types";
import { CONSTANTS } from "../../config/constants.ts";

/** Native rich Markdown, with a literal fallback only after a formatting rejection. */
export async function sendFormattedMessage(api: Api, chatId: number, text: string): Promise<number> {
  try {
    return (await api.sendRichMessage(chatId, { markdown: text })).message_id;
  } catch (error) {
    if (
      !(error instanceof GrammyError) || error.error_code !== 400 ||
      !/parse|can't find end|rich.message|too many (?:blocks|columns)|nesting/i.test(error.description)
    ) throw error;
    return (await api.sendRichMessage(chatId, { blocks: [{ type: "paragraph", text }] })).message_id;
  }
}

/** Keep rich replies readable when quoted or forwarded back to the agent. */
export function messageText(message?: Message): string {
  return message?.text ?? message?.caption ??
    (message?.rich_message ? JSON.stringify(message.rich_message) : "");
}

/** Prefer whole paragraphs within the rich-message limit, without cutting emoji or indentation. */
export function splitMessage(text: string, maxLen: number = CONSTANTS.TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
  if (!Number.isInteger(maxLen) || maxLen < 2) throw new Error("Message limit must be an integer >= 2");
  if (text.length <= maxLen) return text.trim() ? [text] : [];

  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    const window = remaining.slice(0, maxLen + 1);
    let splitAt = window.lastIndexOf("\n\n", maxLen - 2) + 2;
    if (splitAt < 2) {
      splitAt = window.lastIndexOf("\n", maxLen - 1) + 1;
      if (splitAt < maxLen / 2) splitAt = window.lastIndexOf(" ", maxLen - 1) + 1;
      if (splitAt < maxLen / 2) splitAt = maxLen;
    }
    if (/[\uD800-\uDBFF]/.test(remaining[splitAt - 1]!)) splitAt--;
    const part = remaining.slice(0, splitAt);
    if (part.trim()) parts.push(part);
    remaining = remaining.slice(splitAt);
  }
  if (remaining.trim()) parts.push(remaining);
  return parts;
}

export async function sendFormattedChunks(api: Api, chatId: number, text: string): Promise<void> {
  for (const part of splitMessage(text)) await sendFormattedMessage(api, chatId, part);
}
