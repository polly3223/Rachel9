import { db } from "./database.ts";
import { errorMessage } from "./errors.ts";

export type AgentRunStatus = "running" | "completed" | "failed" | "timeout" | "aborted" | "stale";
export type AgentQueueStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface AgentRunRecord {
  id: string;
  chatId: number;
  status: AgentRunStatus;
  promptPreview: string;
  promptLength: number;
  activeTool: string | null;
  startedAt: number;
  lastActivityAt: number;
  endedAt: number | null;
  error: string | null;
  responsePreview: string | null;
  model: string | null;
  metadata: Record<string, unknown>;
}

export interface AgentQueueRecord {
  id: string;
  chatId: number;
  status: AgentQueueStatus;
  textLength: number;
  enqueuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
}

export interface AgentRunEventRecord {
  id: number;
  runId: string;
  chatId: number;
  type: string;
  message: string | null;
  toolName: string | null;
  data: Record<string, unknown>;
  createdAt: number;
}

function now(): number {
  return Date.now();
}

function preview(text: string, max = 500): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function mapRun(row: Record<string, unknown>): AgentRunRecord {
  return {
    id: String(row["id"]),
    chatId: Number(row["chat_id"]),
    status: String(row["status"]) as AgentRunStatus,
    promptPreview: String(row["prompt_preview"] ?? ""),
    promptLength: Number(row["prompt_length"] ?? 0),
    activeTool: row["active_tool"] === null ? null : String(row["active_tool"]),
    startedAt: Number(row["started_at"]),
    lastActivityAt: Number(row["last_activity_at"]),
    endedAt: row["ended_at"] === null ? null : Number(row["ended_at"]),
    error: row["error"] === null ? null : String(row["error"]),
    responsePreview: row["response_preview"] === null ? null : String(row["response_preview"]),
    model: row["model"] === null ? null : String(row["model"]),
    metadata: parseMetadata(row["metadata"] === null ? null : String(row["metadata"])),
  };
}

function mapQueue(row: Record<string, unknown>): AgentQueueRecord {
  return {
    id: String(row["id"]),
    chatId: Number(row["chat_id"]),
    status: String(row["status"]) as AgentQueueStatus,
    textLength: Number(row["text_length"] ?? 0),
    enqueuedAt: Number(row["enqueued_at"]),
    startedAt: row["started_at"] === null ? null : Number(row["started_at"]),
    completedAt: row["completed_at"] === null ? null : Number(row["completed_at"]),
    error: row["error"] === null ? null : String(row["error"]),
  };
}

function mapRunEvent(row: Record<string, unknown>): AgentRunEventRecord {
  return {
    id: Number(row["id"]),
    runId: String(row["run_id"]),
    chatId: Number(row["chat_id"]),
    type: String(row["type"]),
    message: row["message"] === null ? null : String(row["message"]),
    toolName: row["tool_name"] === null ? null : String(row["tool_name"]),
    data: parseMetadata(row["data"] === null ? null : String(row["data"])),
    createdAt: Number(row["created_at"]),
  };
}

export function createRun(params: {
  chatId: number;
  prompt: string;
  model: string;
  metadata?: Record<string, unknown>;
}): string {
  const id = crypto.randomUUID();
  const ts = now();
  db.query(`
    INSERT INTO agent_runs (
      id, chat_id, status, prompt_preview, prompt_length, started_at,
      last_activity_at, model, metadata
    )
    VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.chatId,
    preview(params.prompt),
    params.prompt.length,
    ts,
    ts,
    params.model,
    JSON.stringify(params.metadata ?? {}),
  );
  appendRunEvent({ runId: id, chatId: params.chatId, type: "run_started" });
  return id;
}

export function appendRunEvent(params: {
  runId: string;
  chatId: number;
  type: string;
  message?: string;
  toolName?: string;
  data?: Record<string, unknown>;
}): void {
  db.query(`
    INSERT INTO agent_events (run_id, chat_id, type, message, tool_name, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    params.runId,
    params.chatId,
    params.type,
    params.message ?? null,
    params.toolName ?? null,
    JSON.stringify(params.data ?? {}),
  );
}

export function touchRun(runId: string, params?: {
  activeTool?: string | null;
  eventType?: string;
  chatId?: number;
  data?: Record<string, unknown>;
}): void {
  const ts = now();
  if (params && Object.hasOwn(params, "activeTool")) {
    db.query(`
      UPDATE agent_runs
      SET last_activity_at = ?, active_tool = ?
      WHERE id = ? AND status = 'running'
    `).run(ts, params.activeTool ?? null, runId);
  } else {
    db.query(`
      UPDATE agent_runs
      SET last_activity_at = ?
      WHERE id = ? AND status = 'running'
    `).run(ts, runId);
  }

  if (params?.eventType && params.chatId !== undefined) {
    appendRunEvent({
      runId,
      chatId: params.chatId,
      type: params.eventType,
      toolName: params.activeTool ?? undefined,
      data: params.data,
    });
  }
}

export function finishRun(runId: string, params: {
  chatId: number;
  status: AgentRunStatus;
  response?: string;
  error?: unknown;
  data?: Record<string, unknown>;
}): void {
  const ts = now();
  db.query(`
    UPDATE agent_runs
    SET status = ?, ended_at = ?, last_activity_at = ?, active_tool = NULL,
        error = ?, response_preview = ?
    WHERE id = ? AND status = 'running'
  `).run(
    params.status,
    ts,
    ts,
    params.error === undefined ? null : errorMessage(params.error),
    params.response === undefined ? null : preview(params.response),
    runId,
  );
  appendRunEvent({
    runId,
    chatId: params.chatId,
    type: `run_${params.status}`,
    message: params.error === undefined ? undefined : errorMessage(params.error),
    data: params.data,
  });
}

export function markStaleRuns(staleAfterMs: number): AgentRunRecord[] {
  const cutoff = now() - staleAfterMs;
  const rows = db.query(`
    SELECT * FROM agent_runs
    WHERE status = 'running' AND last_activity_at < ?
    ORDER BY last_activity_at ASC
  `).all(cutoff) as Array<Record<string, unknown>>;

  const stale = rows.map(mapRun);
  const ts = now();
  const update = db.query(`
    UPDATE agent_runs
    SET status = 'stale', ended_at = ?, error = ?
    WHERE id = ? AND status = 'running'
  `);

  for (const run of stale) {
    update.run(ts, `No activity for more than ${staleAfterMs}ms`, run.id);
    appendRunEvent({
      runId: run.id,
      chatId: run.chatId,
      type: "run_stale",
      message: `No activity for more than ${staleAfterMs}ms`,
    });
  }

  return stale;
}

export function getActiveRuns(): AgentRunRecord[] {
  const rows = db.query(`
    SELECT * FROM agent_runs
    WHERE status = 'running'
    ORDER BY started_at ASC
  `).all() as Array<Record<string, unknown>>;
  return rows.map(mapRun);
}

export function getLatestRun(chatId: number): AgentRunRecord | null {
  const row = db.query(`
    SELECT * FROM agent_runs
    WHERE chat_id = ?
    ORDER BY started_at DESC
    LIMIT 1
  `).get(chatId) as Record<string, unknown> | null;
  return row ? mapRun(row) : null;
}

export function getRunEvents(runId: string, limit = 20): AgentRunEventRecord[] {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const rows = db.query(`
    SELECT * FROM agent_events
    WHERE run_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(runId, safeLimit) as Array<Record<string, unknown>>;
  return rows.map(mapRunEvent).reverse();
}

export function enqueueTurn(chatId: number, textLength: number): string {
  const id = crypto.randomUUID();
  db.query(`
    INSERT INTO agent_queue (id, chat_id, status, text_length, enqueued_at)
    VALUES (?, ?, 'queued', ?, ?)
  `).run(id, chatId, textLength, now());
  return id;
}

export function startQueuedTurn(queueId: string): void {
  db.query(`
    UPDATE agent_queue
    SET status = 'running', started_at = ?
    WHERE id = ? AND status = 'queued'
  `).run(now(), queueId);
}

export function finishQueuedTurn(queueId: string, status: Extract<AgentQueueStatus, "completed" | "failed" | "cancelled">, error?: unknown): void {
  db.query(`
    UPDATE agent_queue
    SET status = ?, completed_at = ?, error = ?
    WHERE id = ?
  `).run(status, now(), error === undefined ? null : errorMessage(error), queueId);
}

export function getQueueSnapshot(chatId?: number): AgentQueueRecord[] {
  const rows = chatId === undefined
    ? db.query(`
        SELECT * FROM agent_queue
        WHERE status IN ('queued', 'running')
        ORDER BY enqueued_at ASC
      `).all()
    : db.query(`
        SELECT * FROM agent_queue
        WHERE chat_id = ? AND status IN ('queued', 'running')
        ORDER BY enqueued_at ASC
      `).all(chatId);
  return (rows as Array<Record<string, unknown>>).map(mapQueue);
}

export function recoverAbandonedRuntimeState(): { staleRuns: number; failedQueueItems: number } {
  const ts = now();
  const runningRuns = db.query(`
    SELECT id, chat_id FROM agent_runs
    WHERE status = 'running'
  `).all() as Array<Record<string, unknown>>;

  for (const row of runningRuns) {
    const runId = String(row["id"]);
    const chatId = Number(row["chat_id"]);
    db.query(`
      UPDATE agent_runs
      SET status = 'stale', ended_at = ?, error = ?
      WHERE id = ? AND status = 'running'
    `).run(ts, "Process restarted before this run completed", runId);
    appendRunEvent({
      runId,
      chatId,
      type: "run_recovered_as_stale",
      message: "Process restarted before this run completed",
    });
  }

  const failedQueueItems = db.query(`
    SELECT id FROM agent_queue
    WHERE status IN ('queued', 'running')
  `).all() as Array<Record<string, unknown>>;

  db.query(`
    UPDATE agent_queue
    SET status = 'failed', completed_at = ?, error = ?
    WHERE status IN ('queued', 'running')
  `).run(ts, "Process restarted before this queue item completed");

  return {
    staleRuns: runningRuns.length,
    failedQueueItems: failedQueueItems.length,
  };
}
