import { Router } from 'express';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { db, dbPath, audit, businessDate } from '../db.js';
import { requireAuth } from '../auth.js';
import { voidEvent, HttpError } from '../services/events.js';
import { getSnapshot } from '../services/dashboard.js';

const router = Router();
router.use(requireAuth(['admin']));
const refresh = (req) => {
  const io = req.app.get('io');
  if (io) io.emit('snapshot', getSnapshot());
};

/* ---------- users ---------- */
router.get('/users', (req, res) => {
  const today = businessDate();
  res.json(db.prepare(`
    SELECT u.id, u.name, u.role, u.employee_code, u.program_id, u.tl_id, u.photo_url, u.birthday, u.hire_date, u.active,
           p.name AS program_name, tl.name AS tl_name,
           (
             SELECT MAX(e.created_at)
             FROM events e
             WHERE (e.tl_id = u.id OR e.created_by = u.id)
               AND e.business_date = ?
               AND e.voided = 0
           ) AS last_active_at
    FROM users u
    LEFT JOIN programs p ON p.id = u.program_id
    LEFT JOIN users tl ON tl.id = u.tl_id
    ORDER BY u.role, u.name
  `).all(today));
});

router.post('/users', (req, res, next) => {
  try {
    const { name, role, employee_code, pin, program_id = null, tl_id = null, photo_url = null, birthday = null, hire_date = null } = req.body || {};
    if (!name || !employee_code || !['admin', 'tl', 'telecaller'].includes(role)) {
      throw new HttpError(400, 'name, employee_code and a valid role are required');
    }
    if (role !== 'telecaller' && !pin) throw new HttpError(400, 'PIN is required for admin and TL');
    const r = db.prepare(`
      INSERT INTO users (name, role, employee_code, pin_hash, program_id, tl_id, photo_url, birthday, hire_date)
      VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(name, role, String(employee_code).trim(), pin ? bcrypt.hashSync(String(pin), 10) : null,
          program_id ? Number(program_id) : null, tl_id ? Number(tl_id) : null, photo_url, birthday || null, hire_date || null);
    audit(req.user.id, 'user.create', 'user', Number(r.lastInsertRowid), { name, role, employee_code });
    refresh(req);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch (e) { next(e); }
});

router.patch('/users/:id', (req, res, next) => {
  try {
    const allowed = ['name', 'role', 'program_id', 'tl_id', 'photo_url', 'birthday', 'hire_date', 'active'];
    const sets = [], vals = [];
    for (const k of allowed) {
      if (k in req.body) {
        sets.push(`${k} = ?`);
        vals.push(req.body[k]);
      }
    }
    if (req.body.pin) {
      sets.push('pin_hash = ?');
      vals.push(bcrypt.hashSync(String(req.body.pin), 10));
    }
    if (!sets.length) throw new HttpError(400, 'Nothing to update');
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, req.params.id);
    audit(req.user.id, 'user.update', 'user', Number(req.params.id), { fields: Object.keys(req.body) });
    refresh(req);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------- bulk user import ---------- */
router.post('/users/import', (req, res, next) => {
  try {
    const { rows = [], commit = false } = req.body || {};
    if (!Array.isArray(rows) || !rows.length) {
      throw new HttpError(400, 'No rows provided');
    }

    const allPrograms = db.prepare('SELECT id, name FROM programs').all();
    const progMap = Object.fromEntries(allPrograms.map((p) => [p.name.toLowerCase().trim(), p.id]));
    const allUsers = db.prepare('SELECT id, employee_code, role FROM users').all();
    const userCodes = new Set(allUsers.map((u) => u.employee_code.toLowerCase().trim()));
    const tlMap = Object.fromEntries(
      allUsers.filter((u) => u.role === 'tl').map((u) => [u.employee_code.toLowerCase().trim(), u.id])
    );

    const validated = [];
    const errors = [];
    const seenInCsv = new Set();

    rows.forEach((row, index) => {
      const line = index + 1;
      const name = String(row.name || '').trim();
      const role = String(row.role || '').toLowerCase().trim();
      const code = String(row.employee_code || '').trim();
      const progName = String(row.program || '').toLowerCase().trim();
      const tlCode = String(row.tl_code || '').toLowerCase().trim();
      const pin = row.pin ? String(row.pin).trim() : '111111';

      const rowErrors = [];
      if (!name) rowErrors.push('Missing name');
      if (!['admin', 'tl', 'telecaller'].includes(role)) rowErrors.push('Invalid role (must be admin, tl, or telecaller)');
      if (!code) rowErrors.push('Missing employee_code');
      else {
        if (seenInCsv.has(code.toLowerCase())) rowErrors.push(`Duplicate code ${code} in CSV`);
        else seenInCsv.add(code.toLowerCase());
        if (userCodes.has(code.toLowerCase())) rowErrors.push(`Employee code ${code} already exists in database`);
      }

      let programId = null;
      if (progName) {
        programId = progMap[progName] || null;
        if (!programId) rowErrors.push(`Program "${row.program}" not found`);
      }

      let tlId = null;
      if (tlCode) {
        tlId = tlMap[tlCode] || null;
        if (!tlId) rowErrors.push(`TL code "${row.tl_code}" not found`);
      }

      if (rowErrors.length) {
        errors.push({ line, code, name, errors: rowErrors });
      } else {
        validated.push({ name, role, employee_code: code, program_id: programId, tl_id: tlId, pin });
      }
    });

    if (!commit) {
      return res.json({
        total: rows.length,
        valid: validated.length,
        invalid: errors.length,
        errors,
        preview: validated.slice(0, 10),
      });
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Cannot commit with validation errors', errors });
    }

    const ins = db.prepare(`
      INSERT INTO users (name, role, employee_code, pin_hash, program_id, tl_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((items) => {
      for (const item of items) {
        const pinHash = item.role !== 'telecaller' ? bcrypt.hashSync(item.pin, 10) : null;
        ins.run(item.name, item.role, item.employee_code, pinHash, item.program_id, item.tl_id);
      }
    });

    insertMany(validated);
    audit(req.user.id, 'users.bulk_import', 'users', null, { count: validated.length });
    refresh(req);

    res.json({ ok: true, imported: validated.length });
  } catch (e) { next(e); }
});

/* ---------- programs and statuses (generic helpers) ---------- */
function patchTable(table, allowed) {
  return (req, res, next) => {
    try {
      const sets = [], vals = [];
      for (const k of allowed) {
        if (k in req.body) { sets.push(`${k} = ?`); vals.push(req.body[k]); }
      }
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
    const r = db.prepare('INSERT INTO programs (name, daily_target) VALUES (?,?)').run(name, Number(daily_target) || 0);
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
                          VALUES (?,?,?,?,?,?,?)`).run(code, label, is_sale ? 1 : 0, sound, color, Number(sort_order) || 0, show_in_feed ? 1 : 0);
    audit(req.user.id, 'statuses.create', 'statuses', Number(r.lastInsertRowid), { code });
    refresh(req);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch (e) { next(e); }
});
router.patch('/statuses/:id',
  patchTable('statuses', ['label', 'is_sale', 'sound', 'color', 'sort_order', 'active', 'show_in_feed']));

/* ---------- settings ---------- */
const SETTING_KEYS = [
  'sound_enabled',
  'normal_volume',
  'quiet_start',
  'quiet_end',
  'quiet_volume',
  'tv_rotation_sec',
  'gamification_enabled',
  'streaks_enabled',
  'badges_enabled',
  'hot_now_enabled',
  'nudges_enabled',
  'celebrations_banner_enabled',
  'tv_broadcast_message',
  'tv_broadcast_style',
  'tv_broadcast_active',
  'power_hour_enabled',
];
router.put('/settings', (req, res) => {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const k of SETTING_KEYS) {
    if (k in req.body) up.run(k, String(req.body[k]));
  }
  audit(req.user.id, 'settings.update', 'settings', null, req.body);
  refresh(req);
  res.json({ ok: true });
});

/* ---------- TV Broadcast and Remote Diagnostics ---------- */
router.post('/broadcast', (req, res, next) => {
  try {
    const { message = '', style = 'info', active = true } = req.body || {};
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    up.run('tv_broadcast_message', String(message));
    up.run('tv_broadcast_style', String(style));
    up.run('tv_broadcast_active', active ? '1' : '0');

    audit(req.user.id, 'tv.broadcast', 'broadcast', null, { message, style, active });
    const io = req.app.get('io');
    if (io) {
      io.emit('tv_broadcast', { message, style, active: !!active });
    }
    refresh(req);
    res.json({ ok: true, broadcast: { message, style, active: !!active } });
  } catch (e) { next(e); }
});

router.post('/remote-action', (req, res, next) => {
  try {
    const { action } = req.body || {};
    if (!action) throw new HttpError(400, 'Action is required');

    if (action === 'toggle_power_hour') {
      const current = db.prepare(`SELECT value FROM settings WHERE key = 'power_hour_enabled'`).get()?.value === '1';
      const nextVal = current ? '0' : '1';
      db.prepare(`INSERT INTO settings (key, value) VALUES ('power_hour_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(nextVal);
      audit(req.user.id, 'power_hour.toggle', 'settings', null, { active: nextVal === '1' });
      refresh(req);
      return res.json({ ok: true, power_hour: nextVal === '1' });
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('remote_action', { action, timestamp: Date.now() });
    }
    audit(req.user.id, 'remote_action', 'tv', null, { action });
    res.json({ ok: true, action });
  } catch (e) { next(e); }
});

/* ---------- System Health & Database Backup Download ---------- */
router.get('/system-health', (req, res) => {
  let dbSizeBytes = 0;
  try {
    if (fs.existsSync(dbPath)) {
      dbSizeBytes = fs.statSync(dbPath).size;
      const walPath = `${dbPath}-wal`;
      if (fs.existsSync(walPath)) dbSizeBytes += fs.statSync(walPath).size;
    }
  } catch {}

  const totalEvents = db.prepare('SELECT COUNT(*) AS c FROM events').get()?.c || 0;
  const totalSales = db.prepare(`SELECT COUNT(*) AS c FROM events e JOIN statuses s ON s.id = e.status_id WHERE s.is_sale = 1 AND e.voided = 0`).get()?.c || 0;
  const totalUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get()?.c || 0;
  const totalPrograms = db.prepare('SELECT COUNT(*) AS c FROM programs WHERE active = 1').get()?.c || 0;
  
  const io = req.app.get('io');
  const activeSockets = io ? io.engine?.clientsCount || 0 : 0;

  res.json({
    db_size_bytes: dbSizeBytes,
    db_size_formatted: (dbSizeBytes / (1024 * 1024)).toFixed(2) + ' MB',
    total_events: totalEvents,
    total_sales: totalSales,
    total_users: totalUsers,
    total_programs: totalPrograms,
    active_connections: activeSockets,
    uptime_seconds: Math.floor(process.uptime()),
    node_version: process.version,
    server_time: new Date().toISOString()
  });
});

router.get('/backup/download', async (req, res, next) => {
  try {
    const backupDir = path.resolve('backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const tempBackup = path.join(backupDir, `dashboard-backup-${Date.now()}.db`);
    await db.backup(tempBackup);
    res.download(tempBackup, `dashboard-${businessDate()}.db`, (err) => {
      try { fs.unlinkSync(tempBackup); } catch {}
      if (err) console.error('Download error:', err);
    });
    audit(req.user.id, 'database.backup_download', 'database', null, {});
  } catch (e) { next(e); }
});

/* ---------- Weekly and Monthly Progress Analytics ---------- */
router.get('/analytics/progress', (req, res, next) => {
  try {
    const today = businessDate();
    const selectedMonth = req.query.month || today.slice(0, 7);
    const [yearStr, monthStr] = selectedMonth.split('-');
    const year = Number(yearStr) || new Date().getFullYear();
    const month = Number(monthStr) || (new Date().getMonth() + 1);

    // Month dates calculation
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthPrefix = `${yearStr}-${String(month).padStart(2, '0')}`;

    // 1. Daily sales across the month
    const dailySalesRows = db.prepare(`
      SELECT e.business_date,
             SUM(CASE WHEN s.is_sale = 1 THEN 1 ELSE 0 END) AS sales,
             COUNT(e.id) AS total_updates,
             COUNT(DISTINCT e.telecaller_id) AS active_callers
      FROM events e
      JOIN statuses s ON s.id = e.status_id
      WHERE e.business_date LIKE ? AND e.voided = 0
      GROUP BY e.business_date
      ORDER BY e.business_date ASC
    `).all(`${monthPrefix}%`);

    const dailyMap = Object.fromEntries(dailySalesRows.map(r => [r.business_date, r]));
    const monthTimeline = [];
    let monthTotalSales = 0;
    let monthTotalUpdates = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const dStr = `${monthPrefix}-${String(day).padStart(2, '0')}`;
      const entry = dailyMap[dStr] || { sales: 0, total_updates: 0, active_callers: 0 };
      monthTotalSales += (entry.sales || 0);
      monthTotalUpdates += (entry.total_updates || 0);
      monthTimeline.push({
        date: dStr,
        day,
        sales: entry.sales || 0,
        updates: entry.total_updates || 0,
        active_callers: entry.active_callers || 0,
        is_today: dStr === today,
        is_past: dStr <= today
      });
    }

    // 2. Program breakdown for the month
    const programsMonthly = db.prepare(`
      SELECT p.id, p.name, p.daily_target,
             COALESCE(SUM(CASE WHEN s.is_sale = 1 THEN 1 ELSE 0 END), 0) AS sales,
             COUNT(e.id) AS total_updates,
             COUNT(DISTINCT e.telecaller_id) AS active_callers
      FROM programs p
      LEFT JOIN events e ON e.program_id = p.id AND e.business_date LIKE ? AND e.voided = 0
      LEFT JOIN statuses s ON s.id = e.status_id
      WHERE p.active = 1
      GROUP BY p.id
      ORDER BY sales DESC
    `).all(`${monthPrefix}%`);

    // 3. Top telecallers of the month
    const topTelecallersMonthly = db.prepare(`
      SELECT u.id, u.name, u.photo_url, p.name AS program_name, tl.name AS tl_name,
             COALESCE(SUM(CASE WHEN s.is_sale = 1 THEN 1 ELSE 0 END), 0) AS sales,
             COUNT(e.id) AS total_updates,
             COUNT(DISTINCT e.business_date) AS active_days
      FROM users u
      JOIN events e ON e.telecaller_id = u.id AND e.business_date LIKE ? AND e.voided = 0
      JOIN statuses s ON s.id = e.status_id AND s.is_sale = 1
      LEFT JOIN programs p ON p.id = u.program_id
      LEFT JOIN users tl ON tl.id = u.tl_id
      WHERE u.role = 'telecaller'
      GROUP BY u.id
      ORDER BY sales DESC, total_updates ASC
      LIMIT 12
    `).all(`${monthPrefix}%`).map((r, i) => ({
      ...r,
      rank: i + 1,
      conversion_pct: r.total_updates ? Math.round((r.sales / r.total_updates) * 100) : 0
    }));

    // 4. Status breakdown for the month
    const statusBreakdown = db.prepare(`
      SELECT s.id, s.code, s.label, s.color, s.is_sale,
             COUNT(e.id) AS count
      FROM statuses s
      LEFT JOIN events e ON e.status_id = s.id AND e.business_date LIKE ? AND e.voided = 0
      WHERE s.active = 1
      GROUP BY s.id
      ORDER BY s.sort_order ASC
    `).all(`${monthPrefix}%`);

    // 5. Weekly Analysis (Current Week: Monday to Sunday)
    const anchor = req.query.week_date || today;
    const anchorD = new Date(anchor + 'T12:00:00Z');
    const dayOfWeek = anchorD.getUTCDay(); // 0 is Sun, 1 is Mon
    const diffToMon = (dayOfWeek + 6) % 7;
    const mondayD = new Date(anchorD.getTime() - diffToMon * 86400000);

    const weekDays = [];
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let weekSales = 0;
    let weekTarget = 0;
    const dailyOrgTarget = programsMonthly.reduce((sum, p) => sum + (p.daily_target || 0), 0);

    for (let i = 0; i < 7; i++) {
      const curD = new Date(mondayD.getTime() + i * 86400000);
      const dateStr = curD.toISOString().slice(0, 10);
      const row = db.prepare(`
        SELECT COALESCE(SUM(CASE WHEN s.is_sale = 1 THEN 1 ELSE 0 END), 0) AS sales,
               COUNT(e.id) AS total_updates,
               COUNT(DISTINCT e.telecaller_id) AS active_callers
        FROM events e
        JOIN statuses s ON s.id = e.status_id
        WHERE e.business_date = ? AND e.voided = 0
      `).get(dateStr) || { sales: 0, total_updates: 0, active_callers: 0 };

      weekSales += row.sales;
      weekTarget += dailyOrgTarget;

      weekDays.push({
        date: dateStr,
        day_name: dayNames[i],
        sales: row.sales,
        updates: row.total_updates,
        active_callers: row.active_callers,
        target: dailyOrgTarget,
        hit_target: dailyOrgTarget > 0 && row.sales >= dailyOrgTarget,
        is_today: dateStr === today
      });
    }

    // Previous week total for comparison
    const prevMonD = new Date(mondayD.getTime() - 7 * 86400000);
    const prevSunD = new Date(mondayD.getTime() - 1 * 86400000);
    const prevWeekRow = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN s.is_sale = 1 THEN 1 ELSE 0 END), 0) AS sales
      FROM events e
      JOIN statuses s ON s.id = e.status_id
      WHERE e.business_date BETWEEN ? AND ? AND e.voided = 0
    `).get(prevMonD.toISOString().slice(0, 10), prevSunD.toISOString().slice(0, 10));
    const prevWeekSales = prevWeekRow?.sales || 0;
    const weekGrowth = prevWeekSales > 0 ? Math.round(((weekSales - prevWeekSales) / prevWeekSales) * 100) : 0;

    res.json({
      month: selectedMonth,
      today,
      monthly: {
        total_sales: monthTotalSales,
        total_updates: monthTotalUpdates,
        timeline: monthTimeline,
        programs: programsMonthly,
        top_telecallers: topTelecallersMonthly,
        statuses: statusBreakdown,
        avg_daily_sales: Math.round((monthTotalSales / Math.max(1, new Date().getDate())) * 10) / 10
      },
      weekly: {
        week_sales: weekSales,
        week_target: weekTarget,
        prev_week_sales: prevWeekSales,
        growth_pct: weekGrowth,
        days: weekDays,
        daily_org_target: dailyOrgTarget
      }
    });
  } catch (e) { next(e); }
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
