import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { streamSimple, getModel } from "@mariozechner/pi-ai";
import { CONSTANTS } from "../config/constants.ts";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";

/**
 * Estimate token count from messages by character length.
 * Uses JSON.stringify on each message for accurate sizing — this captures
 * all fields including tool result details, usage metadata, and JSON overhead
 * that the previous field-by-field approach missed entirely.
 */
function estimateTokens(messages: AgentMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    // Stringify the entire message to capture ALL fields:
    // - toolResult.details (can be massive — bash output, file contents, etc.)
    // - assistant metadata (usage, model, provider, api, stopReason)
    // - JSON structure overhead (keys, quotes, brackets)
    chars += JSON.stringify(msg).length;
  }
  return Math.ceil(chars / CONSTANTS.CHARS_PER_TOKEN);
}

/**
 * Extract text content from messages for summarization.
 */
function messagesToText(messages: AgentMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    if (!("role" in msg) || !("content" in msg)) continue;
    const role = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "System";
    if (typeof msg.content === "string") {
      lines.push(`${role}: ${msg.content}`);
    } else if (Array.isArray(msg.content)) {
      const textParts = (msg.content as { type: string; text?: string }[])
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text as string);
      if (textParts.length > 0) {
        lines.push(`${role}: ${textParts.join(" ")}`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * Count turn pairs (user + assistant) from the end of messages.
 */
function countTurnPairsFromEnd(messages: AgentMessage[], keepTurns: number): number {
  let turns = 0;
  let idx = messages.length - 1;

  while (idx >= 0 && turns < keepTurns) {
    // Walk backwards past tool results
    while (idx >= 0 && "role" in messages[idx]! && messages[idx]!.role === "toolResult") {
      idx--;
    }
    // Expect assistant
    if (idx >= 0 && "role" in messages[idx]! && messages[idx]!.role === "assistant") {
      idx--;
    }
    // Walk backwards past more tool results between user and assistant
    while (idx >= 0 && "role" in messages[idx]! && messages[idx]!.role === "toolResult") {
      idx--;
    }
    // Expect user
    if (idx >= 0 && "role" in messages[idx]! && messages[idx]!.role === "user") {
      idx--;
      turns++;
    } else {
      // Unexpected structure — just move back one
      idx--;
    }
  }

  return messages.length - 1 - idx;
}

/**
 * Summarize a chunk of conversation using the LLM.
 * Falls back to simple truncation if the LLM call fails.
 */
async function summarizeMessages(
  messages: AgentMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const conversationText = messagesToText(messages);

  // If conversation text is very short, just keep it as-is
  if (conversationText.length < 500) {
    return conversationText;
  }

  const summaryPrompt = `Summarize the following conversation concisely, preserving key facts, decisions, user preferences, and any context the assistant needs to continue helping effectively. Be thorough but concise — aim for roughly 10-20% of the original length.

Conversation:
${conversationText}

Summary:`;

  try {
    const model = getModel("zai", "glm-5");
    const context = {
      systemPrompt: "You are a conversation summarizer. Produce concise, factual summaries.",
      messages: [{ role: "user" as const, content: summaryPrompt, timestamp: Date.now() }],
    };

    let summary = "";
    const stream = streamSimple(model, context, {
      signal,
      apiKey: env.ZAI_API_KEY,
    });

    for await (const event of stream) {
      if (event.type === "text_delta") {
        summary += event.delta;
      }
    }

    return summary.trim() || conversationText.slice(0, 2000);
  } catch (err) {
    logger.warn("Compaction summary failed, using truncation fallback", { error: String(err) });
    // Fallback: just truncate the conversation text
    return conversationText.slice(0, 2000) + "\n\n[...older conversation truncated]";
  }
}

/**
 * Standalone compaction function for proactive use (e.g. after loading session from disk).
 * Returns compacted messages if threshold exceeded, or original messages if not needed.
 */
export async function compactMessages(messages: AgentMessage[], signal?: AbortSignal): Promise<AgentMessage[]> {
  return doCompact(messages, signal);
}

/**
 * Create a transformContext callback for the Agent.
 * Auto-compacts context when estimated tokens approach the configured maximum.
 */
export function createContextTransform(): (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]> {
  return doCompact;
}

async function doCompact(messages: AgentMessage[], signal?: AbortSignal): Promise<AgentMessage[]> {
  const estimated = estimateTokens(messages);
  const threshold = CONSTANTS.MAX_CONTEXT_TOKENS * CONSTANTS.COMPACTION_THRESHOLD;

  if (estimated <= threshold) {
    return messages;
  }

  logger.info("Context compaction triggered", {
    estimatedTokens: estimated,
    threshold,
    messageCount: messages.length,
  });

  // Determine how many messages to keep from the end
  const keepFromEnd = countTurnPairsFromEnd(messages, CONSTANTS.COMPACTION_KEEP_RECENT_TURNS);

  // Always keep the first 2 messages (typically initial user+assistant exchange)
  const keepFromStart = Math.min(2, messages.length);

  // If we can't meaningfully split, return as-is
  if (keepFromStart + keepFromEnd >= messages.length) {
    logger.warn("Cannot compact — not enough messages to split", {
      keepFromStart,
      keepFromEnd,
      total: messages.length,
    });
    return messages;
  }

  const headMessages = messages.slice(0, keepFromStart);
  const middleMessages = messages.slice(keepFromStart, messages.length - keepFromEnd);
  const tailMessages = messages.slice(messages.length - keepFromEnd);

  // Summarize the middle section
  const summary = await summarizeMessages(middleMessages, signal);

  // Create a synthetic user message with the summary
  const summaryMessage: AgentMessage = {
    role: "user" as const,
    content: `[Context Summary — the following is a summary of our earlier conversation that was compacted to save context space. Your memory files (MEMORY.md, context/, daily-logs/) contain full details.]\n\n${summary}`,
    timestamp: Date.now(),
  };

  const compacted = [...headMessages, summaryMessage, ...tailMessages];

  logger.info("Context compacted", {
    originalMessages: messages.length,
    compactedMessages: compacted.length,
    droppedMessages: middleMessages.length,
    estimatedSavedTokens: estimateTokens(middleMessages) - estimateTokens([summaryMessage]),
  });

  return compacted;
}
