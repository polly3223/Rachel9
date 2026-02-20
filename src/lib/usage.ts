import { db } from "./database.ts";
import { logger } from "./logger.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageEntry {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  costTotal: number;
  thinkingTokens?: number;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalCost: number;
  turnCount: number;
}

export interface ModelUsage {
  model: string;
  provider: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

const insertStmt = db.prepare(`
  INSERT INTO usage (chat_id, timestamp, model, provider, input_tokens, output_tokens, cache_read, cache_write, cost_total, thinking_tokens)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const summaryStmt = db.prepare(`
  SELECT
    COALESCE(SUM(input_tokens), 0) AS totalInputTokens,
    COALESCE(SUM(output_tokens), 0) AS totalOutputTokens,
    COALESCE(SUM(cache_read), 0) AS totalCacheRead,
    COALESCE(SUM(cache_write), 0) AS totalCacheWrite,
    COALESCE(SUM(cost_total), 0) AS totalCost,
    COUNT(*) AS turnCount
  FROM usage
  WHERE chat_id = ? AND timestamp >= ?
`);

const byModelStmt = db.prepare(`
  SELECT
    model, provider,
    COUNT(*) AS turns,
    COALESCE(SUM(input_tokens), 0) AS inputTokens,
    COALESCE(SUM(output_tokens), 0) AS outputTokens,
    COALESCE(SUM(cost_total), 0) AS cost
  FROM usage
  WHERE chat_id = ? AND timestamp >= ?
  GROUP BY model, provider
  ORDER BY cost DESC
`);

const totalCostStmt = db.prepare(`
  SELECT COALESCE(SUM(cost_total), 0) AS total
  FROM usage
  WHERE chat_id = ? AND timestamp >= ?
`);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a single agent turn's token usage.
 */
export function recordUsage(chatId: number, entry: UsageEntry): void {
  try {
    insertStmt.run(
      chatId,
      Date.now(),
      entry.model,
      entry.provider,
      entry.inputTokens,
      entry.outputTokens,
      entry.cacheRead,
      entry.cacheWrite,
      entry.costTotal,
      entry.thinkingTokens ?? 0,
    );
  } catch (err) {
    logger.warn("Failed to record usage", { chatId, error: String(err) });
  }
}

/**
 * Get aggregated usage summary for a chat over the last N days.
 */
export function getUsageSummary(chatId: number, days = 7): UsageSummary {
  const since = Date.now() - days * 86_400_000;
  return summaryStmt.get(chatId, since) as UsageSummary;
}

/**
 * Get usage broken down by model for a chat over the last N days.
 */
export function getUsageByModel(chatId: number, days = 7): ModelUsage[] {
  const since = Date.now() - days * 86_400_000;
  return byModelStmt.all(chatId, since) as ModelUsage[];
}

/**
 * Get total cost for a chat over the last N days.
 */
export function getTotalCost(chatId: number, days = 7): number {
  const since = Date.now() - days * 86_400_000;
  const row = totalCostStmt.get(chatId, since) as { total: number } | undefined;
  return row?.total ?? 0;
}
