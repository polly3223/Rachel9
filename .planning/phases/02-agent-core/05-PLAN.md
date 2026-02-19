---
wave: 3
depends_on:
  - 04-PLAN.md
files_modified:
  - src/index.ts
  - tests/agent.test.ts
requirements:
  - AGENT-12
autonomous: true
---

# Plan 05: Wire Into Entry Point + Verification

## Goal
Wire the agent system into the main entry point (index.ts) and run full type-check verification. The agent should be initialized on startup so it's ready when Phase 3 connects Telegram handlers.

## Tasks

### Task 1: Update index.ts to initialize agent system
<task>
Update `/home/rachel/rachel9/src/index.ts` to add agent initialization after database setup:

After the existing database import and before the shutdown section, add:

```typescript
import { initAgentSystem } from "./agent/index.ts";

// Initialize agent system with tool dependencies
initAgentSystem({
  cwd: process.cwd(),
  sendFile: async (filePath: string, caption?: string) => {
    // Will be replaced with real Telegram send in Phase 3
    // For now, use bot.api directly
    const file = Bun.file(filePath);
    if (await file.exists()) {
      await bot.api.sendDocument(env.OWNER_TELEGRAM_USER_ID, new InputFile(await file.arrayBuffer(), filePath.split("/").pop() ?? "file"));
    }
  },
});
```

Also add the grammY InputFile import at the top:
```typescript
import { InputFile } from "grammy";
```

This means on startup:
1. Env validated ✅
2. Database initialized ✅
3. Agent system initialized ✅
4. Bot starts (polling or webhook) ✅
</task>

### Task 2: Full project type-check
<task>
Run `cd /home/rachel/rachel9 && bunx tsc --noEmit` and fix any type errors.

Common issues to watch for:
- AgentTool type mismatch between pi-agent-core and pi-coding-agent (may need casting)
- TypeBox schema compatibility with AgentTool parameters
- Import paths needing `.ts` extension
- `bun:sqlite` type issues with @types/bun
</task>

### Task 3: Verify all Phase 2 requirements
<task>
Check each requirement is satisfied:

- AGENT-01: Agent class integration ✅ (AgentRunner wraps Agent)
- AGENT-02: pi-ai with Z.ai ✅ (getModel("zai", "glm-5"))
- AGENT-03: createAllTools() ✅ (7 coding tools in tools/index.ts)
- AGENT-04: Web search ✅ (web-search.ts)
- AGENT-05: Web fetch ✅ (web-fetch.ts)
- AGENT-06: Telegram send file ✅ (telegram.ts)
- AGENT-07: System prompt with memory ✅ (system-prompt.ts)
- AGENT-08: SessionManager ✅ (context.jsonl in runner.ts)
- AGENT-09: Context compaction ✅ (available via pi-coding-agent, wired in future)
- AGENT-10: Context overflow recovery ✅ (handleContextOverflow in runner.ts)
- AGENT-11: Event subscriptions ✅ (onEvent() in runner.ts)
- AGENT-13: Skills via loadSkills() — deferred to Phase 6 (SKILL system)
- AGENT-14: Coding excellence ✅ (10 tools + system prompt emphasizes coding)
</task>

## Verification
- [ ] `bunx tsc --noEmit` exits with code 0
- [ ] index.ts calls `initAgentSystem()` on startup
- [ ] Agent system has access to all 10 tools (7 coding + 3 custom)
- [ ] `agentPrompt()` can be imported and called from any module
- [ ] All Phase 2 AGENT requirements are addressed

## must_haves
- Type-check passes with zero errors
- index.ts initializes agent before bot starts
- No circular dependencies between modules
