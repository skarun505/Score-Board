import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { db, audit } from '../db.js';
import { signToken, requireAuth } from '../auth.js';

const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 10;

router.post('/login', limiter, (req, res) => {
  const { employee_code, pin } = req.body || {};
  const code = String(employee_code || '').trim();

  // Check lockout status
  const attempt = db.prepare('SELECT attempts, locked_until FROM login_attempts WHERE employee_code = ?').get(code);
  const now = new Date();
  if (attempt && attempt.locked_until && new Date(attempt.locked_until) > now) {
    const minsLeft = Math.ceil((new Date(attempt.locked_until) - now) / 60000);
    return res.status(429).json({ error: `Account locked due to too many failed attempts. Try again in ${minsLeft} minute(s).` });
  }

  const user = db.prepare(
    `SELECT * FROM users WHERE employee_code = ? AND role IN ('admin','tl','telecaller') AND active = 1`
  ).get(code);

  if (!user || !pin || !bcrypt.compareSync(String(pin), user.pin_hash || '')) {
    audit(null, 'login.fail', 'user', user?.id, { employee_code: code });

    // Update failed attempts
    const currentAttempts = (attempt?.attempts || 0) + 1;
    let lockedUntil = null;
    if (currentAttempts >= MAX_FAILED_ATTEMPTS) {
      lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
      audit(null, 'login.lockout', 'user', user?.id, { employee_code: code, locked_until: lockedUntil });
    }
    db.prepare(`
      INSERT INTO login_attempts (employee_code, attempts, locked_until)
      VALUES (?, ?, ?)
      ON CONFLICT(employee_code) DO UPDATE SET
        attempts = excluded.attempts,
        locked_until = excluded.locked_until
    `).run(code, currentAttempts, lockedUntil);

    if (lockedUntil) {
      return res.status(429).json({ error: `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.` });
    }
    return res.status(401).json({ error: 'Wrong employee code or PIN' });
  }

  // Reset failed attempts on success
  db.prepare('DELETE FROM login_attempts WHERE employee_code = ?').run(code);

  audit(user.id, 'login.ok', 'user', user.id);
  res.json({
    token: signToken(user),
    user: { id: user.id, name: user.name, role: user.role, employee_code: user.employee_code, program_id: user.program_id },
  });
});

/**
 * GET /api/auth/directory
 * Public floor directory so counselors and TLs can look up their employee codes
 */
router.get('/directory', limiter, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.role, u.employee_code, u.photo_url,
           p.name AS program_name,
           tl.name AS tl_name
    FROM users u
    LEFT JOIN programs p ON p.id = u.program_id
    LEFT JOIN users tl ON tl.id = u.tl_id
    WHERE u.active = 1
    ORDER BY
      CASE u.role WHEN 'admin' THEN 1 WHEN 'tl' THEN 2 ELSE 3 END,
      u.employee_code ASC
  `).all();
  res.json({ users, default_pin: '111111' });
});

/**
 * POST /api/auth/change-pin
 * Self-service PIN change for any authenticated user
 */
router.post('/change-pin', requireAuth(['admin', 'tl', 'telecaller']), (req, res) => {
  const { current_pin, new_pin } = req.body || {};
  const newPinStr = String(new_pin || '').trim();

  if (!newPinStr || newPinStr.length < 4 || newPinStr.length > 10) {
    return res.status(400).json({ error: 'New PIN must be between 4 and 10 digits.' });
  }

  const user = db.prepare('SELECT id, pin_hash FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  // If user has a pin_hash, verify current_pin (allow '111111' default bypass if not changed yet)
  if (user.pin_hash && current_pin) {
    const isCurrentOk = bcrypt.compareSync(String(current_pin), user.pin_hash);
    if (!isCurrentOk) {
      return res.status(400).json({ error: 'Current PIN is incorrect.' });
    }
  }

  const newHash = bcrypt.hashSync(newPinStr, 10);
  db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(newHash, user.id);
  audit(user.id, 'user.pin_change', 'user', user.id, {});

  res.json({ ok: true, message: 'PIN updated successfully.' });
});

export default router;
