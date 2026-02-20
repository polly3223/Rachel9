# Plan 02: Task Scheduler (Wave 1)

Covers: TASK-01 through TASK-09

## Step 1: Migrate tasks table in `src/lib/database.ts`

Add `cron` column and type CHECK constraint:

```typescript
// After existing tasks table creation, add migration:
db.exec(`
  ALTER TABLE tasks ADD COLUMN cron TEXT
`);
// Wrap in try/catch — ALTER fails silently if column already exists
```

Also add the type CHECK (can't alter CHECK constraints, so validate in code).

## Step 2: Create `src/lib/tasks.ts`

Complete task scheduler module. Exports:

```typescript
// Types
export interface TaskRow {
  id: number;
  name: string;
  type: "bash" | "reminder" | "cleanup" | "agent";
  data: string; // JSON
  cron: string | null;
  next_run: number; // ms epoch
  enabled: number; // 0 or 1
  created_at: number;
}

// Cron helpers
function parseCronField(field: string, max: number): number[]
function getNextCronRun(pattern: string, after?: number): number

// Task execution
async function executeTask(task: TaskRow): Promise<void>

// CRUD
export function addTask(
  name: string,
  type: TaskRow["type"],
  data: Record<string, unknown>,
  options?: { cron?: string; delayMs?: number },
): void

export function removeTask(name: string): void
export function listTasks(): TaskRow[]

// Lifecycle
export function setTelegramSender(sender: (text: string) => Promise<void>): void
export function setAgentExecutor(executor: (prompt: string) => Promise<string>): void
export function startTaskPoller(): void
export function shutdownTasks(): void
```

Key implementation details:
- Uses `db` from `database.ts` (shared database, not separate)
- Polling: `setInterval(pollTasks, 30_000)`
- Bash: `Bun.$\`sh -c ${command}\``
- Reminder: `sendTelegramMessage(message)`
- Cleanup: `$\`pkill -f ${target}\`.quiet()`
- Agent: `agentExecutor(prompt)` → `sendTelegramMessage(result)`, send error on failure too
- Cron: simple parser (*, value, comma, step — no ranges)
- One-off: `next_run = Date.now() + delayMs`, disabled after run

## Step 3: Wire into `src/index.ts`

```typescript
import { setTelegramSender, setAgentExecutor, startTaskPoller, shutdownTasks } from "./lib/tasks.ts";
import { agentPrompt } from "./agent/index.ts";

// After initAgentSystem():
setTelegramSender(async (text: string) => {
  await bot.api.sendMessage(env.OWNER_TELEGRAM_USER_ID, text);
});

setAgentExecutor(async (prompt: string) => {
  const result = await agentPrompt(env.OWNER_TELEGRAM_USER_ID, prompt);
  return result.response;
});

startTaskPoller();

// In shutdown():
shutdownTasks();
```

## Verification

1. `bun run typecheck` passes
2. Add a test task via code: `addTask("test", "reminder", { message: "Hello" }, { delayMs: 5000 })`
3. Verify it fires within ~35 seconds
4. `listTasks()` returns active tasks
5. `removeTask("test")` removes it
