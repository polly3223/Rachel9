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

/** Exported paths for reference (e.g., system prompt, tools) */
export const MEMORY_PATHS = {
  base: MEMORY_BASE,
  coreMemory: join(MEMORY_BASE, "MEMORY.md"),
  dailyLogs: DAILY_LOGS_DIR,
  context: CONTEXT_DIR,
} as const;

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
