interface ActiveToolState {
  name: string;
  startedAt: number;
}

interface ActiveTurnState {
  chatId: number;
  startedAt: number;
  lastEventAt: number;
  textLength: number;
  activeTool?: ActiveToolState;
}

export interface RuntimeHealth {
  status: "ok" | "degraded";
  uptimeSeconds: number;
  thresholds: {
    agentStaleMs: number;
    toolStaleMs: number;
  };
  activeTurns: Array<{
    chatId: number;
    durationMs: number;
    idleMs: number;
    textLength: number;
    activeTool?: {
      name: string;
      durationMs: number;
    };
  }>;
  staleTurns: Array<{
    chatId: number;
    durationMs: number;
    idleMs: number;
    reason: string;
    activeTool?: {
      name: string;
      durationMs: number;
    };
  }>;
  lastCompletedAt: string | null;
  lastError: string | null;
}

const AGENT_STALE_MS = Number(Bun.env["AGENT_STALE_MS"] ?? 20 * 60_000);
const TOOL_STALE_MS = Number(Bun.env["TOOL_STALE_MS"] ?? 10 * 60_000);

const activeTurns = new Map<number, ActiveTurnState>();
let lastCompletedAt: number | null = null;
let lastError: string | null = null;

export function markAgentPromptStarted(chatId: number, textLength: number): void {
  const now = Date.now();
  activeTurns.set(chatId, {
    chatId,
    startedAt: now,
    lastEventAt: now,
    textLength,
  });
}

export function markAgentPromptEnded(chatId: number, error?: string): void {
  activeTurns.delete(chatId);
  lastCompletedAt = Date.now();
  if (error) {
    lastError = error;
  }
}

export function markToolStarted(chatId: number, toolName: string): void {
  const now = Date.now();
  const turn = activeTurns.get(chatId);
  if (!turn) return;
  turn.lastEventAt = now;
  turn.activeTool = { name: toolName, startedAt: now };
}

export function markToolEnded(chatId: number): void {
  const turn = activeTurns.get(chatId);
  if (!turn) return;
  turn.lastEventAt = Date.now();
  delete turn.activeTool;
}

export function getRuntimeHealth(now = Date.now()): RuntimeHealth {
  const active = [...activeTurns.values()].map((turn) => {
    const activeTool = turn.activeTool
      ? {
          name: turn.activeTool.name,
          durationMs: now - turn.activeTool.startedAt,
        }
      : undefined;

    return {
      chatId: turn.chatId,
      durationMs: now - turn.startedAt,
      idleMs: now - turn.lastEventAt,
      textLength: turn.textLength,
      activeTool,
    };
  });

  const staleTurns = active.flatMap((turn) => {
    const staleTool = turn.activeTool && turn.activeTool.durationMs > TOOL_STALE_MS;
    const staleAgent = turn.durationMs > AGENT_STALE_MS;
    if (!staleTool && !staleAgent) return [];

    return [{
      chatId: turn.chatId,
      durationMs: turn.durationMs,
      idleMs: turn.idleMs,
      reason: staleTool ? "tool_stale" : "agent_stale",
      activeTool: turn.activeTool,
    }];
  });

  return {
    status: staleTurns.length > 0 ? "degraded" : "ok",
    uptimeSeconds: process.uptime(),
    thresholds: {
      agentStaleMs: AGENT_STALE_MS,
      toolStaleMs: TOOL_STALE_MS,
    },
    activeTurns: active,
    staleTurns,
    lastCompletedAt: lastCompletedAt ? new Date(lastCompletedAt).toISOString() : null,
    lastError,
  };
}
