# Plan 02: Memory Module + Daily Logs

## Wave 1 — Single wave (phase is small)

### Step 1: Create `src/lib/memory.ts`

Memory infrastructure module with three exports.

```typescript
// src/lib/memory.ts
import { existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../config/env.ts";
import { logger } from "./logger.ts";
import { errorMessage } from "./errors.ts";

/** Base path for all memory files */
const MEMORY_BASE = join(env.SHARED_FOLDER_PATH, "rachel-memory");
const DAILY_LOGS_DIR = join(MEMORY_BASE, "daily-logs");
const CONTEXT_DIR = join(MEMORY_BASE, "context");

/**
 * Initialize the memory directory structure.
 * Safe to call multiple times — mkdir recursive is idempotent.
 * Call once on startup in index.ts.
 */
export async function initializeMemorySystem(): Promise<void> {
  try {
    await mkdir(MEMORY_BASE, { recursive: true });
    await mkdir(DAILY_LOGS_DIR, { recursive: true });
    await mkdir(CONTEXT_DIR, { recursive: true });
    logger.info("Memory system initialized", { base: MEMORY_BASE });
  } catch (err) {
    logger.error("Failed to initialize memory system", { error: errorMessage(err) });
  }
}

/**
 * Append a message to today's daily log.
 * Creates the file with a header if it doesn't exist.
 *
 * Format matches Rachel8 exactly:
 * ## [ISO timestamp] User/Rachel
 * message content
 */
export async function appendToDailyLog(
  role: "user" | "assistant",
  message: string,
): Promise<void> {
  try {
    const date = new Date().toISOString().split("T")[0]!;
    const logPath = join(DAILY_LOGS_DIR, `${date}.md`);
    const timestamp = new Date().toISOString();
    const label = role === "user" ? "User" : "Rachel";
    const entry = `\n## [${timestamp}] ${label}\n${message}\n`;

    if (!existsSync(logPath)) {
      const header = `# Daily Log: ${date}\n\n## Conversations\n`;
      await writeFile(logPath, header + entry, "utf-8");
      logger.debug("Created new daily log", { date });
    } else {
      await appendFile(logPath, entry, "utf-8");
    }
  } catch (err) {
    // Daily log is best-effort — never crash the bot for a log failure
    logger.error("Failed to append to daily log", { error: errorMessage(err) });
  }
}

/** Exported paths for reference (e.g., system prompt, tools) */
export const MEMORY_PATHS = {
  base: MEMORY_BASE,
  coreMemory: join(MEMORY_BASE, "MEMORY.md"),
  dailyLogs: DAILY_LOGS_DIR,
  context: CONTEXT_DIR,
} as const;
```

### Step 2: Modify `src/index.ts` — Add memory init on startup

Add import and call `initializeMemorySystem()` before agent initialization:

```typescript
// After existing imports, add:
import { initializeMemorySystem } from "./lib/memory.ts";

// Before initAgentSystem() call:
await initializeMemorySystem();
```

### Step 3: Modify `src/telegram/handlers/message.ts` — Add daily log calls

In the `processMessage` function, log user input before agent call and assistant response after:

```typescript
import { appendToDailyLog } from "../../lib/memory.ts";

// In processMessage(), after timestampedText:
void appendToDailyLog("user", text);

// After extracting finalText from result:
void appendToDailyLog("assistant", finalText);
```

Note: Using `void` (fire-and-forget) because daily logs should never block or delay the user's response. Errors are already caught inside `appendToDailyLog`.

## Verification

1. `bun run check` — TypeScript compiles without errors
2. Start bot, send a message → check `$SHARED/rachel-memory/daily-logs/YYYY-MM-DD.md` exists with correct format
3. Send another message → verify it appends (not overwrites)
4. Verify `rachel-memory/`, `daily-logs/`, `context/` directories are created on startup
5. Verify existing MEMORY.md still loads into system prompt (no regression)

## Requirements Covered

| Req | Description | How |
|-----|-------------|-----|
| MEM-03 | Daily logs | `appendToDailyLog()` called from message handler |
| MEM-05 | Memory dir init | `initializeMemorySystem()` called from index.ts |
| MEM-06 | Backward compat | Same paths as Rachel8 (`$SHARED/rachel-memory/`) |
