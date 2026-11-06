import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, server } from '../src/index.js';
import { db, businessDate } from '../src/db.js';
import { signToken } from '../src/auth.js';
import { recordEvent, undoEvent, voidEvent, UNDO_SECONDS } from '../src/services/events.js';
import { getSnapshot } from '../src/services/dashboard.js';

describe('Live Sales Dashboard Server Tests', () => {
  let tl1, tl2, tc1, tc2, adminUser;
  let tl1Token, tl2Token, tc1Token, adminToken;

  before(() => {
    // Clean and seed fresh test records
    tl1 = db.prepare("SELECT * FROM users WHERE employee_code = 'TL001'").get();
    tl2 = db.prepare("SELECT * FROM users WHERE employee_code = 'TL002'").get();
    tc1 = db.prepare("SELECT * FROM users WHERE tl_id = ? AND role = 'telecaller'").get(tl1.id);
    tc2 = db.prepare("SELECT * FROM users WHERE tl_id = ? AND role = 'telecaller'").get(tl2.id);
    adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin'").get();

    tl1Token = signToken(tl1);
    tl2Token = signToken(tl2);
    tc1Token = signToken(tc1);
    adminToken = signToken(adminUser);
  });

  beforeEach(() => {
    // Reset events and audit log for each test
    db.prepare('DELETE FROM events').run();
    db.prepare('DELETE FROM audit_log').run();
    db.prepare('DELETE FROM login_attempts').run();
  });

  test('1. Ownership check: TL can only record for their own telecallers', async () => {
    // TL1 records for their own telecaller (TC1) -> 201 Created
    const resSuccess = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${tl1Token}`)
      .send({ telecaller_id: tc1.id, status_code: 'interested' });
    assert.equal(resSuccess.status, 201);
    assert.equal(resSuccess.body.event.telecaller.id, tc1.id);

    // TL1 attempts to record for TL2's telecaller (TC2) -> 403 Forbidden
    const resForbidden = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${tl1Token}`)
      .send({ telecaller_id: tc2.id, status_code: 'interested' });
    assert.equal(resForbidden.status, 403);
    assert.match(resForbidden.body.error, /Not your team member/i);
  });

  test('2. Duplicate guard: second sale within window requires confirmation', async () => {
    // First sale -> 201
    const res1 = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${tl1Token}`)
      .send({ telecaller_id: tc1.id, status_code: 'sale_closed' });
    assert.equal(res1.status, 201);

    // Second sale immediately without confirm_duplicate -> 409 DUPLICATE_CONFIRM
    const res2 = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${tl1Token}`)
      .send({ telecaller_id: tc1.id, status_code: 'sale_closed' });
    assert.equal(res2.status, 409);
    assert.equal(res2.body.code, 'DUPLICATE_CONFIRM');

    // Second sale with confirm_duplicate = true -> 201
    const res3 = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${tl1Token}`)
      .send({ telecaller_id: tc1.id, status_code: 'sale_closed', confirm_duplicate: true });
    assert.equal(res3.status, 201);
  });

  test('3. Undo window: creator can undo within window, not others', async () => {
    const res1 = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${tl1Token}`)
      .send({ telecaller_id: tc1.id, status_code: 'sale_closed' });
    const eventId = res1.body.event.id;

    // TL2 tries to undo TL1's entry -> 403
    const resFail = await request(app)
      .post(`/api/events/${eventId}/undo`)
      .set('Authorization', `Bearer ${tl2Token}`);
    assert.equal(resFail.status, 403);

    // TL1 undos their own entry -> 200
    const resUndo = await request(app)
      .post(`/api/events/${eventId}/undo`)
      .set('Authorization', `Bearer ${tl1Token}`);
    assert.equal(resUndo.status, 200);
    assert.equal(resUndo.body.ok, true);

    const eventInDb = db.prepare('SELECT voided, void_reason FROM events WHERE id = ?').get(eventId);
    assert.equal(eventInDb.voided, 1);
    assert.equal(eventInDb.void_reason, 'undo');
  });

  test('4. Voided entries excluded from counts and dashboard', async () => {
    // Record sale
    const res1 = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${tl1Token}`)
      .send({ telecaller_id: tc1.id, status_code: 'sale_closed' });
    const eventId = res1.body.event.id;

    let snap = getSnapshot();
    assert.equal(snap.totals.sales, 1);
    assert.equal(snap.feed.length, 1);

    // Admin voids it with reason
    const resVoid = await request(app)
      .post(`/api/admin/events/${eventId}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Customer changed mind' });
    assert.equal(resVoid.status, 200);

    snap = getSnapshot();
    assert.equal(snap.totals.sales, 0);
    assert.equal(snap.feed.length, 0);
  });

  test('5. Milestone detection: first sale, target hit, every Nth sale', async () => {
    // Set low target on Program A to test target_hit
    db.prepare('UPDATE programs SET daily_target = 2 WHERE id = ?').run(tl1.program_id);

    // First sale of the day -> milestone: first_sale
    const r1 = recordEvent({ actor: tl1, telecallerId: tc1.id, statusCode: 'sale_closed', confirmDuplicate: true });
    assert.ok(r1.milestone);
    assert.equal(r1.milestone.type, 'first_sale');

    // Second sale -> hits target of 2 -> milestone: target_hit
    const r2 = recordEvent({ actor: tl1, telecallerId: tc1.id, statusCode: 'sale_closed', confirmDuplicate: true });
    assert.ok(r2.milestone);
    assert.equal(r2.milestone.type, 'target_hit');
    assert.match(r2.milestone.label, /hit its target/i);
  });

  test('6. Business date calculation around midnight in Asia/Kolkata', () => {
    // Test date format YYYY-MM-DD
    const d = businessDate(new Date('2026-10-28T19:00:00Z')); // 00:30 IST next day
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(d, '2026-10-29');

    // With a date before midnight IST
    const d2 = businessDate(new Date('2026-10-28T18:00:00Z')); // 23:30 IST on 28th
    assert.equal(d2, '2026-10-28');
  });

  test('7. Auth & Lockout: correct credentials succeed, 5 failed attempts lock for 10 minutes', async () => {
    // Success login
    const resOk = await request(app)
      .post('/api/auth/login')
      .send({ employee_code: 'TL001', pin: '111111' });
    assert.equal(resOk.status, 200);
    assert.ok(resOk.body.token);

    // 4 failed attempts
    for (let i = 0; i < 4; i++) {
      const resWrong = await request(app)
        .post('/api/auth/login')
        .send({ employee_code: 'TL001', pin: '000000' });
      assert.equal(resWrong.status, 401);
    }

    // 5th failed attempt triggers lockout
    const res5 = await request(app)
      .post('/api/auth/login')
      .send({ employee_code: 'TL001', pin: '000000' });
    assert.equal(res5.status, 429);
    assert.match(res5.body.error, /locked/i);

    // 6th attempt (even with correct PIN) is blocked while locked
    const resBlocked = await request(app)
      .post('/api/auth/login')
      .send({ employee_code: 'TL001', pin: '111111' });
    assert.equal(resBlocked.status, 429);
    assert.match(resBlocked.error.text, /locked/i);
  });

  test('8. Profile photo upload and delete', async () => {
    const base64Png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const resUpload = await request(app)
      .post('/api/profile/photo')
      .set('Authorization', `Bearer ${tc1Token}`)
      .send({ photo: base64Png });
    assert.equal(resUpload.status, 200);
    assert.match(resUpload.body.photo_url, /^\/uploads\//);

    const user = db.prepare('SELECT photo_url FROM users WHERE id = ?').get(tc1.id);
    assert.equal(user.photo_url, resUpload.body.photo_url);

    // Delete photo
    const resDel = await request(app)
      .delete('/api/profile/photo')
      .set('Authorization', `Bearer ${tc1Token}`);
    assert.equal(resDel.status, 200);
    assert.equal(resDel.body.ok, true);

    const userAfter = db.prepare('SELECT photo_url FROM users WHERE id = ?').get(tc1.id);
    assert.equal(userAfter.photo_url, null);
  });

  test('9. Counselor me endpoint returns weekly stats and rank', async () => {
    // Record a sale for tc1
    await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${tl1Token}`)
      .send({ telecaller_id: tc1.id, status_code: 'sale_closed' });

    const resMe = await request(app)
      .get('/api/counselor/me')
      .set('Authorization', `Bearer ${tc1Token}`);

    assert.equal(resMe.status, 200);
    assert.equal(resMe.body.user.id, tc1.id);
    assert.equal(resMe.body.stats.sales_today, 1);
    assert.equal(resMe.body.stats.sales_week, 1);
    assert.equal(resMe.body.stats.rank_today, 1);
    assert.equal(resMe.body.stats.active_callers_today, 1);
  });

  after(() => {
    if (server.listening) server.close();
  });
});
