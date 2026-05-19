---
name: whatsapp-bridge
description: Use when the user asks to connect WhatsApp, read WhatsApp chats, list groups, export group contacts, send WhatsApp messages, or send files through WhatsApp. Includes setup/install guidance for running the bridge inside the container.
---

# WhatsApp Bridge

Use this skill for any WhatsApp task: connect/link WhatsApp, check status, list groups, export contacts, read recent messages, send messages, or send files.

## Runtime

Preferred CLI bundled with this skill:

```bash
bun run skills/whatsapp-bridge/scripts/cli.ts <command> [args...]
```

If the CLI dependencies are missing in a local/dev container, install them in the repo root:

```bash
bun add baileys qrcode
bun add -d @types/qrcode
```

If this skill was copied without its `scripts/` folder, create a persistent bridge project under:

```bash
mkdir -p "$SHARED_FOLDER_PATH/whatsapp-bridge"
cd "$SHARED_FOLDER_PATH/whatsapp-bridge"
bun init -y
bun add baileys qrcode
bun add -d @types/qrcode
```

Then copy or implement a small Bun CLI using Baileys with:
- `useMultiFileAuthState("$SHARED_FOLDER_PATH/rachel-memory/whatsapp-auth")`
- `Browsers.macOS("Google Chrome")`
- `syncFullHistory: true`
- QR generation via `qrcode`
- auth/session files stored only under `$SHARED_FOLDER_PATH`

Do not store WhatsApp auth under `/tmp`, `/app`, or other ephemeral paths.

## Connect via QR

When the user asks to connect WhatsApp:

1. Run the QR connection in the background:

```bash
nohup bun run skills/whatsapp-bridge/scripts/cli.ts connect-qr > /tmp/wa-connect.log 2>&1 &
```

2. Wait for the QR image:

```bash
sleep 5 && grep -q "QR code saved" /tmp/wa-connect.log && echo "QR ready"
```

3. Send the QR image through Telegram:

```bash
bun run src/telegram/send-file.ts "$SHARED_FOLDER_PATH/whatsapp-qr.png" "Scan this QR code: WhatsApp -> Settings -> Linked Devices -> Link a Device"
```

4. Do not ask the user to tell you when done. The background process detects the scan.

5. Check connection:

```bash
grep "connected successfully\|connected" /tmp/wa-connect.log || bun run skills/whatsapp-bridge/scripts/cli.ts status
```

Only clear auth when the session is known expired or logged out:

```bash
rm -rf "$SHARED_FOLDER_PATH/rachel-memory/whatsapp-auth"/*
```

## Connect via Pairing Code

Use only if the user asks for phone-number pairing:

```bash
bun run skills/whatsapp-bridge/scripts/cli.ts connect "+393343502266"
```

Send the pairing code to the user and tell them:
WhatsApp -> Settings -> Linked Devices -> Link a Device -> Link with phone number instead.

## Commands

Check status:

```bash
bun run skills/whatsapp-bridge/scripts/cli.ts status
```

List groups:

```bash
bun run skills/whatsapp-bridge/scripts/cli.ts groups
```

Export group contacts:

```bash
bun run skills/whatsapp-bridge/scripts/cli.ts contacts "Group Name"
```

Then send the generated CSV:

```bash
bun run src/telegram/send-file.ts "$SHARED_FOLDER_PATH/whatsapp-contacts-<group>.csv" "Contacts from <group>"
```

Send a message:

```bash
bun run skills/whatsapp-bridge/scripts/cli.ts send "Clara" "Ciao! Come stai?"
bun run skills/whatsapp-bridge/scripts/cli.ts send "+393343502266" "Hey!"
```

Send a file:

```bash
bun run skills/whatsapp-bridge/scripts/cli.ts send-file "+393343502266" "/path/to/file.pdf" "Here is the report"
```

Read recent messages:

```bash
bun run skills/whatsapp-bridge/scripts/cli.ts messages "Marco" 20
```

Search contacts:

```bash
bun run skills/whatsapp-bridge/scripts/cli.ts search "Marco"
```

Disconnect:

```bash
bun run skills/whatsapp-bridge/scripts/cli.ts disconnect
```

## Notes

- Auth persists in `$SHARED_FOLDER_PATH/rachel-memory/whatsapp-auth/`.
- QR image is written to `$SHARED_FOLDER_PATH/whatsapp-qr.png`.
- Group contact CSVs are written to `$SHARED_FOLDER_PATH/whatsapp-contacts-<group>.csv`.
- Contact name sync can take several seconds after first connection.
- `messages` only includes messages received while the bridge was connected.
- Prefer phone numbers with country code when name resolution is ambiguous.

## Similar Skill Pattern

This repo already has skills that tell Rachel to install or use local dependencies when needed:
- `skills/crm/SKILL.md` uses `bun init` / `bun add` in a persistent project folder.
- `skills/pptx/SKILL.md` documents installing PPT dependencies.
- `skills/pdf/SKILL.md` documents optional OCR dependencies.
- `skills/webapp-testing/SKILL.md` documents test/runtime setup patterns.
