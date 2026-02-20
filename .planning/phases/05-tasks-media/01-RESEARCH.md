# Phase 5: Tasks & Media — Research

## Scope

Phase 5 covers two major subsystems:
1. **Task Scheduler** (TASK-01 through TASK-09) — SQLite-backed polling scheduler
2. **Media Handlers** (TG-02 through TG-09) — photo, document, voice, audio, video, video_note, sticker, send-file CLI

This is the largest phase. After completion, Rachel9 is fully usable for daily use.

---

## Part A: Task Scheduler

### Rachel8 Reference: `/home/rachel/rachel8/src/lib/tasks.ts`

#### Database Schema
```sql
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('bash', 'reminder', 'cleanup', 'agent')),
  data TEXT NOT NULL DEFAULT '{}',
  cron TEXT,
  next_run INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
)
```

Rachel9's `database.ts` already has a tasks table but is missing:
- `cron TEXT` column
- `CHECK(type IN (...))` constraint

**Decision:** Migrate the table — add `cron` column and the type constraint.

#### Polling Loop
- 30-second `setInterval`
- Query: `SELECT * FROM tasks WHERE enabled = 1 AND next_run <= ?`
- After execution: cron tasks → update `next_run`, one-off → set `enabled = 0`

#### Task Types
| Type | Data | Execution |
|------|------|-----------|
| bash | `{ command: string }` | `$\`sh -c ${command}\`` via Bun shell |
| reminder | `{ message: string }` | Send via Telegram |
| cleanup | `{ targets: string[] }` | `pkill -f` each target |
| agent | `{ prompt: string }` | Run agent prompt → send result via Telegram |

#### Cron Parser
Simple implementation — supports: `*`, specific values, comma-separated, step (`*/5`). Does NOT support ranges (`0-30`). Uses UTC.

#### Integration Pattern
Callback injection:
- `setTelegramSender(fn)` — for reminder + agent result delivery
- `setAgentExecutor(fn)` — for agent tasks

### Rachel9 Architecture Decisions

1. **Separate tasks module** — `src/lib/tasks.ts` (matches Rachel8)
2. **Reuse existing `db`** — from `database.ts` (don't create separate tasks.db)
3. **Agent executor** — calls `agentPrompt()` from agent/index.ts
4. **Telegram sender** — injected from index.ts (bot.api.sendMessage)
5. **Migrate existing table** — add `cron` column via `ALTER TABLE`

---

## Part B: Media Handlers

### Rachel8 Reference: `/home/rachel/rachel8/src/telegram/handlers/`

#### File Download Pattern
```
ctx.api.getFile(fileId) → file_path
fetch(https://api.telegram.org/file/bot{TOKEN}/{file_path}) → buffer
write to $SHARED_FOLDER_PATH/telegram-files/{timestamp}-{filename}
return absolute path
```

#### Handler Pattern (per media type)
1. Extract media from `ctx.message`
2. Download via `downloadTelegramFile(ctx, fileId, filename)`
3. Build timestamped prompt with metadata
4. Call agent via `agentPrompt(chatId, prompt)` + streaming
5. Send response

#### Prompt Injection Formats
| Media | Format |
|-------|--------|
| Photo | `[User sent an image saved at: {path}]\n\n{caption}` |
| Document | `[User sent a file saved at: {path} (filename: {name})]\n\n{caption}` |
| Voice | `[Voice message transcribed: "{text}"]\n\n{caption}` or just `{transcription}` |
| Audio | `[Audio file "{name}" transcribed: "{text}"]\n\n{caption}` |
| Video | `[User sent a video saved at: {path} (filename: {name}, duration: {dur}s)]\n\n{caption}` |
| Video Note | `[User sent a video note (round video) saved at: {path} (duration: {dur}s)]` |
| Sticker (static) | `[User sent a sticker saved at: {path} (emoji: {e}, set: "{s}")]` |
| Sticker (animated) | `[User sent a sticker: emoji {e}, from set "{s}"]` |

#### STT Transcription
- Providers: Groq (default, `whisper-large-v3-turbo`) or OpenAI (`whisper-1`)
- API: multipart/form-data POST with `file` + `model` fields
- Response: `{ text: string }`
- Env vars: `STT_PROVIDER`, `GROQ_API_KEY`, `OPENAI_API_KEY`
- Important: `new File([bytes], fileName)` for correct extension detection

#### Send File CLI
- `src/telegram/send-file.ts` — standalone script
- MIME-based routing: image→sendPhoto, video→sendVideo, audio→sendAudio, else→sendDocument
- Uses Telegram Bot API directly via fetch + FormData

### Rachel9 Architecture Decisions

1. **File download utility** — `src/telegram/lib/file.ts`
2. **STT module** — `src/telegram/lib/transcribe.ts`
3. **Media handlers** — `src/telegram/handlers/media.ts` (single file, not 7 separate)
4. **Send-file CLI** — `src/telegram/send-file.ts`
5. **Env vars** — Add optional `GROQ_API_KEY` and `STT_PROVIDER` to env.ts
6. **Error wrapper** — `withErrorHandling()` pattern from Rachel8
7. **Reuse processMessage pattern** — Media handlers call agentPrompt with streaming, same as text
8. **Storage** — `$SHARED_FOLDER_PATH/telegram-files/` (same as Rachel8)

---

## Implementation Plan

### Wave 1: Task Scheduler
1. Migrate tasks table (add `cron` column)
2. Create `src/lib/tasks.ts` — cron parser, polling loop, all 4 task types, CRUD
3. Wire into `index.ts` — register callbacks, start poller, shutdown

### Wave 2: File Download + STT
4. Add env vars (`GROQ_API_KEY`, `STT_PROVIDER`)
5. Create `src/telegram/lib/file.ts` — `downloadTelegramFile()`
6. Create `src/telegram/lib/transcribe.ts` — `transcribeAudio()`

### Wave 3: Media Handlers + Send File
7. Create `src/telegram/handlers/media.ts` — all 7 media handlers
8. Register handlers in `src/telegram/bot.ts`
9. Create `src/telegram/send-file.ts` — CLI utility
10. TypeScript check + verify
