# Plan 02: WhatsApp Bridge (Wave 1)

Covers: WA-01 through WA-11

## Step 1: Install dependencies

```bash
cd /home/rachel/rachel9
bun add baileys@^7.0.0-rc.9 qrcode@^1.5.4
bun add -d @types/qrcode
```

## Step 2: Copy and adapt `src/whatsapp/client.ts`

Copy from Rachel8 and adapt imports:
- `import { logger } from "../lib/logger.ts"` (same relative path)
- `import { env } from "../config/env.ts"` (same relative path)
- `import { errorMessage } from "../lib/errors.ts"`
- Auth dir: `join(env.SHARED_FOLDER_PATH, "rachel-memory", "whatsapp-auth")`
- Contacts file: `join(AUTH_DIR, "contact-names.json")`

Key exports to preserve:
```typescript
// Connection
export async function connect(mode, phone?, callbacks?): Promise<ConnectResult>
export function isConnected(): boolean
export function disconnect(): Promise<void>

// Messaging
export async function sendMessage(to, text): Promise<void>
export async function sendFile(to, filePath, caption?): Promise<void>

// Contacts & Groups
export async function listGroups(): Promise<GroupInfo[]>
export async function getGroupContacts(groupJidOrName): Promise<{...}>
export function contactsToCsv(contacts): string
export function getRecentMessages(chat, limit?): SimpleMessage[]
export function searchContacts(query): ContactMatch[]
```

Changes from Rachel8:
- None functionally — module is self-contained
- Import paths adapted to Rachel9 structure
- TypeScript strict mode compliance (add explicit types if needed)

## Step 3: Copy and adapt `src/whatsapp/cli.ts`

Copy from Rachel8 and adapt:
- Import client functions from `./client.ts`
- Import logger, env
- QR save path: `join(env.SHARED_FOLDER_PATH, "whatsapp-qr.png")`

CLI remains standalone script:
```bash
bun run src/whatsapp/cli.ts <command> [args...]
```

## Step 4: Add WhatsApp section to system prompt

In `src/agent/system-prompt.ts`, add to BASE_PROMPT:

```markdown
## WhatsApp Integration
You can connect to the user's WhatsApp and manage it for them.
When the user asks to connect WhatsApp:
1. Run: `bun run src/whatsapp/cli.ts connect-qr`
2. This saves a QR code to $SHARED_FOLDER_PATH/whatsapp-qr.png
3. Send the QR: `bun run src/telegram/send-file.ts $SHARED_FOLDER_PATH/whatsapp-qr.png "Scan with WhatsApp: Settings → Linked Devices → Link a Device"`
4. Wait up to 120 seconds for scan
For full command reference, read skills/whatsapp-bridge.md
```

## Step 5: Copy `skills/whatsapp-bridge.md`

Copy from Rachel8's `skills/whatsapp-bridge.md` to Rachel9's `skills/whatsapp-bridge.md`.
Update any Rachel8-specific paths if needed.

## Verification

1. `bun run typecheck` passes
2. `bun run src/whatsapp/cli.ts status` runs without error (shows "disconnected" if no session)
3. WhatsApp section appears in system prompt
