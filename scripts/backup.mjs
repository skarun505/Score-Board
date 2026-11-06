import fs from 'node:fs';
import path from 'node:path';
import { db } from '../server/src/db.js';

const backupDir = path.resolve('backups');
fs.mkdirSync(backupDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDir, `dashboard-${timestamp}.db`);

console.log(`Starting SQLite online backup to ${backupPath}...`);
db.backup(backupPath)
  .then(() => {
    console.log(`Backup completed successfully: ${backupPath} (${fs.statSync(backupPath).size} bytes)`);
    // Retention: clean up backups older than 30 days
    const files = fs.readdirSync(backupDir);
    const now = Date.now();
    for (const f of files) {
      const p = path.join(backupDir, f);
      const stat = fs.statSync(p);
      if (now - stat.mtimeMs > 30 * 86400 * 1000) {
        fs.unlinkSync(p);
        console.log(`Cleaned up old backup: ${f}`);
      }
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('Backup failed:', err);
    process.exit(1);
  });
