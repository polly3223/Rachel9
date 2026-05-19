import type { Api } from "grammy";
import { CONSTANTS } from "../../config/constants.ts";
import { logger } from "../../lib/logger.ts";

type HtmlToken = {
  placeholder: string;
  html: string;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function tokenPlaceholder(index: number): string {
  return `\u0000HTML_TOKEN_${index}\u0000`;
}

function restoreTokens(text: string, tokens: HtmlToken[]): string {
  let restored = text;
  for (const token of tokens) {
    restored = restored.replaceAll(token.placeholder, token.html);
  }
  return restored;
}

function protectCode(markdown: string): { text: string; tokens: HtmlToken[] } {
  const tokens: HtmlToken[] = [];

  const addToken = (html: string): string => {
    const placeholder = tokenPlaceholder(tokens.length);
    tokens.push({ placeholder, html });
    return placeholder;
  };

  let text = markdown.replace(/```(?:[a-zA-Z0-9_+-]+)?\n?([\s\S]*?)```/g, (_match, code: string) => {
    return addToken(`<pre>${escapeHtml(code.trimEnd())}</pre>`);
  });

  text = text.replace(/```(?:[a-zA-Z0-9_+-]+)?\n?([\s\S]*)$/g, (_match, code: string) => {
    return addToken(`<pre>${escapeHtml(code.trimEnd())}</pre>`);
  });

  text = text.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    return addToken(`<code>${escapeHtml(code)}</code>`);
  });

  return { text, tokens };
}

function convertLinks(text: string): string {
  return text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)\n]+)\)/g, (_match, label: string, url: string) => {
    return `<a href="${url.replace(/"/g, "&quot;")}">${label}</a>`;
  });
}

/**
 * Convert common Markdown into Telegram-friendly HTML.
 *
 * Code spans/blocks are protected first so bold/italic/list parsing cannot
 * corrupt code content. Everything else is HTML-escaped before tags are added.
 */
export function markdownToHtml(markdown: string): string {
  const { text, tokens } = protectCode(markdown);

  let html = escapeHtml(text);

  // Convert Markdown bullets before italic handling so leading "*" is not parsed.
  html = html.replace(/^([ \t]*)[-*]\s+/gm, "$1• ");

  html = convertLinks(html);

  // Bold first, then italic. Keep this intentionally conservative.
  html = html.replace(/\*\*([\s\S]+?)\*\*/g, "<b>$1</b>");
  html = html.replace(/__([\s\S]+?)__/g, "<b>$1</b>");
  html = html.replace(/(^|[^\w])\*([^*\n]+?)\*/g, "$1<i>$2</i>");
  html = html.replace(/(^|[^\w])_([^_\n]+?)_/g, "$1<i>$2</i>");

  return restoreTokens(html, tokens);
}

/**
 * Send a new message with HTML formatting, falling back to plain text.
 * Returns the message_id.
 */
export async function sendFormattedMessage(
  api: Api,
  chatId: number,
  text: string,
): Promise<number> {
  const formatted = markdownToHtml(text);

  try {
    const msg = await api.sendMessage(chatId, formatted, { parse_mode: "HTML" });
    return msg.message_id;
  } catch (err) {
    logger.warn("sendFormattedMessage failed with HTML, falling back to plain", { chatId, error: String(err) });
    try {
      const msg = await api.sendMessage(chatId, text);
      return msg.message_id;
    } catch (retryErr) {
      logger.error("sendFormattedMessage failed entirely", { chatId, error: String(retryErr) });
      throw retryErr;
    }
  }
}

/**
 * Edit an existing message with HTML formatting, falling back to plain text.
 * Silently handles "message is not modified" and deleted-message edit errors.
 */
export async function editFormattedMessage(
  api: Api,
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> {
  if (!text.trim()) return;

  const formatted = markdownToHtml(text);

  try {
    await api.editMessageText(chatId, messageId, formatted, { parse_mode: "HTML" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("message is not modified")) return;
    if (msg.includes("message to edit not found")) {
      logger.debug("Message was deleted, can't edit", { chatId, messageId });
      return;
    }

    try {
      await api.editMessageText(chatId, messageId, text);
    } catch (retryErr) {
      const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      if (retryMsg.includes("message is not modified")) return;
      if (retryMsg.includes("message to edit not found")) return;
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
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx < maxLen / 2) splitIdx = maxLen;
    parts.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return parts;
}
