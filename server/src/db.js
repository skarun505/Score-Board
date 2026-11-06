import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(serverDir, '..');

dotenv.config({ path: path.join(serverDir, '.env') });
dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config();

const rawDbPath = process.env.DB_PATH || './data/dashboard.db';
export const dbPath = path.isAbsolute(rawDbPath)
  ? rawDbPath
  : path.resolve(rootDir, rawDbPath);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const rawUploadsDir = process.env.UPLOADS_DIR || './data/uploads';
export const uploadsDir = path.isAbsolute(rawUploadsDir)
  ? rawUploadsDir
  : path.resolve(rootDir, rawUploadsDir);
fs.mkdirSync(uploadsDir, { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  daily_target INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','tl','telecaller')),
  employee_code TEXT NOT NULL UNIQUE,
  pin_hash TEXT,
  program_id INTEGER REFERENCES programs(id),
  tl_id INTEGER REFERENCES users(id),
  photo_url TEXT,
  birthday TEXT,
  hire_date TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS statuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  is_sale INTEGER NOT NULL DEFAULT 0,
  sound TEXT,
  color TEXT DEFAULT '#3b82f6',
  sort_order INTEGER NOT NULL DEFAULT 0,
  show_in_feed INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telecaller_id INTEGER NOT NULL REFERENCES users(id),
  program_id INTEGER NOT NULL REFERENCES programs(id),
  tl_id INTEGER NOT NULL REFERENCES users(id),
  status_id INTEGER NOT NULL REFERENCES statuses(id),
  lead_ref TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  business_date TEXT NOT NULL,
  voided INTEGER NOT NULL DEFAULT 0,
  voided_by INTEGER,
  voided_at TEXT,
  void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events (business_date, voided);
CREATE INDEX IF NOT EXISTS idx_events_tc ON events (telecaller_id, created_at);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  employee_code TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);
CREATE TABLE IF NOT EXISTS daily_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telecaller_id INTEGER NOT NULL REFERENCES users(id),
  status_code TEXT NOT NULL,
  business_date TEXT NOT NULL,
  adjusted_by INTEGER NOT NULL REFERENCES users(id),
  old_count INTEGER NOT NULL,
  new_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_adj_tc_status_date ON daily_adjustments(telecaller_id, status_code, business_date);

`);

try { db.exec('ALTER TABLE users ADD COLUMN birthday TEXT'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN hire_date TEXT'); } catch {}

export const TZ = process.env.TZ_NAME || 'Asia/Kolkata';
const DAY_START = Number(process.env.DAY_START_HOUR || 0);

/** Business date (YYYY-MM-DD) in the configured timezone, shifted by DAY_START_HOUR. */
export const businessDate = (d = new Date()) =>
  new Date(d.getTime() - DAY_START * 3600_000).toLocaleDateString('en-CA', { timeZone: TZ });

export function audit(actorId, action, entity, entityId, details) {
  db.prepare(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details, created_at) VALUES (?,?,?,?,?,?)`
  ).run(actorId ?? null, action, entity ?? null, entityId ?? null,
        details ? JSON.stringify(details) : null, new Date().toISOString());
}
