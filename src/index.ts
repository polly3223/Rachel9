import { existsSync } from "node:fs";
import { bot } from "./telegram/bot.ts";
import { InputFile } from "grammy";
import { env } from "./config/env.ts";
import { CONSTANTS } from "./config/constants.ts";
import { logger } from "./lib/logger.ts";
import { db } from "./lib/database.ts";
import { errorMessage } from "./lib/errors.ts";
import { initAgentSystem, agentPrompt } from "./agent/index.ts";
import { initializeMemorySystem } from "./lib/memory.ts";
import { setTelegramSender, setAgentExecutor, startTaskPoller, shutdownTasks } from "./lib/tasks.ts";

// ---------------------------------------------------------------------------
// SAFETY GUARD: Prevent polling mode inside Docker containers.
// If RACHEL_CLOUD is not set, the bot starts in polling mode which calls
// deleteWebhook on the shared bot token — breaking ALL user containers.
// This check makes the catastrophic failure physically impossible.
// ---------------------------------------------------------------------------
if (!Bun.env["RACHEL_CLOUD"] && existsSync("/.dockerenv")) {
  console.error(
    "FATAL: Running inside Docker without RACHEL_CLOUD=true. " +
    "Polling mode would call deleteWebhook on the shared bot token, " +
    "breaking all containers. Set RACHEL_CLOUD=true or use the orchestrator. Aborting."
  );
  process.exit(1);
}

logger.info("Rachel9 starting...", { env: env.NODE_ENV });
logger.info("Configuration loaded", {
  sharedFolder: env.SHARED_FOLDER_PATH,
  logLevel: env.LOG_LEVEL,
});

// ---------------------------------------------------------------------------
// Initialize memory system (creates directories if needed)
// ---------------------------------------------------------------------------
await initializeMemorySystem();

// ---------------------------------------------------------------------------
// Initialize agent system
// ---------------------------------------------------------------------------
initAgentSystem({
  cwd: process.cwd(),
  sendFile: async (filePath: string, caption?: string) => {
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const fileName = filePath.split("/").pop() ?? "file";
      const buffer = await file.arrayBuffer();
      await bot.api.sendDocument(
        env.OWNER_TELEGRAM_USER_ID,
        new InputFile(new Uint8Array(buffer), fileName),
        caption ? { caption } : undefined,
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Initialize task scheduler
// ---------------------------------------------------------------------------
setTelegramSender(async (text: string) => {
  await bot.api.sendMessage(env.OWNER_TELEGRAM_USER_ID, text);
});

setAgentExecutor(async (prompt: string) => {
  const result = await agentPrompt(env.OWNER_TELEGRAM_USER_ID, prompt);
  return result.response;
});

startTaskPoller();

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
const isWebhookMode = Bun.env["RACHEL_CLOUD"] === "true";
let isShuttingDown = false;

function shutdown(): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info("Graceful shutdown initiated");

  // Stop task poller
  shutdownTasks();

  // Close database (flushes WAL, releases file handles)
  try {
    db.close();
    logger.info("Database closed");
  } catch (err) {
    logger.error("Error closing database", { error: errorMessage(err) });
  }

  // Stop polling bot (only in polling mode)
  if (!isWebhookMode) {
    bot.stop();
    logger.info("Bot polling stopped");
  }

  logger.info("Shutdown complete");
  process.exit(0);
}

process.once("SIGTERM", () => shutdown());
process.once("SIGINT", () => shutdown());

// ---------------------------------------------------------------------------
// Startup debouncing (lock file)
// Prevents spam "I'm online!" messages during crash loops.
// If startup message was sent within last 30s, skip it.
// ---------------------------------------------------------------------------
const STARTUP_LOCK = "/tmp/rachel9-startup.lock";
let shouldSendStartup = true;

try {
  const lockFile = Bun.file(STARTUP_LOCK);
  if (await lockFile.exists()) {
    const lastSent = (await lockFile.text()).trim();
    const elapsed = Date.now() - Number(lastSent);
    if (elapsed < CONSTANTS.MIN_UPTIME_BEFORE_RETRY_MS) {
      shouldSendStartup = false;
      logger.info("Skipping startup message (sent recently)");
    }
  }
} catch {
  // Lock file read failed -- send anyway
}

if (shouldSendStartup) {
  try {
    await bot.api.sendMessage(env.OWNER_TELEGRAM_USER_ID, "Rachel9 is online!");
    await Bun.write(STARTUP_LOCK, String(Date.now()));
    logger.info("Startup message sent");
  } catch (err) {
    logger.warn("Could not send startup message", { error: errorMessage(err) });
  }
}

// ---------------------------------------------------------------------------
// Startup mode: webhook (Rachel Cloud containers) vs polling (standalone)
//
// In Rachel Cloud, RACHEL_CLOUD=true is set. The central router at
// get-rachel.com/api/telegram/webhook receives ALL updates from Telegram
// and forwards them to containers via POST http://rachel-user-{id}:8443/webhook.
//
// Standalone instances use traditional long polling.
// ---------------------------------------------------------------------------

if (isWebhookMode) {
  const WEBHOOK_PORT = Number(Bun.env["WEBHOOK_PORT"] || "8443");

  // Initialize grammY bot internals without starting polling
  await bot.init();

  Bun.serve({
    port: WEBHOOK_PORT,
    async fetch(req: Request) {
      const url = new URL(req.url);

      // Health check endpoint
      if (req.method === "GET" && url.pathname === "/health") {
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Webhook endpoint -- receives raw Telegram updates from the router
      // IMPORTANT: Return 200 immediately and process asynchronously.
      // The router's fetch() has a timeout (~5min). If the agent takes longer
      // (e.g., web search + PDF creation), the router times out and sends
      // "⚠️ Rachel is temporarily unavailable" to the user — even though
      // the container is fine and still processing. Fire-and-forget fixes this.
      if (req.method === "POST" && url.pathname === "/webhook") {
        try {
          const update = (await req.json()) as import("@grammyjs/types").Update;
          // Fire-and-forget: process in background, respond to router instantly
          void bot.handleUpdate(update).catch((err) => {
            logger.error("Webhook handler error (async)", { error: errorMessage(err) });
          });
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          logger.error("Webhook parse error", { error: errorMessage(err) });
          return new Response(JSON.stringify({ ok: false }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      return new Response("Not found", { status: 404 });
    },
  });

  logger.info(`Rachel9 webhook server listening on port ${WEBHOOK_PORT}`);
} else {
  // Standalone mode -- use long polling (only 1 instance per bot token!)
  await bot.start({
    onStart: () => {
      logger.info("Rachel9 is running (polling mode). Listening for messages...");
    },
  });
}
