# Rachel9 Stack Research — Bun + pi-mono Framework

**Research Date:** 2026-02-19
**Target:** Production-ready Telegram AI agent on pi-mono framework with Bun runtime

---

## Executive Summary

Rachel9 will use **pi-mono** (@mariozechner/pi-agent-core + @mariozechner/pi-ai) as the agent framework, replacing the Claude Agent SDK. This provides multi-provider LLM support, better agent architecture, and open-source flexibility. **Critical finding:** pi-mono packages are published as npm packages and work with Bun's npm compatibility layer. Use `bun add` for installation, not `npm install`.

**Key Compatibility Concerns:**
1. pi-mono uses TypeBox — fully compatible with Bun
2. SQLite: Use `bun:sqlite` (native, 3-6x faster) instead of better-sqlite3 (ABI compatibility issues with Bun)
3. Testing: Use Vitest (pi-mono's choice) running on Bun, not bun:test (lacks feature parity)
4. Bun aims for 100% Node.js compatibility but 34% of projects encounter edge cases — test thoroughly

---

## 1. pi-mono Packages

### 1.1 Core Packages & Versions

| Package | Latest Version | Purpose | Install Command |
|---------|---------------|---------|-----------------|
| `@mariozechner/pi-agent-core` | **0.53.0** | Agent runtime (state, tools, events) | `bun add @mariozechner/pi-agent-core` |
| `@mariozechner/pi-ai` | **0.52.12** | Multi-provider LLM API (20+ providers) | `bun add @mariozechner/pi-ai` |

**Installation Method:** Use `bun add` NOT `npm install`. Bun's package manager handles npm packages natively and is faster.

**Last Updated:** pi-agent-core 9 hours ago, pi-ai 4 days ago (as of 2026-02-19). Actively maintained.

### 1.2 How pi-mono Works

**Architecture Layers:**
```
@mariozechner/pi-agent-core   ← Agent loop, tool calling, state management
         ↓
@mariozechner/pi-ai           ← Unified LLM API (OpenAI, Anthropic, Google, etc.)
         ↓
Your Bot (Rachel9)            ← Telegram/WhatsApp integration, custom tools
```

**Key Features:**
- **Agent class** with proper state management (vs Claude SDK's opaque `query()`)
- **Event system** for streaming (turn_start, message_update, tool_execution, turn_end)
- **TypeBox schemas** for tool parameters (re-exported from @mariozechner/pi-ai)
- **Provider abstraction** — switch LLMs with config change, not code rewrite
- **Reference implementation:** `mom` Slack bot in pi-mono repo

### 1.3 TypeBox for Tool Schemas

pi-mono uses **@sinclair/typebox** for defining tool parameter schemas. TypeBox exports are re-exported from `@mariozechner/pi-ai`, so you don't need to install TypeBox separately.

**Example from pi-mono:**
```typescript
import { Type } from '@mariozechner/pi-ai'; // TypeBox re-exported

const BashTool = {
  name: 'bash',
  description: 'Execute bash command',
  parameters: Type.Object({
    command: Type.String({ description: 'The command to execute' })
  })
};
```

**Version:** TypeBox latest is **0.34.48** (if installing separately, but not needed).

---

## 2. Bun Compatibility with pi-mono

### 2.1 Module Resolution & npm Packages

**TL;DR:** pi-mono packages are npm packages. Bun handles them natively.

**How Bun handles npm packages:**
- Bun aims for **100% Node.js API compatibility**
- Supports CommonJS and ESM seamlessly
- `require()` works in both ESM and CJS modules
- Falls back to "module" → "main" for package resolution
- Supports `"bun"` export condition in package.json

**Install npm packages with Bun:**
```bash
bun add @mariozechner/pi-agent-core @mariozechner/pi-ai
```

**NOT:**
```bash
npm install @mariozechner/pi-agent-core  # Slower, uses npm
```

### 2.2 Known Compatibility Issues

**Reality Check (2026 data):**
- **34% of projects** encounter compatibility challenges with Bun
- Most issues are with native Node.js modules (C++ addons)
- Bun v1.2 and v1.3 addressed most common issues
- Production-ready since v1.0 (Sept 2023), currently at v1.3.9

**For Rachel9:**
- **grammY:** Works on Bun (framework supports Bun, Deno, Node)
- **Baileys:** Likely works (pure TS), but test thoroughly
- **pi-mono:** Works on Bun (pure TS/JS, no native modules)
- **bun:sqlite:** Native Bun module (recommended)
- **better-sqlite3:** ABI compatibility issues — DO NOT USE with Bun

### 2.3 TypeBox + Bun Compatibility

**Status:** Fully compatible.

**Evidence:**
- Elysia web framework (designed for Bun) uses TypeBox for validation
- TypeBox provides JSON Schema compatible type definitions
- No runtime conflicts with Bun
- TypeBox Schema works seamlessly in Bun-based TypeScript apps

**Recommendation:** Use TypeBox via pi-ai's re-exports. No separate installation needed.

---

## 3. Telegram: grammY

### 3.1 Version & Installation

| Package | Version | Command |
|---------|---------|---------|
| `grammy` | **1.40.0** | `bun add grammy` |
| `@grammyjs/auto-chat-action` | **0.1.1** | `bun add @grammyjs/auto-chat-action` |

**Last Published:** 7 days ago (as of 2026-02-19)

### 3.2 Breaking Changes

**v1.40.0 Changelog:** Not available in search results. Recommendation:
- Check [GitHub releases page](https://github.com/grammyjs/grammY/releases)
- Check [official docs](https://grammy.dev/)
- Rachel8 uses 1.40.0 successfully — likely backward-compatible

**Migration from v1.x to v2.x (future):**
- v2.0 roadmap exists ([Issue #675](https://github.com/grammyjs/grammY/issues/675))
- No breaking changes expected in 1.x minor versions
- Stick to 1.40.0 for Rachel9 initial release

### 3.3 Bun Compatibility

**Status:** Fully supported.

grammY officially supports **Bun, Deno, and Node.js**. No special configuration needed.

### 3.4 Recommended Setup

```typescript
import { Bot } from 'grammy';
import { autoChatAction } from '@grammyjs/auto-chat-action';

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
bot.use(autoChatAction());

// Works seamlessly on Bun
await bot.start();
```

---

## 4. WhatsApp: Baileys

### 4.1 Version & Installation

| Package | Version | Command |
|---------|---------|---------|
| `@whiskeysockets/baileys` | **7.0.0-rc.9** | `bun add @whiskeysockets/baileys` |

**Last Published:** 3 months ago (as of 2026-02-19)

### 4.2 Stability & Breaking Changes

**Current Status:**
- **v7.0.0** introduced multiple breaking changes
- Migration guide: https://whiskey.so/migrate-latest
- Still on release candidate (rc.9), not stable yet
- Original repo removed, development continues at [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys)
- Community-maintained, enterprise support available

**Risk Assessment:**
- **Unofficial library** — replicates WhatsApp Web protocol
- May break if WhatsApp updates their system
- No official WhatsApp API for web protocol
- Used successfully in Rachel8 with v7.0.0-rc.9

**Recommendation:** Pin to exact version `7.0.0-rc.9` in package.json. Monitor for updates.

### 4.3 Bun Compatibility

**Status:** Likely compatible (pure TypeScript, no native modules).

**Evidence:**
- Baileys is a WebSocket-based library (TS/JS only)
- No C++ bindings or native dependencies in core
- Rachel8 runs on Bun with Baileys successfully

**Testing Required:**
- QR code generation (qrcode library — works on Bun)
- WebSocket connections
- File uploads/downloads
- Group operations

---

## 5. Database: SQLite

### 5.1 CRITICAL: bun:sqlite vs better-sqlite3

| Feature | bun:sqlite | better-sqlite3 |
|---------|------------|----------------|
| **Speed** | 3-6x faster | Baseline |
| **Compatibility** | Bun only | Node.js (ABI issues with Bun) |
| **Installation** | Built-in (`import { Database } from 'bun:sqlite'`) | `npm install` required, native compilation |
| **API** | Inspired by better-sqlite3 | Original API |
| **Dependencies** | Zero | Requires Python, build tools |
| **Docker** | Works out of box | Requires build step |

### 5.2 Recommendation: Use bun:sqlite

**Reasons:**
1. **ABI incompatibility:** better-sqlite3 compiled for Node.js v131, Bun expects v127
2. **Performance:** 3-6x faster than better-sqlite3
3. **No dependencies:** No build step, works in Docker immediately
4. **Zero install:** Built into Bun runtime
5. **API similarity:** Inspired by better-sqlite3, easy migration

**Warning:** pi-mono packages might expect better-sqlite3 API. If pi-agent-core uses SQLite internally (for state persistence), check if it's hardcoded to better-sqlite3.

### 5.3 bun:sqlite Example

```typescript
import { Database } from 'bun:sqlite';

const db = new Database('rachel.db');

// Create tables
db.run(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task TEXT,
    due_date TEXT
  )
`);

// Insert
const insert = db.prepare('INSERT INTO tasks (task, due_date) VALUES (?, ?)');
insert.run('Call mom', '2026-02-20');

// Query
const query = db.prepare('SELECT * FROM tasks');
const tasks = query.all();
```

### 5.4 Migration Strategy

If pi-mono uses better-sqlite3 internally:
1. **Fork and patch** pi-mono to use bun:sqlite (unlikely to be needed)
2. **Adapter pattern** — create wrapper that matches better-sqlite3 API using bun:sqlite
3. **Check if pi-mono even uses SQLite** — it might be stateless

**Action:** Test pi-agent-core initialization. If it fails due to better-sqlite3, create adapter.

---

## 6. Speech-to-Text (STT)

### 6.1 Groq Whisper

| Package | Version | Command |
|---------|---------|---------|
| `groq-sdk` | **0.37.0** | `bun add groq-sdk` |

**Last Published:** 3 months ago

**Features:**
- **Speed:** 216x real-time transcription (Whisper Large v3 Turbo)
- **Models:** `whisper-large-v3`, `whisper-large-v3-turbo`
- **Free tier:** Available
- **Formats:** flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm

**Example:**
```typescript
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const transcription = await groq.audio.transcriptions.create({
  file: audioFileBuffer,
  model: 'whisper-large-v3-turbo',
  response_format: 'json'
});
```

### 6.2 OpenAI Whisper

| Package | Version | Command |
|---------|---------|---------|
| `openai` | **v4.103.x** | `bun add openai` |

**Models:**
- `whisper-1` (Whisper V2)
- `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`
- `gpt-4o-transcribe-diarize` (speaker separation)

**Example:**
```typescript
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const transcription = await openai.audio.transcriptions.create({
  file: audioFile,
  model: 'whisper-1'
});
```

### 6.3 Recommendation

**Primary:** Groq Whisper (faster, free, sufficient for most use cases)
**Fallback:** OpenAI Whisper (for diarization or better accuracy)

Both SDKs work on Bun (pure TS/JS, REST API clients).

---

## 7. Build Tooling: TypeScript + Bun

### 7.1 Recommended tsconfig.json

Bun provides official tsconfig recommendations. Use this for Rachel9:

```json
{
  "compilerOptions": {
    // Environment & Latest Features
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "preserve",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "allowJs": true,

    // Bundler Mode (Bun-specific)
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,

    // Best Practices
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,

    // Type Definitions
    "types": ["bun-types"]
  }
}
```

**Key Settings Explained:**
- `"module": "preserve"` — Let Bun handle ESM/CJS
- `"moduleResolution": "bundler"` — Use Bun's module resolution
- `"allowImportingTsExtensions": true` — Import `.ts` files directly
- `"noEmit": true` — Bun runs TS directly, no compilation needed
- `"types": ["bun-types"]` — Bun runtime type definitions

### 7.2 Install Bun Types

```bash
bun add -d @types/bun
```

### 7.3 TypeScript for pi-mono Compatibility

pi-mono packages ship with TypeScript types. No additional @types packages needed.

---

## 8. Testing: Bun Test vs Vitest

### 8.1 The Problem

**pi-mono uses Vitest** (seen in references to testing framework).
**Bun has its own test runner** (`bun:test`).

**Feature Comparison:**

| Feature | Vitest | bun:test |
|---------|--------|----------|
| **Speed** | Fast (Vite-based) | Faster (native Bun) |
| **API** | Jest-compatible | Jest-like, but incomplete |
| **Mocking** | Full support | Vitest-compatible mocking (new) |
| **Browser mode** | Yes | No |
| **Type testing** | Yes | No |
| **Fake timers** | Full | Incomplete |
| **Test isolation** | Full (per-suite) | No (global state leaks) |
| **IDE integration** | Excellent | Limited |

### 8.2 Recommendation: Vitest on Bun

**Rationale:**
1. **pi-mono uses Vitest** — consistency with upstream
2. **Feature parity** — Better test correctness (isolation, fake timers)
3. **Run on Bun runtime** — Get Bun's speed benefits
4. **Proven in production** — Frontend projects use Vitest + Bun successfully

**Setup:**
```bash
bun add -d vitest
```

**Run tests:**
```bash
bun run test  # NOT `bun test` (that runs bun:test)
```

**package.json:**
```json
{
  "scripts": {
    "test": "vitest"
  }
}
```

**Important:** Use `bun run test` to run Vitest, NOT `bun test` (which runs bun:test).

### 8.3 Why Not bun:test?

**Gaps (as of 2026):**
- No global state isolation (tests can affect each other)
- Incomplete fake timers (dealbreaker for scheduler tests)
- Limited IDE support vs Vitest

**When to use bun:test:**
- Simple unit tests with no mocking/timers
- Maximizing speed for CI/CD
- No frontend testing needs

For Rachel9: Stick with **Vitest** for robustness.

---

## 9. Docker Deployment

### 9.1 Bun Docker Best Practices

**Official Bun Docker Image:**
```dockerfile
FROM oven/bun:1.3.9-alpine AS base
```

**Multi-Stage Build (Recommended):**
```dockerfile
# Build stage
FROM oven/bun:1.3.9 AS build
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .

# Production stage
FROM oven/bun:1.3.9-alpine AS production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./

# Run as non-root user
USER bun
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
```

### 9.2 Key Practices for Rachel Cloud

1. **Use Alpine base** for smaller images
2. **Multi-stage builds** (build deps ≠ runtime deps)
3. **Non-root user** (`USER bun`)
4. **Health checks:**
   ```dockerfile
   HEALTHCHECK --interval=30s --timeout=3s \
     CMD curl -f http://localhost:3000/health || exit 1
   ```
5. **Graceful shutdown** (handle SIGTERM/SIGINT)
6. **Environment variables** for config (never hardcode secrets)

### 9.3 Rachel Cloud Specifics

**Deployment Modes:**
- **Standalone:** Polling mode, no webhook needed
- **Cloud:** Webhook mode, multi-tenant routing

**Docker Environment Variables:**
```bash
TELEGRAM_BOT_TOKEN=xxx
RACHEL_CLOUD_MODE=webhook  # or 'polling'
RACHEL_CLOUD_WEBHOOK_URL=https://cloud.example.com/webhook/rachel9
```

**Persistent Storage:**
- Mount `/app/data` for SQLite DB
- Mount `/app/MEMORY.md` and `/app/context/` for memory persistence

---

## 10. Specific Dependency Versions — Full Stack

### 10.1 Core Dependencies

```json
{
  "dependencies": {
    "@mariozechner/pi-agent-core": "0.53.0",
    "@mariozechner/pi-ai": "0.52.12",
    "grammy": "1.40.0",
    "@grammyjs/auto-chat-action": "0.1.1",
    "@whiskeysockets/baileys": "7.0.0-rc.9",
    "groq-sdk": "0.37.0",
    "openai": "^4.103.0",
    "qrcode": "^1.5.4",
    "zod": "^4.3.6"
  }
}
```

**Notes:**
- **Pin pi-mono versions** to exact versions (no `^`)
- **Baileys:** Pin to exact rc.9 (unstable)
- **openai:** Use caret for patch updates
- **zod:** Validation library (used by Rachel8, keep)

### 10.2 Dev Dependencies

```json
{
  "devDependencies": {
    "@types/bun": "latest",
    "@types/qrcode": "^1.5.6",
    "vitest": "^2.1.0"
  }
}
```

**Notes:**
- **@types/bun:** Always use `latest` (Bun updates frequently)
- **vitest:** Use latest stable (currently 2.x series)

### 10.3 NOT NEEDED (Built into Bun)

- **TypeScript:** Bun includes tsc
- **better-sqlite3:** Use `bun:sqlite` instead
- **tsx/ts-node:** Bun runs `.ts` files natively
- **nodemon:** Use `bun --watch`

### 10.4 Installation Command

```bash
bun add @mariozechner/pi-agent-core@0.53.0 \
        @mariozechner/pi-ai@0.52.12 \
        grammy@1.40.0 \
        @grammyjs/auto-chat-action@0.1.1 \
        @whiskeysockets/baileys@7.0.0-rc.9 \
        groq-sdk@0.37.0 \
        openai \
        qrcode \
        zod

bun add -d @types/bun@latest \
           @types/qrcode \
           vitest
```

---

## 11. Critical Warnings & Gotchas

### 11.1 SQLite: bun:sqlite vs better-sqlite3

**DO:**
```typescript
import { Database } from 'bun:sqlite';
```

**DO NOT:**
```typescript
import Database from 'better-sqlite3'; // ABI mismatch!
```

**If pi-mono requires better-sqlite3:**
1. Check if it's actually needed (might be stateless)
2. Create adapter wrapper using bun:sqlite
3. File issue on pi-mono repo

### 11.2 Testing: bun test vs bun run test

**DO:**
```bash
bun run test  # Runs Vitest
```

**DO NOT:**
```bash
bun test  # Runs bun:test (different runner!)
```

### 11.3 Package Manager: Use bun add

**DO:**
```bash
bun add grammy
```

**DO NOT:**
```bash
npm install grammy  # Slower, creates package-lock.json
```

Bun uses `bun.lockb`, npm uses `package-lock.json`. Don't mix.

### 11.4 Baileys Stability

- **v7.0.0 is still release candidate** (rc.9)
- Pin to exact version: `"@whiskeysockets/baileys": "7.0.0-rc.9"`
- Monitor [releases page](https://github.com/WhiskeySockets/Baileys/releases)
- WhatsApp may break unofficial clients anytime

### 11.5 TypeScript: No Compilation Needed

Bun runs `.ts` files directly. Do NOT:
- Run `tsc` to compile
- Use `tsx` or `ts-node`
- Build to `dist/` folder

Just:
```bash
bun run src/index.ts  # Runs TS directly
```

---

## 12. Migration from Rachel8

### 12.1 What Changes

| Component | Rachel8 | Rachel9 | Migration Effort |
|-----------|---------|---------|------------------|
| Agent SDK | `@anthropic-ai/claude-agent-sdk` | `@mariozechner/pi-agent-core` | **HIGH** (full rewrite) |
| LLM API | Claude-only | Multi-provider (pi-ai) | **HIGH** (new abstraction) |
| Telegram | grammY 1.40.0 | grammY 1.40.0 | **LOW** (same version) |
| WhatsApp | Baileys 7.0.0-rc.9 | Baileys 7.0.0-rc.9 | **LOW** (same version) |
| Database | bun:sqlite | bun:sqlite | **ZERO** (no change) |
| STT | Groq + OpenAI | Groq + OpenAI | **ZERO** (no change) |
| Memory | File-based | File-based | **ZERO** (backward-compatible) |
| Skills | 12 skills | Port all 12 | **MEDIUM** (tool API differs) |

### 12.2 What Stays the Same

- **Bun runtime** — no change
- **grammY version** — exact same
- **Baileys version** — exact same
- **bun:sqlite** — no change
- **Zod** — same validation library
- **Memory files** — MEMORY.md, context/, daily-logs/ (format unchanged)

### 12.3 What Requires Rewrite

**Agent SDK Integration:**
- Replace `agent.query()` with `new Agent()` and event subscriptions
- Rewrite tool definitions using TypeBox (from Claude SDK's format)
- Implement streaming via agent events (`message_update`)

**LLM Configuration:**
- Add provider config (Z.ai, Claude, GPT, etc.)
- Use pi-ai's unified API instead of Claude SDK

**Skills:**
- Port 12 skills to pi-mono's tool format
- Update tool schemas (TypeBox instead of Claude SDK format)

---

## 13. Testing Strategy

### 13.1 Unit Tests (Vitest)

**What to test:**
- Tool functions (bash, file read/write, web search)
- Memory persistence (MEMORY.md, context/)
- Task scheduler (SQLite operations, cron parsing)
- Telegram utilities (file download, Markdown parsing)

**Example:**
```typescript
import { describe, it, expect } from 'vitest';
import { Database } from 'bun:sqlite';

describe('Task Scheduler', () => {
  it('should create task', () => {
    const db = new Database(':memory:');
    db.run('CREATE TABLE tasks (id INTEGER PRIMARY KEY, task TEXT)');
    db.run('INSERT INTO tasks (task) VALUES (?)', ['Test task']);

    const tasks = db.prepare('SELECT * FROM tasks').all();
    expect(tasks).toHaveLength(1);
  });
});
```

### 13.2 Integration Tests

**Test areas:**
1. **pi-agent-core initialization** — Can Agent be created?
2. **Tool calling** — Can agent execute bash tool?
3. **Streaming** — Do message_update events fire?
4. **Telegram message handling** — Does bot.on('message') work?
5. **WhatsApp connection** — Does Baileys QR code work?
6. **SQLite persistence** — Does bun:sqlite save data?

### 13.3 Docker Tests

**Verify:**
- Image builds successfully
- Container starts without errors
- Health check endpoint responds
- Telegram polling works in container
- Webhook mode works with ngrok/test URL
- Volume mounts persist data

**Command:**
```bash
docker build -t rachel9 .
docker run --rm -e TELEGRAM_BOT_TOKEN=xxx rachel9
```

---

## 14. Open Questions & Action Items

### 14.1 Questions Requiring Testing

1. **Does pi-agent-core use better-sqlite3 internally?**
   - Action: Initialize Agent and check for better-sqlite3 errors
   - Mitigation: Create adapter or fork if needed

2. **Do Baileys and grammY work together without conflicts?**
   - Action: Run both in same process, test for WebSocket conflicts

3. **Can pi-ai switch providers at runtime?**
   - Action: Test provider switching (Z.ai → Claude → GPT)

4. **Does streaming work with Telegram message editing?**
   - Action: Subscribe to agent message_update events, edit Telegram message

### 14.2 Documentation to Review

1. [pi-mono GitHub](https://github.com/badlogic/pi-mono) — Read full docs
2. [pi-mono mom bot](https://github.com/badlogic/pi-mono/tree/main/packages/mom) — Reference implementation
3. [Baileys v7 migration guide](https://whiskey.so/migrate-latest)
4. [grammY docs](https://grammy.dev/)
5. [Bun Docker guide](https://bun.com/docs/guides/ecosystem/docker)

### 14.3 Risks to Monitor

1. **Baileys stability** — WhatsApp may break unofficial clients
2. **pi-mono maintenance** — Project freeze until Feb 23, 2026
3. **Bun 34% compatibility issue** — Test edge cases thoroughly
4. **better-sqlite3 dependency** — If pi-mono requires it, major blocker

---

## 15. Final Recommendations

### 15.1 Package Versions (Exact)

```json
{
  "name": "rachel9",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@mariozechner/pi-agent-core": "0.53.0",
    "@mariozechner/pi-ai": "0.52.12",
    "grammy": "1.40.0",
    "@grammyjs/auto-chat-action": "0.1.1",
    "@whiskeysockets/baileys": "7.0.0-rc.9",
    "groq-sdk": "0.37.0",
    "openai": "^4.103.0",
    "qrcode": "^1.5.4",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/qrcode": "^1.5.6",
    "vitest": "^2.1.0"
  }
}
```

### 15.2 Installation Commands

```bash
# Core dependencies
bun add @mariozechner/pi-agent-core@0.53.0
bun add @mariozechner/pi-ai@0.52.12
bun add grammy@1.40.0
bun add @grammyjs/auto-chat-action@0.1.1
bun add @whiskeysockets/baileys@7.0.0-rc.9
bun add groq-sdk@0.37.0
bun add openai
bun add qrcode
bun add zod

# Dev dependencies
bun add -d @types/bun@latest
bun add -d @types/qrcode
bun add -d vitest
```

### 15.3 tsconfig.json (Copy-Paste Ready)

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "preserve",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "allowJs": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "types": ["bun-types"]
  }
}
```

### 15.4 Dockerfile (Production-Ready)

```dockerfile
FROM oven/bun:1.3.9 AS build
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .

FROM oven/bun:1.3.9-alpine AS production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./
USER bun
CMD ["bun", "run", "src/index.ts"]
```

### 15.5 Next Steps

1. **Initialize Rachel9 project:**
   ```bash
   cd /home/rachel/rachel9
   bun init
   ```

2. **Install dependencies** (use commands above)

3. **Copy tsconfig.json** (paste from 15.3)

4. **Create src/index.ts** with basic pi-agent-core test:
   ```typescript
   import { Agent } from '@mariozechner/pi-agent-core';
   import { Bot } from 'grammy';

   console.log('Rachel9 starting...');
   // Test imports work
   ```

5. **Test Bun execution:**
   ```bash
   bun run src/index.ts
   ```

6. **Read pi-mono docs** and implement Agent initialization

7. **Port Rachel8 tools** to TypeBox format

8. **Test SQLite** with bun:sqlite

9. **Docker test** with provided Dockerfile

---

## Sources

- [pi-mono GitHub](https://github.com/badlogic/pi-mono)
- [@mariozechner/pi-agent-core npm](https://www.npmjs.com/package/@mariozechner/pi-agent-core)
- [@mariozechner/pi-ai npm](https://www.npmjs.com/package/@mariozechner/pi-ai)
- [Bun Module Resolution](https://bun.com/docs/runtime/module-resolution)
- [Bun Package Manager](https://bun.com/package-manager)
- [Bun Package Manager Reality Check 2026](https://vocal.media/01/bun-package-manager-reality-check-2026)
- [grammY GitHub](https://github.com/grammyjs/grammY)
- [grammY npm](https://www.npmjs.com/package/grammy)
- [Baileys GitHub](https://github.com/WhiskeySockets/Baileys)
- [Baileys npm](https://www.npmjs.com/package/@whiskeysockets/baileys)
- [Bun SQLite Docs](https://bun.com/docs/runtime/sqlite)
- [bun:sqlite vs better-sqlite3 Discussion](https://github.com/WiseLibs/better-sqlite3/discussions/1057)
- [TypeBox npm](https://www.npmjs.com/package/@sinclair/typebox)
- [Bun TypeScript Config](https://bun.com/docs/typescript)
- [Bun Docker Guide](https://bun.com/docs/guides/ecosystem/docker)
- [Docker Bun Deployment](https://oneuptime.com/blog/post/2026-01-31-bun-production-deployment/view)
- [Vitest on Bun](https://github.com/vitest-dev/vscode/discussions/473)
- [Groq SDK npm](https://www.npmjs.com/package/groq-sdk)
- [Groq Whisper Docs](https://console.groq.com/docs/speech-to-text)
- [OpenAI npm](https://www.npmjs.com/package/openai)
- [Node.js Compatibility - Bun](https://bun.com/docs/runtime/nodejs-compat)

**Research completed:** 2026-02-19
**Researcher:** Claude Sonnet 4.5 (rachel8 codebase analysis + web research)
