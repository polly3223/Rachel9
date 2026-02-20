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
    return {
      url: "https://api.openai.com/v1/audio/transcriptions",
      model: "whisper-1",
      apiKey: key,
    };
  }

  // Default: Groq
  const key = env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY required for voice transcription. Set GROQ_API_KEY in .env");
  return {
    url: "https://api.groq.com/openai/v1/audio/transcriptions",
    model: "whisper-large-v3-turbo",
    apiKey: key,
  };
}

/**
 * Transcribe an audio file using Groq Whisper (default) or OpenAI Whisper.
 * Returns the transcription text.
 *
 * @param filePath - Absolute path to the audio file (.ogg, .mp3, etc.)
 */
export async function transcribeAudio(filePath: string): Promise<string> {
  const t0 = performance.now();
  const config = getConfig();

  // Read file — wrap as File object so APIs detect format from extension
  const bunFile = Bun.file(filePath);
  if (!(await bunFile.exists())) {
    throw new Error(`Audio file not found: ${filePath}`);
  }

  const bytes = await bunFile.arrayBuffer();
  const fileName = basename(filePath) || "audio.ogg";
  const file = new File([bytes], fileName, { type: bunFile.type });

  // Build multipart/form-data
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
  logger.info(`STT completed in ${elapsed}ms`, {
    provider: env.STT_PROVIDER,
    model: config.model,
    textLength: text.length,
  });

  return text;
}
