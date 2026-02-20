import { db } from "./database.ts";
import { logger } from "./logger.ts";
import { errorMessage } from "./errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskRow {
  id: number;
  name: string;
  type: "bash" | "reminder" | "cleanup" | "agent";
  data: string;
  cron: string | null;
  next_run: number;
  enabled: number;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Callback injection (set from index.ts to avoid circular deps)
// ---------------------------------------------------------------------------

let telegramSender: ((text: string) => Promise<void>) | null = null;
let agentExecutor: ((prompt: string) => Promise<string>) | null = null;

export function setTelegramSender(sender: (text: string) => Promise<void>): void {
  telegramSender = sender;
}

export function setAgentExecutor(executor: (prompt: string) => Promise<string>): void {
  agentExecutor = executor;
}

// ---------------------------------------------------------------------------
// Cron parser (simple: *, value, comma, step — no ranges)
// ---------------------------------------------------------------------------

function parseCronField(field: string, max: number): number[] {
  if (field === "*") {
    return Array.from({ length: max }, (_, i) => i);
  }

  // Step: */5
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step <= 0) return [0];
    return Array.from({ length: max }, (_, i) => i).filter((i) => i % step === 0);
  }

  // Comma-separated: 1,5,10
  return field.split(",").map((v) => parseInt(v.trim(), 10)).filter((v) => !isNaN(v) && v >= 0 && v < max);
}

/**
 * Get next run time for a cron pattern (minute hour dom month dow).
 * Uses UTC. Returns ms epoch.
 */
export function getNextCronRun(pattern: string, after?: number): number {
  const parts = pattern.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron pattern: "${pattern}" — expected 5 fields`);
  }

  const [minField, hourField, domField, monField, dowField] = parts as [string, string, string, string, string];
  const minutes = parseCronField(minField, 60);
  const hours = parseCronField(hourField, 24);
  const doms = parseCronField(domField, 32).map((d) => (d === 0 ? 1 : d)); // day 0 → 1
  const months = parseCronField(monField, 13).filter((m) => m >= 1); // months 1-12
  const dows = parseCronField(dowField, 7); // 0=Sunday

  const start = new Date(after ?? Date.now());
  // Start searching from next minute
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);

  // Search up to 366 days ahead
  const limit = 366 * 24 * 60;
  for (let i = 0; i < limit; i++) {
    const candidate = new Date(start.getTime() + i * 60_000);
    const m = candidate.getUTCMinutes();
    const h = candidate.getUTCHours();
    const dom = candidate.getUTCDate();
    const mon = candidate.getUTCMonth() + 1;
    const dow = candidate.getUTCDay();

    if (
      minutes.includes(m) &&
      hours.includes(h) &&
      (doms.includes(dom) || domField === "*") &&
      (months.includes(mon) || monField === "*") &&
      (dows.includes(dow) || dowField === "*")
    ) {
      return candidate.getTime();
    }
  }

  // Fallback: 24h from now
  return Date.now() + 86_400_000;
}

// ---------------------------------------------------------------------------
// Task execution
// ---------------------------------------------------------------------------

async function executeTask(task: TaskRow): Promise<void> {
  const data = JSON.parse(task.data) as Record<string, unknown>;

  switch (task.type) {
    case "bash": {
      const command = String(data["command"] ?? "echo 'no command'");
      logger.info("Executing bash task", { name: task.name, command });
      try {
        const proc = Bun.spawn(["sh", "-c", command], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const exitCode = await proc.exited;
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        if (exitCode !== 0) {
          logger.warn("Bash task non-zero exit", { name: task.name, exitCode, stderr: stderr.slice(0, 500) });
        } else {
          logger.debug("Bash task completed", { name: task.name, stdout: stdout.slice(0, 200) });
        }
      } catch (err) {
        logger.error("Bash task failed", { name: task.name, error: errorMessage(err) });
      }
      break;
    }

    case "reminder": {
      const message = String(data["message"] ?? "Reminder!");
      logger.info("Sending reminder", { name: task.name });
      if (telegramSender) {
        await telegramSender(message);
      } else {
        logger.warn("No Telegram sender registered for reminder task");
      }
      break;
    }

    case "cleanup": {
      const targets = (data["targets"] as string[] | undefined) ?? [];
      logger.info("Running cleanup task", { name: task.name, targets });
      for (const target of targets) {
        try {
          Bun.spawn(["pkill", "-f", target], { stdout: "ignore", stderr: "ignore" });
        } catch {
          // pkill returns non-zero if no processes matched — ignore
        }
      }
      break;
    }

    case "agent": {
      const prompt = String(data["prompt"] ?? "Hello");
      logger.info("Executing agent task", { name: task.name });
      if (!agentExecutor) {
        logger.warn("No agent executor registered for agent task");
        break;
      }
      try {
        const result = await agentExecutor(prompt);
        if (telegramSender && result) {
          // Truncate if too long for Telegram
          const truncated = result.length > 4000 ? result.slice(0, 4000) + "\n\n...(truncated)" : result;
          await telegramSender(truncated);
        }
      } catch (err) {
        logger.error("Agent task failed", { name: task.name, error: errorMessage(err) });
        if (telegramSender) {
          await telegramSender(`⚠️ Agent task "${task.name}" failed: ${errorMessage(err)}`);
        }
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Polling loop
// ---------------------------------------------------------------------------

let pollInterval: ReturnType<typeof setInterval> | null = null;

const POLL_INTERVAL_MS = 30_000;

async function pollTasks(): Promise<void> {
  try {
    const now = Date.now();
    const dueTasks = db.query<TaskRow, [number]>(
      "SELECT * FROM tasks WHERE enabled = 1 AND next_run <= ?",
    ).all(now);

    for (const task of dueTasks) {
      try {
        await executeTask(task);

        if (task.cron) {
          // Recurring: compute next run
          const nextRun = getNextCronRun(task.cron, now);
          db.run("UPDATE tasks SET next_run = ? WHERE id = ?", [nextRun, task.id]);
          logger.debug("Rescheduled cron task", { name: task.name, nextRun: new Date(nextRun).toISOString() });
        } else {
          // One-off: disable
          db.run("UPDATE tasks SET enabled = 0 WHERE id = ?", [task.id]);
          logger.debug("Disabled one-off task", { name: task.name });
        }
      } catch (err) {
        logger.error("Task execution error", { taskId: task.id, name: task.name, error: errorMessage(err) });
      }
    }
  } catch (err) {
    logger.error("Task poll error", { error: errorMessage(err) });
  }
}

// ---------------------------------------------------------------------------
// CRUD API
// ---------------------------------------------------------------------------

export function addTask(
  name: string,
  type: TaskRow["type"],
  data: Record<string, unknown>,
  options?: { cron?: string; delayMs?: number },
): void {
  const cron = options?.cron ?? null;
  const nextRun = cron
    ? getNextCronRun(cron)
    : Date.now() + (options?.delayMs ?? 0);

  db.run(
    "INSERT INTO tasks (name, type, data, cron, next_run) VALUES (?, ?, ?, ?, ?)",
    [name, type, JSON.stringify(data), cron, nextRun],
  );

  logger.info("Task added", { name, type, cron, nextRun: new Date(nextRun).toISOString() });
}

export function removeTask(name: string): void {
  const result = db.run("DELETE FROM tasks WHERE name = ?", [name]);
  logger.info("Task removed", { name, deleted: result.changes });
}

export function listTasks(): TaskRow[] {
  return db.query<TaskRow, []>("SELECT * FROM tasks WHERE enabled = 1 ORDER BY next_run ASC").all();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function startTaskPoller(): void {
  // Run once immediately, then every 30s
  void pollTasks();
  pollInterval = setInterval(() => void pollTasks(), POLL_INTERVAL_MS);
  logger.info("Task poller started", { intervalMs: POLL_INTERVAL_MS });
}

export function shutdownTasks(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    logger.info("Task poller stopped");
  }
}
