---
wave: 1
depends_on: []
files_modified:
  - src/agent/tools/web-search.ts
  - src/agent/tools/web-fetch.ts
  - src/agent/tools/telegram.ts
  - src/agent/tools/index.ts
requirements:
  - AGENT-04
  - AGENT-05
  - AGENT-06
  - AGENT-03
autonomous: true
---

# Plan 03: Custom Tools + Tool Assembly

## Goal
Create the 3 custom AgentTools (web search, web fetch, telegram send file) and the tool assembly function that combines them with pi-coding-agent tools.

## Tasks

### Task 1: Create web search tool
<task>
Create `/home/rachel/rachel9/src/agent/tools/web-search.ts`:

```typescript
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
    execute: async (_toolCallId, params: WebSearchParams): Promise<AgentToolResult<unknown>> => {
      const numResults = Math.min(params.num_results ?? 5, 10);
      logger.debug("Web search", { query: params.query, numResults });

      try {
        // Use DuckDuckGo HTML search (no API key needed)
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(params.query)}`;
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; Rachel9/1.0)",
          },
        });
        const html = await response.text();

        // Parse results from HTML
        const results: { title: string; url: string; snippet: string }[] = [];
        const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
        let match;
        while ((match = resultRegex.exec(html)) !== null && results.length < numResults) {
          const [, rawUrl, rawTitle, rawSnippet] = match;
          if (rawUrl && rawTitle) {
            // DuckDuckGo wraps URLs in redirects — extract the actual URL
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
```

Uses DuckDuckGo HTML search — no API key needed. Parses results from HTML response.
</task>

### Task 2: Create web fetch tool
<task>
Create `/home/rachel/rachel9/src/agent/tools/web-fetch.ts`:

```typescript
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
    // Remove script and style blocks
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    // Convert common block elements to newlines
    .replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Strip remaining tags
    .replace(/<[^>]*>/g, "")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Collapse whitespace
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
    execute: async (_toolCallId, params: WebFetchParams): Promise<AgentToolResult<unknown>> => {
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

        // Truncate to 15K chars to avoid context bloat
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
```
</task>

### Task 3: Create telegram send file tool
<task>
Create `/home/rachel/rachel9/src/agent/tools/telegram.ts`:

```typescript
import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { logger } from "../../lib/logger.ts";

const TelegramSendFileSchema = Type.Object({
  file_path: Type.String({ description: "Absolute path to the file to send" }),
  caption: Type.Optional(Type.String({ description: "Optional caption for the file" })),
});

type TelegramSendFileParams = Static<typeof TelegramSendFileSchema>;

/**
 * Creates a tool that sends files to the bot owner via Telegram.
 * The sendFn is injected to avoid circular dependency with bot module.
 */
export function createTelegramSendFileTool(
  sendFn: (filePath: string, caption?: string) => Promise<void>,
): AgentTool<typeof TelegramSendFileSchema> {
  return {
    name: "telegram_send_file",
    label: "Send File",
    description: "Send a file (image, document, video, audio) to the user via Telegram. Provide the absolute file path.",
    parameters: TelegramSendFileSchema,
    execute: async (_toolCallId, params: TelegramSendFileParams): Promise<AgentToolResult<unknown>> => {
      logger.debug("Telegram send file", { path: params.file_path });

      try {
        // Check file exists
        const file = Bun.file(params.file_path);
        if (!(await file.exists())) {
          return {
            content: [{ type: "text", text: `File not found: ${params.file_path}` }],
            details: { error: "not_found" },
          };
        }

        await sendFn(params.file_path, params.caption);

        return {
          content: [{ type: "text", text: `File sent: ${params.file_path}${params.caption ? ` (caption: "${params.caption}")` : ""}` }],
          details: { sent: true },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Failed to send file: ${msg}` }],
          details: { error: msg },
        };
      }
    },
  };
}
```

Uses dependency injection for the send function to avoid coupling with the Telegram bot module.
</task>

### Task 4: Create tool assembly module
<task>
Create `/home/rachel/rachel9/src/agent/tools/index.ts`:

```typescript
import { createAllTools } from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createWebSearchTool } from "./web-search.ts";
import { createWebFetchTool } from "./web-fetch.ts";
import { createTelegramSendFileTool } from "./telegram.ts";

export interface ToolDependencies {
  /** Working directory for coding tools */
  cwd: string;
  /** Function to send files via Telegram */
  sendFile: (filePath: string, caption?: string) => Promise<void>;
}

/**
 * Create all tools for an agent instance.
 * Combines pi-coding-agent tools (7) with custom Rachel tools (3).
 * Total: 10 tools.
 */
export function createAgentTools(deps: ToolDependencies): AgentTool[] {
  const codingTools = createAllTools(deps.cwd);
  const codingToolArray = Object.values(codingTools);

  const customTools = [
    createWebSearchTool(),
    createWebFetchTool(),
    createTelegramSendFileTool(deps.sendFile),
  ];

  return [...codingToolArray, ...customTools] as AgentTool[];
}
```

Combines 7 pi-coding-agent tools + 3 custom tools = 10 tools total.
`createAllTools()` returns a Record, so we convert to array with `Object.values()`.
</task>

## Verification
- [ ] All 4 files created in `src/agent/tools/`
- [ ] `createAgentTools()` returns an array of 10 tools
- [ ] `bunx tsc --noEmit` passes
- [ ] Web search uses DuckDuckGo (no API key needed)
- [ ] Web fetch strips HTML, truncates to 15K chars
- [ ] Telegram send file uses injected sendFn (no circular deps)
- [ ] All custom tools use TypeBox schemas (not Zod)

## must_haves
- All tools implement AgentTool interface with name, label, description, parameters, execute
- TypeBox schemas used for parameters (NOT Zod)
- Tool assembly uses createAllTools() (7 tools) not createCodingTools() (4 tools)
- No hardcoded API keys in any tool
- Web fetch has 15-second timeout and 15K character limit
