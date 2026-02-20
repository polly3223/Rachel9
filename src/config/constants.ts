/**
 * Central constants file.
 * All tunable values in one place — easy to adjust per deployment.
 */
export const CONSTANTS = {
  // ── Context Management ──────────────────────────────────────────────
  /** Maximum context tokens before hard overflow. */
  MAX_CONTEXT_TOKENS: 180_000,
  /** Trigger compaction when estimated tokens exceed this fraction of MAX_CONTEXT_TOKENS. */
  COMPACTION_THRESHOLD: 0.70,
  /** Always keep the last N user+assistant turn pairs during compaction. */
  COMPACTION_KEEP_RECENT_TURNS: 10,
  /** Rough chars-per-token ratio for estimation. */
  CHARS_PER_TOKEN: 4,

  // ── Streaming / Telegram ────────────────────────────────────────────
  /** Minimum ms between Telegram message edits during streaming. */
  STREAM_THROTTLE_MS: 500,
  /** Telegram single-message character limit. */
  TELEGRAM_MAX_MESSAGE_LENGTH: 4096,
  /** Truncation point for streaming edits (leave room for suffix). */
  STREAM_EDIT_TRUNCATE: 4000,

  // ── Task Scheduler ──────────────────────────────────────────────────
  /** How often the task scheduler polls for due tasks (ms). */
  TASK_POLL_INTERVAL_MS: 30_000,
  /** Max agent result length before truncation in reminder messages. */
  TASK_RESULT_TRUNCATE: 4000,

  // ── Crash Guard ─────────────────────────────────────────────────────
  /** Minimum uptime (ms) before a crash triggers immediate re-throw. */
  MIN_UPTIME_BEFORE_RETRY_MS: 30_000,
} as const;
