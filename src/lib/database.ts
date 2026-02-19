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
    type TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    next_run INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )
`);

logger.info("Database initialized", { path: DB_PATH });
