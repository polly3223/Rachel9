#!/usr/bin/env bun
/**
 * Send a file to the bot owner via Telegram.
 *
 * Usage:
 *   bun run src/telegram/send-file.ts <file-path> [caption]
 *
 * Examples:
 *   bun run src/telegram/send-file.ts /data/photo.png "Here's the photo"
 *   bun run src/telegram/send-file.ts /data/report.pdf
 *   bun run src/telegram/send-file.ts /data/video.mp4 "Check this out"
 */

const filePath = process.argv[2];
const caption = process.argv.slice(3).join(" ") || undefined;

if (!filePath) {
  console.error("Usage: bun run src/telegram/send-file.ts <file-path> [caption]");
  process.exit(1);
}

const token = process.env["TELEGRAM_BOT_TOKEN"];
const chatId = process.env["OWNER_TELEGRAM_USER_ID"];

if (!token || !chatId) {
  console.error("Missing TELEGRAM_BOT_TOKEN or OWNER_TELEGRAM_USER_ID in environment");
  process.exit(1);
}

// Read file
const file = Bun.file(filePath);
if (!(await file.exists())) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const mime = file.type || "application/octet-stream";
const fileName = filePath.split("/").pop() ?? "file";
const blob = await file.arrayBuffer();

// Determine Telegram API method based on MIME type
let method: string;
let fieldName: string;

if (mime.startsWith("image/")) {
  method = "sendPhoto";
  fieldName = "photo";
} else if (mime.startsWith("video/")) {
  method = "sendVideo";
  fieldName = "video";
} else if (mime.startsWith("audio/")) {
  method = "sendAudio";
  fieldName = "audio";
} else {
  method = "sendDocument";
  fieldName = "document";
}

// Build FormData
const formData = new FormData();
formData.append("chat_id", chatId);
formData.append(fieldName, new File([blob], fileName, { type: mime }));
if (caption) {
  formData.append("caption", caption);
}

// Send to Telegram
const url = `https://api.telegram.org/bot${token}/${method}`;
const response = await fetch(url, { method: "POST", body: formData });
const result = (await response.json()) as { ok: boolean; description?: string };

if (result.ok) {
  console.log(`✅ File sent via ${method}: ${fileName}`);
} else {
  console.error(`❌ Failed to send file: ${result.description}`);
  process.exit(1);
}
