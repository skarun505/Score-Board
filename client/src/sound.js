const NAMES = ['bell', 'chime', 'soft', 'gong', 'applause'];
const cache = {};
let unlocked = false;

export const isUnlocked = () => unlocked;

/**
 * Pure function to check if a given time falls within quiet hours.
 * Handles both regular windows (e.g. 13:00 - 15:00) and windows that cross midnight (e.g. 22:00 - 07:00).
 * @param {Date|string|number} time - Date object, "HH:MM" string, or minutes since midnight
 * @param {string} quietStart - "HH:MM" (default "22:00")
 * @param {string} quietEnd - "HH:MM" (default "07:00")
 * @returns {boolean}
 */
export function isQuietHours(time, quietStart = '22:00', quietEnd = '07:00') {
  let mins;
  if (time instanceof Date) {
    mins = time.getHours() * 60 + time.getMinutes();
  } else if (typeof time === 'string') {
    const [h, m] = time.split(':').map(Number);
    mins = (h || 0) * 60 + (m || 0);
  } else if (typeof time === 'number') {
    mins = time;
  } else {
    const d = new Date();
    mins = d.getHours() * 60 + d.getMinutes();
  }

  const [sh = 22, sm = 0] = String(quietStart || '22:00').split(':').map(Number);
  const [eh = 7, em = 0] = String(quietEnd || '07:00').split(':').map(Number);

  const start = sh * 60 + sm;
  const end = eh * 60 + em;

  if (start === end) return false;
  if (start > end) {
    // Window crosses midnight (e.g. 22:00 to 07:00)
    return mins >= start || mins < end;
  }
  // Window within same calendar day (e.g. 13:00 to 15:00)
  return mins >= start && mins < end;
}

/**
 * Pure function to calculate effective volume.
 * @param {object} settings
 * @param {Date|string|number} time
 * @param {number} scale
 * @returns {number}
 */
export function calculateVolume(settings = {}, time = new Date(), scale = 1) {
  if (settings.sound_enabled === '0' || settings.sound_enabled === false) {
    return 0;
  }
  const quiet = isQuietHours(time, settings.quiet_start, settings.quiet_end);
  const base = quiet ? Number(settings.quiet_volume ?? 0.3) : Number(settings.normal_volume ?? 1);
  return Math.min(1, Math.max(0, base * scale));
}

let audioCtx = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioCtx) {
    audioCtx = new AudioCtx();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playSynth(name, vol) {
  const ctx = getAudioContext();
  if (!ctx || vol <= 0) return;
  const now = ctx.currentTime;

  if (name === 'bell') {
    // Rich metallic bell chime (880Hz A5 + harmonics at 1760Hz and 2640Hz)
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(0.4 * vol, now + 0.015);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    master.connect(ctx.destination);

    [880, 1760, 2640].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = idx === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      g.gain.setValueAtTime(1 / (idx + 1), now);
      osc.connect(g);
      g.connect(master);
      osc.start(now);
      osc.stop(now + 1.8);
    });
  } else if (name === 'applause') {
    // Triumphant rising victory fanfare: C5 -> E5 -> G5 -> C6
    const chords = [523.25, 659.25, 783.99, 1046.5];
    chords.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const start = now + i * 0.12;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.35 * vol, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 1.2);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 1.25);
    });
  } else if (name === 'gong') {
    // Deep resonant gong
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 2.5);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.5 * vol, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 2.8);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 2.8);
  } else if (name === 'chime') {
    // Two-tone crystal chime (E6 -> B6)
    [1318.5, 1975.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const start = now + i * 0.15;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.3 * vol, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 1.4);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 1.4);
    });
  } else {
    // Soft affirmative blip
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.25 * vol, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  }
}

function load(name) {
  if (typeof Audio === 'undefined') return null;
  if (!cache[name]) {
    cache[name] = new Audio(`/sounds/${name}.mp3`);
    cache[name].preload = 'auto';
  }
  return cache[name];
}

/** Call once from a click (or automatically in kiosk mode with the autoplay flag). */
export function unlockAudio() {
  unlocked = true;
  NAMES.forEach(load);
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

export function play(name, settings, scale = 1) {
  if (settings?.sound_enabled === '0' || !name) return;
  const vol = calculateVolume(settings, new Date(), scale);
  if (vol <= 0) return;

  // 1. Try HTML5 Audio file
  const a = load(name);
  if (a) {
    a.currentTime = 0;
    a.volume = vol;
    a.play().catch(() => {});
  }

  // 2. Play Web Audio synth for instantaneous, guaranteed sound
  try {
    playSynth(name, vol);
  } catch (err) {
    // ignore
  }
}
