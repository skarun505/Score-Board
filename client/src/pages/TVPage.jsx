import { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { connectSocket } from '../socket.js';
import { play, unlockAudio, isUnlocked } from '../sound.js';
import { api } from '../api.js';

const STALE_MS = 75_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fireConfetti(big) {
  const end = Date.now() + (big ? 4000 : 2000);
  (function frame() {
    confetti({ particleCount: big ? 8 : 4, angle: 60, spread: 80, origin: { x: 0, y: 0.7 } });
    confetti({ particleCount: big ? 8 : 4, angle: 120, spread: 80, origin: { x: 1, y: 0.7 } });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

function Avatar({ p, big, size }) {
  const initials = p?.name
    ? p.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : '??';
  const cls = 'tv-avatar' + (big ? ' big' : '');
  const style = size ? { width: size, height: size, fontSize: `calc(${size} * 0.4)` } : {};
  return p?.photo_url ? (
    <img className={cls} style={style} src={p.photo_url} alt="" />
  ) : (
    <div className={cls} style={style}>{initials}</div>
  );
}

export function getCleanProgramName(name) {
  return name || '';
}

function usePage(items, size, ms) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / size));
  useEffect(() => {
    const t = setInterval(() => setPage((p) => (p + 1) % pages), ms);
    return () => clearInterval(t);
  }, [pages, ms]);
  const p = page % pages;
  return { slice: items.slice(p * size, p * size + size), page: p, pages };
}

function CelebrationModal({ batch, milestone, onClose }) {
  const one = batch.length === 1 ? batch[0] : null;
  return (
    <div className="tv-celebrate-overlay" onClick={onClose} title="Click anywhere to dismiss">
      <div className="celebrate-backdrop-glow" />
      <div className="celebrate-card" onClick={(e) => e.stopPropagation()}>
        {milestone && (
          <div className="celebrate-milestone-pill">
            <i className="fas fa-trophy"></i> {milestone.label}
          </div>
        )}
        {one ? (
          <>
            <div className="celebrate-avatar-ring">
              <Avatar p={one.telecaller} big />
            </div>
            <div className="celebrate-kicker">
              <i className="fas fa-sparkles"></i> NEW SALE CLOSED! <i className="fas fa-sparkles"></i>
            </div>
            <div className="celebrate-name">{one.telecaller.name}</div>
            <div className="celebrate-details">
              <span className="celebrate-prog" title={one.program.name}>
                <i className="fas fa-building"></i> {getCleanProgramName(one.program.name)}
              </span>
              <span className="celebrate-divider">•</span>
              <span className="celebrate-tl"><i className="fas fa-user-tie"></i> TL: {one.tl.name}</span>
            </div>
          </>
        ) : (
          <>
            <div className="celebrate-kicker">
              <i className="fas fa-fire"></i> MASSIVE SALES BURST! <i className="fas fa-fire"></i>
            </div>
            <div className="celebrate-name">{batch.length} NEW SALES CLOSED!</div>
            <div className="celebrate-burst-grid">
              {batch.slice(0, 8).map((e) => (
                <div key={e.id} className="burst-chip">
                  <Avatar p={e.telecaller} size="2.4em" />
                  <span>{e.telecaller.name} ({getCleanProgramName(e.program.name)})</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div style={{ fontSize: '0.85em', color: '#94a3b8', marginTop: '0.4em' }}>
          <i className="fas fa-info-circle"></i> Auto-closing · Click backdrop to dismiss
        </div>
      </div>
    </div>
  );
}

export default function TVPage() {
  const params = new URLSearchParams(location.search);
  const key = params.get('key') || '';
  const autoSound = params.get('autosound') === '1';

  const [snap, setSnap] = useState(null);
  const [online, setOnline] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [celebration, setCelebration] = useState(null);
  const [soundReady, setSoundReady] = useState(isUnlocked());
  const [view, setView] = useState('today');
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const [connError, setConnError] = useState(null);

  const settingsRef = useRef({});
  const queue = useRef([]);
  const busy = useRef(false);

  // Fast REST snapshot fallback on mount for instant zero-lag rendering
  useEffect(() => {
    const qKey = key ? `?key=${encodeURIComponent(key)}` : '';
    api(`/api/dashboard${qKey}`)
      .then((d) => {
        if (d && !snap) {
          settingsRef.current = d.settings || {};
          setSnap(d);
          setLastUpdate(Date.now());
        }
      })
      .catch((e) => {
        if (e.status === 401) {
          setConnError('Authentication required. Invalid or missing TV Key.');
        }
      });
  }, [key]);

  async function pump() {
    if (busy.current) return;
    busy.current = true;
    while (queue.current.length) {
      await sleep(800);
      const batch = queue.current.splice(0);
      const milestone = batch.find((e) => e.milestone)?.milestone || null;
      setCelebration({ batch, milestone });
      play(milestone ? (milestone.type === 'target_hit' ? 'applause' : 'gong') : 'bell', settingsRef.current);
      fireConfetti(batch.length > 1 || !!milestone);
      await sleep(milestone ? 7500 : 4500);
      setCelebration(null);
      await sleep(300);
    }
    busy.current = false;
  }

  useEffect(() => {
    if (autoSound) {
      unlockAudio();
      setSoundReady(true);
    }
    const token = localStorage.getItem('token') || undefined;
    const s = connectSocket({ tvKey: key || undefined, token });
    s.on('connect', () => {
      setOnline(true);
      setConnError(null);
    });
    s.on('connect_error', (err) => {
      if (err?.message === 'unauthorized') {
        setConnError('TV Screen unauthorized. Please open with ?key=TV_KEY or log in as Admin/TL.');
      }
    });
    s.on('disconnect', () => setOnline(false));
    s.on('snapshot', (d) => {
      settingsRef.current = d.settings || {};
      setSnap(d);
      setLastUpdate(Date.now());
      setConnError(null);
    });
    s.on('event:new', (ev) => {
      if (ev.status.is_sale) {
        queue.current.push(ev);
        pump();
      } else if (ev.status.sound) {
        play(ev.status.sound, settingsRef.current, 0.5);
      }
    });
    s.on('remote_action', (data) => {
      if (data?.action === 'test_sound' || data?.action === 'test_bell') {
        play('bell', settingsRef.current);
      } else if (data?.action === 'test_gong') {
        play('gong', settingsRef.current);
      } else if (data?.action === 'test_cheer') {
        play('cheer', settingsRef.current);
      } else if (data?.action === 'test_confetti') {
        fireConfetti(true);
      } else if (data?.action === 'force_reload') {
        window.location.reload();
      }
    });
    s.on('tv_broadcast', (data) => {
      setSnap((prev) => prev ? {
        ...prev,
        broadcast: data.active ? { message: data.message, style: data.style } : null
      } : prev);
    });
    return () => s.close();
  }, [key]);

  /* Live clock */
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  /* Global auto-unlock audio on any user interaction */
  useEffect(() => {
    function handleGesture() {
      unlockAudio();
      setSoundReady(true);
    }
    window.addEventListener('click', handleGesture);
    window.addEventListener('keydown', handleGesture);
    window.addEventListener('touchstart', handleGesture);
    return () => {
      window.removeEventListener('click', handleGesture);
      window.removeEventListener('keydown', handleGesture);
      window.removeEventListener('touchstart', handleGesture);
    };
  }, []);

  /* Rotate right panel between today and 7 days */
  const rotSec = Number(snap?.settings?.tv_rotation_sec || 25);
  useEffect(() => {
    const t = setInterval(() => setView((v) => (v === 'today' ? 'week' : 'today')), rotSec * 1000);
    return () => clearInterval(t);
  }, [rotSec]);

  /* Nightly auto-reload at 03:30 IST */
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      if (d.getHours() === 3 && d.getMinutes() === 30 && performance.now() > 120_000) {
        location.reload();
      }
    }, 20_000);
    return () => clearInterval(t);
  }, []);

  /* Burn-in protection: subtle micro-jitter */
  useEffect(() => {
    const t = setInterval(() => {
      setShift({
        x: Math.round(Math.random() * 8 - 4),
        y: Math.round(Math.random() * 8 - 4),
      });
    }, 180_000);
    return () => clearInterval(t);
  }, []);

  const programsPage = usePage(snap?.programs || [], 8, 15000);
  const footerProgramsPage = usePage(snap?.programs || [], 4, 15000);

  if (!snap) {
    return (
      <div className="tv-root">
        <div className="tv-connecting-box">
          {connError ? (
            <>
              <div style={{ fontSize: '3rem', color: '#ef4444' }}><i className="fas fa-shield-halved" /></div>
              <div className="tv-wait-title" style={{ color: '#ef4444' }}>TV Screen Authorization</div>
              <p className="muted" style={{ maxWidth: '420px', margin: '0 auto' }}>{connError}</p>
              <form onSubmit={(e) => {
                e.preventDefault();
                const inputKey = e.target.elements.k?.value?.trim();
                if (inputKey) window.location.search = `?key=${encodeURIComponent(inputKey)}`;
              }} style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', width: '100%', maxWidth: '380px' }}>
                <input name="k" placeholder="Enter TV Key..." style={{ flex: 1, padding: '0.6rem 0.9rem', borderRadius: '0.6rem', border: '1.5px solid #cbd5e1', fontSize: '1rem' }} />
                <button type="submit" style={{ padding: '0.6rem 1.2rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.6rem', fontWeight: 800 }}>Connect</button>
              </form>
            </>
          ) : (
            <>
              <div className="tv-spinner" />
              <div className="tv-wait-title">Connecting to 108" Live Sales Stream…</div>
              <p className="muted">Synchronizing programs, team leaders, and real-time audio channels</p>
            </>
          )}
        </div>
      </div>
    );
  }

  const stale = !online || !lastUpdate || now - lastUpdate > STALE_MS;
  const agoSec = Math.round((now - lastUpdate) / 1000);
  const target = snap.totals.week_target || 0;
  const sales = snap.totals.week_sales || 0;
  const pct = target > 0 ? Math.min(100, Math.round((sales / target) * 100)) : 0;
  const leaders = view === 'today' ? snap.top_today : snap.top_week;

  // Aggregate totals across all programs
  const totalFollowups = (snap.programs || []).reduce((acc, p) => acc + (p.by_status?.follow_up || 0), 0);
  const totalInterested = (snap.programs || []).reduce((acc, p) => acc + (p.by_status?.interested || 0), 0);
  const totalL1 = (snap.programs || []).reduce((acc, p) => acc + (p.by_status?.l1_selected || 0), 0);
  const totalL2 = (snap.programs || []).reduce((acc, p) => acc + (p.by_status?.l2_selected || 0), 0);

  const topPerformer = leaders.length > 0 ? leaders[0] : null;

  return (
    <div className="tv-root" style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}>
      {/* Stale Connection Warning Banner */}
      {stale && (
        <div className="tv-stale-banner">
          <i className="fas fa-exclamation-triangle"></i> LIVE FEED DELAYED · Last synchronized {agoSec}s ago · Reconnecting…
        </div>
      )}

      {/* Power Hour Mode Banner */}
      {snap?.power_hour && (
        <div className="tv-power-hour-banner">
          <i className="fas fa-fire fa-beat text-gold"></i>
          <span><b>POWER HOUR ACTIVE!</b> Extra momentum on the floor — crush the targets!</span>
          <i className="fas fa-bolt fa-beat text-gold"></i>
        </div>
      )}

      {/* Live Admin Broadcast Marquee Ticker */}
      {snap?.broadcast?.message && (
        <div className={`tv-broadcast-ticker ${snap.broadcast.style || 'info'}`}>
          <div className="ticker-badge">
            <span className="ticker-pulse-dot" />
            <i className="fas fa-bullhorn"></i> ANNOUNCEMENT
          </div>
          <div className="ticker-marquee-track">
            <div className="ticker-text">{snap.broadcast.message}</div>
          </div>
        </div>
      )}

      {/* Top Header */}
      <header className="tv-header">
        <div className="tv-header-left">
          <div className="tv-live-pill">
            <span className="tv-pulse-dot" />
            <i className="fas fa-broadcast-tower"></i> LIVE SALES BROADCAST
          </div>
          <div className="tv-headline">FLOOR PERFORMANCE WALLBOARD</div>
        </div>

        {/* Center Mega Sales Metric */}
        <div className="tv-header-center">
          <div className="tv-sales-score-row">
            <div className="tv-sales-big-group">
              <span className="tv-sales-giant-num">{sales}</span>
              <div className="tv-sales-labels">
                <span className="tv-sales-main-lbl">SALES THIS WEEK</span>
                <span className="tv-sales-target-lbl">OF {target} TARGET</span>
              </div>
            </div>

            <div className="tv-progress-box">
              <div className="tv-progress-track">
                <div className="tv-progress-glow" style={{ width: `${pct}%` }} />
              </div>
              <div className="tv-progress-meta">
                <span className="tv-pct-badge">{pct}% ACHIEVED</span>
                <span className="tv-rem-badge">
                  {target > sales ? `${target - sales} to weekly goal` : (
                    <span><i className="fas fa-check-circle"></i> GOAL REACHED!</span>
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Header Right: Clock, Month Total & Sound Control */}
        <div className="tv-header-right">
          <div className="tv-clock-time">
            {new Date(now).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          <div className="tv-clock-date">
            {new Date(now).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} · IST
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6em', marginTop: '0.25em' }}>
            <button
              className={`tv-sound-badge-btn ${soundReady ? 'active' : 'unlocked-prompt'}`}
              onClick={(e) => {
                e.stopPropagation();
                unlockAudio();
                setSoundReady(true);
                play('bell', settingsRef.current);
              }}
              title="Click to test & enable Audio Celebrations"
            >
              <i className={`fas ${soundReady ? 'fa-volume-up' : 'fa-volume-mute'}`}></i>
              <span>{soundReady ? 'AUDIO ON' : 'ENABLE SOUND'}</span>
            </button>
            <div className="tv-month-chip">
              <i className="fas fa-calendar-check"></i> Month Total: <b>{snap.totals.month_sales} Sales</b>
            </div>
          </div>
        </div>
      </header>

      {/* Main 3-Column Display */}
      <main className="tv-main-grid">
        {/* COLUMN 1: Program Leaderboard */}
        <section className="tv-column tv-programs-col">
          <div className="tv-col-header">
            <div className="tv-col-title-wrap">
              <i className="fas fa-chart-line tv-col-icon"></i>
              <h2>PROGRAM LEADERBOARD</h2>
            </div>
            {programsPage.pages > 1 && (
              <span className="tv-page-indicator">{programsPage.page + 1}/{programsPage.pages}</span>
            )}
          </div>

          <div className="tv-program-list">
            {programsPage.slice.map((p, i) => {
              const rank = programsPage.page * 8 + i + 1;
              const pTarget = p.daily_target || 0;
              const pSales = p.sales || 0;
              const pPct = pTarget > 0 ? Math.min(100, Math.round((pSales / pTarget) * 100)) : 0;
              const isLead = rank === 1;

              return (
                <div key={p.id} className={`tv-program-card ${isLead ? 'rank-one' : ''}`}>
                  <div className="tv-prog-rank">
                    {rank === 1 ? <i className="fas fa-medal medal-gold" title="1st Place"></i> :
                     rank === 2 ? <i className="fas fa-medal medal-silver" title="2nd Place"></i> :
                     rank === 3 ? <i className="fas fa-medal medal-bronze" title="3rd Place"></i> :
                     `#${rank}`}
                  </div>
                  <div className="tv-prog-info">
                    <div className="tv-prog-name-row">
                      <span className="tv-prog-name" title={p.name}>{p.name}</span>
                      <span className="tv-tl-badge"><i className="fas fa-bullseye"></i> Target: {p.daily_target}</span>
                      {p.streak > 1 && <span className="tv-streak-badge"><i className="fas fa-fire"></i> {p.streak}d streak</span>}
                    </div>
                    <div className="tv-prog-bar-track">
                      <div className="tv-prog-bar-fill" style={{ width: `${pPct}%` }} />
                    </div>
                    <div className="tv-prog-sub-meta">
                      <span>Target: {pTarget} ({pPct}%)</span>
                      <span className={`tv-trend-tag ${p.trend}`}>
                        {p.trend === 'up' ? <span><i className="fas fa-arrow-up"></i> Trending Up</span> :
                         p.trend === 'down' ? <span><i className="fas fa-arrow-down"></i> Down vs yday</span> :
                         <span><i className="fas fa-minus"></i> Steady</span>}
                      </span>
                    </div>
                  </div>
                  <div className="tv-prog-sales-num">{pSales}</div>
                </div>
              );
            })}
            {!programsPage.slice.length && (
              <div className="tv-empty-card">No programs active today</div>
            )}
          </div>
        </section>

        {/* COLUMN 2: Live Activity Feed */}
        <section className="tv-column tv-feed-col">
          <div className="tv-col-header">
            <div className="tv-col-title-wrap">
              <i className="fas fa-bolt tv-col-icon"></i>
              <h2>REAL-TIME FLOOR PULSE</h2>
            </div>
            <span className="tv-feed-badge"><i className="fas fa-circle-notch fa-spin"></i> LIVE ACTIVITY</span>
          </div>

          <div className="tv-feed-list">
            {snap.feed.length === 0 ? (
              <div className="tv-empty-card">
                <i className="fas fa-headset tv-pulse-icon"></i>
                <p>Waiting for calls to be recorded on floor…</p>
                <span className="muted">Updates appear here automatically</span>
              </div>
            ) : (
              snap.feed.slice(0, 10).map((f) => (
                <div key={f.id} className={`tv-feed-card ${f.is_sale ? 'is-sale-card' : ''}`}>
                  <div className="tv-feed-avatar-wrap">
                    <Avatar p={{ name: f.telecaller, photo_url: f.photo_url }} size="3em" />
                    {f.is_sale && <span className="tv-feed-star"><i className="fas fa-star"></i></span>}
                  </div>
                  <div className="tv-feed-details">
                    <div className="tv-feed-tc-row">
                      <span className="tv-feed-caller">{f.telecaller}</span>
                      <span className="tv-feed-prog-pill" title={f.program}>{getCleanProgramName(f.program)}</span>
                    </div>
                    <div className="tv-feed-sub"><i className="fas fa-user-tie"></i> TL {f.tl}</div>
                  </div>
                  <div className={`tv-feed-tag ${f.is_sale ? 'sale-tag' : ''}`}>
                    {f.is_sale ? <span><i className="fas fa-bell"></i> SALE CLOSED</span> : f.label}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* COLUMN 3: Top Performers / Hall of Fame */}
        <section className="tv-column tv-performers-col">
          <div className="tv-col-header">
            <div className="tv-col-title-wrap">
              <i className="fas fa-trophy tv-col-icon"></i>
              <h2>{view === 'today' ? "TODAY'S CHAMPIONS" : '7-DAY MASTERS'}</h2>
            </div>
            <span className="tv-rot-badge">{view === 'today' ? 'TODAY' : '7 DAYS'}</span>
          </div>

          {/* Spotlight on #1 Counselor */}
          {topPerformer && (
            <div className="tv-top-spotlight">
              <div className="spotlight-crown"><i className="fas fa-crown"></i> #1 TOP PERFORMER</div>
              <div className="spotlight-body">
                <Avatar p={topPerformer} size="4.6em" />
                <div className="spotlight-info">
                  <div className="spotlight-name">{topPerformer.name}</div>
                  <div className="spotlight-prog" title={topPerformer.program}>
                    <i className="fas fa-building"></i> {getCleanProgramName(topPerformer.program)}
                  </div>
                  <div className="spotlight-conversion">
                    <i className="fas fa-bullseye"></i> {topPerformer.conversion}% Conversion Rate
                  </div>
                </div>
                <div className="spotlight-sales">
                  <span className="spotlight-num">{topPerformer.sales}</span>
                  <span className="spotlight-lbl">SALES</span>
                </div>
              </div>
            </div>
          )}

          <div className="tv-champions-list">
            {leaders.length === 0 ? (
              <div className="tv-empty-card">
                <p>No sales recorded yet</p>
                <span className="muted">The first sale will take the #1 crown!</span>
              </div>
            ) : (
              leaders.slice(topPerformer ? 1 : 0, 8).map((l, idx) => {
                const rankNum = (topPerformer ? 2 : 1) + idx;
                return (
                  <div key={l.id} className="tv-leader-row">
                    <div className="tv-leader-rank">#{rankNum}</div>
                    <Avatar p={l} size="2.6em" />
                    <div className="tv-leader-info">
                      <div className="tv-leader-name">{l.name}</div>
                      <div className="tv-leader-prog" title={l.program}>
                        {getCleanProgramName(l.program)} · {l.conversion}% conv
                      </div>
                    </div>
                    <div className="tv-leader-sales">{l.sales}</div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </main>

      {/* DOWN LINE: PROGRAM-WISE PERFORMANCE */}
      <footer className="tv-program-wise-footer">
        <div className="footer-title-strip">
          <div className="footer-title">
            <i className="fas fa-chart-pie text-primary"></i>
            <span>PROGRAM-WISE PIPELINE STATUS (TODAY'S COUNTS)</span>
            {footerProgramsPage.pages > 1 && (
              <span className="tv-footer-page-badge">
                <i className="fas fa-rotate"></i> Page {footerProgramsPage.page + 1}/{footerProgramsPage.pages}
              </span>
            )}
          </div>
          <div className="footer-status-legend">
            <span className="legend-tag fu"><i className="fas fa-calendar-alt"></i> Follow-up</span>
            <span className="legend-tag int"><i className="fas fa-comments"></i> Interested</span>
            <span className="legend-tag l1"><i className="fas fa-bullseye"></i> L1 Selected</span>
            <span className="legend-tag l2"><i className="fas fa-trophy"></i> L2 Selected</span>
          </div>
        </div>

        {/* Program Cards */}
        <div className="footer-programs-row">
          {footerProgramsPage.slice.map((p) => {
            const fu = p.by_status?.follow_up || 0;
            const int = p.by_status?.interested || 0;
            const l1 = p.by_status?.l1_selected || 0;
            const l2 = p.by_status?.l2_selected || 0;

            return (
              <div key={p.id} className="footer-program-box">
                <div className="fp-head">
                  <div className="fp-title-wrap">
                    <span className="fp-name" title={p.name}>{p.name}</span>
                    <span className="fp-target-badge"><i className="fas fa-bullseye"></i> Target: {p.daily_target}</span>
                  </div>
                  <div className="fp-sales-pill">
                    <i className="fas fa-check-circle"></i> <b>{p.sales || 0}</b> Sales
                  </div>
                </div>
                <div className="fp-metrics-grid">
                  <div className="fp-metric-item fu">
                    <span className="fp-label"><i className="fas fa-calendar-alt"></i> Follow-up</span>
                    <span className="fp-val">{fu}</span>
                  </div>
                  <div className="fp-metric-item int">
                    <span className="fp-label"><i className="fas fa-comments"></i> Interested</span>
                    <span className="fp-val">{int}</span>
                  </div>
                  <div className="fp-metric-item l1">
                    <span className="fp-label"><i className="fas fa-bullseye"></i> L1 Selected</span>
                    <span className="fp-val">{l1}</span>
                  </div>
                  <div className="fp-metric-item l2">
                    <span className="fp-label"><i className="fas fa-trophy"></i> L2 Selected</span>
                    <span className="fp-val">{l2}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </footer>

      {/* Full-Screen Mind-Blowing Celebration Modal */}
      {celebration && <CelebrationModal {...celebration} onClose={() => setCelebration(null)} />}
    </div>
  );
}
