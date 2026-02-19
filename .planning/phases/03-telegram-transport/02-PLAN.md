---
wave: 2
depends_on:
  - 01-PLAN.md
files_modified:
  - src/telegram/handlers/message.ts
  - src/telegram/bot.ts
  - src/index.ts
requirements:
  - TG-01
  - TG-11
  - TG-14
autonomous: true
---

# Plan 02: Message Handler + Streaming + Bot Wiring

## Goal
Create the text message handler that routes messages to the agent with streaming responses. Update bot.ts to wire in auth middleware and the new handler. Update index.ts to remove the placeholder handler.

This is the core of Phase 3 — after this, the bot responds to text messages with streamed AI responses.

## Tasks

### Task 1: Create text message handler with streaming
<task>
Create `/home/rachel/rachel9/src/telegram/handlers/message.ts`:

```typescript
import type { BotContext } from "../bot.ts";
import { agentPrompt, subscribeToAgent } from "../../agent/index.ts";
import { timestamp } from "../lib/timestamp.ts";
import { editFormattedMessage, sendFormattedMessage, splitMessage } from "../lib/format.ts";
import { enqueueForChat } from "../lib/queue.ts";
import { logger } from "../../lib/logger.ts";
import { errorMessage } from "../../lib/errors.ts";

/** Minimum ms between message edits during streaming */
const EDIT_THROTTLE_MS = 500;

/**
 * Handle incoming text messages.
 * Routes to agent, streams response back via message editing.
 */
export async function handleTextMessage(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text;
  const chatId = ctx.chat?.id;
  if (!text || !chatId) return;

  // Enqueue to prevent concurrent agent runs for same chat
  await enqueueForChat(chatId, async () => {
    ctx.chatAction = "typing";

    try {
      await processMessage(ctx, chatId, text);
    } catch (err) {
      logger.error("Message handler error", { chatId, error: errorMessage(err) });
      try {
        await ctx.reply("Sorry, something went wrong. Please try again.");
      } catch {
        // Can't even send error message — give up
      }
    }
  });
}

async function processMessage(ctx: BotContext, chatId: number, text: string): Promise<void> {
  // Prepend CET/CEST timestamp
  const timestampedText = `${timestamp()} ${text}`;

  // Send placeholder message for streaming
  const placeholder = await ctx.reply("...");
  const messageId = placeholder.message_id;

  // State for throttled editing
  let accumulatedText = "";
  let lastEditTime = 0;
  let editTimer: ReturnType<typeof setTimeout> | null = null;
  let currentToolName: string | null = null;

  // Subscribe to agent events for streaming
  const unsub = subscribeToAgent(chatId, (event) => {
    if (event.type === "message_update") {
      // Extract accumulated text from the streaming message
      const textParts = event.message.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text);
      accumulatedText = textParts.join("\n");
      currentToolName = null;

      // Throttled edit
      const now = Date.now();
      if (now - lastEditTime >= EDIT_THROTTLE_MS) {
        void doEdit(ctx.api, chatId, messageId, accumulatedText);
        lastEditTime = now;
        if (editTimer) {
          clearTimeout(editTimer);
          editTimer = null;
        }
      } else if (!editTimer) {
        const delay = EDIT_THROTTLE_MS - (now - lastEditTime);
        editTimer = setTimeout(() => {
          void doEdit(ctx.api, chatId, messageId, accumulatedText);
          lastEditTime = Date.now();
          editTimer = null;
        }, delay);
      }
    }

    if (event.type === "tool_execution_start") {
      currentToolName = event.toolName;
      const toolIndicator = accumulatedText
        ? `${accumulatedText}\n\n_🔧 ${event.toolName}..._`
        : `_🔧 ${event.toolName}..._`;
      void doEdit(ctx.api, chatId, messageId, toolIndicator);
      lastEditTime = Date.now();
    }

    if (event.type === "tool_execution_end") {
      currentToolName = null;
    }
  });

  try {
    // Run agent (blocks until all turns complete)
    const result = await agentPrompt(chatId, timestampedText);

    // Clean up streaming state
    if (editTimer) {
      clearTimeout(editTimer);
      editTimer = null;
    }
    unsub();

    // Send final response
    const finalText = result.response.trim() || "(No response)";
    await sendFinalResponse(ctx, chatId, messageId, finalText);
  } catch (err) {
    unsub();
    if (editTimer) clearTimeout(editTimer);
    throw err;
  }
}

/**
 * Edit message during streaming. Swallows errors to avoid crashing the stream.
 */
async function doEdit(api: BotContext["api"], chatId: number, messageId: number, text: string): Promise<void> {
  try {
    // Truncate if too long for Telegram during streaming
    const truncated = text.length > 4000
      ? text.slice(0, 4000) + "\n\n_... (streaming)_"
      : text;
    await editFormattedMessage(api, chatId, messageId, truncated);
  } catch {
    // Swallow — streaming edits are best-effort
  }
}

/**
 * Send the final response: edit the placeholder with full text,
 * or split into multiple messages if too long.
 */
async function sendFinalResponse(
  ctx: BotContext,
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> {
  const parts = splitMessage(text);

  // First part: edit the placeholder
  await editFormattedMessage(ctx.api, chatId, messageId, parts[0]!);

  // Remaining parts: send as new messages
  for (let i = 1; i < parts.length; i++) {
    await sendFormattedMessage(ctx.api, chatId, parts[i]!);
  }
}
```

Key design decisions:
- Message is enqueued via per-chat queue (prevents concurrent agent runs)
- Placeholder "..." sent immediately, then edited as tokens stream
- 500ms throttle between edits to respect Telegram rate limits
- Tool execution shown with 🔧 indicator during streaming
- Final response split into multiple messages if > 4096 chars
- All streaming edits are best-effort (errors swallowed)
- Timer cleaned up before final edit to prevent race conditions

**TG-01 satisfied**: Receive and respond to text messages
**TG-11 satisfied**: Typing indicator via autoChatAction middleware
**TG-14 satisfied**: Streaming responses via message editing
</task>

### Task 2: Update bot.ts with auth middleware and new handler
<task>
Replace `/home/rachel/rachel9/src/telegram/bot.ts` with:

```typescript
import { Bot, type Context, GrammyError, HttpError } from "grammy";
import { autoChatAction, type AutoChatActionFlavor } from "@grammyjs/auto-chat-action";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { authGuard } from "./middleware/auth.ts";
import { handleTextMessage } from "./handlers/message.ts";

export type BotContext = Context & AutoChatActionFlavor;

export const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);

// Middleware (order matters: auth first, then typing indicator)
bot.use(authGuard);
bot.use(autoChatAction());

// Commands
bot.command("start", (ctx) => ctx.reply("Hello! I'm Rachel, your personal AI assistant."));

// Message handlers
bot.on("message:text", handleTextMessage);

// Error handler
function formatBotError(e: unknown): string {
  if (e instanceof GrammyError) return e.description;
  if (e instanceof HttpError) return `Network error: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

bot.catch((err) => {
  logger.error(`Error handling update ${err.ctx.update.update_id}`, {
    error: formatBotError(err.error),
  });
});
```

Changes from Phase 1 bot.ts:
- Added `authGuard` middleware (before autoChatAction)
- Replaced placeholder text handler with `handleTextMessage`
- Removed placeholder "I heard you!" response
</task>

### Task 3: Clean up index.ts
<task>
Update `/home/rachel/rachel9/src/index.ts` — no changes needed if bot.ts already exports cleanly. Just verify that:
1. `initAgentSystem()` is called before bot starts
2. Bot starts in the correct mode (polling or webhook)
3. No orphan imports

The index.ts from Phase 2 should work as-is since bot.ts is updated.
</task>

### Task 4: Full type-check
<task>
Run `cd /home/rachel/rachel9 && bunx tsc --noEmit` and fix any type errors.

Watch for:
- BotContext type compatibility between bot.ts and handler
- Agent event types (message_update might have specific content shape)
- `ctx.api` type in the doEdit helper
</task>

## Verification
- [ ] `src/telegram/handlers/message.ts` exists and exports `handleTextMessage`
- [ ] `src/telegram/bot.ts` uses `authGuard` middleware
- [ ] `src/telegram/bot.ts` uses `handleTextMessage` for text messages
- [ ] `bunx tsc --noEmit` exits with code 0
- [ ] Streaming: placeholder "..." sent, then edited as tokens arrive
- [ ] Throttling: edits happen at most every 500ms during streaming
- [ ] Tool indicator: 🔧 shown during tool execution
- [ ] Long messages: split into multiple messages if > 4096 chars
- [ ] Final edit: always happens after agent.prompt() completes
- [ ] Queue: messages for same chat processed sequentially

## must_haves
- Auth guard runs BEFORE autoChatAction (middleware order)
- Placeholder "..." is sent before agent starts processing
- Edit throttle is 500ms minimum
- Tool execution shows 🔧 indicator
- Final response uses Markdown with fallback
- Long responses split at newlines
- Per-chat queue wraps the entire handler
- Timer is cleared before final edit (prevents race condition)
- Streaming edit errors are swallowed (best-effort)
