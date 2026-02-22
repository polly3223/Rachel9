import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Security: Load secrets from file if available (Docker entrypoint strips
// sensitive env vars so the agent's bash tool can't leak them).
// ---------------------------------------------------------------------------
function loadSecrets(): void {
  const secretsFile = process.env["RACHEL_SECRETS_FILE"];
  if (!secretsFile || !existsSync(secretsFile)) return;

  const content = readFileSync(secretsFile, "utf-8");
  for (const line of content.split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (value) {
      process.env[key] = value;
    }
  }

  // Delete the secrets file immediately — it's no longer needed
  try { unlinkSync(secretsFile); } catch {}
  delete process.env["RACHEL_SECRETS_FILE"];
}

loadSecrets();

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

// ---------------------------------------------------------------------------
// Security: Remove sensitive env vars from process.env so the agent's bash
// tool cannot leak them (e.g., `printenv GEMINI_API_KEY`).
// The values are already captured in the `env` object above and passed to
// the model provider via getApiKey() — they don't need to stay in process.env.
// ---------------------------------------------------------------------------
const SENSITIVE_KEYS = [
  "GEMINI_API_KEY",
  "ZAI_API_KEY",
  "GROQ_API_KEY",
  "OPENAI_API_KEY",
  "TELEGRAM_BOT_TOKEN",
] as const;

for (const key of SENSITIVE_KEYS) {
  delete process.env[key];
  // Bun.env is a proxy over process.env, but delete to be safe
  delete (Bun.env as Record<string, unknown>)[key];
}
