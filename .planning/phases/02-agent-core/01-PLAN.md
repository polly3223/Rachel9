---
wave: 1
depends_on: []
files_modified:
  - package.json
  - src/config/env.ts
requirements:
  - AGENT-02
autonomous: true
---

# Plan 01: Add Pi-Mono Dependencies + Env Config

## Goal
Install pi-agent-core, pi-ai, pi-coding-agent, and @sinclair/typebox. Add ZAI_API_KEY to env validation.

## Tasks

### Task 1: Update package.json dependencies
<task>
Add the following dependencies to `/home/rachel/rachel9/package.json`:

```json
{
  "dependencies": {
    "@mariozechner/pi-agent-core": "^0.53.1",
    "@mariozechner/pi-ai": "^0.53.1",
    "@mariozechner/pi-coding-agent": "^0.53.1",
    "@sinclair/typebox": "^0.34.48"
  }
}
```

These are added to the existing dependencies (grammy, zod, @grammyjs/auto-chat-action).

Then run `bun install` to install them.
</task>

### Task 2: Add ZAI_API_KEY to env validation
<task>
Update `/home/rachel/rachel9/src/config/env.ts` to add ZAI_API_KEY:

Add to the envSchema:
```typescript
ZAI_API_KEY: z.string().min(1, {
  message: "Z.ai API key required. Get from Z.ai Pro dashboard",
}),
```

This key is used by `getApiKey()` callback in the Agent constructor.
</task>

### Task 3: Update .env.example
<task>
Add to `/home/rachel/rachel9/.env.example`:

```
# Z.ai API Key (from Z.ai Pro dashboard)
ZAI_API_KEY=
```
</task>

## Verification
- [ ] `bun install` succeeds with all pi-mono packages
- [ ] `bunx tsc --noEmit` passes (new packages type-check)
- [ ] env.ts validates ZAI_API_KEY as required string
- [ ] .env.example documents ZAI_API_KEY
