# Plan 04: Media Handlers + Send File CLI (Wave 3)

Covers: TG-02 through TG-09

## Step 1: Create `src/telegram/handlers/media.ts`

All 7 media handlers in one file. Each handler:
1. Extracts media from ctx
2. Downloads file via `downloadTelegramFile()`
3. Transcribes if voice/audio
4. Builds prompt with metadata
5. Routes through same streaming pipeline as text messages

```typescript
import type { BotContext } from "../bot.ts";
import { downloadTelegramFile } from "../lib/file.ts";
import { transcribeAudio } from "../lib/transcribe.ts";
import { timestamp } from "../lib/timestamp.ts";
import { agentPrompt, subscribeToAgent } from "../../agent/index.ts";
import { enqueueForChat } from "../lib/queue.ts";
import { appendToDailyLog } from "../../lib/memory.ts";
import { env } from "../../config/env.ts";
import { logger } from "../../lib/logger.ts";
import { errorMessage } from "../../lib/errors.ts";

// Error wrapper
function withErrorHandling(mediaType: string, handler: (ctx: BotContext) => Promise<void>) {
  return async (ctx: BotContext): Promise<void> => {
    try {
      await handler(ctx);
    } catch (err) {
      logger.error(`Failed to handle ${mediaType}`, { error: errorMessage(err) });
      try { await ctx.reply(`Sorry, I couldn't process that ${mediaType}. Please try again.`); } catch { /* give up */ }
    }
  };
}

// Shared: process media through agent with streaming (reuse text handler's streaming pattern)
async function processMediaPrompt(ctx: BotContext, chatId: number, prompt: string): Promise<void> {
  // Same pattern as handleTextMessage — enqueue, stream, respond
  // Imports processMessage-like logic or calls agentPrompt directly
}
```

### Handlers:

**handlePhoto:**
- Get highest-res photo: `photos[photos.length - 1]`
- Download as `photo.jpg`
- Prompt: `[User sent an image saved at: {path}]\n\n{caption or default}`

**handleDocument:**
- Get `doc.file_name ?? "document"`
- Prompt: `[User sent a file saved at: {path} (filename: {name})]\n\n{caption}`

**handleVoice:**
- Download as `voice.ogg`
- Transcribe via `transcribeAudio()`
- No caption: prompt is just `{timestamp} {transcription}` (natural, like text)
- With caption: `[Voice message transcribed: "{text}"]\n\n{caption}`

**handleAudio:**
- Get filename from `audio.file_name` or construct from mime
- Transcribe
- Prompt: `[Audio file "{name}" transcribed: "{text}"]\n\n{caption}`

**handleVideo:**
- Download as `video.mp4`
- Prompt: `[User sent a video saved at: {path} (filename: {name}, duration: {dur}s)]\n\n{caption}`

**handleVideoNote:**
- Download as `video_note.mp4`
- Prompt: `[User sent a video note (round video) saved at: {path} (duration: {dur}s)]`

**handleSticker:**
- Static: download as `sticker.webp`, include path
- Animated/video: metadata only (emoji, set name)

## Step 2: Extract `processMediaPrompt` as shared streaming helper

Refactor `src/telegram/handlers/message.ts` to export the streaming + agent call pattern so media handlers can reuse it:

```typescript
// In message.ts, export:
export async function processAgentPrompt(ctx: BotContext, chatId: number, prompt: string, logText?: string): Promise<void>
```

This wraps: enqueue → placeholder → subscribe → agentPrompt → stream edits → final response → daily log.
The `logText` parameter lets media handlers log a readable version (e.g., "[Photo] caption") to daily logs.

## Step 3: Register handlers in `src/telegram/bot.ts`

```typescript
import { handlePhoto, handleDocument, handleVoice, handleAudio, handleVideo, handleVideoNote, handleSticker } from "./handlers/media.ts";

bot.on("message:photo", handlePhoto);
bot.on("message:document", handleDocument);
bot.on("message:voice", handleVoice);
bot.on("message:audio", handleAudio);
bot.on("message:video", handleVideo);
bot.on("message:video_note", handleVideoNote);
bot.on("message:sticker", handleSticker);
```

## Step 4: Create `src/telegram/send-file.ts`

Standalone CLI script:

```typescript
#!/usr/bin/env bun
// Usage: bun run src/telegram/send-file.ts <file-path> [caption]

const filePath = process.argv[2];
const caption = process.argv.slice(3).join(" ") || undefined;

// Read env directly (standalone script, no env.ts import)
const token = process.env["TELEGRAM_BOT_TOKEN"];
const chatId = process.env["OWNER_TELEGRAM_USER_ID"];

// Detect MIME → choose Telegram method
// image/* → sendPhoto, video/* → sendVideo, audio/* → sendAudio, else → sendDocument

// Build FormData, POST to Telegram API
```

## Verification

1. `bun run typecheck` passes
2. Send a photo → agent describes it
3. Send a voice message → transcription shown, agent responds
4. Send a document → path injected, agent can read it
5. Send a sticker → emoji/set metadata, agent acknowledges
6. `bun run src/telegram/send-file.ts /path/to/test.png "test"` → sends to owner
