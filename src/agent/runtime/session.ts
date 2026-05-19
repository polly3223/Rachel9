import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentMessage, ContentPart, UsageMetadata } from "./types.ts";

function normalizeContent(content: unknown): ContentPart[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];

  const parts: ContentPart[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    if (record["type"] === "text" && typeof record["text"] === "string") {
      parts.push({ type: "text", text: record["text"] });
    } else if (
      (record["type"] === "image" || record["type"] === "media") &&
      typeof record["data"] === "string" &&
      typeof record["mimeType"] === "string"
    ) {
      parts.push({
        type: "media",
        data: record["data"],
        mimeType: record["mimeType"],
        fileName: typeof record["fileName"] === "string" ? record["fileName"] : undefined,
      });
    }
  }
  return parts;
}

function normalizeMessage(value: unknown): AgentMessage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const role = record["role"];
  const timestamp = typeof record["timestamp"] === "number" ? record["timestamp"] : Date.now();
  const content = normalizeContent(record["content"]);

  if (role === "user") {
    return { role, content, timestamp };
  }
  if (role === "assistant") {
    const usage = record["usage"] && typeof record["usage"] === "object"
      ? record["usage"] as UsageMetadata
      : undefined;

    return {
      role,
      content,
      timestamp,
      model: typeof record["model"] === "string" ? record["model"] : undefined,
      provider: typeof record["provider"] === "string" ? record["provider"] : undefined,
      usage,
      stopReason: typeof record["stopReason"] === "string" ? record["stopReason"] : undefined,
      errorMessage: typeof record["errorMessage"] === "string" ? record["errorMessage"] : undefined,
      toolCalls: Array.isArray(record["toolCalls"])
        ? record["toolCalls"] as Extract<AgentMessage, { role: "assistant" }>["toolCalls"]
        : undefined,
    };
  }
  if (role === "toolResult") {
    return {
      role,
      content,
      timestamp,
      toolCallId: typeof record["toolCallId"] === "string" ? record["toolCallId"] : "unknown",
      toolName: typeof record["toolName"] === "string" ? record["toolName"] : "unknown",
      details: record["details"],
      isError: record["isError"] === true,
    };
  }
  return null;
}

export class JsonlSessionStore {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  load(): AgentMessage[] {
    if (!existsSync(this.path)) return [];

    const messages: AgentMessage[] = [];
    const lines = readFileSync(this.path, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const message = normalizeMessage(JSON.parse(trimmed));
        if (message) messages.push(message);
      } catch {
        // Skip corrupt lines rather than breaking the whole session.
      }
    }
    return messages;
  }

  append(message: AgentMessage): void {
    appendFileSync(this.path, `${JSON.stringify(message)}\n`);
  }

  rewrite(messages: AgentMessage[]): void {
    try {
      unlinkSync(this.path);
    } catch {
      // File may not exist.
    }
    for (const message of messages) {
      this.append(message);
    }
  }
}
