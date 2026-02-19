---
wave: 1
depends_on: []
files_modified:
  - src/telegram/middleware/auth.ts
  - src/telegram/lib/timestamp.ts
  - src/telegram/lib/format.ts
  - src/telegram/lib/queue.ts
requirements:
  - TG-10
  - TG-12
  - TG-13
  - TG-15
autonomous: true
---

# Plan 01: Transport Utilities (Auth, Timestamp, Format, Queue)

## Goal
Create the four utility modules that the message handler depends on. These are all independent and can be developed and tested in isolation.

## Tasks

### Task 1: Create auth middleware
<task>
Create `/home/rachel/rachel9/src/telegram/middleware/auth.ts`:

```typescript
import type { Context, NextFunction } from "grammy";
import { env } from "../../config/env.ts";
import { logger } from "../../lib/logger.ts";

/**
 * Auth middleware: only allows the bot owner through.
 * Silent rejection — unauthorized users get no response at all.
 */
export async function authGuard(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;

  if (userId !== env.OWNER_TELEGRAM_USER_ID) {
    logger.warn("Unauthorized access attempt", { userId });
    return; // Silent — don't reveal bot exists
  }

  await next();
}
```

**TG-12 satisfied**: Single-user auth middleware with silent rejection.
</task>

### Task 2: Create timestamp utility
<task>
Create `/home/rachel/rachel9/src/telegram/lib/timestamp.ts`:

```typescript
/**
 * Generate a CET/CEST timestamp string for prepending to user messages.
 * Format: "DD/MM HH:MMCET" or "DD/MM HH:MMCEST"
 * Uses Europe/Zurich timezone (auto-detects daylight saving).
 */
export function timestamp(): string {
  const now = new Date();
  const dt = now.toLocaleString("en-GB", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  // Detect CET vs CEST by comparing UTC hour to local hour
  const utcH = now.getUTCHours();
  const localH = Number(dt.split(", ")[1]?.split(":")[0] ?? "0");
  const offset = ((localH - utcH) + 24) % 24;
  const tz = offset === 2 ? "CEST" : "CET";
  return dt.replace(", ", " ") + tz;
}
```

**TG-13 satisfied**: CET/CEST timestamp prefix on every user message.
</task>

### Task 3: Create Telegram formatting module
<task>
Create `/home/rachel/rachel9/src/telegram/lib/format.ts`:

```typescript
import type { Api } from "grammy";
import { logger } from "../../lib/logger.ts";

/**
 * Send or edit a message with Markdown formatting, falling back to plain text.
 * Handles "message is not modified" errors gracefully.
 */
export async function sendFormattedMessage(
  api: Api,
  chatId: number,
  text: string,
): Promise<number> {
  try {
    const msg = await api.sendMessage(chatId, text, { parse_mode: "Markdown" });
    return msg.message_id;
  } catch {
    const msg = await api.sendMessage(chatId, text);
    return msg.message_id;
  }
}

/**
 * Edit an existing message with Markdown formatting, falling back to plain text.
 * Silently handles "message is not modified" and other edit errors.
 */
export async function editFormattedMessage(
  api: Api,
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> {
  if (!text.trim()) return; // Never edit with empty text

  try {
    await api.editMessageText(chatId, messageId, text, { parse_mode: "Markdown" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // "message is not modified" — ignore (text unchanged)
    if (msg.includes("message is not modified")) return;
    // "message to edit not found" — message was deleted
    if (msg.includes("message to edit not found")) {
      logger.debug("Message was deleted, can't edit", { chatId, messageId });
      return;
    }
    // Markdown parse failed — retry without formatting
    try {
      await api.editMessageText(chatId, messageId, text);
    } catch (retryErr) {
      const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      if (retryMsg.includes("message is not modified")) return;
      logger.debug("Edit failed entirely", { chatId, messageId, error: retryMsg });
    }
  }
}

/**
 * Split a long message into chunks that fit Telegram's 4096 char limit.
 * Tries to split at newlines for clean breaks.
 */
export function splitMessage(text: string, maxLen = 4096): string[] {
  if (text.length <= maxLen) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      parts.push(remaining);
      break;
    }
    // Find last newline before maxLen
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx < maxLen / 2) splitIdx = maxLen; // No good split point, hard cut
    parts.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return parts;
}
```

**TG-10 satisfied**: Telegram-specific markdown formatting with plaintext fallback.
</task>

### Task 4: Create per-chat message queue
<task>
Create `/home/rachel/rachel9/src/telegram/lib/queue.ts`:

```typescript
import { logger } from "../../lib/logger.ts";

/**
 * Simple async queue that processes one task at a time.
 * Used to prevent concurrent agent runs for the same chat.
 */
class ChatQueue {
  private tasks: (() => Promise<void>)[] = [];
  private running = false;

  /**
   * Enqueue a task. Returns when the task completes (not when it's enqueued).
   */
  async enqueue(fn: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.tasks.push(async () => {
        try {
          await fn();
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      void this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.running || this.tasks.length === 0) return;
    this.running = true;

    const task = this.tasks.shift()!;
    try {
      await task();
    } finally {
      this.running = false;
      void this.processNext();
    }
  }

  get pending(): number {
    return this.tasks.length;
  }
}

/**
 * Map of per-chat queues. One queue per chatId.
 * Ensures messages for the same chat are processed sequentially.
 */
const queues = new Map<number, ChatQueue>();

/**
 * Enqueue a task for a specific chat.
 * If the chat has a pending task, the new task waits.
 */
export async function enqueueForChat(chatId: number, fn: () => Promise<void>): Promise<void> {
  let queue = queues.get(chatId);
  if (!queue) {
    queue = new ChatQueue();
    queues.set(chatId, queue);
  }

  logger.debug("Chat queue", { chatId, pending: queue.pending });
  await queue.enqueue(fn);
}
```

**TG-15 satisfied**: Per-chat message queue to prevent concurrent agent runs.
</task>

## Verification
- [ ] All 4 files created
- [ ] `bunx tsc --noEmit` passes
- [ ] Auth guard silently rejects non-owner users
- [ ] Timestamp produces CET/CEST format
- [ ] Format module handles Markdown with fallback
- [ ] Queue processes one task at a time per chat
