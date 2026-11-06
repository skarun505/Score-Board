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
  if (prog && prog.daily_target > 0 && progSales === prog.daily_target) {
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
  if (actor.role === 'telecaller' && tc.id !== actor.id) throw new HttpError(403, 'You can only record activity for yourself');

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
