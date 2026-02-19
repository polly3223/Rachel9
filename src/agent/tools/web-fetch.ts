import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { logger } from "../../lib/logger.ts";

const WebFetchSchema = Type.Object({
  url: Type.String({ description: "The URL to fetch" }),
  extract: Type.Optional(Type.String({ description: "What information to extract (for context)" })),
});

type WebFetchParams = Static<typeof WebFetchSchema>;

/**
 * Simple HTML to text converter.
 * Strips tags, decodes entities, collapses whitespace.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function createWebFetchTool(): AgentTool<typeof WebFetchSchema> {
  return {
    name: "web_fetch",
    label: "Web Fetch",
    description: "Fetch a URL and extract its text content. Returns the page text (HTML stripped). Max 15000 characters.",
    parameters: WebFetchSchema,
    execute: async (_toolCallId: string, params: WebFetchParams): Promise<AgentToolResult<unknown>> => {
      logger.debug("Web fetch", { url: params.url });

      try {
        const response = await fetch(params.url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; Rachel9/1.0)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(15_000),
        });

        if (!response.ok) {
          return {
            content: [{ type: "text", text: `HTTP ${response.status}: ${response.statusText}` }],
            details: { status: response.status },
          };
        }

        const contentType = response.headers.get("content-type") ?? "";
        const body = await response.text();

        let text: string;
        if (contentType.includes("html")) {
          text = htmlToText(body);
        } else {
          text = body;
        }

        const MAX_CHARS = 15_000;
        if (text.length > MAX_CHARS) {
          text = text.slice(0, MAX_CHARS) + "\n\n[... truncated at 15000 characters]";
        }

        return {
          content: [{ type: "text", text: `Content from ${params.url}:\n\n${text}` }],
          details: { url: params.url, length: text.length },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Fetch failed: ${msg}` }],
          details: { error: msg },
        };
      }
    },
  };
}
