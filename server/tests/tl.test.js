import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/index.js';
import { db, businessDate } from '../src/db.js';

test('Team Leader & Advanced Counselor Features', async (t) => {
  // 1. Login as TL TL001
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ employee_code: 'TL001', pin: '111111' })
    .expect(200);

  const tlToken = loginRes.body.token;
  assert.ok(tlToken, 'TL should receive JWT token');
  const tlUser = loginRes.body.user;

  // 2. TL creates a new counselor manually
  const testCode = `TC999_${Date.now().toString().slice(-4)}`;
  const createRes = await request(app)
    .post('/api/tl/counselors')
    .set('Authorization', `Bearer ${tlToken}`)
    .send({
      name: 'Test Manual Counselor',
      employee_code: testCode,
      program_id: tlUser.program_id,
      pin: '111111',
    })
    .expect(201);

  assert.equal(createRes.body.employee_code, testCode);
  const newCounselorId = createRes.body.id;

  // 3. TL edits counselor details
  await request(app)
    .patch(`/api/tl/counselors/${newCounselorId}`)
    .set('Authorization', `Bearer ${tlToken}`)
    .send({ name: 'Updated Manual Counselor' })
    .expect(200);

  const updatedRow = db.prepare('SELECT name FROM users WHERE id = ?').get(newCounselorId);
  assert.equal(updatedRow.name, 'Updated Manual Counselor');

  // 4. Custom count entry: Set count to 3 sales
  const countRes1 = await request(app)
    .post(`/api/tl/counselors/${newCounselorId}/custom-count`)
    .set('Authorization', `Bearer ${tlToken}`)
    .send({ status_code: 'sale_closed', count: 3 })
    .expect(200);

  assert.equal(countRes1.body.new_count, 3);
  assert.equal(countRes1.body.old_count, 0);

  const today = businessDate();
  const salesTodayCount = db.prepare(`
    SELECT COUNT(*) AS c FROM events e JOIN statuses s ON s.id = e.status_id
    WHERE e.telecaller_id = ? AND s.code = 'sale_closed' AND e.business_date = ? AND e.voided = 0
  `).get(newCounselorId, today).c;
  assert.equal(salesTodayCount, 3, 'Event count should match 3');

  // 5. 1-Time Daily Rechange Safeguard:
  // Rechanging once more (second time on same day) must be rejected with 400
  const countRes2 = await request(app)
    .post(`/api/tl/counselors/${newCounselorId}/custom-count`)
    .set('Authorization', `Bearer ${tlToken}`)
    .send({ status_code: 'sale_closed', count: 4 })
    .expect(400);

  assert.equal(countRes2.body.code, 'DAILY_RECHANGE_LIMIT_REACHED');

  // 6. TL Report Summary
  const repRes = await request(app)
    .get('/api/tl/reports/summary')
    .set('Authorization', `Bearer ${tlToken}`)
    .expect(200);

  assert.ok(repRes.body.whatsapp_text.includes('DAILY SALES & FLOOR REPORT'));
  assert.ok(repRes.body.totals !== undefined);

  // 7. TL CSV Export
  const csvRes = await request(app)
    .get(`/api/tl/reports/export.csv?from=${today}&to=${today}`)
    .set('Authorization', `Bearer ${tlToken}`)
    .expect(200);

  assert.ok(csvRes.text.includes('telecaller_name'));

  // 8. Self-Service PIN Change
  await request(app)
    .post('/api/auth/change-pin')
    .set('Authorization', `Bearer ${tlToken}`)
    .send({ current_pin: '111111', new_pin: '222222' })
    .expect(200);

  // Re-verify login with new PIN
  await request(app)
    .post('/api/auth/login')
    .send({ employee_code: 'TL001', pin: '222222' })
    .expect(200);

  // Revert back to 111111 for clean state
  await request(app)
    .post('/api/auth/change-pin')
    .set('Authorization', `Bearer ${tlToken}`)
    .send({ current_pin: '222222', new_pin: '111111' })
    .expect(200);

  // Cleanup test counselor
  db.prepare('DELETE FROM events WHERE telecaller_id = ?').run(newCounselorId);
  db.prepare('DELETE FROM daily_adjustments WHERE telecaller_id = ?').run(newCounselorId);
  db.prepare('DELETE FROM users WHERE id = ?').run(newCounselorId);
});

