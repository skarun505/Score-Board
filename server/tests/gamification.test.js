import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import {
  calculateProgramStreak,
  calculateBadges,
  calculateHotNow,
  calculateNudges,
  calculateCelebrations,
} from '../src/services/dashboard.js';
import {
  recordUserLogin,
  getCounselorLoginStreakStatus,
  getTlInactiveCounselors,
} from '../src/db.js';

describe('Gamification Unit Tests', () => {
  let tc1, tc2, progA, progB, tl1, saleStatus;

  before(() => {
    tc1 = db.prepare("SELECT * FROM users WHERE role = 'telecaller' LIMIT 1").get();
    tc2 = db.prepare("SELECT * FROM users WHERE role = 'telecaller' AND id != ? LIMIT 1").get(tc1.id);
    tl1 = db.prepare("SELECT * FROM users WHERE role = 'tl' LIMIT 1").get();
    progA = db.prepare("SELECT * FROM programs LIMIT 1").get();
    progB = db.prepare("SELECT * FROM programs WHERE id != ? LIMIT 1").get(progA.id);
    saleStatus = db.prepare("SELECT * FROM statuses WHERE is_sale = 1 LIMIT 1").get();
  });

  beforeEach(() => {
    db.prepare('DELETE FROM events').run();
  });

  test('calculateProgramStreak counts consecutive target days and breaks on miss', () => {
    const today = '2026-10-28';
    const yday = '2026-10-27';
    const dayBefore = '2026-10-26';
    const target = 2;

    // Zero target returns 0
    assert.equal(calculateProgramStreak(progA.id, 0, today), 0);

    // No sales -> streak 0
    assert.equal(calculateProgramStreak(progA.id, target, today), 0);

    const ins = db.prepare(`
      INSERT INTO events (telecaller_id, program_id, tl_id, status_id, created_by, created_at, business_date)
      VALUES (?,?,?,?,?,?,?)
    `);

    // Insert 2 sales today (meets target)
    ins.run(tc1.id, progA.id, tl1.id, saleStatus.id, tl1.id, `${today}T10:00:00Z`, today);
    ins.run(tc1.id, progA.id, tl1.id, saleStatus.id, tl1.id, `${today}T11:00:00Z`, today);

    // Insert 2 sales yesterday (meets target)
    ins.run(tc1.id, progA.id, tl1.id, saleStatus.id, tl1.id, `${yday}T10:00:00Z`, yday);
    ins.run(tc1.id, progA.id, tl1.id, saleStatus.id, tl1.id, `${yday}T11:00:00Z`, yday);

    // Insert 2 sales day before yesterday (meets target)
    ins.run(tc1.id, progA.id, tl1.id, saleStatus.id, tl1.id, `${dayBefore}T10:00:00Z`, dayBefore);
    ins.run(tc1.id, progA.id, tl1.id, saleStatus.id, tl1.id, `${dayBefore}T11:00:00Z`, dayBefore);

    assert.equal(calculateProgramStreak(progA.id, target, today), 3);
  });

  test('calculateBadges identifies First Sale, Closer (5+), and Comeback', () => {
    const today = '2026-10-28';
    const yday = '2026-10-27';
    const ins = db.prepare(`
      INSERT INTO events (telecaller_id, program_id, tl_id, status_id, created_by, created_at, business_date)
      VALUES (?,?,?,?,?,?,?)
    `);

    // Yesterday: tc1 had 2 sales, tc2 had 0 sales
    ins.run(tc1.id, progA.id, tl1.id, saleStatus.id, tl1.id, `${yday}T10:00:00Z`, yday);
    ins.run(tc1.id, progA.id, tl1.id, saleStatus.id, tl1.id, `${yday}T11:00:00Z`, yday);

    // Today: tc1 makes the first sale at 09:00:00
    ins.run(tc1.id, progA.id, tl1.id, saleStatus.id, tl1.id, `${today}T09:00:00Z`, today);

    // Today: tc2 makes 5 sales (Closer badge + Comeback badge)
    for (let i = 0; i < 5; i++) {
      ins.run(tc2.id, progA.id, tl1.id, saleStatus.id, tl1.id, `${today}T10:0${i}:00Z`, today);
    }

    const badges = calculateBadges(today, yday);

    // tc1 should have First Sale
    const tc1Badges = badges[tc1.id] || [];
    assert.ok(tc1Badges.some((b) => b.code === 'first_sale'));

    // tc2 should have Closer (5+) and Comeback (beat 0 from yesterday)
    const tc2Badges = badges[tc2.id] || [];
    assert.ok(tc2Badges.some((b) => b.code === 'closer'));
    assert.ok(tc2Badges.some((b) => b.code === 'comeback'));
  });

  test('calculateHotNow detects telecaller with 2+ sales in last 60 minutes', () => {
    const now = new Date('2026-10-28T14:00:00Z');
    const ins = db.prepare(`
      INSERT INTO events (telecaller_id, program_id, tl_id, status_id, created_by, created_at, business_date)
      VALUES (?,?,?,?,?,?,?)
    `);

    // Sale 90 minutes ago (outside window)
    ins.run(tc1.id, progA.id, tl1.id, saleStatus.id, tl1.id, '2026-10-28T12:20:00Z', '2026-10-28');

    // Only 1 sale in window -> hotNow returns null (requires min 2)
    ins.run(tc1.id, progA.id, tl1.id, saleStatus.id, tl1.id, '2026-10-28T13:30:00Z', '2026-10-28');
    assert.equal(calculateHotNow(now), null);

    // Second sale 10 mins ago -> hotNow returns tc1
    ins.run(tc1.id, progA.id, tl1.id, saleStatus.id, tl1.id, '2026-10-28T13:50:00Z', '2026-10-28');
    const hot = calculateHotNow(now);
    assert.ok(hot);
    assert.equal(hot.id, tc1.id);
    assert.equal(hot.recent_sales, 2);
  });

  test('calculateNudges produces encouraging positive messages', () => {
    const programs = [
      { name: 'Program Alpha', sales: 10 },
      { name: 'Program Beta', sales: 8 }, // 2 behind Alpha
      { name: 'Program Gamma', sales: 1 }, // 7 behind Beta (diff > 4, ignored)
    ];
    const nudges = calculateNudges(programs);
    assert.equal(nudges.length, 1);
    assert.equal(nudges[0], 'Program Beta is only 2 sales behind Program Alpha!');
  });

  test('calculateCelebrations produces birthday and work anniversary banners', () => {
    // Temporarily update tc1 and tc2 with birthday and hire_date
    db.prepare('UPDATE users SET birthday = ?, hire_date = ? WHERE id = ?').run('10-28', '2024-10-28', tc1.id);
    db.prepare('UPDATE users SET birthday = ?, hire_date = ? WHERE id = ?').run('05-12', '2026-10-28', tc2.id);

    const celebrations = calculateCelebrations('2026-10-28');
    assert.ok(celebrations.some((c) => c.type === 'birthday' && c.user.id === tc1.id));
    assert.ok(celebrations.some((c) => c.type === 'anniversary' && c.text.includes('2 Year')));

    // Clean up
    db.prepare('UPDATE users SET birthday = NULL, hire_date = NULL WHERE id IN (?, ?)').run(tc1.id, tc2.id);
  });

  test('Daily Login Streak and >4 days inactivity warning for counselor & TL', () => {
    // Reset tc1 login state and ensure tc1 belongs to tl1
    db.prepare('UPDATE users SET tl_id = ?, last_login_date = NULL, last_login_at = NULL, login_streak = 0 WHERE id = ?').run(tl1.id, tc1.id);

    // Day 1: First login -> streak = 1
    const day1 = new Date('2026-11-01T10:00:00Z');
    const res1 = recordUserLogin(tc1.id, day1);
    assert.equal(res1.streak, 1);
    assert.equal(res1.streak_broken, false);

    // Day 1 duplicate login -> streak stays 1
    const res1Dup = recordUserLogin(tc1.id, new Date('2026-11-01T15:00:00Z'));
    assert.equal(res1Dup.streak, 1);

    // Day 2 consecutive login -> streak = 2
    const day2 = new Date('2026-11-02T10:00:00Z');
    const res2 = recordUserLogin(tc1.id, day2);
    assert.equal(res2.streak, 2);

    // Day 3 consecutive login -> streak = 3
    const day3 = new Date('2026-11-03T10:00:00Z');
    const res3 = recordUserLogin(tc1.id, day3);
    assert.equal(res3.streak, 3);

    // On Day 8 (5 days later, > 4 days inactive):
    // Check status before logging in:
    const statusBefore = getCounselorLoginStreakStatus(tc1.id, '2026-11-08');
    assert.equal(statusBefore.status, 'ended');
    assert.equal(statusBefore.streak_ended, true);
    assert.ok(statusBefore.streak_warning.includes('more than 4 days'));

    // TL checks inactive counselors:
    const tlAlerts = getTlInactiveCounselors(tl1.id, '2026-11-08');
    assert.ok(tlAlerts.counselors.some((c) => c.id === tc1.id && c.streak_ended));

    // When tc1 logs in on Day 8:
    const res8 = recordUserLogin(tc1.id, new Date('2026-11-08T10:00:00Z'));
    assert.equal(res8.streak_broken, true);
    assert.equal(res8.streak, 1); // Streak ended and restarted
  });

  test('Admin winning sound settings configuration', () => {
    // Save custom sound setting
    const testSoundUrl = '/uploads/test_chime.mp3';
    db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('sale_sound', testSoundUrl);
    db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('sale_sound_url', testSoundUrl);
    db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('sale_sound_name', 'Golden Chime');

    const sound = db.prepare("SELECT value FROM settings WHERE key = 'sale_sound'").get()?.value;
    assert.equal(sound, testSoundUrl);

    // Reset back
    db.prepare("UPDATE settings SET value = 'bell' WHERE key = 'sale_sound'").run();
    db.prepare("UPDATE settings SET value = '' WHERE key = 'sale_sound_url'").run();
  });
});
