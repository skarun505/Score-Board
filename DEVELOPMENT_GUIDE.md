# Live Sales Dashboard: Development Guide

A 24/7 live dashboard for a 108-inch TV that shows program sales, top telecallers and engagement, with a bell sound whenever a sale is closed. TLs update statuses manually from a phone-friendly page.

This file is written to be dropped into the project root and used with **Google Antigravity** (agent-first IDE). It contains requirements, architecture, working reference code, a phased plan, and copy-paste prompts.

> Menu and feature names in Antigravity can change between versions. Where this guide names a feature (Agent Manager, Planning mode, Rules), check your version if it looks different.

---

## Table of contents

1. Product summary and scope
2. Requirements
3. Architecture
4. Tech stack and why
5. Project structure
6. Data model
7. API and real-time events
8. Backend reference code
9. Frontend reference code
10. Sounds
11. Running 24/7 (kiosk, Docker, backups)
12. Phased plan
13. How to use this file in Antigravity
14. Antigravity prompts (copy-paste, in order)
15. Testing and acceptance checklist
16. Things that are easy to miss
17. Future ideas

---

## 1. Product summary and scope

**Who uses it**

| Role | What they do |
|---|---|
| Telecaller | Makes calls. Does not log in. Appears as a tile on the TL's screen and on the TV. |
| TL (Team Leader) | Logs in on phone or PC, taps a telecaller, taps a status. Each TL has one program and a few telecallers. |
| Admin | Manages programs, TLs, telecallers, statuses, targets, sounds. Can void mistaken entries. Sees the audit log. |
| TV | A read-only screen in kiosk mode. No login, uses a secret TV key in the URL. |

**Key decisions already made**

- Data is **manual**: TLs tap statuses. There is no CRM or telephony integration in v1.
- The TV shows **counts only**, never money values.
- Sale Closed triggers a bell, a full-screen pop-up with the telecaller's photo, and confetti.
- Other statuses (Interested, Follow-up, Callback) feed engagement counts and may play a soft sound.

**Out of scope for v1:** CRM or dialer integration, payroll or incentive calculation, customer data.

---

## 2. Requirements

### Functional

- F1. TL logs in with employee code and PIN.
- F2. TL sees only their own telecallers as large photo tiles, with today's sale count on each.
- F3. TL records a status in two taps: tile, then status button.
- F4. A 10-second **Undo** appears after every entry.
- F5. Duplicate guard: a second sale for the same telecaller within 20 seconds asks for confirmation.
- F6. The TV updates instantly (no refresh) when any status is recorded.
- F7. The TV shows: total sales vs target, program leaderboard with trend arrows, live activity feed, top telecallers (today and 7 days, rotating), and an engagement strip.
- F8. Sale Closed plays a bell and a celebration pop-up. Milestones (first sale of the day, program target hit, every Nth sale) play a bigger sound.
- F9. Bursts of sales are merged into one pop-up ("3 NEW SALES!") so sounds never overlap.
- F10. Admin can add or edit programs, users, statuses, targets and settings, void any entry with a reason, view the audit log, and export CSV.
- F11. Quiet hours: reduced volume on a schedule, plus a global sound on/off setting.

### Non-functional

- N1. Runs 24/7 with no manual intervention. Auto-reconnect, nightly reload, process auto-restart.
- N2. If data is stale or the connection drops, the TV shows **"Data delayed"** instead of silently showing old numbers.
- N3. Readable from 10+ metres: big type, high contrast, dark theme, layout scales with screen width.
- N4. Burn-in protection: slow pixel shifting.
- N5. Every change is audit-logged (who, what, when).
- N6. Handles at least 300 TLs and telecallers on one small server.
- N7. All times in IST. "Business day" boundary configurable (for night shifts).

---

## 3. Architecture

```
                    +-----------------------------+
   TL phone/PC ---> |  React web app (Vite build)  |
   (/tl)            |  served by the Node server   |
                    +--------------+--------------+
   Admin (/admin) ----------------->|
                                    | HTTPS / REST (JWT)
                                    v
                    +-----------------------------+
                    |   Node.js + Express API      |
                    |   - auth (PIN -> JWT)        |
                    |   - event service            |
                    |   - snapshot builder         |
                    |   - Socket.IO server         |
                    +------+---------------+------+
                           |               |
                 SQLite (WAL)         WebSocket push
                 data/dashboard.db    (snapshot + event:new)
                                           |
                                           v
                    +-----------------------------+
                    | TV: mini PC, Chrome kiosk    |
                    | /tv?key=...&autosound=1      |
                    | 108-inch display + speakers  |
                    +-----------------------------+
```

**Flow of one sale**

1. TL taps telecaller, then "Sale Closed". The browser calls `POST /api/events`.
2. Server validates (team ownership, status, duplicate guard), saves the event, writes the audit log, detects milestones.
3. Server emits `event:new` (for the sound and pop-up) and `snapshot` (fresh numbers for every screen).
4. TV queues the event, waits 900 ms to collect a burst, plays the sound, shows the pop-up, fires confetti.
5. If the TL taps Undo within 10 seconds, the server voids the event and emits a new `snapshot`.

**Why the server sends full snapshots:** the data is small (tens of programs, hundreds of telecallers). Sending the whole state each time is simpler and self-healing: a TV that missed a message is correct again on the next one. A 30-second heartbeat snapshot also tells the TV the link is alive and handles the midnight reset.

---

## 4. Tech stack and why

| Layer | Choice | Reason |
|---|---|---|
| Frontend | React + Vite | Fast, one codebase for TV, TL and admin pages |
| Real time | Socket.IO | Auto-reconnect and fallbacks built in |
| Backend | Node.js 20 + Express | Simple, easy for the agent to extend |
| Database | SQLite via better-sqlite3 (WAL mode) | Zero setup, one file, plenty for this scale. Schema is plain SQL so moving to PostgreSQL later is easy |
| Auth | PIN + bcrypt + JWT | Fits a floor environment. Use 6-digit PINs |
| Sounds | HTML Audio | No extra library needed |
| Confetti | canvas-confetti | Tiny and reliable |
| Deployment | Docker Compose (or pm2) | Auto-restart, easy backups |
| TV hardware | Mini PC + Chrome kiosk | Autoplay flag allows sound without a click |

---

## 5. Project structure

```
sales-dashboard/
├── DEVELOPMENT_GUIDE.md
├── Dockerfile
├── docker-compose.yml
├── .gitignore
├── data/                      (SQLite file lives here, git-ignored)
├── server/
│   ├── package.json
│   ├── .env.example
│   ├── scripts/simulate.mjs
│   └── src/
│       ├── index.js
│       ├── db.js
│       ├── auth.js
│       ├── seed.js
│       ├── services/
│       │   ├── events.js
│       │   └── dashboard.js
│       └── routes/
│           ├── auth.js
│           ├── events.js
│           └── admin.js
└── client/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    ├── public/sounds/         (bell.mp3, chime.mp3, soft.mp3, gong.mp3, applause.mp3)
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── api.js
        ├── socket.js
        ├── sound.js
        ├── styles.css
        └── pages/
            ├── TLPage.jsx
            ├── TVPage.jsx
            └── AdminPage.jsx   (built by prompt 8)
```

---

## 6. Data model

Created automatically by `server/src/db.js` (section 8).

| Table | Purpose | Key columns |
|---|---|---|
| `programs` | Programs | name, daily_target, active |
| `users` | Admin, TL and telecaller | role, employee_code (unique), pin_hash (admin/TL only), program_id, tl_id, photo_url, active |
| `statuses` | Configurable status list | code, label, is_sale, sound, color, sort_order, show_in_feed |
| `events` | Every status entry | telecaller_id, program_id, tl_id, status_id, lead_ref (optional), created_by, created_at (UTC ISO), business_date (IST), voided, void reason |
| `audit_log` | Who did what | actor_id, action, entity, entity_id, details (JSON), created_at |
| `settings` | Key/value settings | sound_enabled, normal_volume, quiet_start, quiet_end, quiet_volume, tv_rotation_sec |

**Definitions used on the dashboard (change if your process differs)**

- **Sale**: an event whose status has `is_sale = 1` and is not voided.
- **Conversion %**: sales divided by all non-voided status updates by that telecaller in the period.
- **Trend arrow**: today's sales vs yesterday's sales up to the same time of day.
- **Business day**: date in IST after subtracting `DAY_START_HOUR`. Set it to 6 if night shifts cross midnight.

---

## 7. API and real-time events

### REST

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | public | `{employee_code, pin}` returns `{token, user}` |
| GET | `/api/statuses` | TL, admin | Active statuses |
| GET | `/api/team` | TL, admin | Telecallers of this TL with today's counts |
| POST | `/api/events` | TL, admin | `{telecaller_id, status_code, lead_ref?, confirm_duplicate?}` |
| POST | `/api/events/:id/undo` | creator (10s), admin | Void own recent entry |
| GET | `/api/dashboard` | TV key or login | Current snapshot |
| GET | `/api/health` | public | Liveness |
| GET/POST/PATCH | `/api/admin/users` | admin | Manage users |
| GET/POST/PATCH | `/api/admin/programs` | admin | Manage programs and targets |
| GET/POST/PATCH | `/api/admin/statuses` | admin | Manage statuses |
| PUT | `/api/admin/settings` | admin | Sound and rotation settings |
| GET | `/api/admin/events?date=` | admin | List entries (including voided) |
| POST | `/api/admin/events/:id/void` | admin | Void with reason |
| GET | `/api/admin/audit?limit=` | admin | Audit log |
| GET | `/api/admin/export.csv?from=&to=` | admin | CSV export |

Errors return `{ error, code? }`. A duplicate sale returns HTTP 409 with `code: "DUPLICATE_CONFIRM"`.

### Socket.IO (server to client)

| Event | Payload | When |
|---|---|---|
| `snapshot` | full dashboard state | on connect, after every change, every 30 s |
| `event:new` | event view plus optional `milestone` | after a status is recorded |

Auth for sockets: `{ token }` (JWT) or `{ tvKey }`.

---

## 8. Backend reference code

Create these files exactly, then let the agent refine. Node 20+.

#### `server/package.json`

```json
{
  "name": "sales-dashboard-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "seed": "node src/seed.js",
    "simulate": "node scripts/simulate.mjs"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "better-sqlite3": "^11.3.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "express-rate-limit": "^7.4.0",
    "helmet": "^7.1.0",
    "jsonwebtoken": "^9.0.2",
    "socket.io": "^4.7.5"
  }
}
```

#### `server/.env.example`

```bash
PORT=4000
JWT_SECRET=replace-with-a-long-random-string
TV_KEY=replace-with-another-long-random-string
DB_PATH=./data/dashboard.db
TZ_NAME=Asia/Kolkata
DAY_START_HOUR=0
UNDO_WINDOW_SEC=10
DUPLICATE_WINDOW_SEC=20
MILESTONE_EVERY=10
CORS_ORIGIN=http://localhost:5173
ADMIN_CODE=ADMIN
ADMIN_PIN=123456
```

#### `server/src/db.js`

```js
import 'dotenv/config';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = process.env.DB_PATH || './data/dashboard.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

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
`);

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
```

#### `server/src/auth.js`

```js
import jwt from 'jsonwebtoken';

const secret = () => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
  return process.env.JWT_SECRET;
};

export const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role, name: user.name }, secret(), { expiresIn: '12h' });

export const verifyToken = (token) => jwt.verify(token, secret());

const bearer = (req) => {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};

export function requireAuth(roles = []) {
  return (req, res, next) => {
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: 'Login required' });
    try {
      const payload = verifyToken(token);
      if (roles.length && !roles.includes(payload.role)) {
        return res.status(403).json({ error: 'Not allowed' });
      }
      req.user = payload;
      next();
    } catch {
      res.status(401).json({ error: 'Session expired, please log in again' });
    }
  };
}

/** Allows either the secret TV key (?key=...) or a valid login token. */
export function tvOrAuth(req, res, next) {
  const key = req.query.key;
  if (key && process.env.TV_KEY && key === process.env.TV_KEY) return next();
  return requireAuth()(req, res, next);
}
```

#### `server/src/services/dashboard.js`

```js
import { db, businessDate } from '../db.js';

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function rankTelecallers(fromDate, toDate, limit = 10) {
  return db.prepare(`
    SELECT u.id, u.name, u.photo_url, p.name AS program,
           SUM(CASE WHEN s.is_sale = 1 THEN 1 ELSE 0 END) AS sales,
           COUNT(*) AS updates
    FROM events e
    JOIN users u ON u.id = e.telecaller_id
    JOIN programs p ON p.id = e.program_id
    JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date BETWEEN ? AND ? AND e.voided = 0
    GROUP BY u.id
    HAVING sales > 0
    ORDER BY sales DESC, updates ASC
    LIMIT ?`).all(fromDate, toDate, limit)
    .map((r) => ({ ...r, conversion: Math.round((r.sales / r.updates) * 100) }));
}

export function getSnapshot() {
  const now = new Date();
  const today = businessDate(now);
  const weekFrom = businessDate(new Date(now.getTime() - 6 * 86400_000));
  const monthFrom = today.slice(0, 8) + '01';
  const sameTimeYesterday = new Date(now.getTime() - 86400_000);
  const yday = businessDate(sameTimeYesterday);

  const statuses = db.prepare(
    `SELECT id, code, label, is_sale, sound, color FROM statuses WHERE active = 1 ORDER BY sort_order`
  ).all();

  const programs = db.prepare(`
    SELECT p.id, p.name, p.daily_target,
      (SELECT group_concat(name, ', ') FROM users
        WHERE role = 'tl' AND program_id = p.id AND active = 1) AS tl_name
    FROM programs p WHERE p.active = 1`).all();

  const counts = db.prepare(`
    SELECT e.program_id, s.code, s.is_sale, COUNT(*) AS n
    FROM events e JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date = ? AND e.voided = 0
    GROUP BY e.program_id, s.code`).all(today);

  const ydayRows = db.prepare(`
    SELECT e.program_id, COUNT(*) AS n
    FROM events e JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date = ? AND e.voided = 0 AND s.is_sale = 1 AND e.created_at <= ?
    GROUP BY e.program_id`).all(yday, sameTimeYesterday.toISOString());
  const ydayMap = Object.fromEntries(ydayRows.map((r) => [r.program_id, r.n]));

  const programRows = programs.map((p) => {
    const mine = counts.filter((c) => c.program_id === p.id);
    const sales = mine.filter((c) => c.is_sale).reduce((a, c) => a + c.n, 0);
    const y = ydayMap[p.id] || 0;
    return {
      ...p,
      sales,
      by_status: Object.fromEntries(mine.map((c) => [c.code, c.n])),
      yesterday_same_time: y,
      trend: sales > y ? 'up' : sales < y ? 'down' : 'flat',
    };
  }).sort((a, b) => b.sales - a.sales);

  const monthSales = db.prepare(`
    SELECT COUNT(*) AS n FROM events e JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date BETWEEN ? AND ? AND e.voided = 0 AND s.is_sale = 1`).get(monthFrom, today).n;

  const feed = db.prepare(`
    SELECT e.id, e.created_at, u.name AS telecaller, u.photo_url, p.name AS program,
           tl.name AS tl, s.code, s.label, s.is_sale
    FROM events e
    JOIN users u ON u.id = e.telecaller_id
    JOIN users tl ON tl.id = e.tl_id
    JOIN programs p ON p.id = e.program_id
    JOIN statuses s ON s.id = e.status_id
    WHERE e.voided = 0 AND e.business_date = ? AND s.show_in_feed = 1
    ORDER BY e.id DESC LIMIT 20`).all(today);

  return {
    generated_at: now.toISOString(),
    date: today,
    totals: {
      sales: programRows.reduce((a, p) => a + p.sales, 0),
      target: programRows.reduce((a, p) => a + p.daily_target, 0),
      month_sales: monthSales,
    },
    programs: programRows,
    top_today: rankTelecallers(today, today, 10),
    top_week: rankTelecallers(weekFrom, today, 10),
    feed,
    statuses,
    settings: getSettings(),
  };
}
```

#### `server/src/services/events.js`

```js
import { db, businessDate, audit } from '../db.js';

export const UNDO_SECONDS = Number(process.env.UNDO_WINDOW_SEC || 10);
const DUP_SECONDS = Number(process.env.DUPLICATE_WINDOW_SEC || 20);
const MILESTONE_EVERY = Number(process.env.MILESTONE_EVERY || 10);

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function countSales(date, programId) {
  const sql = `SELECT COUNT(*) AS n FROM events e JOIN statuses s ON s.id = e.status_id
               WHERE e.business_date = ? AND e.voided = 0 AND s.is_sale = 1`
              + (programId ? ' AND e.program_id = ?' : '');
  return db.prepare(sql).get(...(programId ? [date, programId] : [date])).n;
}

function detectMilestone(programId) {
  const today = businessDate();
  const orgSales = countSales(today);
  const progSales = countSales(today, programId);
  const prog = db.prepare('SELECT * FROM programs WHERE id = ?').get(programId);
  if (orgSales === 1) return { type: 'first_sale', label: 'First sale of the day!' };
  if (prog.daily_target > 0 && progSales === prog.daily_target) {
    return { type: 'target_hit', label: `${prog.name} hit its target!` };
  }
  if (MILESTONE_EVERY > 0 && orgSales % MILESTONE_EVERY === 0) {
    return { type: 'org_milestone', label: `${orgSales} sales today!` };
  }
  return null;
}

export function getEventView(id) {
  const r = db.prepare(`
    SELECT e.id, e.created_at,
           u.id AS tc_id, u.name AS tc_name, u.photo_url,
           p.id AS program_id, p.name AS program_name,
           tl.name AS tl_name,
           s.code, s.label, s.is_sale, s.sound, s.color
    FROM events e
    JOIN users u ON u.id = e.telecaller_id
    JOIN users tl ON tl.id = e.tl_id
    JOIN programs p ON p.id = e.program_id
    JOIN statuses s ON s.id = e.status_id
    WHERE e.id = ?`).get(id);
  return {
    id: r.id,
    created_at: r.created_at,
    telecaller: { id: r.tc_id, name: r.tc_name, photo_url: r.photo_url },
    program: { id: r.program_id, name: r.program_name },
    tl: { name: r.tl_name },
    status: { code: r.code, label: r.label, is_sale: !!r.is_sale, sound: r.sound, color: r.color },
  };
}

export function recordEvent({ actor, telecallerId, statusCode, leadRef, confirmDuplicate }) {
  const tc = db.prepare(
    `SELECT * FROM users WHERE id = ? AND role = 'telecaller' AND active = 1`
  ).get(telecallerId);
  if (!tc) throw new HttpError(404, 'Telecaller not found');
  if (!tc.program_id || !tc.tl_id) throw new HttpError(400, 'Telecaller has no program or TL assigned');
  if (actor.role === 'tl' && tc.tl_id !== actor.id) throw new HttpError(403, 'Not your team member');

  const st = db.prepare(`SELECT * FROM statuses WHERE code = ? AND active = 1`).get(statusCode);
  if (!st) throw new HttpError(400, 'Unknown status');

  if (st.is_sale && !confirmDuplicate) {
    const since = new Date(Date.now() - DUP_SECONDS * 1000).toISOString();
    const dup = db.prepare(`
      SELECT 1 FROM events e JOIN statuses s ON s.id = e.status_id
      WHERE e.telecaller_id = ? AND s.is_sale = 1 AND e.voided = 0 AND e.created_at >= ?`
    ).get(tc.id, since);
    if (dup) {
      throw new HttpError(409, `A sale was just recorded for ${tc.name}. Record another?`, 'DUPLICATE_CONFIRM');
    }
  }

  const now = new Date();
  const info = db.prepare(`
    INSERT INTO events (telecaller_id, program_id, tl_id, status_id, lead_ref, created_by, created_at, business_date)
    VALUES (?,?,?,?,?,?,?,?)`
  ).run(tc.id, tc.program_id, tc.tl_id, st.id, leadRef || null, actor.id, now.toISOString(), businessDate(now));
  const id = Number(info.lastInsertRowid);
  audit(actor.id, 'event.create', 'event', id, { telecaller: tc.name, status: st.code });

  return { id, milestone: st.is_sale ? detectMilestone(tc.program_id) : null };
}

export function voidEvent(actor, id, reason) {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!ev || ev.voided) throw new HttpError(404, 'Entry not found or already removed');
  db.prepare(`UPDATE events SET voided = 1, voided_by = ?, voided_at = ?, void_reason = ? WHERE id = ?`)
    .run(actor.id, new Date().toISOString(), reason || null, id);
  audit(actor.id, 'event.void', 'event', id, { reason });
}

export function undoEvent(actor, id) {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!ev || ev.voided) throw new HttpError(404, 'Entry not found or already removed');
  if (actor.role !== 'admin') {
    if (ev.created_by !== actor.id) throw new HttpError(403, 'You can only undo your own entries');
    const age = Date.now() - new Date(ev.created_at).getTime();
    if (age > (UNDO_SECONDS + 5) * 1000) {
      throw new HttpError(403, 'Undo window has passed. Ask an admin to remove it.');
    }
  }
  voidEvent(actor, id, 'undo');
}
```

#### `server/src/routes/auth.js`

```js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { db, audit } from '../db.js';
import { signToken } from '../auth.js';

const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });

router.post('/login', limiter, (req, res) => {
  const { employee_code, pin } = req.body || {};
  const user = db.prepare(
    `SELECT * FROM users WHERE employee_code = ? AND role IN ('admin','tl') AND active = 1`
  ).get(String(employee_code || '').trim());

  if (!user || !pin || !bcrypt.compareSync(String(pin), user.pin_hash || '')) {
    audit(null, 'login.fail', 'user', user?.id, { employee_code });
    return res.status(401).json({ error: 'Wrong employee code or PIN' });
  }
  audit(user.id, 'login.ok', 'user', user.id);
  res.json({
    token: signToken(user),
    user: { id: user.id, name: user.name, role: user.role, program_id: user.program_id },
  });
});

export default router;
```

#### `server/src/routes/events.js`

```js
import { Router } from 'express';
import { db, businessDate } from '../db.js';
import { requireAuth } from '../auth.js';
import { recordEvent, undoEvent, getEventView, UNDO_SECONDS } from '../services/events.js';
import { getSnapshot } from '../services/dashboard.js';

const router = Router();

router.get('/statuses', requireAuth(['tl', 'admin']), (req, res) => {
  res.json(db.prepare(
    `SELECT id, code, label, is_sale, color FROM statuses WHERE active = 1 ORDER BY sort_order`
  ).all());
});

router.get('/team', requireAuth(['tl', 'admin']), (req, res) => {
  const today = businessDate();
  const where = req.user.role === 'tl' ? 'AND u.tl_id = ?' : '';
  const params = req.user.role === 'tl' ? [today, req.user.id] : [today];
  const rows = db.prepare(`
    SELECT u.id, u.name, u.photo_url,
           COUNT(e.id) AS updates_today,
           COALESCE(SUM(CASE WHEN s.is_sale = 1 THEN 1 ELSE 0 END), 0) AS sales_today
    FROM users u
    LEFT JOIN events e ON e.telecaller_id = u.id AND e.business_date = ? AND e.voided = 0
    LEFT JOIN statuses s ON s.id = e.status_id
    WHERE u.role = 'telecaller' AND u.active = 1 ${where}
    GROUP BY u.id ORDER BY u.name`).all(...params);
  res.json(rows);
});

router.post('/events', requireAuth(['tl', 'admin']), (req, res, next) => {
  try {
    const { telecaller_id, status_code, lead_ref, confirm_duplicate } = req.body || {};
    const r = recordEvent({
      actor: req.user,
      telecallerId: Number(telecaller_id),
      statusCode: status_code,
      leadRef: lead_ref,
      confirmDuplicate: !!confirm_duplicate,
    });
    const event = { ...getEventView(r.id), milestone: r.milestone };
    const io = req.app.get('io');
    io.emit('event:new', event);
    io.emit('snapshot', getSnapshot());
    res.status(201).json({ event, undo_seconds: UNDO_SECONDS });
  } catch (e) { next(e); }
});

router.post('/events/:id/undo', requireAuth(['tl', 'admin']), (req, res, next) => {
  try {
    undoEvent(req.user, Number(req.params.id));
    req.app.get('io').emit('snapshot', getSnapshot());
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
```

#### `server/src/routes/admin.js`

```js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, audit, businessDate } from '../db.js';
import { requireAuth } from '../auth.js';
import { voidEvent, HttpError } from '../services/events.js';
import { getSnapshot } from '../services/dashboard.js';

const router = Router();
router.use(requireAuth(['admin']));
const refresh = (req) => req.app.get('io').emit('snapshot', getSnapshot());

/* ---------- users ---------- */
router.get('/users', (req, res) => {
  res.json(db.prepare(
    `SELECT id, name, role, employee_code, program_id, tl_id, photo_url, active FROM users ORDER BY role, name`
  ).all());
});

router.post('/users', (req, res, next) => {
  try {
    const { name, role, employee_code, pin, program_id = null, tl_id = null, photo_url = null } = req.body || {};
    if (!name || !employee_code || !['admin', 'tl', 'telecaller'].includes(role)) {
      throw new HttpError(400, 'name, employee_code and a valid role are required');
    }
    if (role !== 'telecaller' && !pin) throw new HttpError(400, 'PIN is required for admin and TL');
    const r = db.prepare(`
      INSERT INTO users (name, role, employee_code, pin_hash, program_id, tl_id, photo_url)
      VALUES (?,?,?,?,?,?,?)`
    ).run(name, role, String(employee_code).trim(), pin ? bcrypt.hashSync(String(pin), 10) : null,
          program_id, tl_id, photo_url);
    audit(req.user.id, 'user.create', 'user', Number(r.lastInsertRowid), { name, role });
    refresh(req);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch (e) { next(e); }
});

router.patch('/users/:id', (req, res, next) => {
  try {
    const allowed = ['name', 'role', 'program_id', 'tl_id', 'photo_url', 'active'];
    const sets = [], vals = [];
    for (const k of allowed) if (k in req.body) { sets.push(`${k} = ?`); vals.push(req.body[k]); }
    if (req.body.pin) { sets.push('pin_hash = ?'); vals.push(bcrypt.hashSync(String(req.body.pin), 10)); }
    if (!sets.length) throw new HttpError(400, 'Nothing to update');
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, req.params.id);
    audit(req.user.id, 'user.update', 'user', Number(req.params.id), { fields: Object.keys(req.body) });
    refresh(req);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------- programs and statuses (generic helpers) ---------- */
function patchTable(table, allowed) {
  return (req, res, next) => {
    try {
      const sets = [], vals = [];
      for (const k of allowed) if (k in req.body) { sets.push(`${k} = ?`); vals.push(req.body[k]); }
      if (!sets.length) throw new HttpError(400, 'Nothing to update');
      db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...vals, req.params.id);
      audit(req.user.id, `${table}.update`, table, Number(req.params.id), req.body);
      refresh(req);
      res.json({ ok: true });
    } catch (e) { next(e); }
  };
}

router.get('/programs', (req, res) => res.json(db.prepare('SELECT * FROM programs ORDER BY name').all()));
router.post('/programs', (req, res, next) => {
  try {
    const { name, daily_target = 0 } = req.body || {};
    if (!name) throw new HttpError(400, 'name is required');
    const r = db.prepare('INSERT INTO programs (name, daily_target) VALUES (?,?)').run(name, daily_target);
    audit(req.user.id, 'programs.create', 'programs', Number(r.lastInsertRowid), { name });
    refresh(req);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch (e) { next(e); }
});
router.patch('/programs/:id', patchTable('programs', ['name', 'daily_target', 'active']));

router.get('/statuses', (req, res) => res.json(db.prepare('SELECT * FROM statuses ORDER BY sort_order').all()));
router.post('/statuses', (req, res, next) => {
  try {
    const { code, label, is_sale = 0, sound = null, color = '#3b82f6', sort_order = 99, show_in_feed = 1 } = req.body || {};
    if (!code || !label) throw new HttpError(400, 'code and label are required');
    const r = db.prepare(`INSERT INTO statuses (code,label,is_sale,sound,color,sort_order,show_in_feed)
                          VALUES (?,?,?,?,?,?,?)`).run(code, label, is_sale, sound, color, sort_order, show_in_feed);
    audit(req.user.id, 'statuses.create', 'statuses', Number(r.lastInsertRowid), { code });
    refresh(req);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch (e) { next(e); }
});
router.patch('/statuses/:id',
  patchTable('statuses', ['label', 'is_sale', 'sound', 'color', 'sort_order', 'active', 'show_in_feed']));

/* ---------- settings ---------- */
const SETTING_KEYS = ['sound_enabled', 'normal_volume', 'quiet_start', 'quiet_end', 'quiet_volume', 'tv_rotation_sec'];
router.put('/settings', (req, res) => {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const k of SETTING_KEYS) if (k in req.body) up.run(k, String(req.body[k]));
  audit(req.user.id, 'settings.update', 'settings', null, req.body);
  refresh(req);
  res.json({ ok: true });
});

/* ---------- events, audit, export ---------- */
router.get('/events', (req, res) => {
  const date = req.query.date || businessDate();
  res.json(db.prepare(`
    SELECT e.id, e.created_at, e.voided, e.void_reason, e.lead_ref,
           u.name AS telecaller, p.name AS program, tl.name AS tl, s.label AS status, s.is_sale
    FROM events e
    JOIN users u ON u.id = e.telecaller_id
    JOIN users tl ON tl.id = e.tl_id
    JOIN programs p ON p.id = e.program_id
    JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date = ? ORDER BY e.id DESC`).all(date));
});

router.post('/events/:id/void', (req, res, next) => {
  try {
    if (!req.body?.reason) throw new HttpError(400, 'A reason is required');
    voidEvent(req.user, Number(req.params.id), req.body.reason);
    refresh(req);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/audit', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(db.prepare(`
    SELECT a.*, u.name AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
    ORDER BY a.id DESC LIMIT ?`).all(limit));
});

router.get('/export.csv', (req, res) => {
  const from = req.query.from || businessDate();
  const to = req.query.to || from;
  const rows = db.prepare(`
    SELECT e.business_date, e.created_at, p.name AS program, tl.name AS tl, u.name AS telecaller,
           s.label AS status, e.lead_ref, e.voided, e.void_reason
    FROM events e
    JOIN users u ON u.id = e.telecaller_id
    JOIN users tl ON tl.id = e.tl_id
    JOIN programs p ON p.id = e.program_id
    JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date BETWEEN ? AND ? ORDER BY e.id`).all(from, to);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = 'date,time_utc,program,tl,telecaller,status,lead_ref,voided,void_reason';
  const body = rows.map((r) => [r.business_date, r.created_at, r.program, r.tl, r.telecaller,
    r.status, r.lead_ref, r.voided, r.void_reason].map(esc).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="sales-${from}_to_${to}.csv"`);
  res.send([header, ...body].join('\n'));
});

export default router;
```

#### `server/src/index.js`

```js
import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';

import './db.js';
import { verifyToken, tvOrAuth } from './auth.js';
import { getSnapshot } from './services/dashboard.js';
import authRoutes from './routes/auth.js';
import eventRoutes from './routes/events.js';
import adminRoutes from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const origins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: origins } });
app.set('io', io);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: origins }));
app.use(express.json());

/* Socket auth: TV key or JWT */
io.use((socket, next) => {
  const { token, tvKey } = socket.handshake.auth || {};
  if (tvKey && process.env.TV_KEY && tvKey === process.env.TV_KEY) return next();
  try {
    if (token) { verifyToken(token); return next(); }
  } catch { /* fall through */ }
  next(new Error('unauthorized'));
});
io.on('connection', (socket) => socket.emit('snapshot', getSnapshot()));

/* Heartbeat: keeps TVs fresh, proves the link is alive, rolls over at midnight */
setInterval(() => io.emit('snapshot', getSnapshot()), 30_000);

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/api/dashboard', tvOrAuth, (req, res) => res.json(getSnapshot()));
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', eventRoutes);

/* Serve the built React app */
const dist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(dist));
app.get('*', (req, res, next) =>
  req.path.startsWith('/api') ? next() : res.sendFile(path.join(dist, 'index.html'), (err) => err && next()));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Already exists' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Server error' : err.message, code: err.code });
});

const port = Number(process.env.PORT || 4000);
server.listen(port, () => console.log(`Dashboard server running on http://localhost:${port}`));

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
process.on('uncaughtException', (e) => { console.error('uncaughtException', e); process.exit(1); }); // let Docker/pm2 restart
```

#### `server/src/seed.js`

```js
import bcrypt from 'bcryptjs';
import { db } from './db.js';

const hash = (pin) => bcrypt.hashSync(String(pin), 10);

/* Statuses (edit to match your real process) */
const statuses = [
  // code, label, is_sale, sound, color, sort_order, show_in_feed
  ['sale_closed', 'Sale Closed', 1, 'bell', '#22c55e', 1, 1],
  ['interested', 'Interested', 0, 'chime', '#3b82f6', 2, 1],
  ['follow_up', 'Follow-up', 0, 'soft', '#f59e0b', 3, 1],
  ['callback', 'Callback', 0, null, '#a855f7', 4, 0],
  ['not_interested', 'Not Interested', 0, null, '#ef4444', 5, 0],
];
const insStatus = db.prepare(
  `INSERT OR IGNORE INTO statuses (code,label,is_sale,sound,color,sort_order,show_in_feed) VALUES (?,?,?,?,?,?,?)`);
statuses.forEach((s) => insStatus.run(...s));

/* Default settings */
const defaults = {
  sound_enabled: '1', normal_volume: '1', quiet_start: '22:00', quiet_end: '07:00',
  quiet_volume: '0.3', tv_rotation_sec: '25',
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)');
Object.entries(defaults).forEach(([k, v]) => insSetting.run(k, v));

/* Admin */
const adminCode = process.env.ADMIN_CODE || 'ADMIN';
if (!db.prepare('SELECT 1 FROM users WHERE employee_code = ?').get(adminCode)) {
  db.prepare(`INSERT INTO users (name, role, employee_code, pin_hash) VALUES (?,?,?,?)`)
    .run('Administrator', 'admin', adminCode, hash(process.env.ADMIN_PIN || '123456'));
  console.log(`Created admin ${adminCode}. CHANGE THE PIN IMMEDIATELY.`);
}

/* Demo data (only when there are no programs yet) */
if (!db.prepare('SELECT 1 FROM programs LIMIT 1').get()) {
  const mkProgram = db.prepare('INSERT INTO programs (name, daily_target) VALUES (?,?)');
  const mkUser = db.prepare(
    `INSERT INTO users (name, role, employee_code, pin_hash, program_id, tl_id) VALUES (?,?,?,?,?,?)`);

  const demo = [
    ['Program A', 20, 'Suresh', 'TL001', ['Ravi', 'Priya', 'Anil', 'Divya']],
    ['Program B', 15, 'Meena', 'TL002', ['Karthik', 'Sana', 'Vikram']],
    ['Program C', 12, 'Rahul', 'TL003', ['Neha', 'Arjun']],
  ];
  let n = 1;
  for (const [pname, target, tlName, tlCode, callers] of demo) {
    const pid = Number(mkProgram.run(pname, target).lastInsertRowid);
    const tlId = Number(mkUser.run(tlName, 'tl', tlCode, hash('111111'), pid, null).lastInsertRowid);
    for (const c of callers) mkUser.run(c, 'telecaller', `TC${String(n++).padStart(3, '0')}`, null, pid, tlId);
  }
  console.log('Demo data created. TL logins: TL001 / TL002 / TL003, PIN 111111');
}
console.log('Seed complete.');
```

#### `server/scripts/simulate.mjs`

Fires random statuses so you can test the TV without waiting for real TLs.

```js
// Usage: node scripts/simulate.mjs TL001 111111
const BASE = process.env.BASE || 'http://localhost:4000';
const [code = 'TL001', pin = '111111'] = process.argv.slice(2);
const json = (r) => r.json();

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ employee_code: code, pin }),
}).then(json);
if (!login.token) throw new Error(`Login failed: ${JSON.stringify(login)}`);

const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };
const team = await fetch(`${BASE}/api/team`, { headers }).then(json);
const pool = ['sale_closed', 'interested', 'interested', 'follow_up', 'callback', 'not_interested', 'not_interested'];

console.log(`Simulating ${team.length} telecallers as ${login.user.name}. Ctrl+C to stop.`);
setInterval(async () => {
  const tc = team[Math.floor(Math.random() * team.length)];
  const status_code = Math.random() < 0.2 ? 'sale_closed' : pool[Math.floor(Math.random() * pool.length)];
  const res = await fetch(`${BASE}/api/events`, {
    method: 'POST', headers,
    body: JSON.stringify({ telecaller_id: tc.id, status_code, confirm_duplicate: true }),
  });
  console.log(tc.name, status_code, res.status);
}, 3000);
```

---

## 9. Frontend reference code

#### `client/package.json`

```json
{
  "name": "sales-dashboard-client",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "canvas-confetti": "^1.9.3",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0",
    "socket.io-client": "^4.7.5"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.4.0"
  }
}
```

#### `client/vite.config.js`

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
```

#### `client/index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Live Sales Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

#### `client/src/main.jsx`

```jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
```

#### `client/src/App.jsx`

```jsx
import { Navigate, Route, Routes } from 'react-router-dom';
import TVPage from './pages/TVPage.jsx';
import TLPage from './pages/TLPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/tv" element={<TVPage />} />
      <Route path="/tl" element={<TLPage />} />
      <Route path="*" element={<Navigate to="/tl" replace />} />
    </Routes>
  );
}
```

Add `/admin` (prompt 8) later.

#### `client/src/api.js`

```js
export async function api(path, { method = 'GET', body, token } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const err = new Error('No connection. Your entry was NOT saved.');
    err.status = 0;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}
```

#### `client/src/socket.js`

```js
import { io } from 'socket.io-client';

export function connectSocket(auth) {
  return io('/', {
    auth,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    transports: ['websocket', 'polling'],
  });
}
```

#### `client/src/sound.js`

```js
const NAMES = ['bell', 'chime', 'soft', 'gong', 'applause'];
const cache = {};
let unlocked = false;

export const isUnlocked = () => unlocked;

function load(name) {
  if (!cache[name]) {
    cache[name] = new Audio(`/sounds/${name}.mp3`);
    cache[name].preload = 'auto';
  }
  return cache[name];
}

/** Call once from a click (or automatically in kiosk mode with the autoplay flag). */
export function unlockAudio() {
  unlocked = true;
  NAMES.forEach(load);
}

function currentVolume(s = {}) {
  const [sh, sm] = (s.quiet_start || '22:00').split(':').map(Number);
  const [eh, em] = (s.quiet_end || '07:00').split(':').map(Number);
  const d = new Date();
  const mins = d.getHours() * 60 + d.getMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  const quiet = start > end ? mins >= start || mins < end : mins >= start && mins < end;
  return quiet ? Number(s.quiet_volume ?? 0.3) : Number(s.normal_volume ?? 1);
}

export function play(name, settings, scale = 1) {
  if (!unlocked || settings?.sound_enabled === '0' || !name) return;
  const a = load(name);
  a.currentTime = 0;
  a.volume = Math.min(1, Math.max(0, currentVolume(settings) * scale));
  a.play().catch(() => {});
}
```

#### `client/src/pages/TLPage.jsx`

```jsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

function Avatar({ p }) {
  const initials = p.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return p.photo_url
    ? <img className="av" src={p.photo_url} alt="" />
    : <div className="av">{initials}</div>;
}

function Login({ onLogin }) {
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: { employee_code: code, pin } });
      onLogin(r);
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  }

  return (
    <form className="login" onSubmit={submit}>
      <h1>TL Login</h1>
      <input placeholder="Employee code" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" />
      <input placeholder="PIN" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} />
      {err && <div className="err">{err}</div>}
      <button disabled={busy || !code || !pin}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}

export default function TLPage() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('session') || 'null'));
  const [team, setTeam] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef();
  const token = session?.token;

  function logout() { localStorage.removeItem('session'); setSession(null); }
  function onLogin(r) { localStorage.setItem('session', JSON.stringify(r)); setSession(r); }

  async function loadTeam() {
    try { setTeam(await api('/api/team', { token })); }
    catch (e) { if (e.status === 401) logout(); }
  }

  useEffect(() => {
    if (!token) return;
    loadTeam();
    api('/api/statuses', { token }).then(setStatuses).catch((e) => e.status === 401 && logout());
    const t = setInterval(loadTeam, 30000);
    return () => clearInterval(t);
  }, [token]);

  async function record(tc, status, confirm = false) {
    if (busy) return;
    setBusy(true);
    try {
      const { event, undo_seconds } = await api('/api/events', {
        method: 'POST', token,
        body: { telecaller_id: tc.id, status_code: status.code, confirm_duplicate: confirm },
      });
      clearTimeout(timer.current);
      setToast({ id: event.id, text: `${tc.name} → ${status.label}`, seconds: undo_seconds });
      timer.current = setTimeout(() => setToast(null), (undo_seconds + 1) * 1000);
      setSelected(null);
      loadTeam();
    } catch (e) {
      if (e.code === 'DUPLICATE_CONFIRM' && window.confirm(e.message)) {
        setBusy(false);
        return record(tc, status, true);
      }
      if (e.status === 401) logout(); else if (e.code !== 'DUPLICATE_CONFIRM') alert(e.message);
    }
    setBusy(false);
  }

  async function undo() {
    try {
      await api(`/api/events/${toast.id}/undo`, { method: 'POST', token });
      setToast(null);
      loadTeam();
    } catch (e) { alert(e.message); }
  }

  if (!token) return <Login onLogin={onLogin} />;

  return (
    <div className="tl">
      <header>
        <div>
          <strong>{session.user.name}</strong>
          <span className="muted"> · tap a telecaller, then a status</span>
        </div>
        <button className="link" onClick={logout}>Log out</button>
      </header>

      <div className="grid">
        {team.map((t) => (
          <button key={t.id} className="tile" onClick={() => setSelected(t)}>
            <Avatar p={t} />
            <div className="name">{t.name}</div>
            <div className="count">{t.sales_today} sales today</div>
          </button>
        ))}
        {!team.length && <p className="muted">No telecallers assigned to you yet. Ask the admin.</p>}
      </div>

      {selected && (
        <div className="sheet-bg" onClick={() => setSelected(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>{selected.name}</h2>
            <div className="status-grid">
              {statuses.map((s) => (
                <button key={s.id} disabled={busy} className="status" style={{ background: s.color }}
                        onClick={() => record(selected, s)}>
                  {s.label}
                </button>
              ))}
            </div>
            <button className="link" onClick={() => setSelected(null)}>Cancel</button>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast">
          <span>{toast.text}</span>
          <button onClick={undo}>UNDO</button>
        </div>
      )}
    </div>
  );
}
```

#### `client/src/pages/TVPage.jsx`

```jsx
import { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { connectSocket } from '../socket.js';
import { play, unlockAudio, isUnlocked } from '../sound.js';

const STALE_MS = 75_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fireConfetti(big) {
  const end = Date.now() + (big ? 3500 : 1500);
  (function frame() {
    confetti({ particleCount: big ? 6 : 3, angle: 60, spread: 70, origin: { x: 0 } });
    confetti({ particleCount: big ? 6 : 3, angle: 120, spread: 70, origin: { x: 1 } });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

function Avatar({ p, big }) {
  const initials = p.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const cls = 'av' + (big ? ' big' : '');
  return p.photo_url ? <img className={cls} src={p.photo_url} alt="" /> : <div className={cls}>{initials}</div>;
}

function usePage(items, size, ms) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / size));
  useEffect(() => {
    const t = setInterval(() => setPage((p) => (p + 1) % pages), ms);
    return () => clearInterval(t);
  }, [pages, ms]);
  const p = page % pages;
  return { slice: items.slice(p * size, p * size + size), page: p, pages };
}

function Celebration({ batch, milestone }) {
  const one = batch.length === 1 ? batch[0] : null;
  return (
    <div className="celebrate">
      {milestone && <div className="ms">{milestone.label}</div>}
      {one ? (
        <>
          <Avatar p={one.telecaller} big />
          <div className="c-title">SALE CLOSED!</div>
          <div className="c-name">{one.telecaller.name}</div>
          <div className="c-sub">{one.program.name} · TL {one.tl.name}</div>
        </>
      ) : (
        <>
          <div className="c-title">{batch.length} NEW SALES!</div>
          <div className="c-list">
            {batch.slice(0, 6).map((e) => <span key={e.id}>{e.telecaller.name}</span>)}
          </div>
        </>
      )}
    </div>
  );
}

export default function TVPage() {
  const params = new URLSearchParams(location.search);
  const key = params.get('key') || '';
  const autoSound = params.get('autosound') === '1';

  const [snap, setSnap] = useState(null);
  const [online, setOnline] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [celebration, setCelebration] = useState(null);
  const [soundReady, setSoundReady] = useState(isUnlocked());
  const [view, setView] = useState('today');
  const [shift, setShift] = useState({ x: 0, y: 0 });

  const settingsRef = useRef({});
  const queue = useRef([]);
  const busy = useRef(false);

  async function pump() {
    if (busy.current) return;
    busy.current = true;
    while (queue.current.length) {
      await sleep(900); // collect a burst of sales
      const batch = queue.current.splice(0);
      const milestone = batch.find((e) => e.milestone)?.milestone || null;
      setCelebration({ batch, milestone });
      play(milestone ? (milestone.type === 'target_hit' ? 'applause' : 'gong') : 'bell', settingsRef.current);
      fireConfetti(batch.length > 1 || !!milestone);
      await sleep(milestone ? 7000 : 4500);
      setCelebration(null);
      await sleep(300);
    }
    busy.current = false;
  }

  useEffect(() => {
    if (autoSound) { unlockAudio(); setSoundReady(true); }
    const s = connectSocket({ tvKey: key });
    s.on('connect', () => setOnline(true));
    s.on('disconnect', () => setOnline(false));
    s.on('snapshot', (d) => { settingsRef.current = d.settings || {}; setSnap(d); setLastUpdate(Date.now()); });
    s.on('event:new', (ev) => {
      if (ev.status.is_sale) { queue.current.push(ev); pump(); }
      else if (ev.status.sound) play(ev.status.sound, settingsRef.current, 0.5);
    });
    return () => s.close();
  }, [key]);

  /* clock + stale detection */
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  /* rotate right panel between today and 7 days */
  const rotSec = Number(snap?.settings?.tv_rotation_sec || 25);
  useEffect(() => {
    const t = setInterval(() => setView((v) => (v === 'today' ? 'week' : 'today')), rotSec * 1000);
    return () => clearInterval(t);
  }, [rotSec]);

  /* nightly reload at 03:30 (only if the page has been up for 2+ minutes) */
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      if (d.getHours() === 3 && d.getMinutes() === 30 && performance.now() > 120_000) location.reload();
    }, 20_000);
    return () => clearInterval(t);
  }, []);

  /* burn-in protection: shift the whole layout a few pixels every 3 minutes */
  useEffect(() => {
    const t = setInterval(() => setShift({
      x: Math.round(Math.random() * 16 - 8), y: Math.round(Math.random() * 16 - 8),
    }), 180_000);
    return () => clearInterval(t);
  }, []);

  const programsPage = usePage(snap?.programs || [], 8, 15000);
  const stripPage = usePage(snap?.programs || [], 4, 12000);

  if (!snap) return <div className="tv"><div className="tv-wait">Connecting…</div></div>;

  const stale = !online || !lastUpdate || now - lastUpdate > STALE_MS;
  const agoSec = Math.round((now - lastUpdate) / 1000);
  const pct = snap.totals.target ? Math.min(100, Math.round((snap.totals.sales / snap.totals.target) * 100)) : 0;
  const leaders = view === 'today' ? snap.top_today : snap.top_week;
  const arrow = { up: '▲', down: '▼', flat: '–' };

  return (
    <div className="tv" style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}>
      {!soundReady && (
        <button className="sound-gate" onClick={() => { unlockAudio(); setSoundReady(true); }}>
          🔔 Click once to enable sound
        </button>
      )}
      {stale && <div className="stale">⚠ Data delayed · last update {agoSec}s ago</div>}

      <header className="hdr">
        <div className="hdr-title">TEAM SALES · LIVE</div>
        <div className="hdr-total">
          <div><span className="big">{snap.totals.sales}</span> <span className="sub">sales today of {snap.totals.target} target</span></div>
          <div className="bar"><div className="fill" style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="hdr-clock">
          {new Date(now).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          <div className="sub">Month: {snap.totals.month_sales} sales</div>
        </div>
      </header>

      <section className="panel">
        <h2>Program Leaderboard {programsPage.pages > 1 && <small>{programsPage.page + 1}/{programsPage.pages}</small>}</h2>
        {programsPage.slice.map((p, i) => (
          <div className="row" key={p.id}>
            <div className="rank">{programsPage.page * 8 + i + 1}</div>
            <div className="grow">
              <div className="rname">{p.name}</div>
              <div className="rsub">TL {p.tl_name || '—'} · target {p.daily_target}</div>
            </div>
            <div className={`trend ${p.trend}`}>{arrow[p.trend]}</div>
            <div className="rnum">{p.sales}</div>
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>Live Activity</h2>
        {snap.feed.length === 0 && <div className="empty">Waiting for the first update of the day…</div>}
        {snap.feed.slice(0, 12).map((f) => (
          <div key={f.id} className={`feed-row ${f.is_sale ? 'sale' : ''}`}>
            <Avatar p={{ name: f.telecaller, photo_url: f.photo_url }} />
            <div className="grow">
              <div className="rname">{f.telecaller}</div>
              <div className="rsub">{f.program} · TL {f.tl}</div>
            </div>
            <div className="tag">{f.is_sale ? '🔔 ' : ''}{f.label}</div>
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>{view === 'today' ? 'Top Performers · Today' : 'Top Performers · 7 Days'}</h2>
        {leaders.length === 0 && <div className="empty">No sales yet</div>}
        {leaders.slice(0, 8).map((l, i) => (
          <div className="row" key={l.id}>
            <div className="rank">{i + 1}</div>
            <Avatar p={l} />
            <div className="grow">
              <div className="rname">{l.name} {i === 0 && <span className="badge">🏆 Top</span>}</div>
              <div className="rsub">{l.program} · {l.conversion}% conversion</div>
            </div>
            <div className="rnum">{l.sales}</div>
          </div>
        ))}
      </section>

      <footer className="strip">
        {stripPage.slice.map((p) => (
          <div className="strip-item" key={p.id}>
            <b>{p.name}</b>
            <span>Interested {p.by_status.interested || 0}</span>
            <span>Follow-ups {p.by_status.follow_up || 0}</span>
            <span>Callbacks {p.by_status.callback || 0}</span>
          </div>
        ))}
      </footer>

      {celebration && <Celebration {...celebration} />}
    </div>
  );
}
```

#### `client/src/styles.css`

```css
* { box-sizing: border-box; }
html, body, #root { margin: 0; height: 100%; background: #0b1020; }
body { font-family: system-ui, 'Segoe UI', Roboto, sans-serif; color: #e8ecf8; }
button { font: inherit; cursor: pointer; }
.muted { color: #8b93b1; }

/* ---------- TV (everything sized in em; font-size scales with screen width) ---------- */
.tv { position: fixed; inset: 0; font-size: calc(100vw / 110); display: grid;
  grid-template-columns: 1.1fr 1.2fr 1fr; grid-template-rows: 9em 1fr 8em; gap: 1.2em;
  padding: 1.5em; overflow: hidden; transition: transform 2s ease; }
.tv-wait { grid-column: 1 / -1; align-self: center; text-align: center; font-size: 4em; }
.hdr { grid-column: 1 / -1; display: flex; align-items: center; gap: 3em;
  background: #121a33; border-radius: 1em; padding: 0 2em; }
.hdr-title { font-size: 2.6em; font-weight: 800; letter-spacing: .08em; }
.hdr-total { flex: 1; }
.hdr-total .big { font-size: 4em; font-weight: 800; color: #4ade80; }
.sub { color: #8b93b1; font-size: 1.3em; }
.bar { height: 1.1em; background: #1f2a4d; border-radius: 1em; overflow: hidden; margin-top: .4em; }
.fill { height: 100%; background: linear-gradient(90deg, #22c55e, #4ade80); transition: width 1s ease; }
.hdr-clock { font-size: 3.4em; font-weight: 700; text-align: right; }
.hdr-clock .sub { font-size: .35em; }

.panel { background: #121a33; border-radius: 1em; padding: 1.2em 1.5em; overflow: hidden; }
.panel h2 { margin: 0 0 .7em; font-size: 1.9em; color: #9db4ff; text-transform: uppercase; letter-spacing: .06em; }
.panel h2 small { color: #8b93b1; font-size: .6em; margin-left: .6em; }
.row, .feed-row { display: flex; align-items: center; gap: 1em; padding: .55em 0; border-bottom: 1px solid #1f2a4d; }
.feed-row { animation: slidein .6s ease; }
.feed-row.sale { background: linear-gradient(90deg, rgba(34,197,94,.18), transparent); border-radius: .6em; padding-left: .6em; }
@keyframes slidein { from { opacity: 0; transform: translateY(-1.2em); } to { opacity: 1; transform: none; } }
.grow { flex: 1; min-width: 0; }
.rank { width: 1.6em; font-size: 2em; font-weight: 800; color: #9db4ff; text-align: center; }
.rname { font-size: 1.9em; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rsub { font-size: 1.2em; color: #8b93b1; }
.rnum { font-size: 3em; font-weight: 800; color: #4ade80; min-width: 1.6em; text-align: right; }
.trend { font-size: 1.8em; width: 1.2em; text-align: center; }
.trend.up { color: #4ade80; } .trend.down { color: #f87171; } .trend.flat { color: #8b93b1; }
.tag { font-size: 1.5em; font-weight: 700; padding: .2em .7em; border-radius: 2em; background: #1f2a4d; }
.sale .tag { background: #166534; }
.badge { font-size: .6em; background: #854d0e; padding: .1em .5em; border-radius: 1em; margin-left: .4em; }
.empty { color: #8b93b1; font-size: 1.6em; padding: 1em 0; }
.av { width: 3.2em; height: 3.2em; border-radius: 50%; object-fit: cover; background: #2b3a6b;
  display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.1em; flex: none; }
.av.big { width: 14em; height: 14em; font-size: 4em; border: .25em solid #4ade80; }

.strip { grid-column: 1 / -1; display: flex; gap: 1.2em; }
.strip-item { flex: 1; background: #121a33; border-radius: 1em; padding: .8em 1.2em;
  display: flex; flex-direction: column; justify-content: center; font-size: 1.4em; gap: .1em; }
.strip-item b { font-size: 1.3em; color: #9db4ff; }
.strip-item span { color: #c9d2f0; }

.celebrate { position: absolute; inset: 0; z-index: 50; background: radial-gradient(circle, #14532d, #052e16 70%);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .6em;
  animation: pop .5s ease; text-align: center; }
@keyframes pop { from { opacity: 0; transform: scale(.9); } to { opacity: 1; transform: none; } }
.c-title { font-size: 7em; font-weight: 900; color: #fde047; letter-spacing: .05em; }
.c-name { font-size: 5em; font-weight: 800; }
.c-sub { font-size: 2.6em; color: #bbf7d0; }
.c-list { display: flex; flex-wrap: wrap; gap: .8em; justify-content: center; max-width: 80%; font-size: 3em; font-weight: 700; }
.ms { font-size: 3.6em; font-weight: 800; background: #fde047; color: #1c1917; padding: .1em .8em; border-radius: 1em; }

.stale { position: absolute; top: 0; left: 0; right: 0; z-index: 60; background: #b91c1c; color: #fff;
  text-align: center; font-size: 2em; font-weight: 800; padding: .3em; }
.sound-gate { position: absolute; z-index: 70; bottom: 1em; left: 50%; transform: translateX(-50%);
  font-size: 2em; padding: .5em 1.2em; border: 0; border-radius: 2em; background: #fde047; color: #1c1917; }

/* ---------- TL page (mobile first) ---------- */
.login { max-width: 22rem; margin: 20vh auto 0; padding: 1rem; display: flex; flex-direction: column; gap: .8rem; }
.login input, .login button { font-size: 1.1rem; padding: .9rem; border-radius: .7rem; border: 1px solid #2b3a6b; background: #121a33; color: #fff; }
.login button { background: #22c55e; border: 0; font-weight: 700; color: #052e16; }
.err { color: #f87171; }
.tl header { display: flex; justify-content: space-between; align-items: center; padding: 1rem; position: sticky; top: 0; background: #0b1020; }
.link { background: none; border: 0; color: #9db4ff; font-size: 1rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: .8rem; padding: 0 1rem 6rem; }
.tile { background: #121a33; border: 1px solid #1f2a4d; border-radius: 1rem; padding: 1rem .5rem; color: #fff;
  display: flex; flex-direction: column; align-items: center; gap: .4rem; min-height: 9rem; }
.tile .av { width: 4rem; height: 4rem; font-size: 1.2rem; }
.tile .name { font-weight: 700; font-size: 1.1rem; }
.tile .count { color: #8b93b1; font-size: .9rem; }
.sheet-bg { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: flex-end; z-index: 10; }
.sheet { width: 100%; background: #121a33; border-radius: 1.2rem 1.2rem 0 0; padding: 1.2rem; padding-bottom: calc(1.2rem + env(safe-area-inset-bottom, 0px)); }
.sheet h2 { margin: 0 0 .8rem; }
.status-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .7rem; margin-bottom: .6rem; }
.status { border: 0; border-radius: .9rem; padding: 1.3rem .5rem; font-size: 1.15rem; font-weight: 800; color: #fff; }
.status:disabled { opacity: .5; }
.toast { position: fixed; left: 1rem; right: 1rem; bottom: calc(1rem + env(safe-area-inset-bottom, 0px)); z-index: 20;
  background: #1f2a4d; border-radius: 1rem; padding: .9rem 1rem; display: flex; justify-content: space-between; align-items: center; }
.toast button { background: #fde047; color: #1c1917; border: 0; border-radius: .6rem; padding: .6rem 1rem; font-weight: 800; }
```

---

## 10. Sounds

Put these files in `client/public/sounds/` (short MP3s, under 5 seconds, normalised to similar loudness):

| File | Used for |
|---|---|
| `bell.mp3` | Sale Closed |
| `gong.mp3` | First sale of the day, every Nth sale |
| `applause.mp3` | Program target hit |
| `chime.mp3` | Interested (played at half volume) |
| `soft.mp3` | Follow-up (played at half volume) |

Use royalty-free or properly licensed sounds only. Check the licence of anything downloaded from a sound library. Test loudness on the real TV speakers on the real floor, then set `normal_volume` and `quiet_volume` in settings.

**Rules**

- Sale bursts are merged into one sound per pop-up, so sounds never pile up.
- Quiet hours (default 22:00 to 07:00) lower the volume. The TV mini PC's clock must be set to IST.
- Only Sale Closed and milestones get a pop-up. Other statuses are quiet by design.

---

## 11. Running 24/7

### 11.1 Server with Docker

#### `Dockerfile`

```dockerfile
FROM node:20-bookworm-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client ./
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server ./
COPY --from=client /app/client/dist /app/client/dist
ENV NODE_ENV=production
EXPOSE 4000
CMD ["sh", "-c", "node src/seed.js && node src/index.js"]
```

#### `docker-compose.yml`

```yaml
services:
  dashboard:
    build: .
    restart: unless-stopped
    ports:
      - "4000:4000"
    env_file: ./server/.env
    volumes:
      - ./data:/app/server/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
```

#### `.gitignore`

```
node_modules/
dist/
data/
.env
```

Without Docker: `npm install -g pm2`, then `pm2 start server/src/index.js --name dashboard` and `pm2 startup && pm2 save`.

### 11.2 TV mini PC (Chrome kiosk)

Use a wired LAN connection, set the Windows/Linux timezone to IST, disable sleep and screen saver, and plug the PC into a UPS.

**Windows: `tv-kiosk.bat`** (put a shortcut in the Startup folder). The loop restarts Chrome if it closes or crashes:

```bat
@echo off
:loop
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required --noerrdialogs --disable-infobars --disable-session-crashed-bubble --check-for-update-interval=31536000 "http://SERVER-IP:4000/tv?key=YOUR_TV_KEY&autosound=1"
timeout /t 5 /nobreak >nul
goto loop
```

**Linux: `tv-kiosk.sh`**

```bash
#!/bin/bash
while true; do
  chromium-browser --kiosk --autoplay-policy=no-user-gesture-required \
    --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
    "http://SERVER-IP:4000/tv?key=YOUR_TV_KEY&autosound=1"
  sleep 5
done
```

Set the TV itself to: no sleep or eco mode, "Just Scan" or "Screen Fit" (no overscan), game or PC mode for sharp text, and a moderate backlight to reduce burn-in.

### 11.3 Backups

Nightly SQLite backup (Linux cron, keep 30 days):

```bash
0 2 * * * sqlite3 /path/to/data/dashboard.db ".backup '/backups/dash-$(date +\%F).db'" && find /backups -name 'dash-*.db' -mtime +30 -delete
```

Copy the backups folder off the machine (cloud drive or another server) weekly.

### 11.4 Monitoring

- Point a free uptime monitor (for example UptimeRobot) at `/api/health` if the server is reachable from outside, or run a simple cron on the LAN that alerts you when it fails.
- The TV's red **"Data delayed"** banner is itself a visible alarm for anyone on the floor.

---

## 12. Phased plan

| Phase | Deliverable | Rough effort |
|---|---|---|
| 0. Setup | Repo, Antigravity workspace, rules file, sample sound files, final status list | 0.5 day |
| 1. Core backend | DB, auth, events API, undo, duplicate guard, snapshot, sockets, seed | 1 to 2 days |
| 2. TL page | Login, team tiles, status sheet, undo toast | 1 day |
| 3. TV page | Layout, leaderboard, feed, top performers, sounds, pop-up, confetti | 2 days |
| 4. Admin | CRUD for users, programs, statuses, targets, settings, void, audit, CSV | 2 days |
| 5. Hardening | Stale detection, nightly reload, burn-in shift, tests, Docker, kiosk scripts | 1 day |
| 6. Pilot | One or two programs for one week, collect feedback, tune sounds and layout | 1 week |
| 7. Rollout | Import all users, train TLs, go live | 2 to 3 days |
| 8. Gamification (optional) | Streaks, badges, team battles, birthday banners | 2 to 3 days |

Do not start phase 8 until the pilot shows TLs are updating statuses consistently. If TL updates are patchy, fix that first, because every number on the TV depends on it.

---

## 13. How to use this file in Antigravity

1. Install Antigravity, sign in, and open an **empty folder** as the workspace.
2. Save this file as `DEVELOPMENT_GUIDE.md` in the folder root.
3. Add the **project rules** from Prompt 0 (Antigravity supports workspace rules; look under its Customizations or Rules settings, since the exact place can differ by version).
4. Open the **Agent Manager** (or the agent panel) and run the prompts in section 14 **one at a time, in order**.
5. For big steps (prompts 1, 3, 4, 8) use **Planning mode** and read the implementation plan before approving. For small fixes use the faster mode.
6. After every prompt: run the app, test, and **commit to git**. If a step goes wrong, roll back that commit instead of stacking fixes.
7. Ask the agent to use the **browser** to open `/tv` and `/tl` and take a screenshot, so it checks its own UI.
8. In every prompt, mention `@DEVELOPMENT_GUIDE.md` so the agent reads the reference code and requirements.

**Tips**

- Reference code in this guide is a working baseline. Tell the agent to "use it as the starting point and improve it", not to rewrite from scratch.
- Never paste real PINs, JWT secrets or TV keys into prompts. Keep them in `.env`.
- If the agent invents extra features, point it back at section 1 (scope) and section 2 (requirements).

---

## 14. Antigravity prompts (copy-paste, in order)

### Prompt 0: Project rules (add once as workspace rules)

```text
You are building a 24/7 live sales dashboard for a 108-inch TV plus a mobile page for team leaders.
Always read @DEVELOPMENT_GUIDE.md before working; it is the source of truth for scope, architecture and reference code.

Rules:
- Stack: Node 20, Express, Socket.IO, better-sqlite3 (SQLite, WAL), React 18 + Vite. Do not add other frameworks or a different database without asking.
- Counts only on screen; never display money values anywhere.
- TLs enter data manually. Every change must be audit-logged (who, what, when).
- All timestamps stored as UTC ISO strings; business_date computed in Asia/Kolkata using DAY_START_HOUR.
- Never hardcode secrets. Use .env and keep .env.example updated.
- Validate all input on the server. Use parameterised SQL only.
- The TV must never silently show stale data: show "Data delayed" when disconnected or no update for 75 seconds.
- Keep the TV UI sized in em units relative to screen width, dark theme, high contrast, readable from 10 metres.
- Keep functions small, add comments only where the reason is not obvious, and keep the folder structure from section 5 of the guide.
- After each task: run the app, run tests, summarise what changed, and list anything you were unsure about.
```

### Prompt 1: Scaffold and database

```text
Read @DEVELOPMENT_GUIDE.md. Create the project structure from section 5 (server/ and client/ only for now).
Use the reference code for server/package.json, .env.example, src/db.js, src/seed.js as the baseline.
Install dependencies, copy .env.example to .env with generated random JWT_SECRET and TV_KEY, run the seed, and confirm the tables and demo data exist.
Acceptance: `npm run seed` runs twice without errors or duplicate rows; database file is created under ./data; I get a short list of the tables and row counts.
```

### Prompt 2: Auth

```text
Using section 8 of @DEVELOPMENT_GUIDE.md as the baseline, implement src/auth.js and src/routes/auth.js (PIN login with bcrypt, JWT, requireAuth, tvOrAuth) and wire them into src/index.js with the health endpoint.
Add login rate limiting and audit-log entries for success and failure.
Acceptance: logging in as TL001 / 111111 returns a token; wrong PIN returns 401; /api/health works; protected routes return 401 without a token. Show me the curl commands you used to verify.
```

### Prompt 3: Events, undo, duplicate guard, milestones

```text
Using section 8 as the baseline, implement services/events.js, routes/events.js and services/dashboard.js.
Requirements: a TL can only record for their own telecallers; duplicate sale within 20 seconds returns 409 DUPLICATE_CONFIRM unless confirm_duplicate is true; undo works only for the creator within the undo window; admin can void anytime with a reason; milestones are detected (first sale of the day, program target hit, every 10th sale); /api/dashboard returns the snapshot.
Write automated tests (vitest or node:test with supertest) covering: ownership check, duplicate guard, undo window, void excluded from counts, milestone detection, business_date around midnight IST.
Acceptance: all tests pass; summarise the test cases.
```

### Prompt 4: Real-time layer

```text
Finish src/index.js per the guide: Socket.IO with TV-key or JWT auth, snapshot on connect, snapshot after every change, 30-second heartbeat, static serving of client/dist, global error handler, and crash handlers that exit so Docker/pm2 restart the process.
Add server/scripts/simulate.mjs from the guide.
Acceptance: write a small Node script (or test) that connects as a TV with the TV key, runs the simulator, and prints received snapshot and event:new messages. A connection with a wrong key must be rejected.
```

### Prompt 5: TL page

```text
Using the client reference code in @DEVELOPMENT_GUIDE.md, scaffold the client (Vite + React) and build the TL page at /tl.
Requirements: mobile-first, large tap targets, login with employee code and PIN (session kept in localStorage), photo tiles with today's sale count, bottom-sheet with status buttons, 10-second Undo toast, duplicate confirmation, clear error if the network is down ("entry was NOT saved"), auto-logout on 401, safe-area padding for phones.
Acceptance: use the browser tool to open /tl at 390x844, log in as TL001, record a sale and an interested status, undo one, and attach screenshots. Count of sales on the tile must update.
```

### Prompt 6: TV page

```text
Build the TV page at /tv using the reference TVPage.jsx and styles.css in @DEVELOPMENT_GUIDE.md as the baseline.
Requirements: layout and behaviour exactly as section 2 (F6 to F9, N2 to N4): header with total vs target and clock, program leaderboard with trend arrows and pagination when more than 8 programs, live feed, top performers rotating between today and 7 days, engagement strip, Sale Closed pop-up with photo/initials and confetti, burst merging, milestone variants, "Data delayed" banner, nightly reload at 03:30, burn-in shifting, ?autosound=1 for kiosk.
Add the five sound files as placeholders (short generated or royalty-free tones) in client/public/sounds and document where to replace them.
Acceptance: run the simulator and open /tv?key=<TV_KEY> in the browser tool at 3840x2160 and at 1920x1080; attach screenshots of normal state, a sale pop-up, and the stale banner (stop the server to trigger it).
```

### Prompt 7: Settings and sound behaviour

```text
Make sound behaviour match section 10 of @DEVELOPMENT_GUIDE.md: volumes from settings, quiet hours (including windows that cross midnight), sound_enabled switch, half volume for non-sale sounds, and no overlapping sounds during bursts.
Add unit tests for the quiet-hours calculation in client/src/sound.js (extract the pure function so it is testable).
Acceptance: tests pass; summarise edge cases covered.
```

### Prompt 8: Admin panel

```text
Build /admin (admin login required) using the API in section 7.
Screens: Users (add, edit, deactivate, reset PIN, assign program and TL, photo URL), Programs (name, daily target), Statuses (label, is_sale, sound, color, order, show_in_feed), Settings (sound, volumes, quiet hours, rotation seconds), Today's entries (search, void with required reason), Audit log (filter by actor/action/date), Export CSV (date range).
Also add bulk import of users from CSV (name, role, employee_code, program, tl_code) with a preview and error report before saving.
Make it clean and usable on a laptop. Reuse the existing styles.
Acceptance: browser-tool walkthrough with screenshots: create a program, a TL and two telecallers, import a 5-row CSV, void an entry, and see the TV update live.
```

### Prompt 9: Hardening

```text
Harden the system per N1 to N7 and sections 11 and 16 of @DEVELOPMENT_GUIDE.md:
- Add Dockerfile, docker-compose.yml, .gitignore, and tv-kiosk.bat / tv-kiosk.sh from the guide; verify `docker compose up` builds and the TV page loads.
- Add helmet, CORS from env, request body size limit, and a PIN lockout after 5 wrong attempts per employee code for 10 minutes.
- Add a SQLite nightly backup script and document restore steps.
- Add a README.md with: setup, env vars, how to add sounds, how to open the TV page, how to rotate the TV key, how to restore a backup.
Acceptance: list every hardening change, and run a 10-minute soak test with the simulator at 1 event/second; report memory use and any errors.
```

### Prompt 10: Review pass

```text
Act as a strict reviewer. Read the whole codebase against @DEVELOPMENT_GUIDE.md sections 1, 2 and 16.
Produce a checklist: requirement, status (done/partial/missing), file and line evidence.
Then fix every "partial" or "missing" item that is in v1 scope, and list the rest as follow-ups. Do not add features outside the guide.
```

### Prompt 11 (optional, after the pilot): Gamification

```text
Add optional gamification, each behind a setting that defaults to off: daily and weekly streaks (consecutive days a program hits target), badges (First Sale, Closer = 5 sales in a day, Comeback = beat yesterday), a "Hot now" indicator for the most sales in the last 60 minutes, program-vs-program nudges ("Program B is 3 sales behind Program A"), and birthday/work-anniversary banners from an optional date field on users.
Show only positive recognition on the TV (no bottom-of-the-list rankings).
Acceptance: tests for streak and badge logic, plus screenshots of each element on the TV page.
```

### Prompt for any bug or change

```text
@DEVELOPMENT_GUIDE.md Context: <what you were doing>. Problem: <what happened vs what you expected>. 
First reproduce it and explain the cause. Then fix it with the smallest change, add a test that would have caught it, and tell me which files changed.
```

---

## 15. Testing and acceptance checklist

**Functional**

- [ ] TL logs in, sees only their own telecallers
- [ ] Two taps record a status; TV updates within 1 second
- [ ] Undo works within 10 seconds, not after
- [ ] Duplicate sale within 20 seconds asks for confirmation
- [ ] A TL cannot record for another TL's telecaller (try it with the API)
- [ ] Voided entries disappear from counts and from the feed
- [ ] Sale pop-up shows the right name, program and TL
- [ ] 5 sales in 3 seconds produce one merged pop-up and one sound
- [ ] First sale of the day, target hit and every 10th sale use the milestone sound
- [ ] Quiet hours lower the volume; sound_enabled = 0 mutes everything
- [ ] Admin void requires a reason and appears in the audit log
- [ ] CSV export matches what the admin screen shows

**Reliability**

- [ ] Stop the server: TV shows "Data delayed" within about 75 seconds, then recovers on its own when the server returns
- [ ] Unplug the TV mini PC's network for 5 minutes: it reconnects without a refresh
- [ ] Kill Chrome: the kiosk loop restarts it
- [ ] Reboot the mini PC: the dashboard comes back unattended
- [ ] Leave it running 48 hours: memory stays flat, no console errors
- [ ] Cross midnight IST (or the DAY_START_HOUR boundary): counts reset and the leaderboard is correct
- [ ] Restore from a backup on a clean machine

**On the real TV**

- [ ] Names readable from the farthest desk
- [ ] Sound audible but not painful; tested at quiet hours too
- [ ] No overscan cut-off at the edges
- [ ] Pop-up and confetti animations are smooth (no dropped frames on the mini PC)

---

## 16. Things that are easy to miss

**Data quality (manual entry)**

- TLs will mis-tap. Undo, admin void and the audit log are not optional.
- Consider an optional `lead_ref` (last 4 digits of the phone number or a lead ID) so management can spot-check sales later. Keep it optional so it doesn't slow TLs down.
- A "no updates for 30+ minutes" flag on the **admin** screen (not on the TV) helps find TLs who stopped updating.
- Decide who may edit yesterday's data (default: admin only).

**Business rules to decide before building**

- The final **status list**, and exactly which statuses count as a sale.
- Whether a "sale" later cancelled by the customer should be removed (admin void) and who decides.
- Targets: daily only, or weekly and monthly too? Do Sundays and holidays have targets?
- **Night shifts**: set `DAY_START_HOUR` so a shift that crosses midnight counts as one business day.
- Tie-breakers on the leaderboard (fewer total updates wins, as in the reference code; change if you prefer conversion %).

**People and fairness**

- Photos and names on a big screen: get employee consent and follow your HR and privacy policy (India's DPDP Act covers personal data such as photos).
- Show top performers and positive nudges only. Publicly ranking the bottom hurts morale and encourages gaming the system.
- Rankings built from manual data can be gamed. Spot-check with `lead_ref` and the audit log.
- Train TLs for 10 minutes and give them a one-page "how to update" card. Adoption decides whether this works.

**Technical**

- Set the TV PC's timezone to IST; quiet hours use the browser's local time.
- 4-digit PINs are weak; use 6 digits and the lockout in Prompt 9. Change the seeded admin PIN on day one and rotate `TV_KEY` if the URL leaks.
- If the TL page is used outside the office network, put the server behind HTTPS (for example Caddy or nginx with a certificate). On the office LAN only, HTTP is workable.
- Browsers block sound until the user interacts once. The kiosk flag plus `&autosound=1` handles the TV; for a normal browser the "Click once to enable sound" button appears.
- Use a UPS for the mini PC and the router. A power blip is the most common cause of a dead TV screen.
- Optimise photos (about 200 x 200 px) so the TV loads quickly. Store them on the server or a CDN and put the URL in `photo_url`.
- The 30-second heartbeat means the TV recovers from a missed message and rolls over at midnight without a reload.
- Use only licensed sound effects.
- SQLite is fine for this size. If you later need several app servers, move to PostgreSQL (the SQL here is standard) and add a Redis adapter for Socket.IO.

---

## 17. Future ideas

- **Event ingestion API:** the event service is source-agnostic, so a CRM, dialer or spreadsheet can push events later without changing the TV.
- Daily summary sent to management by email or WhatsApp at end of shift.
- TL dashboard for their own team's stats and trends on the phone.
- Multiple TV screens with different layouts (per floor or per program group).
- Shift-based modes (day and night themes, different targets).
- Weekly and monthly "Hall of Fame" rotation with winners' photos.
- Team-vs-team challenges with start and end dates set by admin.
