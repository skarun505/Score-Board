import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isQuietHours, calculateVolume } from '../src/sound.js';

describe('Sound & Quiet Hours Pure Function Tests', () => {
  test('Edge Case 1: Window crossing midnight (22:00 to 07:00)', () => {
    const start = '22:00';
    const end = '07:00';

    assert.equal(isQuietHours('21:59', start, end), false, '21:59 is before quiet start');
    assert.equal(isQuietHours('22:00', start, end), true, '22:00 is exact quiet start');
    assert.equal(isQuietHours('23:30', start, end), true, '23:30 is late night');
    assert.equal(isQuietHours('00:00', start, end), true, '00:00 is midnight');
    assert.equal(isQuietHours('03:30', start, end), true, '03:30 is middle of night');
    assert.equal(isQuietHours('06:59', start, end), true, '06:59 is just before quiet end');
    assert.equal(isQuietHours('07:00', start, end), false, '07:00 is quiet end boundary');
    assert.equal(isQuietHours('12:00', start, end), false, '12:00 noon is active hours');
  });

  test('Edge Case 2: Window within same day (13:00 to 15:00 afternoon rest)', () => {
    const start = '13:00';
    const end = '15:00';

    assert.equal(isQuietHours('12:59', start, end), false, '12:59 is before quiet start');
    assert.equal(isQuietHours('13:00', start, end), true, '13:00 is exact start');
    assert.equal(isQuietHours('14:00', start, end), true, '14:00 is inside window');
    assert.equal(isQuietHours('15:00', start, end), false, '15:00 is exact end boundary');
    assert.equal(isQuietHours('15:01', start, end), false, '15:01 is after quiet window');
  });

  test('Edge Case 3: Start equals end (disabled window)', () => {
    assert.equal(isQuietHours('10:00', '10:00', '10:00'), false);
    assert.equal(isQuietHours('22:00', '22:00', '22:00'), false);
  });

  test('Edge Case 4: Acceptance of Date object and minutes number', () => {
    const dateAtMidnight = new Date('2026-10-28T00:30:00');
    // Minutes since midnight = hour*60 + min
    const mins = dateAtMidnight.getHours() * 60 + dateAtMidnight.getMinutes();
    assert.equal(typeof mins, 'number');
    assert.equal(isQuietHours(dateAtMidnight, '22:00', '07:00'), isQuietHours(mins, '22:00', '07:00'));
  });

  test('Edge Case 5: Effective volume calculation and scaling', () => {
    const settings = {
      sound_enabled: '1',
      normal_volume: '1.0',
      quiet_volume: '0.3',
      quiet_start: '22:00',
      quiet_end: '07:00',
    };

    // Daytime full volume
    assert.equal(calculateVolume(settings, '14:00', 1), 1.0);

    // Daytime non-sale sound half volume (0.5 scale)
    assert.equal(calculateVolume(settings, '14:00', 0.5), 0.5);

    // Quiet hours full scale (quiet_volume = 0.3)
    assert.equal(calculateVolume(settings, '23:00', 1), 0.3);

    // Quiet hours non-sale sound half volume (0.3 * 0.5 = 0.15)
    assert.equal(calculateVolume(settings, '23:00', 0.5), 0.15);

    // sound_enabled = '0' mutes everything regardless of time
    const mutedSettings = { ...settings, sound_enabled: '0' };
    assert.equal(calculateVolume(mutedSettings, '14:00', 1), 0);
    assert.equal(calculateVolume(mutedSettings, '23:00', 1), 0);
  });
});
