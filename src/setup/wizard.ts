#!/usr/bin/env bun
/**
 * Rachel9 Interactive Setup Wizard
 *
 * Usage: bun run setup
 *
 * Collects configuration, writes .env, optionally installs systemd service.
 */

import * as p from "@clack/prompts";
import { existsSync } from "node:fs";
import { installSystemdService } from "./install.ts";

async function main() {
  p.intro("🤖 Rachel9 Setup");

  // Check if .env already exists
  if (existsSync(".env")) {
    const overwrite = await p.confirm({
      message: ".env already exists. Overwrite?",
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.outro("Setup canceled. Existing .env kept.");
      return;
    }
  }

  // 1. Telegram bot token
  const botToken = await p.text({
    message: "Telegram bot token (from @BotFather):",
    placeholder: "123456789:ABCdef...",
    validate: (v) => {
      if (!v || !/^\d{8,}:[A-Za-z0-9_-]{35,}$/.test(v)) return "Invalid format. Get yours from @BotFather";
    },
  });
  if (p.isCancel(botToken)) return cancel();

  // 2. Owner Telegram user ID
  const ownerId = await p.text({
    message: "Your Telegram user ID (send /start to @userinfobot):",
    placeholder: "123456789",
    validate: (v) => {
      if (!v || !/^\d+$/.test(v)) return "Must be a number";
    },
  });
  if (p.isCancel(ownerId)) return cancel();

  // 3. Shared folder path
  const sharedFolder = await p.text({
    message: "Shared folder path (persistent storage):",
    initialValue: "/home/rachel/shared",
    validate: (v) => {
      if (!v || !v.startsWith("/")) return "Must be an absolute path";
    },
  });
  if (p.isCancel(sharedFolder)) return cancel();

  // 4. Z.ai API key
  const zaiKey = await p.text({
    message: "Z.ai API key:",
    placeholder: "zai-...",
    validate: (v) => {
      if (!v || v.length < 5) return "Required — get from Z.ai dashboard";
    },
  });
  if (p.isCancel(zaiKey)) return cancel();

  // 5. Optional: Groq API key for voice
  const groqKey = await p.text({
    message: "Groq API key (optional — for voice message transcription):",
    placeholder: "gsk_... (press Enter to skip)",
    initialValue: "",
  });
  if (p.isCancel(groqKey)) return cancel();

  // Build .env content
  const lines: string[] = [
    `TELEGRAM_BOT_TOKEN=${botToken}`,
    `OWNER_TELEGRAM_USER_ID=${ownerId}`,
    `SHARED_FOLDER_PATH=${sharedFolder}`,
    `ZAI_API_KEY=${zaiKey}`,
    `STT_PROVIDER=groq`,
    groqKey ? `GROQ_API_KEY=${groqKey}` : "# GROQ_API_KEY=",
    "NODE_ENV=production",
    "LOG_LEVEL=info",
  ];

  await Bun.write(".env", lines.join("\n") + "\n");
  p.log.success(".env file created!");

  // 6. Optional: systemd service
  const installService = await p.confirm({
    message: "Install systemd service for auto-start on boot?",
    initialValue: true,
  });

  if (!p.isCancel(installService) && installService) {
    const s = p.spinner();
    s.start("Installing systemd service...");
    try {
      await installSystemdService();
      s.stop("systemd service installed and started!");
    } catch (err) {
      s.stop("Service installation failed");
      p.log.warn(`Error: ${(err as Error).message}`);
      p.log.info("You can start manually: bun run start");
    }
  }

  p.outro("Setup complete! Rachel9 is ready. 🚀");
}

function cancel() {
  p.outro("Setup canceled.");
}

main().catch((err) => {
  console.error("Setup error:", err);
  process.exit(1);
});
