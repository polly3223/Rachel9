# Phase 6: WhatsApp & Skills — Research

## Scope

Two independent subsystems:
1. **WhatsApp Bridge** (WA-01 through WA-11) — Baileys client, CLI, contacts, groups
2. **Skills System** (SKILL-01 through SKILL-03) — skill directory, metadata, system prompt integration

These are largely copy-and-adapt jobs from Rachel8, not greenfield code.

---

## Part A: WhatsApp Bridge

### Rachel8 Source: `/home/rachel/rachel8/src/whatsapp/`

Two files:
- `client.ts` (492 lines) — Baileys socket, auth, contacts, messaging, groups
- `cli.ts` (297 lines) — CLI interface for agent use

### Key Architecture

1. **Baileys v7.0.0-rc.9** — `makeWASocket`, `useMultiFileAuthState`, `Browsers`
2. **Multi-file auth state** — stored in `$SHARED/rachel-memory/whatsapp-auth/`
3. **Two connection modes**: QR code (generates PNG) and pairing code (8-char code)
4. **Contact cache** — `Map<string, string>` (JID → name), persisted to `contact-names.json`
5. **Message cache** — `Map<string, proto.IWebMessageInfo[]>`, 200 per chat, in-memory only
6. **Auto-reconnect** — on disconnect, restart socket unless code 474 (logged out)
7. **Browser identity** — `Browsers.macOS("Google Chrome")` (required for pairing code)

### CLI Commands
```
connect <phone>     — Pairing code mode
connect-qr          — QR code mode (saves PNG)
status              — Check connection
groups              — List all groups
contacts <group>    — Export group contacts CSV
send <to> <msg>     — Send text message
send-file <to> <path> [caption] — Send file
messages <chat> [limit] — Read recent messages
search <query>      — Search contacts
disconnect          — Logout
```

### Agent Integration
- Agent uses *bash tool* to run CLI commands
- System prompt explains WhatsApp capability + CLI reference
- `skills/whatsapp-bridge.md` provides detailed command reference
- QR code sent to user via `send-file.ts`

### Porting Strategy
**Near-direct copy.** The WhatsApp module is self-contained with minimal imports:
- `logger` from `../../lib/logger.ts` → same path in Rachel9
- `env.SHARED_FOLDER_PATH` → same in Rachel9
- No dependency on Claude Agent SDK

Changes needed:
1. Copy `client.ts` and `cli.ts` to `src/whatsapp/`
2. Add `baileys@^7.0.0-rc.9` and `qrcode@^1.5.4` to package.json
3. Adapt imports (logger, env paths)
4. Add WhatsApp section to system prompt
5. Copy `skills/whatsapp-bridge.md` to `skills/`

---

## Part B: Skills System

### Rachel8 Skills: `/home/rachel/rachel8/skills/`

12 skills, each a directory with `SKILL.md` + optional resources:
```
algorithmic-art, canvas-design, docx, frontend-design,
mcp-builder, pdf, pptx, skill-creator, slack-gif-creator,
webapp-testing, web-artifacts-builder, xlsx
```

### SKILL.md Format
```yaml
---
name: skill-name
description: When to use this skill...
---

[Markdown instructions body]
```

### How Skills Work in Rachel8
- Claude Agent SDK auto-discovers skills in `skills/` directory
- Metadata (name + description) always in context
- Full SKILL.md loaded on-demand when skill triggers
- Scripts executed via bash tool without loading into context

### Porting Strategy for Rachel9

**Key difference:** Rachel9 uses pi-mono, not Claude Agent SDK. Pi-mono has `loadSkills()` in pi-coding-agent, but the skill format may differ.

**Decision: Hybrid approach.**
1. Copy skills directory as-is (preserving SKILL.md format)
2. Build a simple skill loader that reads SKILL.md frontmatter
3. Inject skill list (names + descriptions) into system prompt
4. Agent reads full SKILL.md on-demand via file tools when triggered

This is simpler than pi-coding-agent's `loadSkills()` and gives us full control. The skills are just markdown files — the agent reads them with file tools when needed.

### System Prompt Integration
Add a section listing skill names + descriptions:
```
## Available Skills
You have the following skills in the skills/ directory:
- pdf: Use for anything with PDF files...
- docx: Use for Word documents...
[etc.]
When a task matches a skill, read the full SKILL.md for instructions.
```

---

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Copy WhatsApp module nearly verbatim | Self-contained, battle-tested, no SDK dependency |
| Simple skill loader over pi-mono loadSkills() | Full control, simpler, skills are just markdown |
| Skill list in system prompt | Small overhead (~500 tokens), always available |
| Keep CLI-driven WhatsApp integration | Agent uses bash tool, no special tools needed |

---

## Implementation Plan

### Wave 1: WhatsApp Bridge
1. Install baileys + qrcode dependencies
2. Copy and adapt `client.ts` → `src/whatsapp/client.ts`
3. Copy and adapt `cli.ts` → `src/whatsapp/cli.ts`
4. Add WhatsApp section to system prompt

### Wave 2: Skills System
5. Copy skills directory from Rachel8
6. Create `src/lib/skills.ts` — skill loader (reads SKILL.md frontmatter)
7. Integrate skill list into system prompt (`system-prompt.ts`)
8. TypeScript check + verify
