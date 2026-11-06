/**
 * Profile routes — self-service photo upload for counselors & TLs.
 * POST /api/profile/photo  — uploads a base64 JPEG/PNG, saves to disk, updates DB
 * GET  /api/profile/me     — alias for counselor/me (all roles)
 */
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, audit, uploadsDir } from '../db.js';
import { requireAuth } from '../auth.js';
import { getSnapshot } from '../services/dashboard.js';

const router = Router();
router.use(requireAuth(['telecaller', 'tl', 'admin']));

/** Strips the data-url prefix and returns a Buffer */
function decodeBase64Image(dataUrl) {
  const match = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
  if (!match) throw { status: 400, message: 'Invalid image format. Send a base64 data URL (JPEG or PNG).' };
  const ext = match[1].split('/')[1].replace('jpeg', 'jpg');
  if (!['jpg', 'png', 'webp'].includes(ext)) {
    throw { status: 400, message: 'Only JPEG, PNG or WebP images are accepted.' };
  }
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length > 3 * 1024 * 1024) throw { status: 400, message: 'Image must be under 3 MB.' };
  return { buf, ext };
}

/**
 * POST /api/profile/photo
 * Body: { photo: "<base64 data URL>" }
 */
router.post('/photo', (req, res, next) => {
  try {
    const { photo } = req.body || {};
    if (!photo) throw { status: 400, message: 'photo field is required' };

    const { buf, ext } = decodeBase64Image(photo);
    const filename = `${req.user.id}.${ext}`;
    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, buf);

    const photoUrl = `/uploads/${filename}`;
    db.prepare('UPDATE users SET photo_url = ? WHERE id = ?').run(photoUrl, req.user.id);
    audit(req.user.id, 'profile.photo_upload', 'user', req.user.id, { filename });

    // Push updated snapshot so TV reflects new photo immediately
    const io = req.app.get('io');
    if (io) io.emit('snapshot', getSnapshot());

    res.json({ ok: true, photo_url: photoUrl });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

/**
 * DELETE /api/profile/photo  — removes profile photo
 */
router.delete('/photo', (req, res, next) => {
  try {
    const user = db.prepare('SELECT photo_url FROM users WHERE id = ?').get(req.user.id);
    if (user?.photo_url?.startsWith('/uploads/')) {
      const filePath = path.join(uploadsDir, path.basename(user.photo_url));
      try { fs.unlinkSync(filePath); } catch { /* already gone */ }
    }
    db.prepare('UPDATE users SET photo_url = NULL WHERE id = ?').run(req.user.id);
    audit(req.user.id, 'profile.photo_delete', 'user', req.user.id, {});
    const io = req.app.get('io');
    if (io) io.emit('snapshot', getSnapshot());
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;

