import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { logger } from "../../lib/logger.ts";

const WebSearchSchema = Type.Object({
  query: Type.String({ description: "The search query" }),
  num_results: Type.Optional(Type.Number({ description: "Number of results (default 5, max 10)" })),
});

type WebSearchParams = Static<typeof WebSearchSchema>;

export function createWebSearchTool(): AgentTool<typeof WebSearchSchema> {
  return {
    name: "web_search",
    label: "Web Search",
    description: "Search the web using DuckDuckGo. Returns titles, URLs, and snippets.",
    parameters: WebSearchSchema,
    execute: async (_toolCallId: string, params: WebSearchParams): Promise<AgentToolResult<unknown>> => {
      const numResults = Math.min(params.num_results ?? 5, 10);
      logger.debug("Web search", { query: params.query, numResults });

      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(params.query)}`;
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; Rachel9/1.0)",
          },
        });
        const html = await response.text();

        const results: { title: string; url: string; snippet: string }[] = [];
        const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
        let match;
        while ((match = resultRegex.exec(html)) !== null && results.length < numResults) {
          const [, rawUrl, rawTitle, rawSnippet] = match;
          if (rawUrl && rawTitle) {
            const actualUrl = decodeURIComponent(
              rawUrl.replace(/.*uddg=/, "").replace(/&.*/, "")
            );
            results.push({
              title: rawTitle.replace(/<[^>]*>/g, "").trim(),
              url: actualUrl || rawUrl,
              snippet: (rawSnippet ?? "").replace(/<[^>]*>/g, "").trim(),
            });
          }
        }

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: `No results found for: "${params.query}"` }],
            details: { resultCount: 0 },
          };
        }

        const formatted = results
          .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
          .join("\n\n");

        return {
          content: [{ type: "text", text: `Search results for "${params.query}":\n\n${formatted}` }],
          details: { resultCount: results.length },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Search failed: ${msg}` }],
          details: { error: msg },
        };
      }
    },
  };
}
