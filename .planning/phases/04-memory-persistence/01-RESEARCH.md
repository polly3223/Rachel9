# Phase 4: Memory & Persistence — Research

## Scope Analysis

Phase 4 has 8 requirements: MEM-01 through MEM-06, AGENT-11, AGENT-12.

### Already Implemented (from earlier phases)

| Requirement | Status | Where |
|-------------|--------|-------|
| MEM-01: MEMORY.md loading | ✅ Done | `src/agent/system-prompt.ts` — `loadCoreMemory()` reads from `$SHARED/rachel-memory/MEMORY.md`, injected every query via `buildSystemPrompt()` |
| MEM-02: MEMORY.md writing | ✅ Done | Agent has file write tool from pi-coding-agent — can directly write MEMORY.md |
| MEM-04: Context files | ✅ Done | Agent has file read/write tools — can access `$SHARED/rachel-memory/context/*.md` |
| AGENT-08: SessionManager | ✅ Done | `src/agent/runner.ts` — sessions at `$SHARED/rachel9/sessions/<chatId>/context.jsonl` |
| AGENT-10: Context overflow | ✅ Done | `runner.ts` — `isContextOverflow()` + `handleContextOverflow()` with fresh session retry |
| AGENT-11: Agent events | ✅ Done | `runner.ts` — event subscription via `agent.subscribe()` forwarded to `eventCallbacks` |
| AGENT-12: Multi-turn | ✅ Done | `runner.ts` — `buildSessionContext()` loads previous messages on startup, `persistSession()` saves new ones |

### Still Needed

| Requirement | Description | Priority |
|-------------|-------------|----------|
| MEM-03: Daily logs | Auto-append user + assistant messages to `daily-logs/YYYY-MM-DD.md` | High — important for memory recall |
| MEM-05: Memory dir init | Create `rachel-memory/`, `daily-logs/`, `context/` on startup | High — prevents first-run errors |
| MEM-06: Backward compat | Use same paths as Rachel8 (`$SHARED/rachel-memory/`) so existing memory works | High — already using correct paths! |

## Rachel8 Reference Implementation

### File: `/home/rachel/rachel8/src/lib/memory.ts`

Key patterns to replicate:

1. **Memory paths** — identical to what Rachel9 already uses:
   ```
   MEMORY_BASE = $SHARED_FOLDER_PATH/rachel-memory
   CORE_MEMORY_FILE = MEMORY_BASE/MEMORY.md
   DAILY_LOGS_DIR = MEMORY_BASE/daily-logs
   CONTEXT_DIR = MEMORY_BASE/context
   ```

2. **initializeMemorySystem()** — creates directories with `mkdir({ recursive: true })`:
   ```typescript
   await mkdir(MEMORY_BASE, { recursive: true });
   await mkdir(DAILY_LOGS_DIR, { recursive: true });
   await mkdir(CONTEXT_DIR, { recursive: true });
   ```

3. **appendToDailyLog(role, message)** — format:
   ```markdown
   ## [2026-02-20T14:30:00.000Z] User
   the user message

   ## [2026-02-20T14:30:05.000Z] Rachel
   the assistant response
   ```
   - Creates file with header if it doesn't exist
   - Appends entry otherwise
   - File name: `YYYY-MM-DD.md`

4. **Log path**: `daily-logs/${new Date().toISOString().split('T')[0]}.md`

## Architecture Decision

### Where to put the memory module?

Option A: `src/lib/memory.ts` (matches Rachel8)
Option B: `src/agent/memory.ts` (alongside system-prompt.ts)

**Decision: Option A** — `src/lib/memory.ts`. The memory system is infrastructure, not agent-specific. It could be used by the task scheduler, self-management, etc. Matches Rachel8 for easy comparison.

### Who calls appendToDailyLog?

Option A: Message handler (telegram layer) calls it directly
Option B: Agent runner calls it after prompt completes

**Decision: Option A** — The message handler in `src/telegram/handlers/message.ts` is the natural place. It has the raw user text and the final response. The agent runner shouldn't know about daily logs — it's a transport concern.

### MEM-06: Backward Compatibility

Rachel9 already uses `$SHARED_FOLDER_PATH/rachel-memory/MEMORY.md` for loading — this is the exact same path as Rachel8. The agent's file tools can read/write anywhere. So backward compatibility is already achieved just by using the same path conventions. The memory init function just needs to ensure the directories exist.

## Implementation Plan

Only 2 files need to be created/modified:

1. **NEW: `src/lib/memory.ts`** — Memory module with:
   - Path constants (MEMORY_BASE, DAILY_LOGS_DIR, CONTEXT_DIR)
   - `initializeMemorySystem()` — creates directories
   - `appendToDailyLog(role, message)` — appends to daily log

2. **MODIFY: `src/index.ts`** — Call `initializeMemorySystem()` on startup

3. **MODIFY: `src/telegram/handlers/message.ts`** — Call `appendToDailyLog()` for user input and assistant response

This is a small, focused phase since most requirements were already satisfied in Phases 1-3.
