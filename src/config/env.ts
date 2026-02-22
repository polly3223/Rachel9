import { existsSync } from "node:fs";
import { z } from "zod";

export const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d{8,}:[A-Za-z0-9_-]{35,}$/, {
    message:
      "Invalid format. Expected: 123456789:ABCdef... Get yours from @BotFather on Telegram",
  }),
  OWNER_TELEGRAM_USER_ID: z.coerce.number().int().positive({
    message:
      "Must be a positive integer. Send /start to @userinfobot on Telegram to find your user ID",
  }),
  SHARED_FOLDER_PATH: z.string().min(1, {
    message: "Shared folder path is required",
  }),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("production"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  ZAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  // Agent behavior
  THINKING_LEVEL: z.enum(["off", "minimal", "low", "medium", "high"]).default("off"),
  // STT (optional — only needed for voice/audio transcription)
  STT_PROVIDER: z.enum(["groq", "openai"]).default("groq"),
  GROQ_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  // Check if .env file exists before attempting validation.
  // Bun silently skips missing .env files, so Zod would fail with
  // cryptic "Required" errors for every field. Catch this early.
  if (!existsSync(".env")) {
    console.log("No .env file found.");
    console.log("Copy .env.example to .env and fill in your values.");
    process.exit(0);
  }

  const result = envSchema.safeParse(Bun.env);

  if (!result.success) {
    console.error("Invalid environment configuration:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    console.error("\nCheck .env.example for required values.");
    process.exit(1);
  }

  return result.data;
}

export const env: Env = loadEnv();
