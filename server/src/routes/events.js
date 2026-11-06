import { Router } from 'express';
import { db, businessDate } from '../db.js';
import { requireAuth } from '../auth.js';
import { recordEvent, undoEvent, getEventView, UNDO_SECONDS } from '../services/events.js';
import { getSnapshot } from '../services/dashboard.js';

const router = Router();

router.get('/statuses', requireAuth(['tl', 'admin', 'telecaller']), (req, res) => {
  res.json(db.prepare(
    `SELECT id, code, label, is_sale, color FROM statuses WHERE active = 1 ORDER BY sort_order`
  ).all());
});

router.get('/team', requireAuth(['tl', 'admin']), (req, res) => {
  const today = businessDate();
  const now = new Date();
  const weekFrom = businessDate(new Date(now.getTime() - 6 * 86400_000));
  const where = req.user.role === 'tl' ? 'AND u.tl_id = ?' : '';
  const params = req.user.role === 'tl'
    ? [today, today, weekFrom, today, weekFrom, today, req.user.id]
    : [today, today, weekFrom, today, weekFrom, today];
  const rows = db.prepare(`
    SELECT u.id, u.name, u.photo_url, u.program_id, p.name AS program_name, p.daily_target,
           COUNT(DISTINCT CASE WHEN e.business_date = ? THEN e.id END) AS updates_today,
           COALESCE(SUM(CASE WHEN e.business_date = ? AND s.is_sale = 1 THEN 1 ELSE 0 END), 0) AS sales_today,
           COALESCE(SUM(CASE WHEN e.business_date BETWEEN ? AND ? AND s.is_sale = 1 THEN 1 ELSE 0 END), 0) AS sales_week
    FROM users u
    LEFT JOIN programs p ON p.id = u.program_id
    LEFT JOIN events e ON e.telecaller_id = u.id AND e.business_date BETWEEN ? AND ? AND e.voided = 0
    LEFT JOIN statuses s ON s.id = e.status_id
    WHERE u.role = 'telecaller' AND u.active = 1 ${where}
    GROUP BY u.id ORDER BY u.name`).all(...params);
  res.json(rows);
});

/* Counselor profile and today's activity stats */
router.get('/counselor/me', requireAuth(['telecaller', 'tl', 'admin']), (req, res) => {
  const today = businessDate();
  const now = new Date();
  const weekFrom = businessDate(new Date(now.getTime() - 6 * 86400_000));
  const tcId = req.user.id;
  const user = db.prepare(`
    SELECT u.id, u.name, u.employee_code, u.role, u.photo_url,
           p.name AS program_name, p.daily_target AS program_target,
           tl.name AS tl_name
    FROM users u
    LEFT JOIN programs p ON p.id = u.program_id
    LEFT JOIN users tl ON tl.id = u.tl_id
    WHERE u.id = ? AND u.active = 1`).get(tcId);

  if (!user) return res.status(404).json({ error: 'User not found' });

  const stats = db.prepare(`
    SELECT
      COUNT(e.id) AS total_today,
      COALESCE(SUM(CASE WHEN s.code = 'sale_closed' THEN 1 ELSE 0 END), 0) AS sales_today,
      COALESCE(SUM(CASE WHEN s.code = 'interested' THEN 1 ELSE 0 END), 0) AS interested_today,
      COALESCE(SUM(CASE WHEN s.code = 'follow_up' THEN 1 ELSE 0 END), 0) AS followup_today,
      COALESCE(SUM(CASE WHEN s.code = 'l1_selected' THEN 1 ELSE 0 END), 0) AS l1_today,
      COALESCE(SUM(CASE WHEN s.code = 'l2_selected' THEN 1 ELSE 0 END), 0) AS l2_today,
      COALESCE(SUM(CASE WHEN s.code = 'callback' THEN 1 ELSE 0 END), 0) AS callback_today,
      COALESCE(SUM(CASE WHEN s.code = 'not_interested' THEN 1 ELSE 0 END), 0) AS not_interested_today
    FROM events e
    JOIN statuses s ON s.id = e.status_id
    WHERE e.telecaller_id = ? AND e.business_date = ? AND e.voided = 0`).get(tcId, today);

  // Weekly sales for this counselor
  const weekRow = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN s.is_sale = 1 THEN 1 ELSE 0 END), 0) AS sales_week
    FROM events e JOIN statuses s ON s.id = e.status_id
    WHERE e.telecaller_id = ? AND e.business_date BETWEEN ? AND ? AND e.voided = 0
  `).get(tcId, weekFrom, today);
  stats.sales_week = weekRow?.sales_week || 0;

  // Personal rank on today's leaderboard
  const rankRow = db.prepare(`
    SELECT COUNT(*) + 1 AS rank
    FROM (
      SELECT e.telecaller_id, SUM(CASE WHEN s.is_sale = 1 THEN 1 ELSE 0 END) AS sales
      FROM events e JOIN statuses s ON s.id = e.status_id
      WHERE e.business_date = ? AND e.voided = 0
      GROUP BY e.telecaller_id
      HAVING sales > (
        SELECT COALESCE(SUM(CASE WHEN s2.is_sale=1 THEN 1 ELSE 0 END),0)
        FROM events e2 JOIN statuses s2 ON s2.id=e2.status_id
        WHERE e2.telecaller_id=? AND e2.business_date=? AND e2.voided=0
      )
    )
  `).get(today, tcId, today);
  stats.rank_today = rankRow?.rank || 1;

  // Total active callers today (for context: "rank X of Y")
  const activeTodayRow = db.prepare(`
    SELECT COUNT(DISTINCT e.telecaller_id) AS cnt
    FROM events e JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date = ? AND e.voided = 0 AND s.is_sale = 1
  `).get(today);
  stats.active_callers_today = activeTodayRow?.cnt || 0;

  const recent = db.prepare(`
    SELECT e.id, e.created_at, e.lead_ref, s.code, s.label, s.color, s.is_sale
    FROM events e
    JOIN statuses s ON s.id = e.status_id
    WHERE e.telecaller_id = ? AND e.business_date = ? AND e.voided = 0
    ORDER BY e.id DESC LIMIT 15`).all(tcId, today);

  res.json({
    user,
    stats,
    recent,
  });
});

router.post('/events', requireAuth(['tl', 'admin', 'telecaller']), (req, res, next) => {
  try {
    let { telecaller_id, status_code, lead_ref, confirm_duplicate } = req.body || {};
    if (req.user.role === 'telecaller') {
      telecaller_id = req.user.id;
    }
    const r = recordEvent({
      actor: req.user,
      telecallerId: Number(telecaller_id),
      statusCode: status_code,
      leadRef: lead_ref,
      confirmDuplicate: !!confirm_duplicate,
    });
    const event = { ...getEventView(r.id), milestone: r.milestone };
    const io = req.app.get('io');
    if (io) {
      io.emit('event:new', event);
      io.emit('snapshot', getSnapshot());
    }
    res.status(201).json({ event, undo_seconds: UNDO_SECONDS });
  } catch (e) { next(e); }
});

router.post('/events/:id/undo', requireAuth(['tl', 'admin', 'telecaller']), (req, res, next) => {
  try {
    undoEvent(req.user, Number(req.params.id));
    const io = req.app.get('io');
    if (io) io.emit('snapshot', getSnapshot());
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/**
 * POST /api/events/counselor/custom-count
 * Counselor sets custom count for their own status with 1-time daily rechange safeguard
 */
router.post('/counselor/custom-count', requireAuth(['telecaller', 'tl', 'admin']), (req, res) => {
  const counselorId = req.user.id;
  const tc = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'telecaller' AND active = 1").get(counselorId);
  if (!tc) return res.status(404).json({ error: 'Counselor not found.' });

  const { status_code, count } = req.body || {};
  const allowedStatuses = ['sale_closed', 'l1_selected', 'l2_selected', 'interested', 'follow_up'];
  if (!allowedStatuses.includes(status_code)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` });
  }

  const newCount = Number(count);
  if (isNaN(newCount) || newCount < 0 || newCount > 500) {
    return res.status(400).json({ error: 'Count must be a valid non-negative number (0-500).' });
  }

  const today = businessDate();
  const st = db.prepare('SELECT id, code, label, is_sale FROM statuses WHERE code = ?').get(status_code);
  if (!st) return res.status(400).json({ error: 'Status not found.' });

  // 1-Time Daily Rechange Safeguard
  const existingAdj = db.prepare(`
    SELECT * FROM daily_adjustments
    WHERE telecaller_id = ? AND status_code = ? AND business_date = ?
  `).get(counselorId, status_code, today);

  if (existingAdj && req.user.role !== 'admin') {
    return res.status(400).json({
      error: `Daily value for ${st.label} has already been adjusted today (set to ${existingAdj.new_count}). ` +
             `You can only rechange your daily count once per day. Please contact your TL or Admin for further updates.`,
      code: 'DAILY_RECHANGE_LIMIT_REACHED',
      already_adjusted: true,
      current_count: existingAdj.new_count,
    });
  }

  const currentEvents = db.prepare(`
    SELECT id, created_at FROM events
    WHERE telecaller_id = ? AND status_id = ? AND business_date = ? AND voided = 0
    ORDER BY id DESC
  `).all(counselorId, st.id, today);

  const currentCount = currentEvents.length;
  const now = new Date();
  const nowIso = now.toISOString();

  if (newCount > currentCount) {
    const toAdd = newCount - currentCount;
    const ins = db.prepare(`
      INSERT INTO events (telecaller_id, program_id, tl_id, status_id, lead_ref, created_by, created_at, business_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let i = 0; i < toAdd; i++) {
      ins.run(tc.id, tc.program_id, tc.tl_id, st.id, `Counselor custom count (${i + 1}/${toAdd})`, req.user.id, nowIso, today);
    }
  } else if (newCount < currentCount) {
    const toVoid = currentCount - newCount;
    const eventsToVoid = currentEvents.slice(0, toVoid);
    const upd = db.prepare(`
      UPDATE events
      SET voided = 1, voided_by = ?, voided_at = ?, void_reason = ?
      WHERE id = ?
    `);
    eventsToVoid.forEach((ev) => {
      upd.run(req.user.id, nowIso, `Rechanged custom count to ${newCount}`, ev.id);
    });
  }

  if (existingAdj) {
    db.prepare(`
      UPDATE daily_adjustments
      SET old_count = ?, new_count = ?, adjusted_by = ?, created_at = ?
      WHERE id = ?
    `).run(currentCount, newCount, req.user.id, nowIso, existingAdj.id);
  } else {
    db.prepare(`
      INSERT INTO daily_adjustments (telecaller_id, status_code, business_date, adjusted_by, old_count, new_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(counselorId, status_code, today, req.user.id, currentCount, newCount, nowIso);
  }

  const io = req.app.get('io');
  if (io) io.emit('snapshot', getSnapshot());

  res.json({
    ok: true,
    status_code,
    status_label: st.label,
    old_count: currentCount,
    new_count: newCount,
    remaining_rechanges_today: 0,
    message: `Count for ${st.label} successfully set to ${newCount}. Daily rechange recorded.`,
  });
});

export default router;
