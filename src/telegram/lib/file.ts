import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { env } from "../../config/env.ts";
import { logger } from "../../lib/logger.ts";

/** Persistent download directory for Telegram files */
const DOWNLOADS_DIR = join(env.SHARED_FOLDER_PATH, "telegram-files");

/**
 * Download a file from Telegram and save it to persistent storage.
 * Returns the absolute local path to the downloaded file.
 *
 * @param fileId - Telegram file_id from the message
 * @param fileName - Desired filename (will be prefixed with timestamp)
 */
export async function downloadTelegramFile(
  fileId: string,
  fileName: string,
): Promise<string> {
  // Ensure download directory exists
  await mkdir(DOWNLOADS_DIR, { recursive: true });

  // 1. Get file metadata from Telegram
  const metaUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;
  const metaRes = await fetch(metaUrl);
  const meta = (await metaRes.json()) as {
    ok: boolean;
    result?: { file_path: string; file_size?: number };
  };

  if (!meta.ok || !meta.result?.file_path) {
    throw new Error(`Failed to get file metadata for ${fileId}`);
  }

  // 2. Download binary content
  const downloadUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${meta.result.file_path}`;
  const fileRes = await fetch(downloadUrl);
  if (!fileRes.ok) {
    throw new Error(`File download failed: HTTP ${fileRes.status}`);
  }
  const buffer = await fileRes.arrayBuffer();

  // 3. Write to persistent storage with timestamp prefix (prevents collisions)
  const localPath = join(DOWNLOADS_DIR, `${Date.now()}-${fileName}`);
  await writeFile(localPath, Buffer.from(buffer));

  logger.debug("File downloaded", {
    fileId,
    localPath,
    size: buffer.byteLength,
  });

  return localPath;
}
