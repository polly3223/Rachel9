import { GoogleGenAI } from "@google/genai";
import { CONSTANTS } from "../config/constants.ts";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import type { AgentMessage, ContentPart } from "./runtime/types.ts";

function estimateTokens(messages: AgentMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    chars += JSON.stringify(msg).length;
  }
  return Math.ceil(chars / CONSTANTS.CHARS_PER_TOKEN);
}

function textFromParts(parts: ContentPart[]): string {
  return parts
    .map((part) => part.type === "text" ? part.text : `[${part.mimeType} media]`)
    .join(" ");
}

function messagesToText(messages: AgentMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const role = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "Tool";
    lines.push(`${role}: ${textFromParts(msg.content)}`);
  }
  return lines.join("\n");
}

function countTurnPairsFromEnd(messages: AgentMessage[], keepTurns: number): number {
  let turns = 0;
  let idx = messages.length - 1;

  while (idx >= 0 && turns < keepTurns) {
    while (idx >= 0 && messages[idx]?.role === "toolResult") idx--;
    if (idx >= 0 && messages[idx]?.role === "assistant") idx--;
    while (idx >= 0 && messages[idx]?.role === "toolResult") idx--;
    if (idx >= 0 && messages[idx]?.role === "user") {
      idx--;
      turns++;
    } else {
      idx--;
    }
  }

  return messages.length - 1 - idx;
}

async function summarizeMessages(messages: AgentMessage[], signal?: AbortSignal): Promise<string> {
  const conversationText = messagesToText(messages);
  if (conversationText.length < 500) return conversationText;

  if (!env.GEMINI_API_KEY) {
    return conversationText.slice(0, 2000) + "\n\n[...older conversation truncated]";
  }

  const prompt = `Summarize the following conversation concisely, preserving key facts, decisions, user preferences, file paths, tool results, and any context the assistant needs to continue effectively. Be factual and compact.

Conversation:
${conversationText}

Summary:`;

  try {
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: env.GEMINI_MODEL ?? "gemini-3.5-flash",
      contents: prompt,
      config: {
        abortSignal: signal,
        systemInstruction: "You are a conversation summarizer. Produce concise, factual summaries.",
      },
    });

    return response.text?.trim() || conversationText.slice(0, 2000);
  } catch (err) {
    logger.warn("Compaction summary failed, using truncation fallback", { error: String(err) });
    return conversationText.slice(0, 2000) + "\n\n[...older conversation truncated]";
  }
}

export async function compactMessages(messages: AgentMessage[], signal?: AbortSignal): Promise<AgentMessage[]> {
  const estimated = estimateTokens(messages);
  const threshold = CONSTANTS.MAX_CONTEXT_TOKENS * CONSTANTS.COMPACTION_THRESHOLD;

  if (estimated <= threshold) return messages;

  logger.info("Context compaction triggered", {
    estimatedTokens: estimated,
    threshold,
    messageCount: messages.length,
  });

  const keepFromEnd = countTurnPairsFromEnd(messages, CONSTANTS.COMPACTION_KEEP_RECENT_TURNS);
  const keepFromStart = Math.min(2, messages.length);

  if (keepFromStart + keepFromEnd >= messages.length) {
    logger.warn("Cannot compact - not enough messages to split", {
      keepFromStart,
      keepFromEnd,
      total: messages.length,
    });
    return messages;
  }

  const headMessages = messages.slice(0, keepFromStart);
  const middleMessages = messages.slice(keepFromStart, messages.length - keepFromEnd);
  const tailMessages = messages.slice(messages.length - keepFromEnd);
  const summary = await summarizeMessages(middleMessages, signal);

  const summaryMessage: AgentMessage = {
    role: "user",
    content: [{
      type: "text",
      text: `[Context Summary - earlier conversation compacted to save context. Memory files may contain full details.]\n\n${summary}`,
    }],
    timestamp: Date.now(),
  };

  const compacted = [...headMessages, summaryMessage, ...tailMessages];

  logger.info("Context compacted", {
    originalMessages: messages.length,
    compactedMessages: compacted.length,
    droppedMessages: middleMessages.length,
  });

  return compacted;
}

