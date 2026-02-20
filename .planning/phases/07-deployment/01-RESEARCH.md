# Phase 7: Deployment & Self-Management — Research

## Scope

Requirements: DEPLOY-01 through DEPLOY-05, SELF-01 through SELF-04

### Already Done
- DEPLOY-01 (polling mode) ✅ — `index.ts` has polling via `bot.start()`
- DEPLOY-02 (webhook mode) ✅ — `index.ts` has `Bun.serve()` on port 8443 when `RACHEL_CLOUD=true`
- SELF-03 (startup confirmation) ✅ — `index.ts` sends "Rachel9 is online!" with debouncing

### Still Needed
- DEPLOY-03: Setup wizard (interactive — bot token, owner ID, shared folder, systemd install)
- DEPLOY-04: systemd service installation
- DEPLOY-05: Dockerfile for container deployment
- SELF-01: Git access (already works via bash tool — just needs system prompt instruction)
- SELF-02: systemd restart capability (system prompt instruction)
- SELF-04: Can modify own code (system prompt instruction)

---

## Rachel Cloud Compatibility — KEY DIFFERENCE

### Rachel8 Containers (current)
- Use Claude Agent SDK → need Claude CLI + OAuth token
- Proxy sits at `host.docker.internal:9999` doing `ANTHROPIC_BASE_URL` rewriting
- `entrypoint.sh` symlinks `~/.claude` to `/data/.claude` for credential persistence
- Credential sync: host copies OAuth tokens into container volumes every 4h

### Rachel9 Containers (new, much simpler!)
- Use pi-mono + Z.ai → only need `ZAI_API_KEY` env var
- **No Claude CLI needed** — pi-ai handles LLM API directly
- **No OAuth token sync** — Z.ai key is just an env var
- **No proxy needed** — pi-ai calls Z.ai directly (or can use proxy if wanted)
- **No entrypoint.sh hacks** — no credential symlinks needed

This is a *massive* simplification. Rachel9 containers are much lighter:
- No Claude CLI installation (saves ~500MB image size)
- No credential provisioning step
- No 4h cron sync job
- Just pass `ZAI_API_KEY` as env var

### Container Environment Variables (Rachel9)
```
TELEGRAM_BOT_TOKEN={shared bot token}
OWNER_TELEGRAM_USER_ID={user telegram id}
SHARED_FOLDER_PATH=/data
NODE_ENV=production
LOG_LEVEL=info
RACHEL_CLOUD=true
ZAI_API_KEY={from proxy or direct}
GROQ_API_KEY={optional, for STT}
STT_PROVIDER=groq
```

### Container Image Strategy
- **Much smaller**: No Claude CLI, no glibc requirement from Claude SDK
- **Can use Alpine?** Maybe — need to check if baileys or pi-mono need glibc. Bun supports Alpine.
- **Builder stage**: `oven/bun:latest`, install deps
- **Runtime stage**: Debian slim or Alpine, copy built files

### Orchestrator Compatibility
The existing orchestrator (`rachel-cloud/src/orchestrator/`) doesn't need changes:
- It builds containers from a Docker image name (configurable via `RACHEL_IMAGE` env)
- Just build Rachel9 as `rachel9:latest` and update `RACHEL_IMAGE`
- Container provisioning flow stays the same minus credential provisioning
- Health check same: `GET /health` on port 8443

---

## Rachel8 Reference: Setup Wizard

`/home/rachel/rachel8/src/setup/wizard.ts`:
- Uses `@clack/prompts` for interactive TUI
- Collects: bot token, owner ID, shared folder path
- Validates each input
- Writes `.env` file
- Optionally installs systemd service

### Setup Wizard for Rachel9
Same pattern, but simpler:
- Collect: bot token, owner ID, shared folder, Z.ai API key
- Optional: GROQ_API_KEY for voice transcription
- Optional: install systemd service

---

## Implementation Plan

### Wave 1: Dockerfile + entrypoint
1. Create `Dockerfile` (multi-stage, Bun-based, no Claude CLI)
2. Create `.dockerignore`
3. Create `entrypoint.sh` (minimal — just starts the app)

### Wave 2: Setup wizard + systemd
4. Add `@clack/prompts` dependency
5. Create `src/setup/wizard.ts`
6. Create `src/setup/install.ts` (systemd service installer)
7. Add `"setup": "bun run src/setup/wizard.ts"` to package.json

### Wave 3: Self-management system prompt
8. Add self-management instructions to system prompt
9. TypeScript check + verify
