# Phase 3 Research: Telegram Transport

## Overview

Phase 3 wires Telegram message handling to the Agent, with streaming responses and message queuing. After this phase, the bot responds to text messages with AI, streams tokens in real-time, and calls tools.

**Requirements:** TG-01, TG-10, TG-11, TG-12, TG-13, TG-14, TG-15

---

## 1. Rachel8 Reference Implementation

### Message Flow
```
Telegram → authGuard (silent reject) → autoChatAction (typing) → handler
  → timestamp() prepend → generateResponse(chatId, text) → sendResponse()
```

### Key Patterns from Rachel8
1. **Auth guard**: Compares `ctx.from?.id` against `OWNER_TELEGRAM_USER_ID`, silent return if unauthorized
2. **Timestamp**: `DD/MM HH:MMCET` format, Europe/Zurich timezone, auto-detects CET vs CEST
3. **Error wrapper**: Sets `ctx.chatAction = "typing"`, catches errors, sends user-friendly message
4. **Markdown + fallback**: Try `{ parse_mode: "Markdown" }`, catch → retry without parse_mode
5. **No streaming**: Rachel8 sends full response. Rachel9 will ADD streaming.
6. **No explicit queue**: Rachel8 relies on Claude SDK's sequential processing. Rachel9 needs explicit queue.

### Rachel8 `sendResponse()` (Telegram formatting)
```typescript
async function sendResponse(ctx, response) {
  try {
    await ctx.reply(response, { parse_mode: "Markdown" });
  } catch {
    await ctx.reply(response); // Fallback to plain text
  }
}
```

### Rachel8 `timestamp()`
```typescript
function timestamp(): string {
  const now = new Date();
  const dt = now.toLocaleString("en-GB", {
    timeZone: "Europe/Zurich",
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hour12: false
  });
  const utcH = now.getUTCHours();
  const localH = Number(dt.split(", ")[1]?.split(":")[0] ?? "0");
  const offset = ((localH - utcH) + 24) % 24;
  const tz = offset === 2 ? "CEST" : "CET";
  return dt.replace(", ", " ") + tz;
}
```

---

## 2. Streaming Strategy for Rachel9

### Pi-mono Events for Streaming
The Agent emits events during processing:
- `message_start` — new message begins
- `message_update` — text chunk arrives (streaming)
- `message_end` — message complete with full content
- `tool_execution_start` — tool about to run
- `tool_execution_end` — tool finished

### Telegram Edit-Based Streaming
Strategy: Send initial message, then edit it as tokens arrive.

```
1. User sends message
2. Agent starts processing → send "..." placeholder message
3. message_update events arrive → edit message with accumulated text (throttled 500ms)
4. tool_execution_start → edit message with "🔧 Running: <toolName>..."
5. message_end → final edit with complete response (Markdown with fallback)
```

### Throttling
- Telegram rate limits: ~30 edits/sec globally, ~1 edit/sec per message
- Use 500ms throttle minimum between edits
- Only edit if text actually changed since last edit
- On message_end: always do final edit (no throttle)

### Message Splitting
- Telegram max message length: 4096 characters
- If response exceeds 4096, split into multiple messages
- First message is the edit target, subsequent are new messages

---

## 3. Per-Chat Message Queue

Rachel8 has no explicit queue. Rachel9 needs one because:
- `agent.prompt()` is async and takes time
- If user sends 2 messages quickly, second must wait
- Without queue, two concurrent `agent.prompt()` calls for same chat = chaos

### Queue Design
```typescript
class ChatQueue {
  private queue: (() => Promise<void>)[] = [];
  private running = false;

  async enqueue(fn: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try { await fn(); resolve(); }
        catch (err) { reject(err); }
      });
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.running || this.queue.length === 0) return;
    this.running = true;
    const fn = this.queue.shift()!;
    try { await fn(); }
    finally { this.running = false; this.processNext(); }
  }
}
```

One queue per chatId, stored in a Map.

---

## 4. Module Structure

```
src/telegram/
  ├── bot.ts              # grammY bot instance (already exists, needs update)
  ├── middleware/
  │   └── auth.ts         # Owner-only auth guard
  ├── handlers/
  │   └── message.ts      # Text message handler (→ agent → stream response)
  └── lib/
      ├── format.ts       # Telegram formatting (Markdown + fallback, message splitting)
      ├── queue.ts        # Per-chat message queue
      └── timestamp.ts    # CET/CEST timestamp utility
```

---

## 5. Streaming Event Flow (Detailed)

```typescript
// In message handler:
const sentMsg = await ctx.reply("...");  // Placeholder
const messageId = sentMsg.message_id;

let accumulatedText = "";
let lastEditTime = 0;
let editTimer: Timer | null = null;

const unsub = subscribeToAgent(chatId, (event) => {
  if (event.type === "message_update") {
    // Extract text from streaming message
    const textParts = event.message.content
      .filter(c => c.type === "text")
      .map(c => c.text);
    accumulatedText = textParts.join("\n");

    // Throttled edit
    const now = Date.now();
    if (now - lastEditTime >= 500) {
      editMessage(ctx, chatId, messageId, accumulatedText);
      lastEditTime = now;
    } else if (!editTimer) {
      editTimer = setTimeout(() => {
        editMessage(ctx, chatId, messageId, accumulatedText);
        lastEditTime = Date.now();
        editTimer = null;
      }, 500 - (now - lastEditTime));
    }
  }

  if (event.type === "tool_execution_start") {
    // Show tool indicator
    const toolText = accumulatedText + `\n\n🔧 _Running: ${event.toolName}..._`;
    editMessage(ctx, chatId, messageId, toolText);
  }
});

// agent.prompt() blocks until done
const result = await agentPrompt(chatId, timestampedText);

// Final edit with complete response + proper formatting
unsub();
clearTimeout(editTimer);
await sendFinalResponse(ctx, chatId, messageId, result.response);
```

---

## 6. Telegram Formatting Details

### Markdown v1 (Telegram's "Markdown" parse mode)
- `*bold*` — single asterisks
- `_italic_` — underscores
- `` `code` `` — backticks
- ` ```block``` ` — triple backticks
- No nested formatting
- URLs auto-linked

### Common Failure Modes
- Unmatched `*` or `_` in text → parse error
- Underscores in filenames/URLs → parse error
- Mix of formatting characters → parse error

### Fallback Strategy
```typescript
async function editMessage(ctx, chatId, messageId, text) {
  try {
    await ctx.api.editMessageText(chatId, messageId, text, { parse_mode: "Markdown" });
  } catch {
    try {
      await ctx.api.editMessageText(chatId, messageId, text);
    } catch {
      // Edit failed entirely (message deleted? too old?)
    }
  }
}
```

### Message Splitting for Long Responses
```typescript
function splitMessage(text: string, maxLen = 4096): string[] {
  if (text.length <= maxLen) return [text];

  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      parts.push(remaining);
      break;
    }
    // Split at last newline before maxLen
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx < maxLen / 2) splitIdx = maxLen; // No good split point
    parts.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return parts;
}
```

---

## 7. Pitfalls

1. **editMessageText throws if text unchanged**: Telegram returns error 400 "message is not modified" — must catch this specific error
2. **editMessageText throws if message deleted**: Need graceful handling
3. **Throttle race condition**: Timer might fire after agent.prompt() returns — clear timer before final edit
4. **Empty responses**: Agent might return empty text (all tool calls, no text) — don't edit with empty string
5. **Concurrent edits**: Multiple rapid edits can arrive out of order — track sequence number
6. **Message too long for edit**: If accumulated text exceeds 4096 during streaming, need to handle gracefully (truncate + send overflow as new message after)
7. **autoChatAction + streaming**: The `autoChatAction()` plugin might conflict with manual chat action management — test this

---

## 8. Dependencies

No new dependencies needed. Everything uses existing grammy and pi-agent-core.
