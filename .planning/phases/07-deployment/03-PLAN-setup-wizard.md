# Plan 03: Setup Wizard + systemd (Wave 2)

Covers: DEPLOY-03, DEPLOY-04

## Step 1: Add dependency

```bash
bun add @clack/prompts
```

## Step 2: Create `src/setup/wizard.ts`

Interactive setup using `@clack/prompts`:

```typescript
#!/usr/bin/env bun
import * as p from "@clack/prompts";

p.intro("Rachel9 Setup");

// 1. Telegram bot token
const botToken = await p.text({
  message: "Telegram bot token (from @BotFather):",
  validate: (v) => /^\d{8,}:[A-Za-z0-9_-]{35,}$/.test(v) ? undefined : "Invalid token format",
});

// 2. Owner Telegram user ID
const ownerId = await p.text({
  message: "Your Telegram user ID (from @userinfobot):",
  validate: (v) => /^\d+$/.test(v) ? undefined : "Must be a number",
});

// 3. Shared folder path
const sharedFolder = await p.text({
  message: "Shared folder path:",
  initialValue: "/home/rachel/shared",
  validate: (v) => v.startsWith("/") ? undefined : "Must be absolute path",
});

// 4. Z.ai API key
const zaiKey = await p.text({
  message: "Z.ai API key:",
  validate: (v) => v.length > 0 ? undefined : "Required",
});

// 5. Optional: Groq API key for STT
const groqKey = await p.text({
  message: "Groq API key (optional, for voice messages):",
  initialValue: "",
});

// 6. Optional: Install systemd service
const installService = await p.confirm({
  message: "Install systemd service for auto-start?",
  initialValue: true,
});

// Write .env
const envContent = [
  `TELEGRAM_BOT_TOKEN=${botToken}`,
  `OWNER_TELEGRAM_USER_ID=${ownerId}`,
  `SHARED_FOLDER_PATH=${sharedFolder}`,
  `ZAI_API_KEY=${zaiKey}`,
  groqKey ? `GROQ_API_KEY=${groqKey}` : `# GROQ_API_KEY=`,
  `STT_PROVIDER=groq`,
  `NODE_ENV=production`,
  `LOG_LEVEL=info`,
].join("\n");
await Bun.write(".env", envContent);

// Install systemd if requested
if (installService) {
  await installSystemdService();
}

p.outro("Setup complete! Run: bun run start");
```

## Step 3: Create `src/setup/install.ts`

systemd service installer:

```typescript
export async function installSystemdService(): Promise<void> {
  const serviceDir = join(homedir(), ".config/systemd/user");
  await mkdir(serviceDir, { recursive: true });

  const service = `[Unit]
Description=Rachel9 AI Assistant
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=120
StartLimitBurst=3

[Service]
Type=simple
WorkingDirectory=${process.cwd()}
ExecStart=${join(homedir(), ".bun/bin/bun")} run src/index.ts
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=default.target`;

  await writeFile(join(serviceDir, "rachel9.service"), service);

  // Enable lingering + reload + enable + start
  execSync("loginctl enable-linger $(whoami)");
  execSync("systemctl --user daemon-reload");
  execSync("systemctl --user enable rachel9");
  execSync("systemctl --user start rachel9");
}
```

## Step 4: Update package.json

```json
"setup": "bun run src/setup/wizard.ts"
```

## Verification

1. `bun run setup` launches interactive wizard
2. `.env` file created with correct values
3. systemd service starts on install
4. `systemctl --user status rachel9` shows active
