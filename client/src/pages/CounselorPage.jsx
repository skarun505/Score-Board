import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api.js';
import { play } from '../sound.js';
import DirectoryModal from '../DirectoryModal.jsx';

/* ─── Confetti burst ─── */
function spawnConfetti(container) {
  const colors = ['#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6', '#ef4444'];
  for (let i = 0; i < 60; i++) {
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed;pointer-events:none;z-index:9999;
      width:${6 + Math.random() * 8}px;height:${6 + Math.random() * 8}px;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
      left:${20 + Math.random() * 60}vw;top:${10 + Math.random() * 30}vh;
      animation:confettiFall ${0.9 + Math.random() * 1.4}s ease-out forwards;
      transform:rotate(${Math.random() * 360}deg);
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }
}

/* ─── Avatar ─── */
function Avatar({ p, size = '3rem', onClick }) {
  const initials = p?.name ? p.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '??';
  const style = { width: size, height: size, cursor: onClick ? 'pointer' : 'default', position: 'relative' };
  if (p?.photo_url) {
    return (
      <div style={style} onClick={onClick} title={onClick ? 'Click to change photo' : ''}>
        <img className="counselor-av" style={{ width: size, height: size }} src={p.photo_url} alt="" />
        {onClick && <span className="av-edit-badge"><i className="fas fa-camera" /></span>}
      </div>
    );
  }
  return (
    <div className="counselor-av" style={style} onClick={onClick} title={onClick ? 'Click to upload photo' : ''}>
      {initials}
      {onClick && <span className="av-edit-badge"><i className="fas fa-camera" /></span>}
    </div>
  );
}

/* ─── Photo Upload Modal ─── */
function PhotoUploadModal({ token, onDone, onClose }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef();
  const videoRef = useRef();
  const [cameraOpen, setCameraOpen] = useState(false);
  const streamRef = useRef(null);

  function readFile(file) {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setErr('File must be under 3 MB'); return; }
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(file);
    setErr('');
  }

  async function openCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      streamRef.current = stream;
      setCameraOpen(true);
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, 100);
    } catch {
      setErr('Camera not accessible. Please upload a file instead.');
    }
  }

  function captureCamera() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    setPreview(canvas.toDataURL('image/jpeg', 0.85));
    stopCamera();
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }

  async function upload() {
    if (!preview) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api('/api/profile/photo', { method: 'POST', token, body: { photo: preview } });
      onDone(r.photo_url);
    } catch (e) {
      setErr(e.message || 'Upload failed');
    }
    setBusy(false);
  }

  async function removePhoto() {
    setBusy(true);
    try {
      await api('/api/profile/photo', { method: 'DELETE', token });
      onDone(null);
    } catch (e) { setErr(e.message || 'Failed'); }
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="photo-modal" onClick={(e) => e.stopPropagation()}>
        <div className="photo-modal-header">
          <span><i className="fas fa-camera" /> Update Profile Photo</span>
          <button className="modal-close-btn" onClick={() => { stopCamera(); onClose(); }}><i className="fas fa-times" /></button>
        </div>

        {cameraOpen ? (
          <div className="camera-view">
            <video ref={videoRef} autoPlay playsInline style={{ width: '100%', borderRadius: '0.75rem' }} />
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
              <button className="btn-primary" onClick={captureCamera}><i className="fas fa-circle" /> Capture</button>
              <button className="btn-secondary" onClick={stopCamera}><i className="fas fa-times" /> Cancel</button>
            </div>
          </div>
        ) : (
          <>
            {preview ? (
              <div className="photo-preview-box">
                <img src={preview} alt="preview" style={{ width: 140, height: 140, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--accent)' }} />
                <button className="btn-secondary small" onClick={() => setPreview(null)}>Choose different</button>
              </div>
            ) : (
              <div className="photo-upload-zone" onClick={() => fileRef.current?.click()}>
                <i className="fas fa-cloud-upload-alt" style={{ fontSize: '2.5rem', color: 'var(--accent)' }} />
                <span>Click to pick a photo</span>
                <span className="muted small">JPEG, PNG or WebP · Max 3 MB</span>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={(e) => readFile(e.target.files?.[0])} />
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button className="btn-secondary" onClick={openCamera}><i className="fas fa-video" /> Open Camera</button>
              {preview && (
                <button className="btn-primary" onClick={upload} disabled={busy}>
                  {busy ? <><i className="fas fa-spinner fa-spin" /> Uploading…</> : <><i className="fas fa-upload" /> Save Photo</>}
                </button>
              )}
              <button className="btn-danger small" onClick={removePhoto} disabled={busy}>
                <i className="fas fa-trash" /> Remove
              </button>
            </div>
          </>
        )}

        {err && <div className="err-banner"><i className="fas fa-exclamation-circle" /> {err}</div>}
      </div>
    </div>
  );
}

/* ─── Rank Badge ─── */
function RankBadge({ rank, total }) {
  if (!rank || !total) return null;
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
  return (
    <span className={`rank-badge rank-${Math.min(rank, 4)}`}>
      {medal && <span>{medal}</span>} #{rank} of {total} today
    </span>
  );
}

/* ─── Weekly Progress Bar ─── */
function WeeklyProgress({ salesWeek, programTarget }) {
  const weekTarget = (programTarget || 0) * 6;
  const pct = weekTarget > 0 ? Math.min(100, Math.round((salesWeek / weekTarget) * 100)) : 0;
  const remaining = Math.max(0, weekTarget - salesWeek);
  return (
    <div className="weekly-progress-card">
      <div className="weekly-progress-header">
        <span><i className="fas fa-calendar-week" /> This Week</span>
        <span className="weekly-sales-num">{salesWeek} <small>/ {weekTarget} target</small></span>
      </div>
      <div className="weekly-bar-track">
        <div className="weekly-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="weekly-progress-meta">
        <span className="weekly-pct">{pct}% achieved</span>
        {remaining > 0
          ? <span className="weekly-rem">{remaining} more to weekly goal 🎯</span>
          : <span className="weekly-done">Weekly goal reached! 🏆</span>
        }
      </div>
    </div>
  );
}

/* ─── Login ─── */
function CounselorLogin({ onLogin }) {
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDirectory, setShowDirectory] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api('/api/auth/login', {
        method: 'POST',
        body: { employee_code: code.trim(), pin: pin.trim() },
      });
      onLogin(r);
    } catch (ex) {
      setErr(ex.message || 'Login failed');
    }
    setBusy(false);
  }

  function handleSelectCode(selectedCode) {
    setCode(selectedCode);
    setPin('111111');
  }

  return (
    <div className="counselor-login-wrap">
      {showDirectory && (
        <DirectoryModal
          roleFilter="telecaller"
          onSelectCode={handleSelectCode}
          onClose={() => setShowDirectory(false)}
        />
      )}
      <div className="counselor-card login-box">
        <div className="counselor-login-hdr">
          <div className="counselor-logo-badge">
            <i className="fas fa-headset" /> COUNSELOR WORKSTATION
          </div>
          <h2>Sign In to Log Calls</h2>
          <p className="muted">Record customer interactions directly to the live floor dashboard</p>
        </div>
        <form onSubmit={submit}>
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label><i className="fas fa-id-card" /> Employee Code</label>
              <button
                type="button"
                className="directory-toggle-btn"
                onClick={() => setShowDirectory(true)}
              >
                <i className="fas fa-search" /> Find My Code
              </button>
            </div>
            <input
              placeholder="e.g. TC001, TC002..."
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoFocus
              required
            />
          </div>
          <div className="form-group">
            <label><i className="fas fa-key" /> PIN (Default: 111111)</label>
            <input
              placeholder="6-digit PIN"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
            />
          </div>
          {err && <div className="err-banner"><i className="fas fa-exclamation-circle" /> {err}</div>}
          <button type="submit" className="btn-primary" disabled={busy || !code || !pin}>
            {busy ? <span><i className="fas fa-spinner fa-spin" /> Authenticating…</span> : <span><i className="fas fa-sign-in-alt" /> Enter Workstation</span>}
          </button>
        </form>
        <div className="login-footer">
          <button
            type="button"
            className="directory-toggle-btn"
            style={{ margin: '0 auto 0.75rem', display: 'flex' }}
            onClick={() => setShowDirectory(true)}
          >
            <i className="fas fa-users-viewfinder" /> View Complete Counselor Directory
          </button>
          <p className="muted">Team Leader or Admin? <a href="/tl"><i className="fas fa-user-shield" /> Go to TL Portal</a></p>
        </div>
      </div>
    </div>
  );
}

/* ─── Counselor Custom Count & 1-Time Daily Rechange Modal ─── */
function CounselorCustomCountModal({ token, initialStatus, currentCount, onDone, onClose }) {
  const [statusCode, setStatusCode] = useState(initialStatus || 'sale_closed');
  const [count, setCount] = useState(currentCount || 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');

  const statusOptions = [
    { code: 'sale_closed', label: 'Sales Closed', icon: 'fa-trophy', color: '#059669' },
    { code: 'l1_selected', label: 'L1 Selected', icon: 'fa-clipboard-check', color: '#7c3aed' },
    { code: 'l2_selected', label: 'L2 Selected', icon: 'fa-award', color: '#c026d3' },
    { code: 'interested', label: 'Interested', icon: 'fa-comment-dots', color: '#2563eb' },
    { code: 'follow_up', label: 'Follow-ups', icon: 'fa-calendar-alt', color: '#d97706' },
  ];

  const currentOpt = statusOptions.find((s) => s.code === statusCode);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setSuccess('');
    try {
      const res = await api('/api/events/counselor/custom-count', {
        method: 'POST',
        token,
        body: { status_code: statusCode, count: Number(count) },
      });
      setSuccess(res.message);
      setTimeout(() => onDone(), 1200);
    } catch (ex) {
      setErr(ex.message || 'Failed to update custom count');
    }
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modern-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-row">
          <div className="modal-title">
            <i className="fas fa-calculator text-primary"></i>
            <h3>Set Daily Custom Count</h3>
          </div>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="custom-count-status-selector">
          {statusOptions.map((opt) => (
            <button
              key={opt.code}
              type="button"
              className={`status-chip-btn ${statusCode === opt.code ? 'active' : ''}`}
              style={{ '--chip-color': opt.color }}
              onClick={() => { setStatusCode(opt.code); setErr(''); setSuccess(''); }}
            >
              <i className={`fas ${opt.icon}`}></i>
              <span>{opt.label}</span>
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="modern-modal-form" style={{ marginTop: '1rem' }}>
          <div className="count-stepper-box">
            <div className="stepper-label">
              <span>Today's Total Count for <b>{currentOpt?.label}</b>:</span>
            </div>
            <div className="stepper-input-row">
              <button
                type="button"
                className="btn-stepper minus"
                onClick={() => setCount((c) => Math.max(0, Number(c) - 1))}
              >
                <i className="fas fa-minus"></i>
              </button>
              <input
                type="number"
                min="0"
                max="500"
                className="stepper-field"
                value={count}
                onChange={(e) => setCount(Math.max(0, parseInt(e.target.value) || 0))}
                required
              />
              <button
                type="button"
                className="btn-stepper plus"
                onClick={() => setCount((c) => Number(c) + 1)}
              >
                <i className="fas fa-plus"></i>
              </button>
            </div>
          </div>

          <div className="rechange-guard-banner info">
            <i className="fas fa-shield-halved"></i>
            <div>
              <b>1-Time Daily Rechange Safeguard</b>
              <p>
                If a count is entered incorrectly, you can rechange/correct it once per day. Verify your count before saving.
              </p>
            </div>
          </div>

          {err && <div className="modal-err-box"><i className="fas fa-circle-exclamation" /> {err}</div>}
          {success && <div className="modal-success-box"><i className="fas fa-circle-check" /> {success}</div>}

          <div className="modal-btn-row">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? <><i className="fas fa-spinner fa-spin" /> Saving…</> : <><i className="fas fa-save" /> Apply Count</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Counselor Profile & PIN Edit Modal ─── */
function CounselorProfileModal({ user, token, onPhotoClick, onClose }) {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');

  async function handlePinChange(e) {
    e.preventDefault();
    if (newPin !== confirmPin) { setErr('New PIN and Confirm PIN do not match'); return; }
    if (newPin.length < 4 || newPin.length > 10) { setErr('PIN must be 4 to 10 digits'); return; }
    setBusy(true);
    setErr('');
    try {
      await api('/api/auth/change-pin', {
        method: 'POST',
        token,
        body: { current_pin: currentPin, new_pin: newPin },
      });
      setSuccess('Security PIN updated successfully!');
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      setTimeout(onClose, 1500);
    } catch (ex) {
      setErr(ex.message || 'Failed to update PIN');
    }
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modern-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-row">
          <div className="modal-title">
            <i className="fas fa-id-card text-primary"></i>
            <h3>Counselor Profile & Security</h3>
          </div>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="profile-details-preview">
          <div style={{ position: 'relative' }}>
            <Avatar p={user} size="4rem" />
            <button className="btn-profile-cam" onClick={onPhotoClick} title="Update photo">
              <i className="fas fa-camera" />
            </button>
          </div>
          <div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{user?.name}</div>
            <div style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '0.2rem' }}>
              Employee ID: <b>{user?.employee_code}</b>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.2rem' }}>
              Program: <b>{user?.program_name || 'Assigned'}</b> · TL: <b>{user?.tl_name || 'Team Leader'}</b>
            </div>
          </div>
        </div>

        <form onSubmit={handlePinChange} className="modern-modal-form" style={{ marginTop: '1.2rem' }}>
          <h4 style={{ margin: '0 0 0.5rem', fontSize: '1rem', fontWeight: 800 }}>Change Security PIN</h4>
          <div className="form-group">
            <label>Current PIN (Default: 111111)</label>
            <input
              type="password"
              inputMode="numeric"
              placeholder="Current PIN"
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>New Secret PIN (4-10 digits)</label>
            <input
              type="password"
              inputMode="numeric"
              placeholder="New PIN"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>Confirm New PIN</label>
            <input
              type="password"
              inputMode="numeric"
              placeholder="Confirm New PIN"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              required
            />
          </div>
          {err && <div className="modal-err-box"><i className="fas fa-circle-exclamation" /> {err}</div>}
          {success && <div className="modal-success-box"><i className="fas fa-circle-check" /> {success}</div>}
          <div className="modal-btn-row">
            <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? <><i className="fas fa-spinner fa-spin" /> Updating…</> : <><i className="fas fa-key" /> Update PIN</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Main Page ─── */
export default function CounselorPage() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('counselor_session') || 'null'));
  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [leadRef, setLeadRef] = useState('');
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [customCountModal, setCustomCountModal] = useState(null);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('counselor_dark') === '1');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineCount, setOfflineCount] = useState(() => {
    try { return JSON.parse(localStorage.getItem('counselor_offline_queue') || '[]').length; } catch { return 0; }
  });
  const timer = useRef();
  const token = session?.token;

  function logout() {
    localStorage.removeItem('counselor_session');
    setSession(null);
    setProfile(null);
    setStats(null);
  }

  function onLogin(r) {
    localStorage.setItem('counselor_session', JSON.stringify(r));
    setSession(r);
  }

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api('/api/counselor/me', { token });
      setProfile(data.user);
      setStats(data.stats);
      setRecent(data.recent || []);
    } catch (e) {
      if (e.status === 401) logout();
    }
  }, [token]);

  // Offline queue listener & auto-sync
  useEffect(() => {
    async function syncQueue() {
      setIsOnline(true);
      const queue = JSON.parse(localStorage.getItem('counselor_offline_queue') || '[]');
      if (!queue.length || !token) return;
      for (const item of queue) {
        try {
          await api('/api/events', { method: 'POST', token, body: item });
        } catch {}
      }
      localStorage.removeItem('counselor_offline_queue');
      setOfflineCount(0);
      loadData();
    }
    function handleOffline() { setIsOnline(false); }
    window.addEventListener('online', syncQueue);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', syncQueue);
      window.removeEventListener('offline', handleOffline);
    };
  }, [token, loadData]);

  useEffect(() => {
    document.body.classList.toggle('dark-mode', darkMode);
    localStorage.setItem('counselor_dark', darkMode ? '1' : '0');
  }, [darkMode]);

  useEffect(() => {
    if (!token) return;
    loadData();
    api('/api/statuses', { token })
      .then(setStatuses)
      .catch((e) => e.status === 401 && logout());
    const t = setInterval(loadData, 20000);
    return () => clearInterval(t);
  }, [token, loadData]);

  // Active running undo countdown timer
  useEffect(() => {
    if (!toast) return;
    const interval = setInterval(() => {
      setToast((prev) => {
        if (!prev) return null;
        if (prev.seconds <= 1) return null;
        return { ...prev, seconds: prev.seconds - 1 };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [toast?.id]);

  async function recordStatus(st, confirm = false) {
    if (busy) return;
    setBusy(true);

    const payload = {
      telecaller_id: profile?.id || session.user.id,
      status_code: st.code,
      lead_ref: leadRef.trim() || undefined,
      confirm_duplicate: confirm,
    };

    if (!navigator.onLine) {
      const q = JSON.parse(localStorage.getItem('counselor_offline_queue') || '[]');
      q.push(payload);
      localStorage.setItem('counselor_offline_queue', JSON.stringify(q));
      setOfflineCount(q.length);
      setLeadRef('');
      setToast({ id: Date.now(), label: `${st.label} (Queued Offline)`, is_sale: st.is_sale, seconds: 5 });
      setTimeout(() => setToast(null), 5000);
      setBusy(false);
      return;
    }

    try {
      const { event, undo_seconds } = await api('/api/events', {
        method: 'POST',
        token,
        body: payload,
      });

      clearTimeout(timer.current);
      setToast({ id: event.id, label: st.label, is_sale: st.is_sale, seconds: undo_seconds });
      timer.current = setTimeout(() => setToast(null), (undo_seconds + 1) * 1000);
      setLeadRef('');
      play(st.is_sale ? 'bell' : (st.sound || 'soft'), { sound_enabled: '1' });

      // Confetti burst on sale!
      if (st.is_sale) spawnConfetti();

      loadData();
    } catch (e) {
      if (e.code === 'DUPLICATE_CONFIRM') {
        setBusy(false);
        if (window.confirm(e.message)) return recordStatus(st, true);
        return;
      }
      if (e.status === 401) logout();
      else if (!navigator.onLine || e.message?.includes('Failed to fetch')) {
        const q = JSON.parse(localStorage.getItem('counselor_offline_queue') || '[]');
        q.push(payload);
        localStorage.setItem('counselor_offline_queue', JSON.stringify(q));
        setOfflineCount(q.length);
        setLeadRef('');
        setToast({ id: Date.now(), label: `${st.label} (Saved Offline)`, is_sale: st.is_sale, seconds: 5 });
        setTimeout(() => setToast(null), 5000);
      } else {
        alert(e.message || 'Failed to save entry');
      }
    }
    setBusy(false);
  }

  async function undo() {
    if (!toast) return;
    try {
      await api(`/api/events/${toast.id}/undo`, { method: 'POST', token });
      setToast(null);
      loadData();
    } catch (e) {
      alert(e.message || 'Undo failed');
    }
  }

  function onPhotoSaved(newUrl) {
    setProfile((p) => p ? { ...p, photo_url: newUrl } : p);
    setSession((s) => s ? { ...s, user: { ...s.user, photo_url: newUrl } } : s);
    setShowPhotoModal(false);
  }

  if (!token) return <CounselorLogin onLogin={onLogin} />;

  const user = profile || session?.user;
  const programName = user?.program_name || 'Assigned Program';
  const tlName = user?.tl_name || 'Team Leader';

  return (
    <div className={`counselor-container${darkMode ? ' dark' : ''}`}>
      {/* Confetti keyframes injected once */}
      <style>{`
        @keyframes confettiFall {
          0%   { opacity:1; transform: translateY(0) rotate(0deg) scale(1); }
          100% { opacity:0; transform: translateY(60vh) rotate(720deg) scale(0.3); }
        }
        .av-edit-badge {
          position:absolute;bottom:0;right:0;
          background:var(--accent,#3b82f6);color:#fff;
          border-radius:50%;width:1.4rem;height:1.4rem;
          display:flex;align-items:center;justify-content:center;
          font-size:0.65rem;border:2px solid #fff;
        }
        .rank-badge { display:inline-flex;align-items:center;gap:0.3em;
          padding:0.2em 0.7em;border-radius:999px;font-size:0.8rem;font-weight:700; }
        .rank-badge.rank-1 { background:#fef3c7;color:#92400e; }
        .rank-badge.rank-2 { background:#f1f5f9;color:#334155; }
        .rank-badge.rank-3 { background:#fdf4ff;color:#7e22ce; }
        .rank-badge.rank-4 { background:#f0fdf4;color:#166534; }
        .weekly-progress-card { background:var(--card-bg,#f8fafc);border:1px solid var(--border,#e2e8f0);
          border-radius:1rem;padding:1rem 1.25rem;margin-bottom:1rem; }
        .weekly-progress-header { display:flex;justify-content:space-between;align-items:center;
          font-weight:600;font-size:0.95rem;margin-bottom:0.6rem;color:var(--text,#1e293b); }
        .weekly-sales-num { font-size:1.2rem;color:var(--accent,#3b82f6); }
        .weekly-sales-num small { font-size:0.78rem;color:var(--muted,#64748b); }
        .weekly-bar-track { background:var(--border,#e2e8f0);border-radius:999px;height:10px;overflow:hidden;margin-bottom:0.5rem; }
        .weekly-bar-fill { background:linear-gradient(90deg,#3b82f6,#10b981);height:100%;border-radius:999px;transition:width 0.6s ease; }
        .weekly-progress-meta { display:flex;justify-content:space-between;font-size:0.82rem; }
        .weekly-pct { color:var(--accent,#3b82f6);font-weight:600; }
        .weekly-rem { color:var(--muted,#64748b); }
        .weekly-done { color:#10b981;font-weight:600; }
        .photo-upload-zone { border:2px dashed var(--accent,#3b82f6);border-radius:1rem;
          padding:2rem;text-align:center;cursor:pointer;display:flex;flex-direction:column;
          align-items:center;gap:0.5rem;color:var(--text,#1e293b); }
        .photo-preview-box { display:flex;flex-direction:column;align-items:center;gap:0.75rem; }
        .btn-secondary { padding:0.5rem 1rem;border-radius:0.5rem;border:1px solid var(--border,#e2e8f0);
          background:var(--card-bg,#f8fafc);cursor:pointer;font-weight:600;font-size:0.875rem; }
        .btn-danger { padding:0.4rem 0.9rem;border-radius:0.5rem;border:1px solid #fca5a5;
          background:#fef2f2;color:#dc2626;cursor:pointer;font-weight:600;font-size:0.82rem; }
        .btn-secondary.small,.btn-danger.small { font-size:0.78rem;padding:0.3rem 0.7rem; }
        .dark-mode .counselor-container, .counselor-container.dark {
          background:#0f172a;color:#e2e8f0;
          --card-bg:#1e293b;--border:#334155;--text:#e2e8f0;--muted:#94a3b8;
        }
        .dm-toggle { background:none;border:1px solid var(--border,#e2e8f0);border-radius:999px;
          padding:0.3rem 0.8rem;cursor:pointer;font-size:0.82rem;color:var(--text,#1e293b);
          display:flex;align-items:center;gap:0.4em; }
      `}</style>

      {/* Photo Modal */}
      {showPhotoModal && (
        <PhotoUploadModal token={token} onDone={onPhotoSaved} onClose={() => setShowPhotoModal(false)} />
      )}

      {/* Profile & PIN Edit Modal */}
      {showProfileModal && (
        <CounselorProfileModal
          user={user}
          token={token}
          onPhotoClick={() => { setShowProfileModal(false); setShowPhotoModal(true); }}
          onClose={() => setShowProfileModal(false)}
        />
      )}

      {/* Custom Count & Daily Rechange Modal */}
      {customCountModal && (
        <CounselorCustomCountModal
          token={token}
          initialStatus={customCountModal.status}
          currentCount={customCountModal.count}
          onDone={() => { setCustomCountModal(null); loadData(); }}
          onClose={() => setCustomCountModal(null)}
        />
      )}

      {/* Offline Alert Banner */}
      {(!isOnline || offlineCount > 0) && (
        <div className="offline-sync-pill">
          <i className="fas fa-wifi-slash"></i>
          <span>
            {!isOnline ? 'Offline Mode' : 'Connected'} · {offlineCount} update{offlineCount === 1 ? '' : 's'} queued (will auto-sync)
          </span>
        </div>
      )}

      {/* Top Bar */}
      <header className="counselor-header">
        <div className="counselor-user-info">
          <div style={{ position: 'relative' }}>
            <Avatar p={user} size="3.2rem" onClick={() => setShowPhotoModal(true)} />
          </div>
          <div>
            <div className="counselor-name-row">
              <span className="counselor-name">{user?.name}</span>
              <span className="counselor-badge">{user?.employee_code}</span>
              {stats && <RankBadge rank={stats.rank_today} total={stats.active_callers_today} />}
            </div>
            <div className="counselor-meta">
              <span className="prog-pill"><i className="fas fa-building" /> {programName}</span>
              <span className="tl-pill"><i className="fas fa-user-tie" /> TL: {tlName}</span>
            </div>
          </div>
        </div>
        <div className="counselor-actions">
          <button className="btn-secondary small" onClick={() => setShowProfileModal(true)} title="Edit profile and change PIN">
            <i className="fas fa-user-pen" /> Edit Profile
          </button>
          <button className="dm-toggle" onClick={() => setDarkMode((d) => !d)} title="Toggle dark mode">
            <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`} />
            {darkMode ? 'Light' : 'Dark'}
          </button>
          <button className="btn-refresh" onClick={loadData} title="Refresh stats">
            <i className="fas fa-sync-alt" />
          </button>
          <button className="btn-logout" onClick={logout}>
            <i className="fas fa-sign-out-alt" /> Sign out
          </button>
        </div>
      </header>

      {/* Weekly Progress */}
      <WeeklyProgress salesWeek={stats?.sales_week || 0} programTarget={user?.program_target || 0} />

      {/* Today's Scoreboard Chips */}
      <section className="counselor-metrics">
        <div className="metric-card sales">
          <div className="metric-icon"><i className="fas fa-bell" /></div>
          <div className="metric-data">
            <span className="metric-num">{stats?.sales_today ?? 0}</span>
            <span className="metric-lbl" title="Sales Closed">Sales Closed</span>
          </div>
          <button
            className="tile-metric-edit-btn"
            title="Set custom count / 1-time daily rechange"
            onClick={() => setCustomCountModal({ status: 'sale_closed', count: stats?.sales_today ?? 0 })}
          >
            <i className="fas fa-pencil" />
          </button>
        </div>
        <div className="metric-card interested">
          <div className="metric-icon"><i className="fas fa-comment-dots" /></div>
          <div className="metric-data">
            <span className="metric-num">{stats?.interested_today ?? 0}</span>
            <span className="metric-lbl" title="Interested">Interested</span>
          </div>
        </div>
        <div className="metric-card followup">
          <div className="metric-icon"><i className="fas fa-calendar-alt" /></div>
          <div className="metric-data">
            <span className="metric-num">{stats?.followup_today ?? 0}</span>
            <span className="metric-lbl" title="Follow-ups">Follow-ups</span>
          </div>
        </div>
        <div className="metric-card l1">
          <div className="metric-icon"><i className="fas fa-clipboard-check" /></div>
          <div className="metric-data">
            <span className="metric-num">{stats?.l1_today ?? 0}</span>
            <span className="metric-lbl" title="L1 Selected">L1 Selected</span>
          </div>
          <button
            className="tile-metric-edit-btn"
            title="Set custom count / 1-time daily rechange"
            onClick={() => setCustomCountModal({ status: 'l1_selected', count: stats?.l1_today ?? 0 })}
          >
            <i className="fas fa-pencil" />
          </button>
        </div>
        <div className="metric-card l2">
          <div className="metric-icon"><i className="fas fa-award" /></div>
          <div className="metric-data">
            <span className="metric-num">{stats?.l2_today ?? 0}</span>
            <span className="metric-lbl" title="L2 Selected">L2 Selected</span>
          </div>
          <button
            className="tile-metric-edit-btn"
            title="Set custom count / 1-time daily rechange"
            onClick={() => setCustomCountModal({ status: 'l2_selected', count: stats?.l2_today ?? 0 })}
          >
            <i className="fas fa-pencil" />
          </button>
        </div>
        <div className="metric-card total">
          <div className="metric-icon"><i className="fas fa-chart-line" /></div>
          <div className="metric-data">
            <span className="metric-num">{stats?.total_today ?? 0}</span>
            <span className="metric-lbl" title="Total Updates">Total Updates</span>
          </div>
        </div>
      </section>

      {/* 1-Tap Fast Logger */}
      <section className="counselor-logger-panel">
        <div className="panel-title-row">
          <h3><i className="fas fa-bolt text-amber" /> Quick Action · 1-Tap Status Logger</h3>
          <span className="muted"><i className="fas fa-broadcast-tower" /> Updates reflect on 108" TV live</span>
        </div>

        <div className="lead-ref-bar">
          <input
            type="text"
            className="counselor-input"
            placeholder="Lead ID / Phone number / Client name (optional)"
            value={leadRef}
            onChange={(e) => setLeadRef(e.target.value)}
            maxLength={40}
          />
        </div>

        <div className="counselor-status-grid">
          {statuses
            .filter((s) => !['callback', 'not_interested'].includes(s.code))
            .map((s) => {
              const isSale = s.code === 'sale_closed';
              return (
                <button
                  key={s.id}
                  disabled={busy}
                  className={`btn-status-tile ${isSale ? 'tile-sale' : ''}`}
                  style={{ '--accent-color': s.color || '#3b82f6' }}
                  onClick={() => recordStatus(s)}
                >
                  <span className="status-tile-icon">
                    {s.code === 'sale_closed' && <i className="fas fa-bell" />}
                    {s.code === 'interested' && <i className="fas fa-comment-dots" />}
                    {s.code === 'follow_up' && <i className="fas fa-calendar-alt" />}
                    {s.code === 'l1_selected' && <i className="fas fa-clipboard-check" />}
                    {s.code === 'l2_selected' && <i className="fas fa-award" />}
                    {!['sale_closed', 'interested', 'follow_up', 'l1_selected', 'l2_selected'].includes(s.code) && (
                      <i className="fas fa-check" />
                    )}
                  </span>
                  <span className="status-tile-label">{s.label}</span>
                  {isSale && <span className="status-tile-sparkle"><i className="fas fa-sparkles" /> CELEBRATE</span>}
                </button>
              );
            })}
        </div>
      </section>

      {/* Today's Personal Log History */}
      <section className="counselor-history-panel">
        <div className="panel-title-row">
          <h3><i className="fas fa-history" /> Your Recent Updates Today</h3>
          <span className="muted">{recent.length} logged today</span>
        </div>
        {recent.length === 0 ? (
          <div className="empty-history">
            <i className="fas fa-clipboard-list" style={{ fontSize: '2.5rem', color: '#94a3b8', marginBottom: '0.5rem', display: 'block' }} />
            <span>No calls logged yet today. Tap any button above to record your first call!</span>
          </div>
        ) : (
          <div className="history-list">
            {recent.map((item) => (
              <div key={item.id} className={`history-item ${item.is_sale ? 'sale-item' : ''}`}>
                <div className="history-status-tag" style={{ backgroundColor: item.color || '#3b82f6' }}>
                  {item.is_sale && <i className="fas fa-bell" style={{ marginRight: '0.4rem' }} />}
                  {item.label}
                </div>
                <div className="history-ref">
                  {item.lead_ref ? <span>Lead: <b>{item.lead_ref}</b></span> : <span className="muted">Direct update</span>}
                </div>
                <div className="history-time">
                  <i className="fas fa-clock" /> {new Date(item.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 10-Second Undo Toast */}
      {toast && (
        <div className="counselor-undo-toast">
          <div className="toast-content">
            <span className="toast-icon">
              {toast.is_sale ? <i className="fas fa-glass-cheers text-amber" /> : <i className="fas fa-check-circle text-green" />}
            </span>
            <div>
              <div className="toast-title">Recorded: <b>{toast.label}</b></div>
              <div className="toast-sub">Broadcasted to 108" TV live!</div>
            </div>
          </div>
          <button className="btn-undo-toast" onClick={undo}>
            <i className="fas fa-undo-alt" /> UNDO ({toast.seconds}s)
          </button>
        </div>
      )}
    </div>
  );
}
