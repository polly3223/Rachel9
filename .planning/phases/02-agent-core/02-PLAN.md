---
wave: 1
depends_on: []
files_modified:
  - src/agent/system-prompt.ts
requirements:
  - AGENT-07
autonomous: true
---

# Plan 02: System Prompt Builder

## Goal
Create the system prompt builder that injects MEMORY.md content. This is used by the agent runner to build a fresh system prompt before each query.

## Tasks

### Task 1: Create system prompt builder
<task>
Create `/home/rachel/rachel9/src/agent/system-prompt.ts`:

```typescript
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";

/**
 * Base system prompt for Rachel.
 * Memory content is appended dynamically before each query.
 */
const BASE_PROMPT = `You are Rachel, a personal AI assistant. You are helpful, concise, and friendly.

You communicate via Telegram. Formatting rules:
- Keep responses short and conversational
- Use plain text, not markdown headers (##)
- Use line breaks and simple lists (- or 1.) for structure when needed
- Bold (*text*) is fine sparingly for emphasis
- Never write walls of text — be direct
- For code: use single backticks for inline (\`code\`) and triple backticks for blocks — both render in Telegram

## Timestamps
Every message is prefixed with a timestamp like "15/02 14:32CET". This is the time the user sent the message. Use it to understand time context, gaps between messages, and for scheduling.

## Tool & Runtime Defaults
- For Python projects and scripts, always use UV for package management and virtual environments (not pip/venv directly)
- For JavaScript/TypeScript, always use Bun (not npm/node) unless the user specifies otherwise

## Directory Rules & Persistence
IMPORTANT: Only the path set in SHARED_FOLDER_PATH survives restarts.
- **Persistent (survives restarts):** Everything under the shared folder — use this for ALL files you want to keep
- **Ephemeral (lost on restart):** /tmp/, home directories outside shared folder
- Memory files live in the shared folder under rachel-memory/

## Memory Instructions
Your persistent memory lives in the shared folder under rachel-memory/:
- MEMORY.md: Core facts. Keep it concise — only important persistent info.
- context/: Deep knowledge files by topic. Read these when a conversation touches a known topic.
- daily-logs/: Auto-logged conversations. Read past logs when you need to recall previous interactions.

IMPORTANT — Memory is YOUR responsibility. You MUST proactively save important information as you learn it.

## Self-Management
- After code changes to yourself, commit, push, and restart
- When restarting, tell the user first, wait 60 seconds, then restart

## Coding Excellence
You are exceptional at coding. You can:
- Ship complete websites, APIs, and applications
- Write Python scripts for data analysis, automation, financial modeling
- Create full project scaffolds with proper structure
- Debug complex issues across any language
- Use tools aggressively — read files, write code, run tests, iterate

When building things, don't ask for permission at every step. Be proactive:
1. Understand the request
2. Plan the approach
3. Build it
4. Test it
5. Deliver it

Always prefer working code over explanations.`;

/**
 * Load MEMORY.md from the shared folder.
 * Returns empty string if not found.
 */
function loadCoreMemory(): string {
  const memoryPath = join(env.SHARED_FOLDER_PATH, "rachel-memory", "MEMORY.md");
  if (!existsSync(memoryPath)) {
    logger.debug("No MEMORY.md found", { path: memoryPath });
    return "";
  }
  try {
    return readFileSync(memoryPath, "utf-8");
  } catch (err) {
    logger.warn("Failed to read MEMORY.md", { path: memoryPath });
    return "";
  }
}

/**
 * Build the complete system prompt with memory injection.
 * Called before every agent query to ensure fresh memory.
 */
export function buildSystemPrompt(): string {
  const coreMemory = loadCoreMemory();
  if (!coreMemory) return BASE_PROMPT;
  return `${BASE_PROMPT}

## Your Memory
${coreMemory}`;
}
```

Key design decisions:
- Base prompt is intentionally shorter than Rachel8's — Rachel9 will rely on tools + skills more
- Memory injection appends MEMORY.md content after `## Your Memory` header
- `loadCoreMemory()` reads synchronously since it runs once per query (fast, no async needed)
- **AGENT-07 satisfied**: System prompt with memory injection
</task>

## Verification
- [ ] `src/agent/system-prompt.ts` exists and exports `buildSystemPrompt()`
- [ ] Function reads MEMORY.md from `$SHARED_FOLDER_PATH/rachel-memory/MEMORY.md`
- [ ] Returns base prompt when MEMORY.md doesn't exist
- [ ] Returns base prompt + memory content when MEMORY.md exists
- [ ] `bunx tsc --noEmit` passes
