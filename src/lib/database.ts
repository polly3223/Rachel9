import { Database } from "bun:sqlite";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { env } from "../config/env.ts";
import { logger } from "./logger.ts";

const DB_DIR = join(env.SHARED_FOLDER_PATH, "rachel9");
const DB_PATH = join(DB_DIR, "data.db");

if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}

export const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency (readers don't block writers)
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL");
db.exec("PRAGMA busy_timeout = 5000");
db.exec("PRAGMA foreign_keys = ON");

// Create core tables
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('bash', 'reminder', 'cleanup', 'agent')),
    data TEXT NOT NULL DEFAULT '{}',
    cron TEXT,
    next_run INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_read INTEGER DEFAULT 0,
    cache_write INTEGER DEFAULT 0,
    cost_total REAL DEFAULT 0,
    thinking_tokens INTEGER DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    chat_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'timeout', 'aborted', 'stale')),
    prompt_preview TEXT NOT NULL DEFAULT '',
    prompt_length INTEGER NOT NULL DEFAULT 0,
    active_tool TEXT,
    started_at INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL,
    ended_at INTEGER,
    error TEXT,
    response_preview TEXT,
    model TEXT,
    metadata TEXT NOT NULL DEFAULT '{}'
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_agent_runs_chat_status
  ON agent_runs(chat_id, status, started_at)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_agent_runs_status_activity
  ON agent_runs(status, last_activity_at)
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    chat_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    message TEXT,
    tool_name TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_agent_events_run_created
  ON agent_events(run_id, created_at)
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_queue (
    id TEXT PRIMARY KEY,
    chat_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    text_length INTEGER NOT NULL DEFAULT 0,
    enqueued_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    error TEXT
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_agent_queue_chat_status
  ON agent_queue(chat_id, status, enqueued_at)
`);

// Migration: add cron column if missing (for databases created before Phase 5)
try {
  db.exec("ALTER TABLE tasks ADD COLUMN cron TEXT");
} catch {
  // Column already exists — expected
}

logger.info("Database initialized", { path: DB_PATH });
