import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, businessDate, audit } from '../db.js';
import { requireAuth } from '../auth.js';
import { getSnapshot } from '../services/dashboard.js';

const router = Router();
router.use(requireAuth(['tl', 'admin']));

const refresh = (req) => {
  const io = req.app.get('io');
  if (io) io.emit('snapshot', getSnapshot());
};

/**
 * GET /api/tl/programs
 * List active programs for counselor assignment
 */
router.get('/programs', (req, res) => {
  res.json(db.prepare('SELECT id, name, daily_target FROM programs WHERE active = 1 ORDER BY name').all());
});

/**
 * GET /api/tl/counselors
 * Returns all counselors under this TL (or all if admin) with today's metrics
 * and daily adjustment status
 */
router.get('/counselors', (req, res) => {
  const today = businessDate();
  const now = new Date();
  const weekFrom = businessDate(new Date(now.getTime() - 6 * 86400_000));
  const isTl = req.user.role === 'tl';
  const where = isTl ? 'AND u.tl_id = ?' : '';
  const params = isTl
    ? [today, today, today, today, today, today, weekFrom, today, weekFrom, today, req.user.id]
    : [today, today, today, today, today, today, weekFrom, today, weekFrom, today];

  const rows = db.prepare(`
    SELECT u.id, u.name, u.employee_code, u.role, u.photo_url, u.program_id, u.tl_id, u.active,
           p.name AS program_name, p.daily_target,
           tl.name AS tl_name,
           COUNT(DISTINCT CASE WHEN e.business_date = ? THEN e.id END) AS updates_today,
           COALESCE(SUM(CASE WHEN e.business_date = ? AND s.code = 'sale_closed' THEN 1 ELSE 0 END), 0) AS sales_today,
           COALESCE(SUM(CASE WHEN e.business_date = ? AND s.code = 'l1_selected' THEN 1 ELSE 0 END), 0) AS l1_today,
           COALESCE(SUM(CASE WHEN e.business_date = ? AND s.code = 'l2_selected' THEN 1 ELSE 0 END), 0) AS l2_today,
           COALESCE(SUM(CASE WHEN e.business_date = ? AND s.code = 'interested' THEN 1 ELSE 0 END), 0) AS interested_today,
           COALESCE(SUM(CASE WHEN e.business_date = ? AND s.code = 'follow_up' THEN 1 ELSE 0 END), 0) AS followup_today,
           COALESCE(SUM(CASE WHEN e.business_date BETWEEN ? AND ? AND s.is_sale = 1 THEN 1 ELSE 0 END), 0) AS sales_week
    FROM users u
    LEFT JOIN programs p ON p.id = u.program_id
    LEFT JOIN users tl ON tl.id = u.tl_id
    LEFT JOIN events e ON e.telecaller_id = u.id AND e.business_date BETWEEN ? AND ? AND e.voided = 0
    LEFT JOIN statuses s ON s.id = e.status_id
    WHERE u.role = 'telecaller' AND u.active = 1 ${where}
    GROUP BY u.id
    ORDER BY u.name
  `).all(...params);

  // Check adjustments already used today
  const adjustments = db.prepare(`
    SELECT telecaller_id, status_code, new_count
    FROM daily_adjustments
    WHERE business_date = ?
  `).all(today);

  const adjMap = {};
  adjustments.forEach((a) => {
    adjMap[`${a.telecaller_id}_${a.status_code}`] = true;
  });

  const enriched = rows.map((r) => ({
    ...r,
    adjustment_used: {
      sale_closed: !!adjMap[`${r.id}_sale_closed`],
      l1_selected: !!adjMap[`${r.id}_l1_selected`],
      l2_selected: !!adjMap[`${r.id}_l2_selected`],
    },
  }));

  res.json(enriched);
});

/**
 * POST /api/tl/counselors
 * TL manually adds a new counselor directly to their team
 */
router.post('/counselors', (req, res) => {
  const { name, employee_code, program_id, pin, photo_url } = req.body || {};
  const code = String(employee_code || '').trim().toUpperCase();
  const counselorName = String(name || '').trim();

  if (!counselorName || !code) {
    return res.status(400).json({ error: 'Name and Employee Code are required.' });
  }

  // Check code uniqueness
  const existing = db.prepare('SELECT id FROM users WHERE employee_code = ?').get(code);
  if (existing) {
    return res.status(409).json({ error: `Employee code ${code} is already assigned to another user.` });
  }

  const tlId = req.user.role === 'tl' ? req.user.id : (Number(req.body.tl_id) || req.user.id);
  const progId = program_id ? Number(program_id) : (req.user.program_id || null);
  const pinToHash = String(pin || '111111').trim();
  const pinHash = bcrypt.hashSync(pinToHash, 10);

  const r = db.prepare(`
    INSERT INTO users (name, role, employee_code, pin_hash, program_id, tl_id, photo_url, active)
    VALUES (?, 'telecaller', ?, ?, ?, ?, ?, 1)
  `).run(counselorName, code, pinHash, progId, tlId, photo_url || null);

  const newId = Number(r.lastInsertRowid);
  audit(req.user.id, 'counselor.create', 'user', newId, { name: counselorName, employee_code: code, tl_id: tlId });

  refresh(req);
  res.status(201).json({
    id: newId,
    name: counselorName,
    employee_code: code,
    program_id: progId,
    tl_id: tlId,
    photo_url: photo_url || null,
  });
});

/**
 * PATCH /api/tl/counselors/:id
 * TL edits counselor details (name, employee_code, program_id, pin, photo, active)
 */
router.patch('/counselors/:id', (req, res) => {
  const counselorId = Number(req.params.id);
  const tc = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'telecaller'").get(counselorId);
  if (!tc) return res.status(404).json({ error: 'Counselor not found.' });

  if (req.user.role === 'tl' && tc.tl_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only edit counselors in your own team.' });
  }

  const { name, employee_code, program_id, pin, photo_url, active } = req.body || {};
  const sets = [];
  const vals = [];

  if (name !== undefined) { sets.push('name = ?'); vals.push(String(name).trim()); }
  if (employee_code !== undefined) {
    const code = String(employee_code).trim().toUpperCase();
    const clash = db.prepare('SELECT id FROM users WHERE employee_code = ? AND id != ?').get(code, counselorId);
    if (clash) return res.status(409).json({ error: `Employee code ${code} is already taken.` });
    sets.push('employee_code = ?'); vals.push(code);
  }
  if (program_id !== undefined) { sets.push('program_id = ?'); vals.push(program_id ? Number(program_id) : null); }
  if (photo_url !== undefined) { sets.push('photo_url = ?'); vals.push(photo_url || null); }
  if (active !== undefined) { sets.push('active = ?'); vals.push(active ? 1 : 0); }
  if (pin) {
    sets.push('pin_hash = ?');
    vals.push(bcrypt.hashSync(String(pin).trim(), 10));
  }

  if (sets.length === 0) return res.json(tc);

  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, counselorId);
  audit(req.user.id, 'counselor.update', 'user', counselorId, { fields: Object.keys(req.body) });

  refresh(req);
  res.json({ ok: true, message: 'Counselor updated successfully.' });
});

/**
 * POST /api/tl/counselors/:id/custom-count
 * Custom count entry and 1-time daily rechange safeguard for Sales, L1, L2
 */
router.post('/counselors/:id/custom-count', (req, res) => {
  const counselorId = Number(req.params.id);
  const tc = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'telecaller' AND active = 1").get(counselorId);
  if (!tc) return res.status(404).json({ error: 'Counselor not found.' });

  if (req.user.role === 'tl' && tc.tl_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only adjust counts for counselors in your team.' });
  }

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
  if (!st) return res.status(400).json({ error: 'Status not found in database.' });

  // 1-Time Daily Rechange Safeguard
  const existingAdj = db.prepare(`
    SELECT * FROM daily_adjustments
    WHERE telecaller_id = ? AND status_code = ? AND business_date = ?
  `).get(counselorId, status_code, today);

  if (existingAdj && req.user.role !== 'admin') {
    return res.status(400).json({
      error: `Daily value for ${st.label} has already been adjusted today (set to ${existingAdj.new_count}). ` +
             `To protect floor data integrity, counselors/TLs can rechange daily count once per day. ` +
             `Please contact an Administrator for any further corrections.`,
      code: 'DAILY_RECHANGE_LIMIT_REACHED',
      already_adjusted: true,
      current_count: existingAdj.new_count,
    });
  }

  // Count current non-voided events today
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
      ins.run(
        tc.id,
        tc.program_id,
        tc.tl_id,
        st.id,
        `Custom count (${i + 1}/${toAdd})`,
        req.user.id,
        nowIso,
        today
      );
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

  // Record or update daily adjustment record
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

  audit(req.user.id, 'custom_count.set', 'counselor', counselorId, {
    status: status_code,
    old_count: currentCount,
    new_count: newCount,
    rechange_used: true,
  });

  refresh(req);
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

/**
 * POST /api/tl/broadcast
 * TL or Admin broadcasts a live motivational ticker message to the 108" TV
 */
router.post('/broadcast', (req, res) => {
  const { message, style = 'fire', active = true } = req.body || {};
  const msg = String(message || '').trim();

  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  upsert.run('tv_broadcast_message', msg);
  upsert.run('tv_broadcast_style', style);
  upsert.run('tv_broadcast_active', active && msg ? '1' : '0');

  audit(req.user.id, 'tl.broadcast', 'tv', null, { message: msg, style, active });

  const io = req.app.get('io');
  if (io) {
    io.emit('tv_broadcast', { message: msg, style, active: active && !!msg });
    io.emit('snapshot', getSnapshot());
  }

  res.json({ ok: true, message: 'Broadcast updated on TV.' });
});

/**
 * GET /api/tl/reports/summary
 * TL Report Center: Full team summary, hourly velocity, and WhatsApp copy text
 */
router.get('/reports/summary', (req, res) => {
  const today = businessDate();
  const now = new Date();
  const weekFrom = businessDate(new Date(now.getTime() - 6 * 86400_000));
  const monthFrom = today.slice(0, 8) + '01';
  const isTl = req.user.role === 'tl';
  const where = isTl ? 'AND u.tl_id = ?' : '';
  const params = isTl ? [req.user.id] : [];

  // Team counselors
  const teamMembers = db.prepare(`
    SELECT u.id, u.name, u.employee_code, u.photo_url, p.name AS program_name, p.daily_target
    FROM users u
    LEFT JOIN programs p ON p.id = u.program_id
    WHERE u.role = 'telecaller' AND u.active = 1 ${where}
    ORDER BY u.name
  `).all(...params);

  const tcIds = teamMembers.map((m) => m.id);

  let countsToday = [];
  let hourlySalesRows = [];
  if (tcIds.length > 0) {
    const inClause = `(${tcIds.join(',')})`;
    countsToday = db.prepare(`
      SELECT e.telecaller_id, s.code, COUNT(*) AS count
      FROM events e
      JOIN statuses s ON s.id = e.status_id
      WHERE e.telecaller_id IN ${inClause} AND e.business_date = ? AND e.voided = 0
      GROUP BY e.telecaller_id, s.code
    `).all(today);

    hourlySalesRows = db.prepare(`
      SELECT strftime('%H', datetime(e.created_at, '+5 hours', '30 minutes')) AS hr,
             COUNT(*) AS count
      FROM events e
      JOIN statuses s ON s.id = e.status_id
      WHERE e.telecaller_id IN ${inClause} AND e.business_date = ? AND e.voided = 0 AND s.is_sale = 1
      GROUP BY hr
    `).all(today);
  }

  const countsMap = {};
  countsToday.forEach((c) => {
    if (!countsMap[c.telecaller_id]) countsMap[c.telecaller_id] = {};
    countsMap[c.telecaller_id][c.code] = c.count;
  });

  const memberStats = teamMembers.map((m) => {
    const c = countsMap[m.id] || {};
    const sales = c.sale_closed || 0;
    const l1 = c.l1_selected || 0;
    const l2 = c.l2_selected || 0;
    const interested = c.interested || 0;
    const followup = c.follow_up || 0;
    const total = Object.values(c).reduce((sum, v) => sum + v, 0);
    return {
      ...m,
      sales,
      l1,
      l2,
      interested,
      followup,
      total_updates: total,
    };
  }).sort((a, b) => b.sales - a.sales || b.total_updates - a.total_updates);

  // Hourly velocity (09:00 to 20:00)
  const hourlySales = {};
  for (let h = 9; h <= 20; h++) hourlySales[h] = 0;
  hourlySalesRows.forEach((r) => {
    const hr = Number(r.hr);
    if (!isNaN(hr)) hourlySales[hr] = r.count;
  });

  const totalSales = memberStats.reduce((sum, m) => sum + m.sales, 0);
  const totalL1 = memberStats.reduce((sum, m) => sum + m.l1, 0);
  const totalL2 = memberStats.reduce((sum, m) => sum + m.l2, 0);
  const totalInterested = memberStats.reduce((sum, m) => sum + m.interested, 0);
  const totalFollowup = memberStats.reduce((sum, m) => sum + m.followup, 0);
  const totalUpdates = memberStats.reduce((sum, m) => sum + m.total_updates, 0);
  const activeCallers = memberStats.filter((m) => m.total_updates > 0).length;

  // Formatted WhatsApp text
  const tlName = req.user.name;
  let whatsapp = `📊 *DAILY SALES & FLOOR REPORT*\n`;
  whatsapp += `👔 *Team Leader:* ${tlName}\n`;
  whatsapp += `📅 *Date:* ${today}\n`;
  whatsapp += `━━━━━━━━━━━━━━━━━━━━\n`;
  whatsapp += `🏆 *Sales Closed:* ${totalSales}\n`;
  whatsapp += `📋 *L1 Selected:* ${totalL1} | 🎖️ *L2 Selected:* ${totalL2}\n`;
  whatsapp += `💬 *Interested:* ${totalInterested} | 📅 *Follow-ups:* ${totalFollowup}\n`;
  whatsapp += `📞 *Active Counselors:* ${activeCallers} of ${memberStats.length} logged\n`;
  whatsapp += `━━━━━━━━━━━━━━━━━━━━\n`;
  whatsapp += `⭐ *COUNSELOR PERFORMANCE:*\n`;
  memberStats.forEach((m, idx) => {
    const trophy = idx === 0 && m.sales > 0 ? '🥇 ' : idx === 1 && m.sales > 0 ? '🥈 ' : idx === 2 && m.sales > 0 ? '🥉 ' : '• ';
    whatsapp += `${trophy}${m.name} (${m.employee_code}): *${m.sales} sales* | L1: ${m.l1} | L2: ${m.l2} | Total: ${m.total_updates}\n`;
  });
  whatsapp += `━━━━━━━━━━━━━━━━━━━━\n`;
  whatsapp += `🚀 *Live Sales Command Center - Floor Update*`;

  res.json({
    date: today,
    tl_name: tlName,
    totals: {
      sales: totalSales,
      l1: totalL1,
      l2: totalL2,
      interested: totalInterested,
      followup: totalFollowup,
      updates: totalUpdates,
      active_callers: activeCallers,
      total_callers: memberStats.length,
    },
    hourly_sales: hourlySales,
    members: memberStats,
    whatsapp_text: whatsapp,
  });
});

/**
 * GET /api/tl/reports/export.csv
 * Date range CSV export for TL's team
 */
router.get('/reports/export.csv', (req, res) => {
  const today = businessDate();
  const from = req.query.from || today;
  const to = req.query.to || from;
  const isTl = req.user.role === 'tl';
  const where = isTl ? 'AND e.tl_id = ?' : '';
  const params = isTl ? [from, to, req.user.id] : [from, to];

  const rows = db.prepare(`
    SELECT e.business_date, e.created_at, p.name AS program, tl.name AS tl, u.name AS telecaller,
           u.employee_code, s.label AS status, s.code AS status_code, e.lead_ref, e.voided, e.void_reason
    FROM events e
    JOIN users u ON u.id = e.telecaller_id
    JOIN users tl ON tl.id = e.tl_id
    JOIN programs p ON p.id = e.program_id
    JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date BETWEEN ? AND ? ${where}
    ORDER BY e.id DESC
  `).all(...params);

  const header = 'date,time_utc,program,tl,telecaller_name,employee_code,status,lead_ref,voided,void_reason';
  const body = rows.map((r) => [
    r.business_date,
    r.created_at,
    `"${(r.program || '').replace(/"/g, '""')}"`,
    `"${(r.tl || '').replace(/"/g, '""')}"`,
    `"${(r.telecaller || '').replace(/"/g, '""')}"`,
    r.employee_code,
    `"${(r.status || '').replace(/"/g, '""')}"`,
    `"${(r.lead_ref || '').replace(/"/g, '""')}"`,
    r.voided ? '1' : '0',
    `"${(r.void_reason || '').replace(/"/g, '""')}"`,
  ].join(',')).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="team_sales_${from}_to_${to}.csv"`);
  res.send(`${header}\n${body}`);
});

export default router;
