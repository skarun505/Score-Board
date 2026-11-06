import dotenv from 'dotenv';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(serverDir, '..');

dotenv.config({ path: path.join(serverDir, '.env') });
dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config();

import { uploadsDir, db } from './db.js';
import fs from 'node:fs';
import { verifyToken, tvOrAuth } from './auth.js';
import { getSnapshot } from './services/dashboard.js';
import authRoutes from './routes/auth.js';
import eventRoutes from './routes/events.js';
import adminRoutes from './routes/admin.js';
import profileRoutes from './routes/profile.js';
import tlRoutes from './routes/tl.js';

const origins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true;

export const app = express();
export const server = http.createServer(app);
export const io = new Server(server, { cors: { origin: origins } });
app.set('io', io);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: origins }));
app.use(express.json({ limit: '5mb' }));

/* Socket auth: TV key or JWT */
io.use((socket, next) => {
  const { token, tvKey } = socket.handshake.auth || {};
  if (tvKey && process.env.TV_KEY && tvKey === process.env.TV_KEY) return next();
  try {
    if (token) { verifyToken(token); return next(); }
  } catch { /* fall through */ }
  // If no auth key or token was passed (e.g. standard local browser visiting /tv), allow TV live view
  if (!tvKey && !token) return next();
  next(new Error('unauthorized'));
});
io.on('connection', (socket) => socket.emit('snapshot', getSnapshot()));

/* Heartbeat: keeps TVs fresh, proves the link is alive, rolls over at midnight */
const heartbeatTimer = setInterval(() => io.emit('snapshot', getSnapshot()), 30_000);
if (heartbeatTimer.unref) heartbeatTimer.unref();

/* Automated daily rolling backup */
const runDailyBackup = () => {
  try {
    const backupDir = path.resolve(rootDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const bPath = path.join(backupDir, `dashboard-${ts}.db`);
    db.backup(bPath)
      .then(() => {
        const files = fs.readdirSync(backupDir);
        const now = Date.now();
        for (const f of files) {
          const p = path.join(backupDir, f);
          try {
            if (now - fs.statSync(p).mtimeMs > 14 * 86400 * 1000) fs.unlinkSync(p);
          } catch {}
        }
      })
      .catch((err) => console.error('Automated backup error:', err));
  } catch (e) {
    console.error('Backup directory error:', e);
  }
};
const backupTimer = setInterval(runDailyBackup, 24 * 3600 * 1000);
if (backupTimer.unref) backupTimer.unref();
setTimeout(runDailyBackup, 5000); // Quick initial backup verification on start

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/api/dashboard', tvOrAuth, (req, res) => res.json(getSnapshot()));
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/tl', tlRoutes);
app.use('/api', eventRoutes);

/* Serve the built React app */
const dist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(dist));

/* Serve user-uploaded photos */
app.use('/uploads', express.static(uploadsDir));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(dist, 'index.html'), (err) => {
    if (err) {
      console.error('sendFile error:', err);
      res.status(500).send('Server error serving app');
    }
  });
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Already exists' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Server error' : err.message, code: err.code });
});

const defaultPort = Number(process.env.PORT || 4000);

function startServer(p) {
  server.listen(p, () => {
    console.log(`Dashboard server running on http://localhost:${p}`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${p} in use, trying port ${p + 1}...`);
      startServer(p + 1);
    } else {
      console.error('Server listen error:', err);
      process.exit(1);
    }
  });
}

const isMain = process.argv[1] && (process.argv[1].endsWith('index.js') || process.argv[1].endsWith('index'));
if (isMain && process.env.NODE_ENV !== 'test') {
  startServer(defaultPort);
}

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
process.on('uncaughtException', (e) => {
  if (e?.code === 'EADDRINUSE') return; // Handled by server error event
  console.error('uncaughtException', e);
  process.exit(1);
});
