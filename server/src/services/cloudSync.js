import pg from 'pg';
import { db } from '../db.js';

const { Pool } = pg;

export class CloudSyncService {
  constructor() {
    this.pool = null;
    this.enabled = false;
    this.connected = false;
    this.lastSyncAt = null;
    this.lastError = null;
    this.queue = [];
    this.isFlushing = false;
    this.syncTimer = null;
    this.flushTimer = null;
    this.connectionUrl = null;
  }

  /** Initialize Cloud PostgreSQL pool if DATABASE_URL or POSTGRES_URL is provided */
  async init() {
    const rawUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL;
    if (!rawUrl) {
      console.log('ℹ️ [CloudSync] No DATABASE_URL configured. Running Tier 1 (In-Memory Engine) + Tier 3 (Daily Backups).');
      this.enabled = false;
      return;
    }

    try {
      this.connectionUrl = rawUrl;
      const isLocal = rawUrl.includes('localhost') || rawUrl.includes('127.0.0.1');
      this.pool = new Pool({
        connectionString: rawUrl,
        ssl: isLocal ? false : { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });

      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();

      this.enabled = true;
      this.connected = true;
      this.lastError = null;
      console.log('✅ [CloudSync] Connected to Tier 2 Cloud PostgreSQL database successfully!');

      await this.ensureSchema();
      await this.hydrateOnStartup();

      // Start periodic sync and queue flush worker
      this.flushTimer = setInterval(() => this.flushQueue(), 1500);
      if (this.flushTimer.unref) this.flushTimer.unref();

      this.syncTimer = setInterval(() => this.reconcileHighWaterMark(), 60000);
      if (this.syncTimer.unref) this.syncTimer.unref();
    } catch (err) {
      this.connected = false;
      this.lastError = err.message;
      console.error('⚠️ [CloudSync] Failed to connect to Tier 2 Cloud PostgreSQL:', err.message);
      console.log('ℹ️ [CloudSync] Falling back to Tier 1 local engine. Mutations will queue in-memory.');
      // Attempt reconnection every 30 seconds
      setTimeout(() => this.init(), 30000);
    }
  }

  /** Ensure matching tables exist in PostgreSQL */
  async ensureSchema() {
    if (!this.pool) return;
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS programs (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          daily_target INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          employee_code TEXT NOT NULL UNIQUE,
          pin_hash TEXT,
          program_id INTEGER,
          tl_id INTEGER,
          photo_url TEXT,
          birthday TEXT,
          hire_date TEXT,
          active INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS statuses (
          id INTEGER PRIMARY KEY,
          code TEXT NOT NULL UNIQUE,
          label TEXT NOT NULL,
          is_sale INTEGER NOT NULL DEFAULT 0,
          sound TEXT,
          color TEXT DEFAULT '#3b82f6',
          sort_order INTEGER NOT NULL DEFAULT 0,
          show_in_feed INTEGER NOT NULL DEFAULT 1,
          active INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS batches (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          program_id INTEGER NOT NULL,
          target INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          start_date TEXT,
          end_date TEXT,
          created_by INTEGER,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY,
          telecaller_id INTEGER NOT NULL,
          program_id INTEGER NOT NULL,
          tl_id INTEGER NOT NULL,
          status_id INTEGER NOT NULL,
          batch_id INTEGER,
          lead_ref TEXT,
          created_by INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          business_date TEXT NOT NULL,
          voided INTEGER NOT NULL DEFAULT 0,
          voided_by INTEGER,
          voided_at TEXT,
          void_reason TEXT
        );

        CREATE TABLE IF NOT EXISTS daily_adjustments (
          id INTEGER PRIMARY KEY,
          telecaller_id INTEGER NOT NULL,
          status_code TEXT NOT NULL,
          business_date TEXT NOT NULL,
          adjusted_by INTEGER NOT NULL,
          old_count INTEGER NOT NULL,
          new_count INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY,
          actor_id INTEGER,
          action TEXT NOT NULL,
          entity TEXT,
          entity_id INTEGER,
          details TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_pg_events_date ON events (business_date, voided);
        CREATE INDEX IF NOT EXISTS idx_pg_events_tc ON events (telecaller_id, created_at);
      `);
    } finally {
      client.release();
    }
  }

  /**
   * On startup, determine whether Cloud PostgreSQL has authoritative data
   * or if local seed should be uploaded to the cloud.
   */
  async hydrateOnStartup() {
    if (!this.pool) return;
    try {
      const client = await this.pool.connect();
      let cloudEventCount = 0;
      let cloudUserCount = 0;
      try {
        const evRes = await client.query('SELECT COUNT(*) as c FROM events');
        cloudEventCount = parseInt(evRes.rows[0]?.c || 0, 10);
        const uRes = await client.query('SELECT COUNT(*) as c FROM users');
        cloudUserCount = parseInt(uRes.rows[0]?.c || 0, 10);
      } finally {
        client.release();
      }

      const localEventCount = db.prepare('SELECT COUNT(*) as c FROM events').get()?.c || 0;

      if (cloudEventCount > localEventCount || (cloudUserCount >= 40 && localEventCount === 0)) {
        console.log(`📥 [CloudSync] Cloud PostgreSQL has authoritative data (${cloudEventCount} events, ${cloudUserCount} users). Hydrating Tier 1 In-Memory Engine...`);
        await this.pullAllFromCloud();
      } else {
        console.log(`📤 [CloudSync] Pushing initial floor setup to Cloud PostgreSQL (${localEventCount} local events)...`);
        await this.pushAllToCloud();
      }
      this.lastSyncAt = new Date().toISOString();
    } catch (err) {
      console.error('⚠️ [CloudSync] Hydration error on boot:', err.message);
    }
  }

  /** Queue a mutation from Tier 1 for write-through persistence to Cloud PostgreSQL */
  queueMutation(table, op, data) {
    if (!data) return;
    this.queue.push({ table, op, data, queuedAt: Date.now() });
    if (this.queue.length > 5000) {
      this.queue.shift(); // Drop oldest to avoid unbounded memory growth if cloud is disconnected for weeks
    }
    // Flush asynchronously without blocking the local response
    setImmediate(() => this.flushQueue());
  }

  /** Flush queued mutations to Cloud PostgreSQL with automatic retry */
  async flushQueue() {
    if (this.isFlushing || this.queue.length === 0 || !this.pool) return;
    this.isFlushing = true;

    try {
      const client = await this.pool.connect();
      try {
        while (this.queue.length > 0) {
          const item = this.queue[0];
          await this.executeMutationOnCloud(client, item.table, item.op, item.data);
          this.queue.shift(); // remove only upon success
        }
        this.connected = true;
        this.lastError = null;
        this.lastSyncAt = new Date().toISOString();
      } finally {
        client.release();
      }
    } catch (err) {
      this.connected = false;
      this.lastError = err.message;
      // Do not crash; queue remains intact for retry on next interval
    } finally {
      this.isFlushing = false;
    }
  }

  /** Execute a single mutation in PostgreSQL */
  async executeMutationOnCloud(client, table, op, data) {
    if (table === 'events') {
      await client.query(`
        INSERT INTO events (id, telecaller_id, program_id, tl_id, status_id, batch_id, lead_ref, created_by, created_at, business_date, voided, voided_by, voided_at, void_reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (id) DO UPDATE SET
          voided = EXCLUDED.voided,
          voided_by = EXCLUDED.voided_by,
          voided_at = EXCLUDED.voided_at,
          void_reason = EXCLUDED.void_reason
      `, [
        data.id, data.telecaller_id, data.program_id, data.tl_id, data.status_id,
        data.batch_id || null, data.lead_ref || null, data.created_by, data.created_at,
        data.business_date, data.voided || 0, data.voided_by || null, data.voided_at || null, data.void_reason || null
      ]);
    } else if (table === 'daily_adjustments') {
      await client.query(`
        INSERT INTO daily_adjustments (id, telecaller_id, status_code, business_date, adjusted_by, old_count, new_count, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          old_count = EXCLUDED.old_count,
          new_count = EXCLUDED.new_count,
          adjusted_by = EXCLUDED.adjusted_by,
          created_at = EXCLUDED.created_at
      `, [
        data.id, data.telecaller_id, data.status_code, data.business_date,
        data.adjusted_by, data.old_count, data.new_count, data.created_at
      ]);
    } else if (table === 'settings') {
      await client.query(`
        INSERT INTO settings (key, value) VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `, [data.key, String(data.value)]);
    } else if (table === 'users') {
      await client.query(`
        INSERT INTO users (id, name, role, employee_code, pin_hash, program_id, tl_id, photo_url, birthday, hire_date, active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          role = EXCLUDED.role,
          employee_code = EXCLUDED.employee_code,
          pin_hash = COALESCE(EXCLUDED.pin_hash, users.pin_hash),
          program_id = EXCLUDED.program_id,
          tl_id = EXCLUDED.tl_id,
          photo_url = EXCLUDED.photo_url,
          birthday = EXCLUDED.birthday,
          hire_date = EXCLUDED.hire_date,
          active = EXCLUDED.active
      `, [
        data.id, data.name, data.role, data.employee_code, data.pin_hash || null,
        data.program_id || null, data.tl_id || null, data.photo_url || null,
        data.birthday || null, data.hire_date || null, data.active ?? 1
      ]);
    } else if (table === 'batches') {
      await client.query(`
        INSERT INTO batches (id, name, program_id, target, active, start_date, end_date, created_by, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          target = EXCLUDED.target,
          active = EXCLUDED.active,
          start_date = EXCLUDED.start_date,
          end_date = EXCLUDED.end_date
      `, [
        data.id, data.name, data.program_id, data.target || 0, data.active ?? 1,
        data.start_date || null, data.end_date || null, data.created_by || null, data.created_at
      ]);
    } else if (table === 'programs') {
      await client.query(`
        INSERT INTO programs (id, name, daily_target, active)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          daily_target = EXCLUDED.daily_target,
          active = EXCLUDED.active
      `, [data.id, data.name, data.daily_target || 0, data.active ?? 1]);
    }
  }

  /** Reconcile high-water mark between SQLite and Cloud PostgreSQL */
  async reconcileHighWaterMark() {
    if (!this.pool || this.isFlushing) return;
    try {
      const client = await this.pool.connect();
      try {
        // 1. Check max event ID in cloud
        const cloudMax = await client.query('SELECT COALESCE(MAX(id), 0) as m FROM events');
        const maxCloudId = parseInt(cloudMax.rows[0]?.m || 0, 10);

        // 2. Query any new local events not yet in cloud
        const pendingLocal = db.prepare('SELECT * FROM events WHERE id > ? ORDER BY id ASC').all(maxCloudId);
        for (const ev of pendingLocal) {
          await this.executeMutationOnCloud(client, 'events', 'INSERT', ev);
        }

        // 3. Query any new cloud events not yet in local
        const localMax = db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM events').get()?.m || 0;
        if (maxCloudId > localMax) {
          const newCloudEvents = await client.query('SELECT * FROM events WHERE id > $1 ORDER BY id ASC', [localMax]);
          const insEv = db.prepare(`
            INSERT OR REPLACE INTO events (id, telecaller_id, program_id, tl_id, status_id, batch_id, lead_ref, created_by, created_at, business_date, voided, voided_by, voided_at, void_reason)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          `);
          db.transaction(() => {
            for (const r of newCloudEvents.rows) {
              insEv.run(r.id, r.telecaller_id, r.program_id, r.tl_id, r.status_id, r.batch_id, r.lead_ref, r.created_by, r.created_at, r.business_date, r.voided, r.voided_by, r.voided_at, r.void_reason);
            }
          })();
        }

        this.connected = true;
        this.lastSyncAt = new Date().toISOString();
      } finally {
        client.release();
      }
    } catch (err) {
      this.connected = false;
      this.lastError = err.message;
    }
  }

  /** Push all local SQLite tables up to Cloud PostgreSQL */
  async pushAllToCloud() {
    if (!this.pool) return { ok: false, error: 'Database pool not connected' };
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Programs
      const progs = db.prepare('SELECT * FROM programs').all();
      for (const p of progs) {
        await client.query(`
          INSERT INTO programs (id, name, daily_target, active) VALUES ($1,$2,$3,$4)
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, daily_target = EXCLUDED.daily_target, active = EXCLUDED.active
        `, [p.id, p.name, p.daily_target, p.active]);
      }

      // 2. Statuses
      const statuses = db.prepare('SELECT * FROM statuses').all();
      for (const s of statuses) {
        await client.query(`
          INSERT INTO statuses (id, code, label, is_sale, sound, color, sort_order, show_in_feed, active)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, is_sale = EXCLUDED.is_sale, sound = EXCLUDED.sound, color = EXCLUDED.color, sort_order = EXCLUDED.sort_order, show_in_feed = EXCLUDED.show_in_feed, active = EXCLUDED.active
        `, [s.id, s.code, s.label, s.is_sale, s.sound, s.color, s.sort_order, s.show_in_feed, s.active]);
      }

      // 3. Users
      const users = db.prepare('SELECT * FROM users').all();
      for (const u of users) {
        await client.query(`
          INSERT INTO users (id, name, role, employee_code, pin_hash, program_id, tl_id, photo_url, birthday, hire_date, active)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, employee_code = EXCLUDED.employee_code, pin_hash = EXCLUDED.pin_hash, program_id = EXCLUDED.program_id, tl_id = EXCLUDED.tl_id, photo_url = EXCLUDED.photo_url, birthday = EXCLUDED.birthday, hire_date = EXCLUDED.hire_date, active = EXCLUDED.active
        `, [u.id, u.name, u.role, u.employee_code, u.pin_hash, u.program_id, u.tl_id, u.photo_url, u.birthday, u.hire_date, u.active]);
      }

      // 4. Batches
      const batches = db.prepare('SELECT * FROM batches').all();
      for (const b of batches) {
        await client.query(`
          INSERT INTO batches (id, name, program_id, target, active, start_date, end_date, created_by, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, target = EXCLUDED.target, active = EXCLUDED.active, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date
        `, [b.id, b.name, b.program_id, b.target, b.active, b.start_date, b.end_date, b.created_by, b.created_at]);
      }

      // 5. Events
      const events = db.prepare('SELECT * FROM events').all();
      for (const e of events) {
        await client.query(`
          INSERT INTO events (id, telecaller_id, program_id, tl_id, status_id, batch_id, lead_ref, created_by, created_at, business_date, voided, voided_by, voided_at, void_reason)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          ON CONFLICT (id) DO UPDATE SET voided = EXCLUDED.voided, voided_by = EXCLUDED.voided_by, voided_at = EXCLUDED.voided_at, void_reason = EXCLUDED.void_reason
        `, [e.id, e.telecaller_id, e.program_id, e.tl_id, e.status_id, e.batch_id, e.lead_ref, e.created_by, e.created_at, e.business_date, e.voided, e.voided_by, e.voided_at, e.void_reason]);
      }

      // 6. Daily Adjustments
      const adjs = db.prepare('SELECT * FROM daily_adjustments').all();
      for (const a of adjs) {
        await client.query(`
          INSERT INTO daily_adjustments (id, telecaller_id, status_code, business_date, adjusted_by, old_count, new_count, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (id) DO UPDATE SET old_count = EXCLUDED.old_count, new_count = EXCLUDED.new_count, adjusted_by = EXCLUDED.adjusted_by, created_at = EXCLUDED.created_at
        `, [a.id, a.telecaller_id, a.status_code, a.business_date, a.adjusted_by, a.old_count, a.new_count, a.created_at]);
      }

      // 7. Settings
      const settings = db.prepare('SELECT * FROM settings').all();
      for (const s of settings) {
        await client.query(`
          INSERT INTO settings (key, value) VALUES ($1,$2)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `, [s.key, s.value]);
      }

      await client.query('COMMIT');
      this.lastSyncAt = new Date().toISOString();
      return { ok: true, pushed: { programs: progs.length, users: users.length, events: events.length, batches: batches.length } };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Pull all tables from Cloud PostgreSQL into SQLite Tier 1 */
  async pullAllFromCloud() {
    if (!this.pool) return { ok: false, error: 'Database pool not connected' };
    const client = await this.pool.connect();
    try {
      const progs = (await client.query('SELECT * FROM programs')).rows;
      const users = (await client.query('SELECT * FROM users')).rows;
      const statuses = (await client.query('SELECT * FROM statuses')).rows;
      const batches = (await client.query('SELECT * FROM batches')).rows;
      const events = (await client.query('SELECT * FROM events')).rows;
      const adjs = (await client.query('SELECT * FROM daily_adjustments')).rows;
      const settings = (await client.query('SELECT * FROM settings')).rows;

      db.transaction(() => {
        // Programs
        const insProg = db.prepare('INSERT OR REPLACE INTO programs (id, name, daily_target, active) VALUES (?,?,?,?)');
        for (const p of progs) insProg.run(p.id, p.name, p.daily_target, p.active);

        // Statuses
        const insSt = db.prepare('INSERT OR REPLACE INTO statuses (id, code, label, is_sale, sound, color, sort_order, show_in_feed, active) VALUES (?,?,?,?,?,?,?,?,?)');
        for (const s of statuses) insSt.run(s.id, s.code, s.label, s.is_sale, s.sound, s.color, s.sort_order, s.show_in_feed, s.active);

        // Users
        const insU = db.prepare('INSERT OR REPLACE INTO users (id, name, role, employee_code, pin_hash, program_id, tl_id, photo_url, birthday, hire_date, active) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
        for (const u of users) insU.run(u.id, u.name, u.role, u.employee_code, u.pin_hash, u.program_id, u.tl_id, u.photo_url, u.birthday, u.hire_date, u.active);

        // Batches
        const insB = db.prepare('INSERT OR REPLACE INTO batches (id, name, program_id, target, active, start_date, end_date, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
        for (const b of batches) insB.run(b.id, b.name, b.program_id, b.target, b.active, b.start_date, b.end_date, b.created_by, b.created_at);

        // Events
        const insE = db.prepare('INSERT OR REPLACE INTO events (id, telecaller_id, program_id, tl_id, status_id, batch_id, lead_ref, created_by, created_at, business_date, voided, voided_by, voided_at, void_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        for (const e of events) insE.run(e.id, e.telecaller_id, e.program_id, e.tl_id, e.status_id, e.batch_id, e.lead_ref, e.created_by, e.created_at, e.business_date, e.voided, e.voided_by, e.voided_at, e.void_reason);

        // Daily Adjustments
        const insA = db.prepare('INSERT OR REPLACE INTO daily_adjustments (id, telecaller_id, status_code, business_date, adjusted_by, old_count, new_count, created_at) VALUES (?,?,?,?,?,?,?,?)');
        for (const a of adjs) insA.run(a.id, a.telecaller_id, a.status_code, a.business_date, a.adjusted_by, a.old_count, a.new_count, a.created_at);

        // Settings
        const insS = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)');
        for (const s of settings) insS.run(s.key, s.value);
      })();

      this.lastSyncAt = new Date().toISOString();
      return { ok: true, pulled: { programs: progs.length, users: users.length, events: events.length, batches: batches.length } };
    } finally {
      client.release();
    }
  }

  /** Get operational status of the Tier 2 Cloud sync */
  getStatus() {
    const localEvents = db.prepare('SELECT COUNT(*) as c FROM events').get()?.c || 0;
    const localUsers = db.prepare('SELECT COUNT(*) as c FROM users WHERE active = 1').get()?.c || 0;
    const localPrograms = db.prepare('SELECT COUNT(*) as c FROM programs WHERE active = 1').get()?.c || 0;
    const localBatches = db.prepare('SELECT COUNT(*) as c FROM batches WHERE active = 1').get()?.c || 0;

    let hostMasked = 'None (Offline / Local WAL Engine)';
    if (this.connectionUrl) {
      try {
        const u = new URL(this.connectionUrl.replace('postgresql://', 'http://').replace('postgres://', 'http://'));
        hostMasked = `${u.hostname}:${u.port || 5432} (${u.pathname.slice(1) || 'postgres'})`;
      } catch {
        hostMasked = 'PostgreSQL Cloud Host';
      }
    }

    return {
      tier1_local_engine: 'Active (Sub-millisecond In-Memory / WAL Cache)',
      tier2_cloud_postgresql: {
        enabled: this.enabled,
        connected: this.connected,
        host: hostMasked,
        pending_queue: this.queue.length,
        last_sync: this.lastSyncAt,
        last_error: this.lastError,
      },
      tier3_backup_layer: 'Active (Automated 24h JSON Snapshots & Admin 1-Click Export/Restore)',
      counts: {
        events: localEvents,
        users: localUsers,
        programs: localPrograms,
        batches: localBatches,
      },
    };
  }
}

export const cloudSync = new CloudSyncService();
