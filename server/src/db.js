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

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  program_id INTEGER NOT NULL REFERENCES programs(id),
  target INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  start_date TEXT,
  end_date TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_batches_prog ON batches (program_id, active);

CREATE TABLE IF NOT EXISTS user_logins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  login_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, login_date)
);
CREATE INDEX IF NOT EXISTS idx_user_logins ON user_logins (user_id, login_date);

`);

try { db.exec('ALTER TABLE users ADD COLUMN birthday TEXT'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN hire_date TEXT'); } catch {}
try { db.exec('ALTER TABLE events ADD COLUMN batch_id INTEGER REFERENCES batches(id)'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN last_login_at TEXT'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN last_login_date TEXT'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN login_streak INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN highest_login_streak INTEGER DEFAULT 0'); } catch {}

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

export function ensureDefaultBatches() {
  try {
    const progs = db.prepare('SELECT id, name, daily_target FROM programs WHERE active = 1').all();
    const checkBatch = db.prepare('SELECT id FROM batches WHERE program_id = ? AND active = 1');
    const insBatch = db.prepare(`
      INSERT INTO batches (name, program_id, target, active, start_date, created_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `);
    const today = businessDate();
    const nowIso = new Date().toISOString();
    for (const p of progs) {
      const existing = checkBatch.get(p.id);
      if (!existing) {
        const batchTarget = p.daily_target > 0 ? p.daily_target * 5 : 50;
        insBatch.run('Batch 1', p.id, batchTarget, today, nowIso);
      }
    }
  } catch (err) {
    // ignore
  }
}

export function autoHydrateInitialSeed() {
  try {
    const eventCount = db.prepare('SELECT count(*) as c FROM events').get()?.c || 0;
    if (eventCount > 0) return; // already has data, preserve it

    const seedPath = path.resolve(serverDir, 'seeds', 'production-seed.json');
    if (!fs.existsSync(seedPath)) return;

    const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    if (!data || !Array.isArray(data.events) || data.events.length === 0) return;

    console.log(`🌱 [Seed] Auto-hydrating ${data.events.length} production sales and batches from production-seed.json...`);

    // In SQLite, PRAGMA foreign_keys must be toggled outside of an active transaction
    db.pragma('foreign_keys = OFF');

    const runImport = db.transaction(() => {
      // Clean child tables first, then parents
      try { db.prepare('DELETE FROM daily_adjustments').run(); } catch {}
      try { db.prepare('DELETE FROM user_logins').run(); } catch {}
      try { db.prepare('DELETE FROM events').run(); } catch {}
      try { db.prepare('DELETE FROM batches').run(); } catch {}
      try { db.prepare('DELETE FROM users').run(); } catch {}
      try { db.prepare('DELETE FROM programs').run(); } catch {}

      // Insert parents first
      if (Array.isArray(data.programs) && data.programs.length > 0) {
        const insProg = db.prepare('INSERT INTO programs (id, name, daily_target, active) VALUES (?, ?, ?, ?)');
        for (const p of data.programs) {
          insProg.run(p.id, p.name, p.daily_target ?? 0, p.active ?? 1);
        }
      }

      if (Array.isArray(data.users) && data.users.length > 0) {
        const insUser = db.prepare(`
          INSERT INTO users (id, name, role, employee_code, pin_hash, program_id, tl_id, photo_url, birthday, hire_date, active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const u of data.users) {
          insUser.run(u.id, u.name, u.role, u.employee_code, u.pin_hash, u.program_id, u.tl_id, u.photo_url, u.birthday, u.hire_date, u.active ?? 1);
        }
      }

      if (Array.isArray(data.batches) && data.batches.length > 0) {
        const insBatch = db.prepare(`
          INSERT INTO batches (id, name, program_id, target, active, start_date, end_date, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const b of data.batches) {
          insBatch.run(b.id, b.name, b.program_id, b.target ?? 0, b.active ?? 1, b.start_date, b.end_date, b.created_by, b.created_at || new Date().toISOString());
        }
      }

      if (Array.isArray(data.events) && data.events.length > 0) {
        const insEvent = db.prepare(`
          INSERT INTO events (id, telecaller_id, program_id, tl_id, status_id, lead_ref, created_by, created_at, business_date, voided, voided_by, voided_at, void_reason, batch_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const e of data.events) {
          insEvent.run(
            e.id, e.telecaller_id, e.program_id, e.tl_id, e.status_id, e.lead_ref,
            e.created_by, e.created_at, e.business_date, e.voided ?? 0,
            e.voided_by, e.voided_at, e.void_reason, e.batch_id ?? null
          );
        }
      }

      if (Array.isArray(data.daily_adjustments) && data.daily_adjustments.length > 0) {
        const insAdj = db.prepare(`
          INSERT INTO daily_adjustments (id, telecaller_id, status_code, business_date, adjusted_by, old_count, new_count, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const a of data.daily_adjustments) {
          insAdj.run(a.id, a.telecaller_id, a.status_code, a.business_date, a.adjusted_by, a.old_count, a.new_count, a.created_at);
        }
      }
    });

    runImport();
    db.pragma('foreign_keys = ON');
    console.log('✅ [Seed] Successfully initialized database with current production floor data!');
  } catch (err) {
    db.pragma('foreign_keys = ON');
    console.error('⚠️ [Seed] Auto-hydration error:', err.message);
  }
}

autoHydrateInitialSeed();
ensureDefaultBatches();

/**
 * Record user daily login and compute streak.
 * If user does not log in for more than 4 days, streak ends (resets to 1).
 */
export function recordUserLogin(userId, now = new Date()) {
  const today = businessDate(now);
  const nowIso = now.toISOString();

  const user = db.prepare(`
    SELECT id, name, last_login_date, last_login_at, login_streak, highest_login_streak
    FROM users WHERE id = ?
  `).get(userId);

  if (!user) return null;

  try {
    db.prepare(`
      INSERT OR IGNORE INTO user_logins (user_id, login_date, created_at)
      VALUES (?, ?, ?)
    `).run(userId, today, nowIso);
  } catch {}

  let newStreak = user.login_streak || 0;
  let streakBroken = false;
  let previousStreak = user.login_streak || 0;
  let diffDays = 0;

  if (!user.last_login_date) {
    newStreak = 1;
  } else if (user.last_login_date === today) {
    newStreak = Math.max(1, user.login_streak || 1);
  } else {
    const lastDate = new Date(user.last_login_date + 'T00:00:00Z');
    const currDate = new Date(today + 'T00:00:00Z');
    diffDays = Math.max(0, Math.round((currDate - lastDate) / 86400_000));

    if (diffDays > 4) {
      // Inactive for more than 4 days: streak ends!
      streakBroken = true;
      newStreak = 1;
    } else {
      newStreak = (user.login_streak || 0) + 1;
    }
  }

  const highestStreak = Math.max(user.highest_login_streak || 0, newStreak);

  db.prepare(`
    UPDATE users SET
      last_login_at = ?,
      last_login_date = ?,
      login_streak = ?,
      highest_login_streak = ?
    WHERE id = ?
  `).run(nowIso, today, newStreak, highestStreak, userId);

  return {
    user_id: userId,
    streak: newStreak,
    highest_streak: highestStreak,
    streak_broken: streakBroken,
    previous_streak: previousStreak,
    diff_days: diffDays,
    last_login_date: today,
  };
}

/**
 * Get counselor login streak status and warnings.
 */
export function getCounselorLoginStreakStatus(userId, today = businessDate()) {
  const user = db.prepare(`
    SELECT id, name, last_login_date, last_login_at, login_streak, highest_login_streak
    FROM users WHERE id = ?
  `).get(userId);

  if (!user) {
    return {
      current_streak: 0,
      highest_streak: 0,
      status: 'active',
      streak_warning: null,
      days_inactive: 0,
      logged_in_today: false,
    };
  }

  const loggedInToday = user.last_login_date === today;
  let daysInactive = 0;

  if (user.last_login_date) {
    const lastDate = new Date(user.last_login_date + 'T00:00:00Z');
    const currDate = new Date(today + 'T00:00:00Z');
    daysInactive = Math.max(0, Math.round((currDate - lastDate) / 86400_000));
  } else {
    daysInactive = 999;
  }

  let status = 'active';
  let streakWarning = null;
  let streakEnded = false;

  if (daysInactive > 4) {
    status = 'ended';
    streakEnded = true;
    streakWarning = `⚠️ Streak ended: You were inactive for more than 4 days (${daysInactive === 999 ? '4+' : daysInactive} days missed). Your Team Leader was notified. Log in daily to rebuild your streak!`;
  } else if (daysInactive >= 3 && !loggedInToday) {
    status = 'at_risk';
    streakWarning = `⚠️ Streak at risk! You have not logged in for ${daysInactive} days. If you do not log in within 4 days, your streak will end and your Team Leader will be notified!`;
  }

  return {
    current_streak: streakEnded && !loggedInToday ? 0 : (user.login_streak || (loggedInToday ? 1 : 0)),
    highest_streak: user.highest_login_streak || user.login_streak || 0,
    last_login_date: user.last_login_date,
    last_login_at: user.last_login_at,
    days_inactive: daysInactive,
    logged_in_today: loggedInToday,
    status,
    streak_warning: streakWarning,
    streak_ended: streakEnded,
  };
}

/**
 * Get all counselors under a TL (or floor-wide) who are inactive for >= 4 days or at risk.
 */
export function getTlInactiveCounselors(tlId, today = businessDate()) {
  const where = tlId ? 'AND u.tl_id = ?' : '';
  const params = tlId ? [tlId] : [];

  const rows = db.prepare(`
    SELECT u.id, u.name, u.employee_code, u.photo_url, u.program_id, u.tl_id,
           u.last_login_date, u.last_login_at, u.login_streak, u.highest_login_streak,
           p.name AS program_name,
           tl.name AS tl_name
    FROM users u
    LEFT JOIN programs p ON p.id = u.program_id
    LEFT JOIN users tl ON tl.id = u.tl_id
    WHERE u.role = 'telecaller' AND u.active = 1 ${where}
    ORDER BY u.name ASC
  `).all(...params);

  const list = [];
  const currDate = new Date(today + 'T00:00:00Z');

  for (const r of rows) {
    let daysInactive = 999;
    if (r.last_login_date) {
      const lastDate = new Date(r.last_login_date + 'T00:00:00Z');
      daysInactive = Math.max(0, Math.round((currDate - lastDate) / 86400_000));
    }
    const isInactiveAlert = daysInactive > 4; // Not logged in for more than 4 days
    const isAtRisk = daysInactive >= 3 && daysInactive <= 4;

    if (isInactiveAlert || isAtRisk) {
      list.push({
        id: r.id,
        name: r.name,
        employee_code: r.employee_code,
        photo_url: r.photo_url,
        program_name: r.program_name,
        tl_name: r.tl_name,
        last_login_date: r.last_login_date,
        last_login_at: r.last_login_at,
        days_inactive: daysInactive,
        login_streak: r.login_streak || 0,
        streak_ended: isInactiveAlert,
        status: isInactiveAlert ? 'ended' : 'at_risk',
        message: isInactiveAlert
          ? `Inactive for ${daysInactive === 999 ? '4+' : daysInactive} days — Streak ended`
          : `At risk: Inactive for ${daysInactive} days`,
      });
    }
  }

  return {
    total_alerts: list.length,
    streak_ended_count: list.filter((c) => c.streak_ended).length,
    at_risk_count: list.filter((c) => !c.streak_ended).length,
    counselors: list.sort((a, b) => b.days_inactive - a.days_inactive),
  };
}

