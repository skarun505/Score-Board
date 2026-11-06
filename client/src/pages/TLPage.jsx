import { useEffect, useRef, useState, useMemo } from 'react';
import { api } from '../api.js';
import CounselorPage from './CounselorPage.jsx';
import DirectoryModal from '../DirectoryModal.jsx';

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
    } catch { setErr('Camera not accessible. Upload a file instead.'); }
  }

  function captureCamera() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    setPreview(canvas.toDataURL('image/jpeg', 0.85));
    stopCamera();
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null; setCameraOpen(false);
  }

  async function upload() {
    if (!preview) return;
    setBusy(true); setErr('');
    try {
      const r = await api('/api/profile/photo', { method: 'POST', token, body: { photo: preview } });
      onDone(r.photo_url);
    } catch (e) { setErr(e.message || 'Upload failed'); }
    setBusy(false);
  }

  async function removePhoto() {
    setBusy(true);
    try { await api('/api/profile/photo', { method: 'DELETE', token }); onDone(null); }
    catch (e) { setErr(e.message || 'Failed'); }
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="photo-modal" onClick={(e) => e.stopPropagation()}>
        <div className="photo-modal-header">
          <span><i className="fas fa-camera" /> Update Profile Photo</span>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>
        {cameraOpen ? (
          <div className="camera-box">
            <video ref={videoRef} autoPlay playsInline style={{ width: '100%', borderRadius: '0.75rem' }} />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button className="btn-primary" onClick={captureCamera}><i className="fas fa-camera" /> Snap Photo</button>
              <button className="btn-secondary" onClick={stopCamera}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            {preview ? (
              <div className="photo-preview-box">
                <img src={preview} alt="preview" style={{ width: '130px', height: '130px', borderRadius: '50%', objectFit: 'cover' }} />
                <button className="btn-secondary small" onClick={() => setPreview(null)}>Choose different</button>
              </div>
            ) : (
              <div className="photo-upload-zone" onClick={() => fileRef.current?.click()}>
                <i className="fas fa-cloud-upload-alt" style={{ fontSize: '2.5rem', color: '#3b82f6' }} />
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

/* ─── Add Counselor Modal ─── */
function AddCounselorModal({ token, programs, onDone, onClose }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [programId, setProgramId] = useState(programs[0]?.id || '');
  const [pin, setPin] = useState('111111');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!name.trim() || !code.trim()) { setErr('Name and Employee Code are required'); return; }
    setBusy(true);
    setErr('');
    try {
      await api('/api/tl/counselors', {
        method: 'POST',
        token,
        body: {
          name: name.trim(),
          employee_code: code.trim().toUpperCase(),
          program_id: programId ? Number(programId) : null,
          pin: pin.trim() || '111111',
        },
      });
      onDone();
    } catch (ex) {
      setErr(ex.message || 'Failed to add counselor');
    }
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modern-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-row">
          <div className="modal-title">
            <i className="fas fa-user-plus text-primary"></i>
            <h3>Add New Counselor</h3>
          </div>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>
        <form onSubmit={submit} className="modern-modal-form">
          <div className="form-group">
            <label>Full Name *</label>
            <input
              type="text"
              placeholder="e.g. Rahul Sharma"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>Employee Code *</label>
            <input
              type="text"
              placeholder="e.g. TC048"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
            />
          </div>
          <div className="form-group">
            <label>Assigned Program</label>
            <select value={programId} onChange={(e) => setProgramId(e.target.value)}>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>{p.name} (Daily Target: {p.daily_target})</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Security PIN (Default: 111111)</label>
            <input
              type="password"
              placeholder="111111"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </div>
          {err && <div className="modal-err-box"><i className="fas fa-circle-exclamation" /> {err}</div>}
          <div className="modal-btn-row">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? <><i className="fas fa-spinner fa-spin" /> Saving…</> : <><i className="fas fa-check" /> Add to Team</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Edit Counselor Modal ─── */
function EditCounselorModal({ counselor, programs, token, onDone, onClose }) {
  const [name, setName] = useState(counselor?.name || '');
  const [code, setCode] = useState(counselor?.employee_code || '');
  const [programId, setProgramId] = useState(counselor?.program_id || programs[0]?.id || '');
  const [newPin, setNewPin] = useState('');
  const [active, setActive] = useState(counselor?.active !== 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api(`/api/tl/counselors/${counselor.id}`, {
        method: 'PATCH',
        token,
        body: {
          name: name.trim(),
          employee_code: code.trim().toUpperCase(),
          program_id: programId ? Number(programId) : null,
          pin: newPin.trim() || undefined,
          active: active ? 1 : 0,
        },
      });
      onDone();
    } catch (ex) {
      setErr(ex.message || 'Failed to update counselor');
    }
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modern-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-row">
          <div className="modal-title">
            <i className="fas fa-user-pen text-primary"></i>
            <h3>Edit Counselor: {counselor.name}</h3>
          </div>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>
        <form onSubmit={submit} className="modern-modal-form">
          <div className="form-group">
            <label>Full Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Employee Code</label>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required />
          </div>
          <div className="form-group">
            <label>Assigned Program</label>
            <select value={programId} onChange={(e) => setProgramId(e.target.value)}>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Reset Security PIN (Leave blank to keep unchanged)</label>
            <input
              type="password"
              placeholder="e.g. 111111 or new 6 digits"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
            />
          </div>
          <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.6rem' }}>
            <input
              type="checkbox"
              id="counselor_active_cb"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              style={{ width: '1.2rem', height: '1.2rem' }}
            />
            <label htmlFor="counselor_active_cb" style={{ margin: 0, cursor: 'pointer', fontWeight: 700 }}>
              Active on Roster & TV
            </label>
          </div>
          {err && <div className="modal-err-box"><i className="fas fa-circle-exclamation" /> {err}</div>}
          <div className="modal-btn-row">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? <><i className="fas fa-spinner fa-spin" /> Saving…</> : <><i className="fas fa-check" /> Update Counselor</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Custom Count & 1-Time Daily Rechange Modal ─── */
function CustomCountModal({ counselor, token, onDone, onClose }) {
  const [statusCode, setStatusCode] = useState('sale_closed');
  const [count, setCount] = useState(counselor?.sales_today || 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');

  const statusOptions = [
    { code: 'sale_closed', label: 'Sales Closed', icon: 'fa-trophy', color: '#059669', current: counselor.sales_today || 0 },
    { code: 'l1_selected', label: 'L1 Selected', icon: 'fa-clipboard-check', color: '#7c3aed', current: counselor.l1_today || 0 },
    { code: 'l2_selected', label: 'L2 Selected', icon: 'fa-award', color: '#c026d3', current: counselor.l2_today || 0 },
    { code: 'interested', label: 'Interested', icon: 'fa-thumbs-up', color: '#2563eb', current: counselor.interested_today || 0 },
    { code: 'follow_up', label: 'Follow-ups', icon: 'fa-calendar-day', color: '#d97706', current: counselor.followup_today || 0 },
  ];

  const currentOpt = statusOptions.find((s) => s.code === statusCode);
  const isAdjustmentUsed = counselor?.adjustment_used?.[statusCode];

  function handleStatusSelect(stCode) {
    setStatusCode(stCode);
    const selectedOpt = statusOptions.find((s) => s.code === stCode);
    setCount(selectedOpt ? selectedOpt.current : 0);
    setErr('');
    setSuccess('');
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setSuccess('');
    try {
      const res = await api(`/api/tl/counselors/${counselor.id}/custom-count`, {
        method: 'POST',
        token,
        body: {
          status_code: statusCode,
          count: Number(count),
        },
      });
      setSuccess(res.message);
      setTimeout(() => {
        onDone();
      }, 1200);
    } catch (ex) {
      setErr(ex.message || 'Failed to adjust count');
    }
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modern-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-row">
          <div className="modal-title">
            <i className="fas fa-calculator text-primary"></i>
            <h3>Set Custom Daily Count: {counselor.name}</h3>
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
              onClick={() => handleStatusSelect(opt.code)}
            >
              <i className={`fas ${opt.icon}`}></i>
              <span>{opt.label}</span>
              <span className="chip-cur-badge">{opt.current}</span>
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="modern-modal-form" style={{ marginTop: '1rem' }}>
          <div className="count-stepper-box">
            <div className="stepper-label">
              <span>Today's Total Count for <b>{currentOpt?.label}</b>:</span>
              <span className="current-sub">Current: <b>{currentOpt?.current}</b></span>
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

          <div className={`rechange-guard-banner ${isAdjustmentUsed ? 'warn' : 'info'}`}>
            <i className={`fas ${isAdjustmentUsed ? 'fa-lock' : 'fa-shield-halved'}`}></i>
            <div>
              <b>{isAdjustmentUsed ? '1-Time Daily Rechange Already Used Today' : '1-Time Daily Rechange Safeguard'}</b>
              <p>
                {isAdjustmentUsed
                  ? 'The daily count for this status was already rechanged once today. Any additional correction requires Administrator authorization.'
                  : 'If a count is entered incorrectly, you can rechange/correct it once per day. Ensure the entered count is accurate.'}
              </p>
            </div>
          </div>

          {err && <div className="modal-err-box"><i className="fas fa-circle-exclamation" /> {err}</div>}
          {success && <div className="modal-success-box"><i className="fas fa-circle-check" /> {success}</div>}

          <div className="modal-btn-row">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy || isAdjustmentUsed}>
              {busy ? <><i className="fas fa-spinner fa-spin" /> Saving…</> : <><i className="fas fa-save" /> Apply Custom Count</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Team Reports & EOD Analytics Modal ─── */
function TeamReportsModal({ token, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [fromDate, setFromDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    setLoading(true);
    api('/api/tl/reports/summary', { token })
      .then(setData)
      .catch((e) => alert(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  function copyWhatsApp() {
    if (!data?.whatsapp_text) return;
    navigator.clipboard.writeText(data.whatsapp_text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="reports-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-row">
          <div className="modal-title">
            <i className="fas fa-chart-line text-primary"></i>
            <h3>Floor Leadership Report Center</h3>
          </div>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <i className="fas fa-spinner fa-spin" style={{ fontSize: '2rem', color: '#2563eb' }} />
            <p>Compiling team intelligence…</p>
          </div>
        ) : (
          <div className="reports-modal-body">
            {/* KPI Cards */}
            <div className="reports-kpi-grid">
              <div className="rep-kpi-card sales">
                <span className="lbl">Team Sales Closed</span>
                <span className="num">{data?.totals?.sales ?? 0}</span>
                <span className="sub">Pushed live to 108" TV</span>
              </div>
              <div className="rep-kpi-card l1">
                <span className="lbl">L1 Selected</span>
                <span className="num">{data?.totals?.l1 ?? 0}</span>
                <span className="sub">Candidates cleared L1</span>
              </div>
              <div className="rep-kpi-card l2">
                <span className="lbl">L2 Selected</span>
                <span className="num">{data?.totals?.l2 ?? 0}</span>
                <span className="sub">Final selections</span>
              </div>
              <div className="rep-kpi-card callers">
                <span className="lbl">Active Calling Roster</span>
                <span className="num">{data?.totals?.active_callers ?? 0} / {data?.totals?.total_callers ?? 0}</span>
                <span className="sub">Logged calls today</span>
              </div>
            </div>

            {/* Hourly Sales Velocity Graph */}
            <div className="hourly-velocity-box">
              <div className="sec-header">
                <i className="fas fa-bolt text-amber"></i>
                <b>Today's Hourly Sales Velocity (IST)</b>
              </div>
              <div className="velocity-bars-row">
                {Object.entries(data?.hourly_sales || {}).map(([hr, count]) => {
                  const maxSales = Math.max(1, ...Object.values(data?.hourly_sales || {}));
                  const pct = Math.round((count / maxSales) * 100);
                  const displayHr = `${hr.padStart(2, '0')}:00`;
                  return (
                    <div key={hr} className="v-bar-col">
                      <span className="v-bar-num">{count > 0 ? count : ''}</span>
                      <div className="v-bar-track">
                        <div className="v-bar-fill" style={{ height: `${pct}%`, background: count > 0 ? '#10b981' : '#e2e8f0' }} />
                      </div>
                      <span className="v-bar-label">{displayHr.slice(0, 2)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Counselor Table */}
            <div className="rep-table-wrap">
              <div className="sec-header">
                <i className="fas fa-users text-primary"></i>
                <b>Counselor Performance Breakdown</b>
              </div>
              <table className="rep-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Counselor</th>
                    <th>Program</th>
                    <th>Sales</th>
                    <th>L1</th>
                    <th>L2</th>
                    <th>Interested</th>
                    <th>Follow-ups</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.members?.map((m, idx) => (
                    <tr key={m.id} className={m.sales > 0 ? 'row-has-sale' : ''}>
                      <td>
                        <span className={`rank-pill ${idx === 0 && m.sales > 0 ? 'first' : ''}`}>#{idx + 1}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <Avatar p={m} size="2.2rem" />
                          <div>
                            <div style={{ fontWeight: 800 }}>{m.name}</div>
                            <div className="muted small">{m.employee_code}</div>
                          </div>
                        </div>
                      </td>
                      <td><span className="prog-tag">{m.program_name || 'General'}</span></td>
                      <td><span className="badge-sales">{m.sales}</span></td>
                      <td><b>{m.l1}</b></td>
                      <td><b>{m.l2}</b></td>
                      <td>{m.interested}</td>
                      <td>{m.followup}</td>
                      <td><b>{m.total_updates}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Actions: WhatsApp + CSV Export */}
            <div className="rep-actions-bar">
              <button className="btn-whatsapp" onClick={copyWhatsApp}>
                <i className={`fas ${copied ? 'fa-check' : 'fa-share-nodes'}`}></i>
                <span>{copied ? 'Copied WhatsApp EOD Summary!' : '1-Click Copy WhatsApp EOD Summary'}</span>
              </button>

              <div className="csv-export-group">
                <div className="date-input-wrap">
                  <label>From:</label>
                  <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                </div>
                <div className="date-input-wrap">
                  <label>To:</label>
                  <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                </div>
                <a
                  href={`/api/tl/reports/export.csv?from=${fromDate}&to=${toDate}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-export-csv"
                >
                  <i className="fas fa-file-csv"></i> Download CSV
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Live Floor Broadcast Modal ─── */
function FloorBroadcastModal({ token, onClose }) {
  const [message, setMessage] = useState('');
  const [style, setStyle] = useState('fire');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/tl/broadcast', {
        method: 'POST',
        token,
        body: { message: message.trim(), style, active: !!message.trim() },
      });
      setSuccess('Broadcasted live to 108" TV!');
      setTimeout(onClose, 1200);
    } catch (ex) {
      alert(ex.message || 'Broadcast failed');
    }
    setBusy(false);
  }

  async function clearBroadcast() {
    setBusy(true);
    try {
      await api('/api/tl/broadcast', {
        method: 'POST',
        token,
        body: { message: '', style: 'fire', active: false },
      });
      setSuccess('Broadcast cleared from TV.');
      setTimeout(onClose, 1000);
    } catch (ex) {
      alert(ex.message);
    }
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modern-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-row">
          <div className="modal-title">
            <i className="fas fa-bullhorn text-amber"></i>
            <h3>Floor Broadcast to 108" TV</h3>
          </div>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>
        <form onSubmit={submit} className="modern-modal-form">
          <p className="muted small">
            Display a live marquee announcement across the 108" TV screen to motivate callers or announce floor targets.
          </p>
          <div className="form-group">
            <label>Announcement Text</label>
            <input
              type="text"
              placeholder="e.g. ⚡ Final 45 mins! 3 sales needed for team cash bonus!"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>Banner Theme</label>
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button
                type="button"
                className={`style-pill ${style === 'fire' ? 'active' : ''}`}
                onClick={() => setStyle('fire')}
              >
                🔥 Fire Gold
              </button>
              <button
                type="button"
                className={`style-pill ${style === 'info' ? 'active' : ''}`}
                onClick={() => setStyle('info')}
              >
                ℹ️ Corporate Blue
              </button>
              <button
                type="button"
                className={`style-pill ${style === 'success' ? 'active' : ''}`}
                onClick={() => setStyle('success')}
              >
                🎉 Victory Green
              </button>
            </div>
          </div>
          {success && <div className="modal-success-box"><i className="fas fa-check" /> {success}</div>}
          <div className="modal-btn-row">
            <button type="button" className="btn-danger small" onClick={clearBroadcast} disabled={busy}>
              Clear Ticker
            </button>
            <button type="submit" className="btn-primary" disabled={busy || !message.trim()}>
              {busy ? <><i className="fas fa-spinner fa-spin" /> Pushing…</> : <><i className="fas fa-broadcast-tower" /> Push to TV</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Self-Service Change PIN Modal ─── */
function ChangePinModal({ token, onClose }) {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');

  async function submit(e) {
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
      setSuccess('PIN changed successfully! Use your new PIN on your next sign-in.');
      setTimeout(onClose, 1500);
    } catch (ex) {
      setErr(ex.message || 'Failed to change PIN');
    }
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modern-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-row">
          <div className="modal-title">
            <i className="fas fa-key text-primary"></i>
            <h3>Change Security PIN</h3>
          </div>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>
        <form onSubmit={submit} className="modern-modal-form">
          <div className="form-group">
            <label>Current PIN (Default: 111111)</label>
            <input
              type="password"
              inputMode="numeric"
              placeholder="Current PIN"
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>New Secret PIN (4–10 digits)</label>
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
              placeholder="Repeat New PIN"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              required
            />
          </div>
          {err && <div className="modal-err-box"><i className="fas fa-circle-exclamation" /> {err}</div>}
          {success && <div className="modal-success-box"><i className="fas fa-check" /> {success}</div>}
          <div className="modal-btn-row">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? <><i className="fas fa-spinner fa-spin" /> Saving…</> : <><i className="fas fa-check" /> Update PIN</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Avatar({ p, size = '4.2rem' }) {
  const initials = p.name ? p.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '??';
  return p.photo_url ? (
    <img className="tl-avatar-img" style={{ width: size, height: size }} src={p.photo_url} alt={p.name} />
  ) : (
    <div className="tl-avatar-fallback" style={{ width: size, height: size }}>{initials}</div>
  );
}

function Login({ onLogin }) {
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
    <div className="modern-auth-wrap">
      {showDirectory && (
        <DirectoryModal
          onSelectCode={handleSelectCode}
          onClose={() => setShowDirectory(false)}
        />
      )}
      <div className="modern-auth-backdrop-glow" />
      <div className="modern-auth-card">
        <div className="auth-brand-badge">
          <i className="fas fa-shield-halved"></i>
          <span>LEADERSHIP ACCESS</span>
        </div>
        <h1 className="auth-title">Team Leader Kiosk</h1>
        <p className="auth-subtitle">Floor dispatch & real-time telecaller performance logging</p>

        <form className="modern-form" onSubmit={submit}>
          <div className="modern-field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label><i className="fas fa-id-badge"></i> Employee Code</label>
              <button
                type="button"
                className="directory-toggle-btn"
                style={{ fontSize: '0.8rem', padding: 0 }}
                onClick={() => setShowDirectory(true)}
              >
                <i className="fas fa-search" /> Look up ID
              </button>
            </div>
            <input
              placeholder="e.g. TL001"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoFocus
              required
            />
          </div>

          <div className="modern-field">
            <label><i className="fas fa-lock"></i> Security PIN (Default: 111111)</label>
            <input
              placeholder="Enter PIN"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
            />
          </div>

          {err && (
            <div className="modern-auth-error">
              <i className="fas fa-circle-exclamation"></i>
              <span>{err}</span>
            </div>
          )}

          <button className="modern-submit-btn" disabled={busy || !code || !pin}>
            {busy ? (
              <span><i className="fas fa-spinner fa-spin"></i> Authenticating…</span>
            ) : (
              <span><i className="fas fa-arrow-right-to-bracket"></i> Sign In to Floor Kiosk</span>
            )}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <button
            type="button"
            className="directory-toggle-btn"
            onClick={() => setShowDirectory(true)}
          >
            <i className="fas fa-users-viewfinder"></i> Browse Floor Leadership & Team Directory
          </button>
        </div>

        <div className="modern-auth-footer">
          <a href="/admin"><i className="fas fa-user-gear"></i> Admin Portal</a>
          <span className="dot-sep">•</span>
          <a href="/counselor"><i className="fas fa-headset"></i> Counselor View</a>
          <span className="dot-sep">•</span>
          <a href="/tv" target="_blank" rel="noreferrer"><i className="fas fa-tv"></i> Live TV</a>
        </div>
      </div>
    </div>
  );
}

const STATUS_ICONS = {
  sale_closed: 'fa-trophy',
  interested: 'fa-thumbs-up',
  follow_up: 'fa-calendar-day',
  callback: 'fa-phone-volume',
  l1_selected: 'fa-circle-check',
  l2_selected: 'fa-medal',
};

export default function TLPage() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('session') || 'null'));
  const [team, setTeam] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [selected, setSelected] = useState(null);
  const [leadRef, setLeadRef] = useState('');
  const [search, setSearch] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tl_favorites') || '[]'); } catch { return []; }
  });
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  // Modals
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [showAddCounselor, setShowAddCounselor] = useState(false);
  const [editCounselor, setEditCounselor] = useState(null);
  const [customCountCounselor, setCustomCountCounselor] = useState(null);
  const [showReports, setShowReports] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [showChangePin, setShowChangePin] = useState(false);

  const timer = useRef();
  const token = session?.token;

  function logout() {
    localStorage.removeItem('session');
    setSession(null);
  }

  function onLogin(r) {
    localStorage.setItem('session', JSON.stringify(r));
    setSession(r);
  }

  function toggleFavorite(id, e) {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem('tl_favorites', JSON.stringify(next));
      return next;
    });
  }

  async function loadTeam() {
    try {
      const [teamData, progs] = await Promise.all([
        api('/api/tl/counselors', { token }),
        api('/api/tl/programs', { token }),
      ]);
      setTeam(teamData);
      setPrograms(progs);
    } catch (e) {
      if (e.status === 401) logout();
    }
  }

  useEffect(() => {
    if (!token) return;
    loadTeam();
    api('/api/statuses', { token })
      .then(setStatuses)
      .catch((e) => e.status === 401 && logout());
    const t = setInterval(loadTeam, 15000);
    return () => clearInterval(t);
  }, [token]);

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

  async function record(tc, status, confirm = false) {
    if (busy) return;
    setBusy(true);
    try {
      const { event, undo_seconds } = await api('/api/events', {
        method: 'POST',
        token,
        body: {
          telecaller_id: tc.id,
          status_code: status.code,
          lead_ref: leadRef.trim() || undefined,
          confirm_duplicate: confirm,
        },
      });
      clearTimeout(timer.current);
      setToast({ id: event.id, text: `${tc.name} → ${status.label}`, isSale: status.is_sale, seconds: undo_seconds });
      timer.current = setTimeout(() => setToast(null), (undo_seconds + 1) * 1000);
      setSelected(null);
      setLeadRef('');
      loadTeam();
    } catch (e) {
      if (e.code === 'DUPLICATE_CONFIRM') {
        setBusy(false);
        if (window.confirm(e.message)) {
          return record(tc, status, true);
        }
        return;
      }
      if (e.status === 401) {
        logout();
      } else {
        alert(e.message || 'Error saving entry');
      }
    }
    setBusy(false);
  }

  async function undo() {
    if (!toast) return;
    try {
      await api(`/api/events/${toast.id}/undo`, { method: 'POST', token });
      setToast(null);
      loadTeam();
    } catch (e) {
      alert(e.message);
    }
  }

  if (!token) return <Login onLogin={onLogin} />;

  if (session?.user?.role === 'telecaller') {
    return <CounselorPage />;
  }

  const totalTeamSales = team.reduce((sum, t) => sum + (t.sales_today || 0), 0);
  const totalL1 = team.reduce((sum, t) => sum + (t.l1_today || 0), 0);
  const totalL2 = team.reduce((sum, t) => sum + (t.l2_today || 0), 0);
  const activeToday = team.filter((t) => (t.sales_today || 0) > 0 || (t.updates_today || 0) > 0).length;

  const filteredTeam = team.filter((t) => {
    const matchesSearch = t.name.toLowerCase().includes(search.toLowerCase()) ||
                          t.employee_code?.toLowerCase().includes(search.toLowerCase()) ||
                          t.program_name?.toLowerCase().includes(search.toLowerCase());
    if (favoritesOnly) return matchesSearch && favorites.includes(t.id);
    return matchesSearch;
  });

  return (
    <div className="tl-dashboard-root">
      {/* Modals */}
      {showPhotoModal && (
        <PhotoUploadModal
          token={token}
          onDone={() => { setShowPhotoModal(false); loadTeam(); }}
          onClose={() => setShowPhotoModal(false)}
        />
      )}
      {showAddCounselor && (
        <AddCounselorModal
          token={token}
          programs={programs}
          onDone={() => { setShowAddCounselor(false); loadTeam(); }}
          onClose={() => setShowAddCounselor(false)}
        />
      )}
      {editCounselor && (
        <EditCounselorModal
          counselor={editCounselor}
          programs={programs}
          token={token}
          onDone={() => { setEditCounselor(null); loadTeam(); }}
          onClose={() => setEditCounselor(null)}
        />
      )}
      {customCountCounselor && (
        <CustomCountModal
          counselor={customCountCounselor}
          token={token}
          onDone={() => { setCustomCountCounselor(null); loadTeam(); }}
          onClose={() => setCustomCountCounselor(null)}
        />
      )}
      {showReports && (
        <TeamReportsModal
          token={token}
          onClose={() => setShowReports(false)}
        />
      )}
      {showBroadcast && (
        <FloorBroadcastModal
          token={token}
          onClose={() => setShowBroadcast(false)}
        />
      )}
      {showChangePin && (
        <ChangePinModal
          token={token}
          onClose={() => setShowChangePin(false)}
        />
      )}

      {/* Top Header */}
      <header className="tl-topbar">
        <div className="tl-topbar-brand">
          <div className="tl-brand-icon">
            <i className="fas fa-layer-group"></i>
          </div>
          <div>
            <div className="tl-brand-title">Team Leader Command Center</div>
            <div className="tl-shift-badge">
              <span className="tl-pulse-dot" />
              <span>LIVE FLOOR SHIFT</span>
            </div>
          </div>
        </div>

        <div className="tl-topbar-user">
          <button className="tl-btn-action-pill add" onClick={() => setShowAddCounselor(true)} title="Add a new counselor to your team">
            <i className="fas fa-user-plus"></i> + Add Counselor
          </button>
          <button className="tl-btn-action-pill report" onClick={() => setShowReports(true)} title="View reports and WhatsApp EOD summary">
            <i className="fas fa-chart-column"></i> 📊 Reports
          </button>
          <button className="tl-btn-action-pill broadcast" onClick={() => setShowBroadcast(true)} title="Broadcast marquee message to TV">
            <i className="fas fa-bullhorn"></i> TV Ticker
          </button>

          <div className="tl-user-pill" onClick={() => setShowChangePin(true)} title="Click to Change PIN" style={{ cursor: 'pointer' }}>
            <i className="fas fa-user-tie"></i>
            <span className="tl-user-name">{session.user.name}</span>
            <i className="fas fa-key small" style={{ fontSize: '0.75rem', opacity: 0.7 }} />
          </div>

          <a href="/tv" target="_blank" rel="noreferrer" className="tl-btn-nav" title="View 108 inch screen">
            <i className="fas fa-tv"></i> TV Screen
          </a>
          <a href="/counselor" className="tl-btn-nav" title="Switch to Counselor view">
            <i className="fas fa-headset"></i> Counselor View
          </a>
          <button className="tl-btn-logout" onClick={logout} title="Sign out">
            <i className="fas fa-arrow-right-from-bracket"></i>
          </button>
        </div>
      </header>

      {/* Main Floor Kiosk Area */}
      <main className="tl-main-body">
        {/* Metric Bar & Search */}
        <div className="tl-controls-bar">
          <div className="tl-quick-kpis">
            <div className="tl-kpi-chip sales">
              <i className="fas fa-trophy"></i>
              <div>
                <span className="num">{totalTeamSales}</span>
                <span className="lbl">Team Sales</span>
              </div>
            </div>
            <div className="tl-kpi-chip l1" style={{ borderColor: '#ddd6fe', background: '#faf5ff' }}>
              <i className="fas fa-clipboard-check" style={{ color: '#7c3aed' }}></i>
              <div>
                <span className="num" style={{ color: '#7c3aed' }}>{totalL1}</span>
                <span className="lbl">L1 Selected</span>
              </div>
            </div>
            <div className="tl-kpi-chip l2" style={{ borderColor: '#fbcfe8', background: '#fdf2f8' }}>
              <i className="fas fa-award" style={{ color: '#c026d3' }}></i>
              <div>
                <span className="num" style={{ color: '#c026d3' }}>{totalL2}</span>
                <span className="lbl">L2 Selected</span>
              </div>
            </div>
            <div className="tl-kpi-chip callers">
              <i className="fas fa-users-viewfinder"></i>
              <div>
                <span className="num">{activeToday} / {team.length}</span>
                <span className="lbl">Active Counselors</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
            <button
              className={`tl-fav-filter-btn ${favoritesOnly ? 'active' : ''}`}
              onClick={() => setFavoritesOnly(!favoritesOnly)}
              title="Show only starred favorite counselors"
            >
              <i className={`fas fa-star ${favoritesOnly ? 'text-amber' : ''}`}></i>
              <span>Favorites ({favorites.length})</span>
            </button>

            <div className="tl-search-box">
              <i className="fas fa-magnifying-glass"></i>
              <input
                type="text"
                placeholder="Search counselor, ID or program..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button className="tl-search-clear" onClick={() => setSearch('')}>
                  <i className="fas fa-xmark"></i>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Telecaller Grid */}
        <div className="tl-counselor-grid">
          {filteredTeam.map((t) => {
            const hasSales = (t.sales_today || 0) > 0;
            const isFav = favorites.includes(t.id);
            return (
              <div
                key={t.id}
                className={`tl-card-tile ${hasSales ? 'has-sales' : ''}`}
                onClick={() => {
                  setSelected(t);
                  setLeadRef('');
                }}
              >
                {/* Top Action Buttons on Tile */}
                <div className="tile-top-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className={`tile-btn-fav ${isFav ? 'starred' : ''}`}
                    onClick={(e) => toggleFavorite(t.id, e)}
                    title={isFav ? 'Remove from favorites' : 'Star as favorite'}
                  >
                    <i className={`${isFav ? 'fas' : 'far'} fa-star`}></i>
                  </button>
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <button
                      className="tile-btn-edit"
                      onClick={(e) => { e.stopPropagation(); setEditCounselor(t); }}
                      title="Edit Counselor Details"
                    >
                      <i className="fas fa-pencil"></i>
                    </button>
                    <button
                      className="tile-btn-count"
                      onClick={(e) => { e.stopPropagation(); setCustomCountCounselor(t); }}
                      title="Set Custom Daily Count / 1-Time Rechange"
                    >
                      <i className="fas fa-calculator"></i>
                    </button>
                  </div>
                </div>

                <div className="tl-tile-avatar-wrap">
                  <Avatar p={t} />
                  {hasSales && (
                    <div className="tl-sale-star">
                      <i className="fas fa-star"></i>
                    </div>
                  )}
                </div>

                <div className="tl-tile-name">{t.name}</div>
                <div className="tl-tile-code-prog">
                  <code>{t.employee_code}</code> · <span>{t.program_name || 'Program'}</span>
                </div>

                <div className={`tl-sale-badge ${hasSales ? 'positive' : 'zero'}`}>
                  {hasSales ? (
                    <>
                      <i className="fas fa-fire"></i>
                      <span><b>{t.sales_today}</b> {t.sales_today === 1 ? 'Sale' : 'Sales'}</span>
                    </>
                  ) : (
                    <span>0 Sales Today</span>
                  )}
                </div>

                <div className="tl-tile-sub-counts">
                  <span title="L1 Selected"><i className="fas fa-clipboard-check text-purple" /> {t.l1_today || 0}</span>
                  <span title="L2 Selected"><i className="fas fa-award text-magenta" /> {t.l2_today || 0}</span>
                  <span title="Interested"><i className="fas fa-thumbs-up text-blue" /> {t.interested_today || 0}</span>
                </div>

                <div className="tl-tile-tap-hint">
                  <span>Tap to record 1-click status</span>
                  <i className="fas fa-chevron-right"></i>
                </div>
              </div>
            );
          })}

          {!team.length && (
            <div className="tl-empty-state">
              <i className="fas fa-user-slash"></i>
              <h3>No Counselors in Team Yet</h3>
              <p>Click "+ Add Counselor" above to add telecallers directly to your floor roster.</p>
              <button className="btn-primary" onClick={() => setShowAddCounselor(true)} style={{ marginTop: '0.8rem' }}>
                <i className="fas fa-user-plus"></i> Add First Counselor
              </button>
            </div>
          )}

          {team.length > 0 && !filteredTeam.length && (
            <div className="tl-empty-state">
              <i className="fas fa-filter"></i>
              <h3>No Matches Found</h3>
              <p>No telecallers match "{search}". Clear search or toggle favorites to view all team members.</p>
            </div>
          )}
        </div>
      </main>

      {/* Modern Action Drawer Modal */}
      {selected && (
        <div className="tl-sheet-overlay" onClick={() => { setSelected(null); setLeadRef(''); }}>
          <div className="tl-sheet-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tl-sheet-header">
              <div className="tl-sheet-agent-info">
                <Avatar p={selected} size="3.6rem" />
                <div>
                  <div className="tl-sheet-title">{selected.name} ({selected.employee_code})</div>
                  <div className="tl-sheet-subtitle">
                    <span className="sales-highlight"><i className="fas fa-trophy"></i> {selected.sales_today || 0} sales today</span>
                    <span className="dot-sep">•</span>
                    <span>L1: <b>{selected.l1_today || 0}</b></span>
                    <span className="dot-sep">•</span>
                    <span>L2: <b>{selected.l2_today || 0}</b></span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  className="tl-btn-action-pill count"
                  onClick={() => { const s = selected; setSelected(null); setCustomCountCounselor(s); }}
                  title="Set bulk/custom count"
                >
                  <i className="fas fa-calculator" /> Custom Count
                </button>
                <button
                  className="tl-btn-action-pill edit"
                  onClick={() => { const s = selected; setSelected(null); setEditCounselor(s); }}
                  title="Edit details"
                >
                  <i className="fas fa-pencil" /> Edit
                </button>
                <button className="tl-sheet-close-btn" onClick={() => { setSelected(null); setLeadRef(''); }}>
                  <i className="fas fa-xmark"></i>
                </button>
              </div>
            </div>

            <div className="tl-sheet-input-wrap">
              <label><i className="fas fa-tag"></i> Lead Reference / Client Phone (Optional):</label>
              <div className="tl-input-with-icon">
                <input
                  type="text"
                  placeholder="e.g. Lead #8492 or customer phone"
                  value={leadRef}
                  onChange={(e) => setLeadRef(e.target.value)}
                  maxLength={40}
                  autoFocus
                />
                {leadRef && (
                  <button className="tl-input-clear" onClick={() => setLeadRef('')}>
                    <i className="fas fa-times-circle"></i>
                  </button>
                )}
              </div>
            </div>

            <div className="tl-sheet-status-heading">
              <span>1-TAP STATUS DISPATCH TO 108" TV:</span>
            </div>

            <div className="tl-sheet-status-grid">
              {statuses.map((s) => {
                const iconCls = STATUS_ICONS[s.code] || 'fa-circle-dot';
                return (
                  <button
                    key={s.id}
                    disabled={busy}
                    className={`tl-status-btn ${s.is_sale ? 'btn-sale' : ''}`}
                    style={{ '--status-accent': s.color || '#2563eb' }}
                    onClick={() => record(selected, s)}
                  >
                    <div className="status-btn-icon">
                      <i className={`fas ${iconCls}`}></i>
                    </div>
                    <div className="status-btn-info">
                      <span className="status-btn-label">{s.label}</span>
                      {s.is_sale && <span className="status-btn-tag">⭐ SALE CLOSED</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Floating Undo Notification */}
      {toast && (
        <div className={`tl-floating-toast ${toast.isSale ? 'toast-sale' : ''}`}>
          <div className="toast-left">
            <div className="toast-icon-circle">
              <i className={`fas ${toast.isSale ? 'fa-trophy' : 'fa-check'}`}></i>
            </div>
            <div className="toast-text-wrap">
              <span className="toast-main-text">{toast.text}</span>
              <span className="toast-sub-text">Pushed live to 108" TV Screen</span>
            </div>
          </div>
          <button className="toast-undo-btn" onClick={undo}>
            <i className="fas fa-rotate-left"></i>
            <span>UNDO ({toast.seconds}s)</span>
          </button>
        </div>
      )}
    </div>
  );
}
