# Plan 03: File Download + STT (Wave 2)

Covers: Foundation for TG-02 through TG-08 (media support), TG-04/TG-05 (voice/audio transcription)

## Step 1: Add optional env vars to `src/config/env.ts`

```typescript
// Add to envSchema:
GROQ_API_KEY: z.string().optional(),
STT_PROVIDER: z.enum(["groq", "openai"]).default("groq"),
OPENAI_API_KEY: z.string().optional(),
```

These are optional because not all Rachel instances need STT.

## Step 2: Create `src/telegram/lib/file.ts`

File download utility:

```typescript
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { env } from "../../config/env.ts";
import { logger } from "../../lib/logger.ts";

const DOWNLOADS_DIR = join(env.SHARED_FOLDER_PATH, "telegram-files");

export async function downloadTelegramFile(
  fileId: string,
  fileName: string,
  botToken: string,
): Promise<string> {
  // 1. Ensure download directory exists
  await mkdir(DOWNLOADS_DIR, { recursive: true });

  // 2. Get file metadata from Telegram
  const metaUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
  const metaRes = await fetch(metaUrl);
  const meta = (await metaRes.json()) as { ok: boolean; result?: { file_path: string } };
  if (!meta.ok || !meta.result?.file_path) {
    throw new Error(`Failed to get file metadata for ${fileId}`);
  }

  // 3. Download binary
  const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${meta.result.file_path}`;
  const fileRes = await fetch(downloadUrl);
  if (!fileRes.ok) throw new Error(`Download failed: ${fileRes.status}`);
  const buffer = await fileRes.arrayBuffer();

  // 4. Write to persistent storage with timestamp prefix
  const localPath = join(DOWNLOADS_DIR, `${Date.now()}-${fileName}`);
  await writeFile(localPath, Buffer.from(buffer));

  logger.debug("File downloaded", { fileId, localPath, size: buffer.byteLength });
  return localPath;
}
```

Note: Takes `botToken` as parameter instead of importing from bot.ts to avoid circular deps. Caller passes `ctx.api.token` or env.TELEGRAM_BOT_TOKEN.

## Step 3: Create `src/telegram/lib/transcribe.ts`

STT transcription:

```typescript
import { basename } from "node:path";
import { env } from "../../config/env.ts";
import { logger } from "../../lib/logger.ts";

interface SttConfig {
  url: string;
  model: string;
  apiKey: string;
}

function getConfig(): SttConfig {
  const provider = env.STT_PROVIDER;
  if (provider === "openai") {
    const key = env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY required when STT_PROVIDER=openai");
    return { url: "https://api.openai.com/v1/audio/transcriptions", model: "whisper-1", apiKey: key };
  }
  // Default: groq
  const key = env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY required for voice transcription");
  return { url: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3-turbo", apiKey: key };
}

export async function transcribeAudio(filePath: string): Promise<string> {
  const t0 = performance.now();
  const config = getConfig();

  // Read file and wrap as File (APIs need filename with extension)
  const bunFile = Bun.file(filePath);
  if (!(await bunFile.exists())) throw new Error(`Audio file not found: ${filePath}`);

  const bytes = await bunFile.arrayBuffer();
  const fileName = basename(filePath) || "audio.ogg";
  const file = new File([bytes], fileName, { type: bunFile.type });

  // Build FormData
  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", config.model);

  // Send to API
  const response = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`STT API error (${response.status}): ${errorText}`);
  }

  const result = (await response.json()) as { text: string };
  const text = result.text?.trim() ?? "";

  const elapsed = (performance.now() - t0).toFixed(0);
  logger.info(`STT completed in ${elapsed}ms`, { provider: env.STT_PROVIDER, textLength: text.length });

  return text;
}
```

## Verification

1. `bun run typecheck` passes
2. Test file download: call `downloadTelegramFile()` with a known file_id
3. Test transcription: call `transcribeAudio()` with a test .ogg file
