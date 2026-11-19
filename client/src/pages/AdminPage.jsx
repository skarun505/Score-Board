import { useState, useEffect } from 'react';
import { api } from '../api.js';

export default function AdminPage() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('admin_session') || 'null'));
  const [tab, setTab] = useState('progress');

  // Login state
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Tab data
  const [users, setUsers] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [settings, setSettings] = useState({});
  const [events, setEvents] = useState([]);
  const [auditLog, setAuditLog] = useState([]);

  // Modals & Forms
  const [modal, setModal] = useState(null); // 'user_new', 'user_edit', 'program_new', 'status_new', 'import_csv', 'void_event'
  const [editingItem, setEditingItem] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidTarget, setVoidTarget] = useState(null);

  // Bulk CSV import state
  const [csvText, setCsvText] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [importErr, setImportErr] = useState('');

  // Date filters
  const [exportFrom, setExportFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [exportTo, setExportTo] = useState(() => new Date().toISOString().slice(0, 10));

  // Analytics & Progress state
  const [progressData, setProgressData] = useState(null);
  const [analyticsMonth, setAnalyticsMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // TV Command & Superpowers state
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastStyle, setBroadcastStyle] = useState('info');
  const [broadcastActive, setBroadcastActive] = useState(false);
  const [powerHour, setPowerHour] = useState(false);
  const [systemHealth, setSystemHealth] = useState(null);
  const [remoteStatus, setRemoteStatus] = useState('');
  const [restoreStatus, setRestoreStatus] = useState(null);

  // Quick Sale by Admin state
  const [quickTcId, setQuickTcId] = useState('');
  const [quickStatusCode, setQuickStatusCode] = useState('sale_closed');
  const [quickLeadRef, setQuickLeadRef] = useState('');
  const [quickSaving, setQuickSaving] = useState(false);

  // Hybrid 3-Tier Architecture Cloud Sync state
  const [cloudSyncStatus, setCloudSyncStatus] = useState(null);
  const [cloudSyncBusy, setCloudSyncBusy] = useState(false);
  const [cloudSyncMsg, setCloudSyncMsg] = useState('');

  const token = session?.token;

  function logout() {
    localStorage.removeItem('admin_session');
    setSession(null);
  }

  async function handleLogin(e) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginErr('');
    try {
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: { employee_code: code, pin },
      });
      if (res.user.role !== 'admin') {
        throw new Error('Access denied. Administrator privileges required.');
      }
      localStorage.setItem('admin_session', JSON.stringify(res));
      setSession(res);
    } catch (err) {
      setLoginErr(err.message);
    }
    setLoggingIn(false);
  }

  async function fetchAnalytics(m = analyticsMonth) {
    if (!token) return;
    setAnalyticsLoading(true);
    try {
      const data = await api(`/api/admin/analytics/progress?month=${m}`, { token });
      setProgressData(data);
    } catch (err) {
      console.error('fetchAnalytics error:', err);
    }
    setAnalyticsLoading(false);
  }

  async function fetchCloudSyncStatus() {
    if (!token) return;
    try {
      const data = await api('/api/admin/cloud-sync/status', { token });
      setCloudSyncStatus(data);
    } catch (err) {
      console.error('fetchCloudSyncStatus error:', err);
    }
  }

  async function handleCloudPush() {
    if (!token) return;
    const ok = window.confirm('Push all local floor programs, users, batches, and sales closures to Cloud PostgreSQL?');
    if (!ok) return;
    setCloudSyncBusy(true);
    setCloudSyncMsg('');
    try {
      const res = await api('/api/admin/cloud-sync/push', { method: 'POST', token });
      setCloudSyncMsg(`✅ ${res.message || 'Pushed to Cloud PostgreSQL successfully!'}`);
      fetchCloudSyncStatus();
      fetchAll();
    } catch (err) {
      setCloudSyncMsg(`❌ Cloud Push failed: ${err.message}`);
    }
    setCloudSyncBusy(false);
  }

  async function handleCloudPull() {
    if (!token) return;
    const ok = window.confirm('Hydrate local In-Memory Engine from Cloud PostgreSQL?\n\nThis will synchronize all data from the cloud down to your local engine.');
    if (!ok) return;
    setCloudSyncBusy(true);
    setCloudSyncMsg('');
    try {
      const res = await api('/api/admin/cloud-sync/pull', { method: 'POST', token });
      setCloudSyncMsg(`✅ ${res.message || 'Hydrated from Cloud PostgreSQL successfully!'}`);
      fetchCloudSyncStatus();
      fetchAll();
    } catch (err) {
      setCloudSyncMsg(`❌ Cloud Pull failed: ${err.message}`);
    }
    setCloudSyncBusy(false);
  }

  async function fetchSystemHealth() {
    if (!token) return;
    try {
      const data = await api('/api/admin/system-health', { token });
      setSystemHealth(data);
    } catch (err) {
      console.error('fetchSystemHealth error:', err);
    }
  }

  async function fetchAll() {
    if (!token) return;
    try {
      const [u, p, s, st, ev, a] = await Promise.all([
        api('/api/admin/users', { token }),
        api('/api/admin/programs', { token }),
        api('/api/admin/statuses', { token }),
        api('/api/dashboard', { token }).then((d) => d.settings || {}),
        api('/api/admin/events', { token }),
        api('/api/admin/audit?limit=150', { token }),
      ]);
      setUsers(u);
      setPrograms(p);
      setStatuses(s);
      setSettings(st);
      setEvents(ev);
      setAuditLog(a);
      setBroadcastMsg(st.tv_broadcast_message || '');
      setBroadcastStyle(st.tv_broadcast_style || 'info');
      setBroadcastActive(st.tv_broadcast_active === '1');
      setPowerHour(st.power_hour_enabled === '1');
      fetchAnalytics(analyticsMonth);
      fetchSystemHealth();
      fetchCloudSyncStatus();
    } catch (err) {
      if (err.status === 401) logout();
    }
  }

  useEffect(() => {
    fetchAll();
  }, [token]);

  // Remote diagnostics action
  async function handleRemoteAction(action) {
    try {
      setRemoteStatus(`Executing ${action}...`);
      const res = await api('/api/admin/remote-action', {
        method: 'POST',
        token,
        body: { action }
      });
      if (action === 'toggle_power_hour') {
        setPowerHour(res.power_hour);
        setRemoteStatus(res.power_hour ? '🔥 Power Hour activated on all screens!' : 'Power Hour deactivated.');
      } else {
        setRemoteStatus(`✅ ${action} command delivered to TV!`);
      }
      setTimeout(() => setRemoteStatus(''), 4500);
      fetchAll();
    } catch (err) {
      alert(err.message);
      setRemoteStatus('');
    }
  }

  // Marquee Broadcast
  async function handleBroadcast(active) {
    try {
      await api('/api/admin/broadcast', {
        method: 'POST',
        token,
        body: {
          message: broadcastMsg,
          style: broadcastStyle,
          active
        }
      });
      setBroadcastActive(active);
      setRemoteStatus(active ? '📢 Live Ticker Broadcasted to TV!' : 'Ticker cleared.');
      setTimeout(() => setRemoteStatus(''), 4500);
      fetchAll();
    } catch (err) {
      alert(err.message);
    }
  }

  // Quick Sale submission by Admin
  async function handleQuickSale(e) {
    e.preventDefault();
    if (!quickTcId) return alert('Please choose a telecaller');
    setQuickSaving(true);
    try {
      await api('/api/events', {
        method: 'POST',
        token,
        body: {
          telecaller_id: Number(quickTcId),
          status_code: quickStatusCode,
          lead_ref: quickLeadRef.trim() || undefined,
          confirm_duplicate: true
        }
      });
      setRemoteStatus('🎉 Entry recorded successfully! Celebration triggered on TV.');
      setQuickLeadRef('');
      setTimeout(() => setRemoteStatus(''), 4500);
      fetchAll();
    } catch (err) {
      alert(err.message);
    }
    setQuickSaving(false);
  }

  // Database Backup download
  function downloadBackup() {
    window.open(`/api/admin/backup/download?token=${token}`, '_blank');
  }

  function exportJsonBackup() {
    window.open(`/api/admin/backup/export-json?token=${token}`, '_blank');
  }

  async function handleRestoreFile(file) {
    if (!file) return;
    const confirmed = window.confirm(
      `Are you sure you want to restore data from "${file.name}"?\n\nThis will restore all sales closures, batches, programs, and counselors from this backup.`
    );
    if (!confirmed) return;

    setRestoreStatus({ loading: true, msg: 'Restoring backup data, please wait…' });
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await api('/api/admin/backup/import-json', {
        method: 'POST',
        token,
        body: { data: parsed },
      });
      setRestoreStatus({ success: true, msg: res.message || 'Backup restored successfully!' });
      fetchAll();
      fetchSystemHealth();
      setTimeout(() => setRestoreStatus(null), 10000);
    } catch (err) {
      setRestoreStatus({ error: true, msg: `Restore failed: ${err.message || 'Invalid JSON backup file'}` });
    }
  }

  // Settings update
  async function saveSettings(e) {
    e.preventDefault();
    try {
      await api('/api/admin/settings', { method: 'PUT', body: settings, token });
      alert('Settings updated successfully!');
      fetchAll();
    } catch (err) {
      alert(err.message);
    }
  }

  // Void entry
  async function submitVoid(e) {
    e.preventDefault();
    if (!voidReason.trim()) return alert('Please enter a void reason');
    try {
      await api(`/api/admin/events/${voidTarget.id}/void`, {
        method: 'POST',
        token,
        body: { reason: voidReason.trim() },
      });
      setVoidTarget(null);
      setVoidReason('');
      fetchAll();
    } catch (err) {
      alert(err.message);
    }
  }

  // Parse CSV for bulk import
  async function previewCsv() {
    setImportErr('');
    setImportPreview(null);
    try {
      const lines = csvText.trim().split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) throw new Error('CSV must contain a header line and at least 1 data row.');
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const rows = lines.slice(1).map((line) => {
        const parts = line.split(',').map((p) => p.trim());
        const row = {};
        headers.forEach((h, idx) => {
          row[h] = parts[idx] || '';
        });
        return row;
      });

      const res = await api('/api/admin/users/import', {
        method: 'POST',
        token,
        body: { rows, commit: false },
      });
      setImportPreview(res);
    } catch (err) {
      setImportErr(err.message);
    }
  }

  async function commitCsv() {
    try {
      const lines = csvText.trim().split(/\r?\n/).filter(Boolean);
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const rows = lines.slice(1).map((line) => {
        const parts = line.split(',').map((p) => p.trim());
        const row = {};
        headers.forEach((h, idx) => {
          row[h] = parts[idx] || '';
        });
        return row;
      });

      const res = await api('/api/admin/users/import', {
        method: 'POST',
        token,
        body: { rows, commit: true },
      });
      alert(`Imported ${res.imported} users successfully!`);
      setModal(null);
      setCsvText('');
      setImportPreview(null);
      fetchAll();
    } catch (err) {
      alert(err.message);
    }
  }

  if (!token) {
    return (
      <div className="modern-auth-wrap">
        <div className="modern-auth-backdrop-glow" />
        <div className="modern-auth-card">
          <div className="auth-brand-badge admin-badge">
            <i className="fas fa-crown"></i>
            <span>ADMINISTRATOR GATE</span>
          </div>
          <h1 className="auth-title">Sales Command Center</h1>
          <p className="auth-subtitle">Enterprise management, television broadcast & data administration</p>

          <form className="modern-form" onSubmit={handleLogin}>
            <div className="modern-field">
              <label><i className="fas fa-user-shield"></i> Admin Code</label>
              <input
                placeholder="Admin Code (ADMIN)"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                autoCapitalize="characters"
                autoFocus
                required
              />
            </div>

            <div className="modern-field">
              <label><i className="fas fa-key"></i> Administrator PIN</label>
              <input
                placeholder="Enter PIN"
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                required
              />
            </div>

            {loginErr && (
              <div className="modern-auth-error">
                <i className="fas fa-circle-exclamation"></i>
                <span>{loginErr}</span>
              </div>
            )}

            <button className="modern-submit-btn admin-btn" disabled={loggingIn || !code || !pin}>
              {loggingIn ? (
                <span><i className="fas fa-spinner fa-spin"></i> Authenticating…</span>
              ) : (
                <span><i className="fas fa-right-to-bracket"></i> Enter Command Portal</span>
              )}
            </button>
          </form>

          <div className="modern-auth-footer">
            <a href="/tl"><i className="fas fa-user-tie"></i> TL Kiosk</a>
            <span className="dot-sep">•</span>
            <a href="/counselor"><i className="fas fa-headset"></i> Counselor View</a>
            <span className="dot-sep">•</span>
            <a href="/tv" target="_blank" rel="noreferrer"><i className="fas fa-tv"></i> Live TV</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-layout">
      <header className="admin-header">
        <div className="admin-brand">
          <div className="admin-brand-icon">
            <i className="fas fa-chart-pie"></i>
          </div>
          <div>
            <div className="admin-brand-title">SALES COMMAND CENTER</div>
            <div className="admin-brand-sub">Enterprise Floor & Television Management</div>
          </div>
        </div>

        <div className="admin-user-info">
          <div className="admin-user-chip">
            <i className="fas fa-user-shield"></i>
            <span>{session.user.name}</span>
          </div>
          <a href="/tv" target="_blank" rel="noreferrer" className="admin-link-btn">
            <i className="fas fa-tv"></i> TV Screen
          </a>
          <a href="/tl" target="_blank" rel="noreferrer" className="admin-link-btn">
            <i className="fas fa-mobile-screen"></i> TL Kiosk
          </a>
          <button className="admin-link-btn logout" onClick={logout}>
            <i className="fas fa-power-off"></i> Sign Out
          </button>
        </div>
      </header>

      <nav className="admin-nav">
        {[
          { id: 'progress', label: '📊 WEEKLY & MONTHLY PROGRESS' },
          { id: 'command', label: '🎮 TV COMMAND CENTER' },
          { id: 'users', label: 'USERS' },
          { id: 'programs', label: 'PROGRAMS' },
          { id: 'statuses', label: 'STATUSES' },
          { id: 'settings', label: 'SETTINGS' },
          { id: 'entries', label: 'ENTRIES' },
          { id: 'audit', label: 'AUDIT LOG' },
          { id: 'export', label: '💾 BACKUP & EXPORT' },
        ].map((t) => (
          <button
            key={t.id}
            className={`admin-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="admin-content">
        {remoteStatus && (
          <div className="admin-status-alert">
            <i className="fas fa-info-circle"></i>
            <span>{remoteStatus}</span>
          </div>
        )}

        {/* WEEKLY & MONTHLY PROGRESS TAB */}
        {tab === 'progress' && (
          <div>
            <div className="admin-card">
              <div className="analytics-header-strip">
                <div>
                  <h2 style={{ margin: 0 }}><i className="fas fa-chart-line text-primary"></i> Floor Performance & Sales Momentum</h2>
                  <div style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '0.2rem' }}>
                    Tracking daily closures, weekly targets, and monthly milestones
                  </div>
                </div>
                <div className="analytics-month-picker">
                  <label style={{ fontWeight: 700, fontSize: '0.9rem', color: '#475569' }}>Select Month:</label>
                  <input
                    type="month"
                    value={analyticsMonth}
                    onChange={(e) => {
                      setAnalyticsMonth(e.target.value);
                      fetchAnalytics(e.target.value);
                    }}
                  />
                  <button className="btn" onClick={() => fetchAnalytics(analyticsMonth)}>
                    <i className="fas fa-sync-alt"></i> Refresh
                  </button>
                </div>
              </div>

              {analyticsLoading && <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Loading analytics…</div>}

              {progressData && !analyticsLoading && (
                <>
                  {/* Top KPI Summary Cards */}
                  <div className="analytics-kpi-grid">
                    <div className="analytics-kpi-card">
                      <span className="kpi-title"><i className="fas fa-calendar-alt"></i> Month Total Sales</span>
                      <div className="kpi-value-row">
                        <span className="kpi-num">{progressData.monthly?.total_sales || 0}</span>
                        <span className="kpi-sub">sales closed</span>
                      </div>
                      <div className="kpi-trend">
                        <span>Avg: <b>{progressData.monthly?.avg_daily_sales || 0}</b> sales / day</span>
                      </div>
                    </div>

                    <div className="analytics-kpi-card">
                      <span className="kpi-title"><i className="fas fa-bullseye"></i> Current Week Sales</span>
                      <div className="kpi-value-row">
                        <span className="kpi-num">{progressData.weekly?.week_sales || 0}</span>
                        <span className="kpi-sub">/ {progressData.weekly?.week_target || 0} target</span>
                      </div>
                      <div className="kpi-trend">
                        <b>{Math.round(((progressData.weekly?.week_sales || 0) / Math.max(1, progressData.weekly?.week_target || 1)) * 100)}%</b> of weekly target
                      </div>
                    </div>

                    <div className="analytics-kpi-card">
                      <span className="kpi-title"><i className="fas fa-chart-bar"></i> Week vs Last Week</span>
                      <div className="kpi-value-row">
                        <span className={`kpi-num ${(progressData.weekly?.growth_pct || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                          {(progressData.weekly?.growth_pct || 0) >= 0 ? '+' : ''}{progressData.weekly?.growth_pct || 0}%
                        </span>
                      </div>
                      <div className={`kpi-trend ${(progressData.weekly?.growth_pct || 0) >= 0 ? 'positive' : 'negative'}`}>
                        <span>Prior week: {progressData.weekly?.prev_week_sales || 0} sales</span>
                      </div>
                    </div>

                    <div className="analytics-kpi-card">
                      <span className="kpi-title"><i className="fas fa-headset"></i> Monthly Activity Volume</span>
                      <div className="kpi-value-row">
                        <span className="kpi-num">{progressData.monthly?.total_updates || 0}</span>
                        <span className="kpi-sub">total touchpoints</span>
                      </div>
                      <div className="kpi-trend">
                        <span>Conversion: <b>{progressData.monthly?.total_updates ? Math.round(((progressData.monthly?.total_sales || 0) / progressData.monthly.total_updates) * 100) : 0}%</b></span>
                      </div>
                    </div>
                  </div>

                  {/* WEEKLY DAY-BY-DAY BAR CHART */}
                  <div className="week-chart-container">
                    <div className="chart-title-wrap">
                      <strong style={{ fontSize: '1.05rem', color: '#0f172a' }}>
                        <i className="fas fa-calendar-week text-primary"></i> THIS WEEK'S DAILY PERFORMANCE (MON - SUN)
                      </strong>
                      <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Daily Target: <b>{progressData.weekly?.daily_org_target || 0} sales / day</b></span>
                    </div>

                    <div className="week-bar-grid">
                      {(progressData.weekly?.days || []).map((d) => {
                        const maxSales = Math.max(5, ...(progressData.weekly?.days || []).map(x => x.sales), progressData.weekly?.daily_org_target || 0);
                        const pctHeight = Math.min(100, Math.max(8, Math.round((d.sales / maxSales) * 100)));
                        return (
                          <div key={d.date} className="week-bar-col">
                            <span className="bar-val-lbl">{d.sales}</span>
                            <div
                              className={`bar-fill ${d.hit_target ? 'target-met' : ''}`}
                              style={{ height: `${pctHeight}%` }}
                              title={`${d.date}: ${d.sales} sales (${d.updates} updates)`}
                            />
                            <div className="bar-day-meta">
                              <div className="bar-day-name">{d.day_name}</div>
                              <div className="bar-day-date">{d.date.slice(8)}</div>
                              {d.hit_target && (
                                <div className="bar-hit-badge"><i className="fas fa-check-circle"></i> Hit</div>
                              )}
                              {d.is_today && (
                                <div style={{ fontSize: '0.7rem', color: '#2563eb', fontWeight: 800 }}>TODAY</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* MONTH-TO-DATE DAILY HEATMAP TIMELINE */}
                  <div style={{ marginTop: '2rem', marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                      <strong style={{ fontSize: '1.05rem', color: '#0f172a' }}>
                        <i className="fas fa-th text-primary"></i> MONTH DAILY PROGRESSION (DAYS 1 TO {progressData.monthly?.timeline?.length || 31})
                      </strong>
                      <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                        <span style={{ display: 'inline-block', width: 10, height: 10, background: '#a7f3d0', borderRadius: 2, marginRight: 4 }}></span> Days with sales
                        <span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid #2563eb', borderRadius: 2, margin: '0 4px 0 12px' }}></span> Today
                      </span>
                    </div>

                    <div className="month-timeline-grid">
                      {(progressData.monthly?.timeline || []).map((c) => (
                        <div
                          key={c.date}
                          className={`month-day-cell ${c.is_today ? 'today' : ''} ${c.sales > 0 ? 'has-sales' : ''}`}
                          title={`${c.date}: ${c.sales} sales, ${c.updates} total touches`}
                        >
                          <span className="mdc-day">{c.day}</span>
                          <span className="mdc-sales">{c.sales}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* TWO COLUMNS: PROGRAMS MONTHLY PERFORMANCE & TOP TELECALLERS */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
                    {/* Program Achievement */}
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.9rem', padding: '1.4rem' }}>
                      <h3 style={{ fontSize: '1.05rem', marginBottom: '1.2rem', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <i className="fas fa-layer-group text-primary"></i> Program Performance This Month
                      </h3>
                      {(progressData.monthly?.programs || []).map((p) => {
                        const monthlyTarget = (p.daily_target || 0) * (progressData.monthly?.timeline?.length || 30);
                        const pct = monthlyTarget > 0 ? Math.min(100, Math.round((p.sales / monthlyTarget) * 100)) : 0;
                        return (
                          <div key={p.id} className="prog-progress-row">
                            <div className="prog-progress-meta">
                              <span><b>{p.name}</b> ({p.sales} sales)</span>
                              <span style={{ color: '#64748b' }}>{pct}% of monthly goal</span>
                            </div>
                            <div className="prog-track">
                              <div className="prog-bar-fill" style={{ width: `${Math.max(5, pct)}%` }} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#64748b', marginTop: '0.2rem' }}>
                              <span>Daily target: {p.daily_target}/day</span>
                              <span>Active callers: {p.active_callers || 0}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Top 10 Telecallers of the Month */}
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.9rem', padding: '1.4rem' }}>
                      <h3 style={{ fontSize: '1.05rem', marginBottom: '1.2rem', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <i className="fas fa-trophy text-gold"></i> Top Closers of the Month
                      </h3>
                      <table className="admin-table" style={{ background: '#ffffff', borderRadius: '0.6rem', overflow: 'hidden' }}>
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Telecaller</th>
                            <th>Program</th>
                            <th>Sales</th>
                            <th>Conv %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(progressData.monthly?.top_telecallers || []).length === 0 ? (
                            <tr><td colSpan="5" style={{ textAlign: 'center', padding: '1.5rem', color: '#64748b' }}>No sales recorded yet this month</td></tr>
                          ) : (
                            (progressData.monthly?.top_telecallers || []).map((tc) => (
                              <tr key={tc.id}>
                                <td style={{ fontWeight: 900 }}>
                                  {tc.rank === 1 ? '🥇' : tc.rank === 2 ? '🥈' : tc.rank === 3 ? '🥉' : `#${tc.rank}`}
                                </td>
                                <td><b>{tc.name}</b></td>
                                <td style={{ color: '#64748b' }}>{tc.program_name || '—'}</td>
                                <td><span style={{ fontWeight: 900, color: '#059669', fontSize: '1.1rem' }}>{tc.sales}</span></td>
                                <td><b>{tc.conversion_pct}%</b></td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* TV COMMAND CENTER & SUPERPOWERS */}
        {tab === 'command' && (
          <div className="admin-command-grid">
            {/* Live TV Broadcast Marquee Ticker */}
            <div className="command-section">
              <h3><i className="fas fa-bullhorn text-primary"></i> 108" TV Live Marquee Ticker</h3>
              <p className="command-desc">
                Broadcast announcements, floor challenges, or incentives in real-time across the TV screen ticker.
              </p>

              <textarea
                rows="3"
                style={{ width: '100%', padding: '0.8rem', borderRadius: '0.6rem', border: '1px solid #cbd5e1', fontSize: '0.95rem', fontFamily: 'inherit' }}
                placeholder="Type broadcast message (e.g. 🔥 POWER SPRINT: Next 30 minutes every sale gets ₹500 voucher!)..."
                value={broadcastMsg}
                onChange={(e) => setBroadcastMsg(e.target.value)}
              />

              <div style={{ marginTop: '0.8rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#475569' }}>Banner Style:</span>
                <div className="style-selector-row">
                  {['info', 'urgent', 'motivation', 'fire'].map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`style-pill ${broadcastStyle === s ? 'active' : ''}`}
                      onClick={() => setBroadcastStyle(s)}
                    >
                      {s.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.8rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleBroadcast(true)}
                  disabled={!broadcastMsg.trim()}
                >
                  <i className="fas fa-paper-plane"></i> Broadcast to TV
                </button>
                {broadcastActive && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => handleBroadcast(false)}
                  >
                    <i className="fas fa-times"></i> Clear Ticker
                  </button>
                )}
              </div>

              {broadcastActive && (
                <div style={{ marginTop: '1rem', padding: '0.7rem', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '0.6rem', color: '#065f46', fontSize: '0.85rem', fontWeight: 700 }}>
                  <i className="fas fa-check-circle"></i> Active on TV: "{broadcastMsg}"
                </div>
              )}
            </div>

            {/* TV Remote Diagnostics & Controls */}
            <div className="command-section">
              <h3><i className="fas fa-tv text-primary"></i> TV Remote Diagnostics</h3>
              <p className="command-desc">
                Test audio chimes and visuals or force refresh all connected screens instantly via WebSockets.
              </p>

              <div className="remote-action-buttons" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
                <button
                  type="button"
                  className="btn-remote"
                  onClick={() => handleRemoteAction('test_sound')}
                >
                  <i className="fas fa-bell"></i>
                  <span>Test Bell Chime</span>
                </button>

                <button
                  type="button"
                  className="btn-remote"
                  onClick={() => handleRemoteAction('test_gong')}
                >
                  <i className="fas fa-drum"></i>
                  <span>Test Gong Chime</span>
                </button>

                <button
                  type="button"
                  className="btn-remote"
                  onClick={() => handleRemoteAction('test_cheer')}
                >
                  <i className="fas fa-bullhorn"></i>
                  <span>Test Cheer</span>
                </button>

                <button
                  type="button"
                  className="btn-remote"
                  onClick={() => handleRemoteAction('test_confetti')}
                >
                  <i className="fas fa-sparkles"></i>
                  <span>Test Confetti Burst</span>
                </button>

                <button
                  type="button"
                  className="btn-remote"
                  onClick={() => handleRemoteAction('force_reload')}
                >
                  <i className="fas fa-redo-alt"></i>
                  <span>Force Reload TVs</span>
                </button>

                <button
                  type="button"
                  className={`btn-remote fire ${powerHour ? 'active-fire' : ''}`}
                  onClick={() => handleRemoteAction('toggle_power_hour')}
                >
                  <i className="fas fa-fire"></i>
                  <span>{powerHour ? 'Power Hour ON' : 'Trigger Power Hour'}</span>
                </button>
              </div>

              <div style={{ marginTop: '1.2rem', padding: '0.9rem', background: '#f8fafc', borderRadius: '0.8rem', border: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#64748b' }}>
                <i className="fas fa-info-circle text-primary"></i> <b>Tip:</b> Audio tests play on every device currently displaying the TV screen with audio unlocked.
              </div>
            </div>

            {/* Direct Admin Lead & Sale Injection */}
            <div className="command-section">
              <h3><i className="fas fa-plus-circle text-primary"></i> Direct Entry / Quick Sale</h3>
              <p className="command-desc">
                Inject a sale or lead status directly as Admin. Instantly triggers celebration bell on TV!
              </p>

              <form onSubmit={handleQuickSale}>
                <div className="form-group" style={{ marginBottom: '0.8rem' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 700 }}>Select Telecaller</label>
                  <select
                    value={quickTcId}
                    onChange={(e) => setQuickTcId(e.target.value)}
                    required
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '0.5rem', border: '1px solid #cbd5e1' }}
                  >
                    <option value="">-- Choose Telecaller --</option>
                    {users.filter(u => u.role === 'telecaller' && u.active).map(tc => (
                      <option key={tc.id} value={tc.id}>
                        {tc.name} ({tc.program_name || 'No Program'} · TL: {tc.tl_name || 'None'})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: '0.8rem' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 700 }}>Status</label>
                  <select
                    value={quickStatusCode}
                    onChange={(e) => setQuickStatusCode(e.target.value)}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '0.5rem', border: '1px solid #cbd5e1' }}
                  >
                    {statuses.filter(s => s.active).map(st => (
                      <option key={st.id} value={st.code}>
                        {st.label} {st.is_sale ? '⭐ (Sale)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 700 }}>Lead Reference / Customer Note (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Lead #98234 or Priya S."
                    value={quickLeadRef}
                    onChange={(e) => setQuickLeadRef(e.target.value)}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '0.5rem', border: '1px solid #cbd5e1' }}
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                  disabled={quickSaving || !quickTcId}
                >
                  {quickSaving ? 'Recording…' : '🚀 Record Status & Fire TV Celebration'}
                </button>
              </form>
            </div>

            {/* System Health & One-Click Backup */}
            <div className="command-section">
              <h3><i className="fas fa-server text-primary"></i> System Health & Database</h3>
              <p className="command-desc">
                Live SQLite status, active WebSocket displays, and instant database backup download.
              </p>

              {systemHealth ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginBottom: '1.2rem' }}>
                  <div style={{ background: '#f8fafc', padding: '0.8rem', borderRadius: '0.6rem', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700 }}>DB STORAGE</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#0f172a' }}>{systemHealth.db_size_formatted}</div>
                  </div>
                  <div style={{ background: '#f8fafc', padding: '0.8rem', borderRadius: '0.6rem', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700 }}>CONNECTED SCREENS</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#2563eb' }}>{systemHealth.active_connections} Live</div>
                  </div>
                  <div style={{ background: '#f8fafc', padding: '0.8rem', borderRadius: '0.6rem', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700 }}>TOTAL EVENTS</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#0f172a' }}>{systemHealth.total_events}</div>
                  </div>
                  <div style={{ background: '#f8fafc', padding: '0.8rem', borderRadius: '0.6rem', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700 }}>LIFETIME SALES</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#059669' }}>{systemHealth.total_sales}</div>
                  </div>
                </div>
              ) : (
                <div style={{ color: '#64748b', fontSize: '0.85rem' }}>Loading health metrics…</div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.6rem' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={downloadBackup}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem', fontSize: '0.85rem', padding: '0.65rem 0.8rem' }}
                    title="Download raw SQLite database file"
                  >
                    <i className="fas fa-download"></i> Download .db
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={exportJsonBackup}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem', fontSize: '0.85rem', padding: '0.65rem 0.8rem' }}
                    title="Export complete database as portable JSON"
                  >
                    <i className="fas fa-file-export"></i> Export JSON Backup
                  </button>
                </div>

                <label
                  className="btn"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    padding: '0.65rem 1rem',
                    background: '#fdf4ff',
                    border: '1.5px solid #f0abfc',
                    color: '#a21caf',
                    fontWeight: 700,
                    borderRadius: '0.6rem',
                    margin: 0,
                  }}
                  title="Upload a previously exported JSON backup to restore all records"
                >
                  <i className="fas fa-upload"></i> Restore from JSON Backup
                  <input
                    type="file"
                    accept=".json"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleRestoreFile(f);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* USERS TAB */}
        {tab === 'users' && (
          <div className="admin-card">
            <div className="card-top">
              <h2>Users Management ({users.length})</h2>
              <div className="card-actions">
                <button className="btn" onClick={() => setModal('import_csv')}>Bulk CSV Import</button>
                <button className="btn btn-primary" onClick={() => setModal('user_new')}>+ Add User</button>
              </div>
            </div>

            <table className="admin-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Program</th>
                  <th>TL</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={u.active ? '' : 'row-inactive'}>
                    <td><code>{u.employee_code}</code></td>
                    <td><b>{u.name}</b></td>
                    <td><span className={`pill role-${u.role}`}>{u.role}</span></td>
                    <td>{u.program_name || '—'}</td>
                    <td>{u.tl_name || '—'}</td>
                    <td>{u.active ? <span className="pill green">Active</span> : <span className="pill red">Inactive</span>}</td>
                    <td>
                      <button
                        className="btn-sm"
                        onClick={() => {
                          setEditingItem(u);
                          setModal('user_edit');
                        }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* PROGRAMS TAB */}
        {tab === 'programs' && (
          <div className="admin-card">
            <div className="card-top">
              <h2>Programs & Daily Targets ({programs.length})</h2>
              <button className="btn btn-primary" onClick={() => setModal('program_new')}>+ Add Program</button>
            </div>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Program Name</th>
                  <th>Daily Target</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {programs.map((p) => (
                  <tr key={p.id}>
                    <td>#{p.id}</td>
                    <td><b>{p.name}</b></td>
                    <td><span className="pill blue">{p.daily_target} sales</span></td>
                    <td>{p.active ? <span className="pill green">Active</span> : <span className="pill red">Inactive</span>}</td>
                    <td>
                      <button
                        className="btn-sm"
                        onClick={async () => {
                          const newTarget = prompt(`Set daily target for ${p.name}:`, p.daily_target);
                          if (newTarget !== null) {
                            await api(`/api/admin/programs/${p.id}`, {
                              method: 'PATCH',
                              token,
                              body: { daily_target: Number(newTarget) || 0 },
                            });
                            fetchAll();
                          }
                        }}
                      >
                        Update Target
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* STATUSES TAB */}
        {tab === 'statuses' && (
          <div className="admin-card">
            <div className="card-top">
              <h2>Status Configuration ({statuses.length})</h2>
              <button className="btn btn-primary" onClick={() => setModal('status_new')}>+ Add Status</button>
            </div>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Label</th>
                  <th>Is Sale?</th>
                  <th>Sound</th>
                  <th>Color</th>
                  <th>Order</th>
                  <th>Show in Feed</th>
                </tr>
              </thead>
              <tbody>
                {statuses.map((s) => (
                  <tr key={s.id}>
                    <td><code>{s.code}</code></td>
                    <td><b>{s.label}</b></td>
                    <td>{s.is_sale ? <span className="pill green">Yes (Counts as Sale)</span> : <span className="pill gray">No</span>}</td>
                    <td>{s.sound || '—'}</td>
                    <td>
                      <div className="color-swatch" style={{ background: s.color }}>
                        {s.color}
                      </div>
                    </td>
                    <td>{s.sort_order}</td>
                    <td>{s.show_in_feed ? '✓' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* SETTINGS TAB */}
        {tab === 'settings' && (
          <div className="admin-card">
            <h2>Audio & Display Settings</h2>
            <form onSubmit={saveSettings} className="settings-form">
              <div className="form-group">
                <label>Sound System</label>
                <select
                  value={settings.sound_enabled ?? '1'}
                  onChange={(e) => setSettings({ ...settings, sound_enabled: e.target.value })}
                >
                  <option value="1">Enabled (Active)</option>
                  <option value="0">Disabled (Global Mute)</option>
                </select>
              </div>

              <div className="form-group">
                <label>Normal Volume (0.0 to 1.0)</label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={settings.normal_volume ?? '1'}
                  onChange={(e) => setSettings({ ...settings, normal_volume: e.target.value })}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Quiet Hours Start</label>
                  <input
                    type="time"
                    value={settings.quiet_start ?? '22:00'}
                    onChange={(e) => setSettings({ ...settings, quiet_start: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Quiet Hours End</label>
                  <input
                    type="time"
                    value={settings.quiet_end ?? '07:00'}
                    onChange={(e) => setSettings({ ...settings, quiet_end: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Quiet Hours Volume (0.0 to 1.0)</label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={settings.quiet_volume ?? '0.3'}
                  onChange={(e) => setSettings({ ...settings, quiet_volume: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>TV Performer Rotation Interval (Seconds)</label>
                <input
                  type="number"
                  min="5"
                  max="120"
                  value={settings.tv_rotation_sec ?? '25'}
                  onChange={(e) => setSettings({ ...settings, tv_rotation_sec: e.target.value })}
                />
              </div>

              <button type="submit" className="btn btn-primary">Save Settings</button>
            </form>
          </div>
        )}

        {/* ENTRIES TAB */}
        {tab === 'entries' && (
          <div className="admin-card">
            <div className="card-top">
              <h2>Today's Status Entries ({events.length})</h2>
              <button className="btn-sm" onClick={fetchAll}>Refresh</button>
            </div>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Telecaller</th>
                  <th>Program</th>
                  <th>TL</th>
                  <th>Status</th>
                  <th>Ref</th>
                  <th>State</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className={e.voided ? 'row-voided' : ''}>
                    <td>{new Date(e.created_at).toLocaleTimeString()}</td>
                    <td><b>{e.telecaller}</b></td>
                    <td>{e.program}</td>
                    <td>{e.tl}</td>
                    <td><span className={`pill ${e.is_sale ? 'green' : 'blue'}`}>{e.status}</span></td>
                    <td>{e.lead_ref || '—'}</td>
                    <td>
                      {e.voided ? (
                        <span className="pill red" title={e.void_reason}>
                          Voided ({e.void_reason})
                        </span>
                      ) : (
                        <span className="pill green">Active</span>
                      )}
                    </td>
                    <td>
                      {!e.voided && (
                        <button
                          className="btn-sm btn-danger"
                          onClick={() => {
                            setVoidTarget(e);
                            setVoidReason('');
                          }}
                        >
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* AUDIT LOG TAB */}
        {tab === 'audit' && (
          <div className="admin-card">
            <h2>Audit Trail (Recent 150 Events)</h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map((a) => (
                  <tr key={a.id}>
                    <td>{new Date(a.created_at).toLocaleTimeString()}</td>
                    <td><b>{a.actor || 'System'}</b></td>
                    <td><code>{a.action}</code></td>
                    <td>{a.entity} #{a.entity_id || ''}</td>
                    <td><small>{a.details}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* BACKUP & EXPORT TAB */}
        {tab === 'export' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            {/* Hybrid 3-Tier Architecture Live Dashboard Card */}
            <div className="admin-card" style={{ border: '2px solid #6366f1', background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.6rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <i className="fas fa-server" style={{ fontSize: '1.5rem', color: '#4f46e5' }}></i>
                  <div>
                    <h2 style={{ margin: 0, color: '#0f172a' }}>Hybrid 3-Tier Enterprise Architecture</h2>
                    <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
                      In-Memory Engine + Cloud PostgreSQL + Automated Disk Recovery
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={fetchCloudSyncStatus}
                    style={{ fontSize: '0.82rem' }}
                    title="Refresh sync status"
                  >
                    <i className="fas fa-rotate"></i> Refresh
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleCloudPush}
                    disabled={cloudSyncBusy}
                    style={{ fontSize: '0.82rem', background: '#4f46e5', borderColor: '#4338ca' }}
                    title="Upload all floor records to Cloud PostgreSQL"
                  >
                    <i className={`fas ${cloudSyncBusy ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'}`}></i> Force Push to Cloud
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleCloudPull}
                    disabled={cloudSyncBusy}
                    style={{ fontSize: '0.82rem' }}
                    title="Hydrate local engine from Cloud PostgreSQL"
                  >
                    <i className="fas fa-cloud-arrow-down"></i> Hydrate from Cloud
                  </button>
                </div>
              </div>

              {cloudSyncMsg && (
                <div style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '0.65rem',
                  marginBottom: '1rem',
                  fontSize: '0.88rem',
                  fontWeight: 600,
                  background: cloudSyncMsg.startsWith('✅') ? '#ecfdf5' : '#fef2f2',
                  color: cloudSyncMsg.startsWith('✅') ? '#047857' : '#b91c1c',
                  border: `1.5px solid ${cloudSyncMsg.startsWith('✅') ? '#6ee7b7' : '#fca5a5'}`,
                }}>
                  {cloudSyncMsg}
                </div>
              )}

              {/* 3 Tier Architecture Cards Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.9rem', marginTop: '0.8rem' }}>
                {/* Tier 1 */}
                <div style={{ background: '#ffffff', border: '1.5px solid #e2e8f0', borderRadius: '0.75rem', padding: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#059669', letterSpacing: '0.05em' }}>
                      Tier 1: Speed Engine
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', fontWeight: 700, color: '#059669', background: '#dcfce7', padding: '0.2rem 0.55rem', borderRadius: '999px' }}>
                      ● Active (&lt;0.5ms)
                    </span>
                  </div>
                  <h4 style={{ margin: '0 0 0.3rem 0', color: '#0f172a' }}>In-Memory / WAL Cache</h4>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5 }}>
                    Zero-latency TV stream broadcast & instant sales closure execution for all 46 counselors and 108" TV screen.
                  </p>
                </div>

                {/* Tier 2 */}
                <div style={{ background: '#ffffff', border: `1.5px solid ${cloudSyncStatus?.tier2_cloud_postgresql?.connected ? '#6ee7b7' : '#cbd5e1'}`, borderRadius: '0.75rem', padding: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#2563eb', letterSpacing: '0.05em' }}>
                      Tier 2: Cloud Persistence
                    </span>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color: cloudSyncStatus?.tier2_cloud_postgresql?.connected ? '#047857' : '#d97706',
                      background: cloudSyncStatus?.tier2_cloud_postgresql?.connected ? '#dcfce7' : '#fef3c7',
                      padding: '0.2rem 0.55rem',
                      borderRadius: '999px'
                    }}>
                      {cloudSyncStatus?.tier2_cloud_postgresql?.connected ? '● Connected' : '○ Standby / Awaiting URL'}
                    </span>
                  </div>
                  <h4 style={{ margin: '0 0 0.3rem 0', color: '#0f172a' }}>Cloud PostgreSQL (Supabase / Neon)</h4>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5 }}>
                    {cloudSyncStatus?.tier2_cloud_postgresql?.connected
                      ? `Host: ${cloudSyncStatus.tier2_cloud_postgresql.host} (Queue: ${cloudSyncStatus.tier2_cloud_postgresql.pending_queue})`
                      : 'Add DATABASE_URL in Render Environment to link free Cloud PostgreSQL.'}
                  </p>
                  {cloudSyncStatus?.tier2_cloud_postgresql?.last_sync && (
                    <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: '#475569' }}>
                      Last Sync: {new Date(cloudSyncStatus.tier2_cloud_postgresql.last_sync).toLocaleTimeString()}
                    </div>
                  )}
                </div>

                {/* Tier 3 */}
                <div style={{ background: '#ffffff', border: '1.5px solid #e2e8f0', borderRadius: '0.75rem', padding: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#7c3aed', letterSpacing: '0.05em' }}>
                      Tier 3: Recovery Layer
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed', background: '#ede9fe', padding: '0.2rem 0.55rem', borderRadius: '999px' }}>
                      ● Active (Daily)
                    </span>
                  </div>
                  <h4 style={{ margin: '0 0 0.3rem 0', color: '#0f172a' }}>1-Click Offline Snapshots</h4>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5 }}>
                    Automated 24h backups and 1-Click portable JSON file download for offline disaster protection.
                  </p>
                </div>
              </div>
            </div>

            {/* Database Backup & Instant Restore (Option 3) Card */}
            <div className="admin-card" style={{ border: '2px solid #3b82f6', background: '#f8fafc' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                <i className="fas fa-shield-halved" style={{ fontSize: '1.5rem', color: '#2563eb' }}></i>
                <h2 style={{ margin: 0, color: '#0f172a' }}>Database Backup & Instant Restore</h2>
              </div>
              <p className="muted" style={{ fontSize: '0.92rem', marginBottom: '1rem' }}>
                Use this to keep all your sales closures, batch targets, and counselor inputs safe when software updates are deployed to Render.
              </p>

              {restoreStatus && (
                <div style={{
                  padding: '0.85rem 1rem',
                  borderRadius: '0.75rem',
                  marginBottom: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  background: restoreStatus.loading ? '#eff6ff' : restoreStatus.success ? '#ecfdf5' : '#fef2f2',
                  color: restoreStatus.loading ? '#1d4ed8' : restoreStatus.success ? '#047857' : '#b91c1c',
                  border: `1.5px solid ${restoreStatus.loading ? '#93c5fd' : restoreStatus.success ? '#6ee7b7' : '#fca5a5'}`,
                }}>
                  <i className={`fas ${restoreStatus.loading ? 'fa-spinner fa-spin' : restoreStatus.success ? 'fa-circle-check' : 'fa-circle-exclamation'}`}></i>
                  <span>{restoreStatus.msg}</span>
                </div>
              )}

              {/* 3 Step Instruction Box */}
              <div style={{
                background: '#ffffff',
                border: '1.5px solid #e2e8f0',
                borderRadius: '0.85rem',
                padding: '0.9rem 1.1rem',
                marginBottom: '1.2rem',
              }}>
                <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#334155', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <i className="fas fa-lightbulb text-amber"></i> How to use before making software updates:
                </div>
                <ol style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', color: '#475569', lineHeight: 1.6 }}>
                  <li>Click <b>"Export JSON Backup"</b> below to download your latest data file to your computer.</li>
                  <li>Deploy your changes to Render.</li>
                  <li>Return to this page, click <b>"Restore from JSON Backup"</b>, and select the file. All sales, batches, and counselors are restored immediately!</li>
                </ol>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.8rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={exportJsonBackup}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.55rem',
                    padding: '0.85rem 1.2rem',
                    fontSize: '0.95rem',
                    fontWeight: 800,
                    borderRadius: '0.75rem',
                    background: 'linear-gradient(135deg, #059669, #047857)',
                    borderColor: '#047857',
                    boxShadow: '0 4px 12px rgba(5, 150, 105, 0.25)',
                  }}
                  title="Export complete database into a portable JSON backup file"
                >
                  <i className="fas fa-file-export" style={{ fontSize: '1.1rem' }}></i>
                  <span>1. Export JSON Backup</span>
                </button>

                <label
                  className="btn"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.55rem',
                    padding: '0.85rem 1.2rem',
                    fontSize: '0.95rem',
                    fontWeight: 800,
                    borderRadius: '0.75rem',
                    cursor: 'pointer',
                    background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                    color: '#ffffff',
                    border: 'none',
                    boxShadow: '0 4px 12px rgba(124, 58, 237, 0.25)',
                    margin: 0,
                  }}
                  title="Upload a previously exported JSON backup to restore all records"
                >
                  <i className="fas fa-file-import" style={{ fontSize: '1.1rem' }}></i>
                  <span>2. Restore from JSON Backup</span>
                  <input
                    type="file"
                    accept=".json"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleRestoreFile(f);
                      e.target.value = '';
                    }}
                  />
                </label>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={downloadBackup}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    padding: '0.85rem 1.2rem',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    borderRadius: '0.75rem',
                  }}
                  title="Download raw SQLite database file (.db)"
                >
                  <i className="fas fa-database"></i>
                  <span>Download Raw .db</span>
                </button>
              </div>
            </div>

            {/* CSV Event Logs Export Card */}
            <div className="admin-card">
              <h2>Download Raw Event Data (CSV)</h2>
              <p className="muted">Export complete audit records and sales counts into standard CSV format for Excel.</p>
              <div className="form-row">
                <div className="form-group">
                  <label>From Date (IST)</label>
                  <input
                    type="date"
                    value={exportFrom}
                    onChange={(e) => setExportFrom(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>To Date (IST)</label>
                  <input
                    type="date"
                    value={exportTo}
                    onChange={(e) => setExportTo(e.target.value)}
                  />
                </div>
              </div>
              <a
                href={`/api/admin/export.csv?from=${exportFrom}&to=${exportTo}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary"
                style={{ display: 'inline-block', marginTop: '0.5rem' }}
              >
                <i className="fas fa-file-csv"></i> Download CSV Export
              </a>
            </div>
          </div>
        )}
      </main>

      {/* MODAL: VOID ENTRY */}
      {voidTarget && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Void Entry #{voidTarget.id}</h3>
            <p>Telecaller: <b>{voidTarget.telecaller}</b> · Status: <b>{voidTarget.status}</b></p>
            <form onSubmit={submitVoid}>
              <div className="form-group">
                <label>Reason for voiding (Required for audit log)</label>
                <input
                  placeholder="e.g. Mistyped status, Customer cancelled, Duplicate entry"
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setVoidTarget(null)}>Cancel</button>
                <button type="submit" className="btn btn-danger">Confirm Void</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: BULK CSV IMPORT */}
      {modal === 'import_csv' && (
        <div className="modal-backdrop">
          <div className="modal modal-lg">
            <h3>Bulk User CSV Import</h3>
            <p className="muted">
              Paste CSV with columns: <code>name,role,employee_code,program,tl_code,pin</code>
            </p>
            <textarea
              className="csv-area"
              rows={8}
              placeholder="name,role,employee_code,program,tl_code,pin&#10;Amit Kumar,telecaller,TC101,Program A,TL001,&#10;Sunita Rao,tl,TL005,Program B,,123456"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
            />
            {importErr && <div className="err">{importErr}</div>}

            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button type="button" className="btn" onClick={previewCsv} disabled={!csvText.trim()}>
                Preview Validation
              </button>
              {importPreview && importPreview.valid > 0 && importPreview.invalid === 0 && (
                <button type="button" className="btn btn-primary" onClick={commitCsv}>
                  Commit Import ({importPreview.valid} users)
                </button>
              )}
            </div>

            {importPreview && (
              <div className="import-results">
                <h4>Validation Summary: {importPreview.valid} valid, {importPreview.invalid} errors</h4>
                {importPreview.errors.length > 0 && (
                  <div className="err-list">
                    {importPreview.errors.map((er, idx) => (
                      <div key={idx} className="err-item">
                        Row {er.line} ({er.name}): {er.errors.join(', ')}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: ADD USER */}
      {modal === 'user_new' && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Add New User</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.target;
                try {
                  await api('/api/admin/users', {
                    method: 'POST',
                    token,
                    body: {
                      name: form.name.value,
                      role: form.role.value,
                      employee_code: form.employee_code.value,
                      pin: form.pin.value || null,
                      program_id: form.program_id.value || null,
                      tl_id: form.tl_id.value || null,
                      photo_url: form.photo_url.value || null,
                    },
                  });
                  setModal(null);
                  fetchAll();
                } catch (err) {
                  alert(err.message);
                }
              }}
            >
              <div className="form-group">
                <label>Name</label>
                <input name="name" required autoFocus />
              </div>
              <div className="form-group">
                <label>Role</label>
                <select name="role" required>
                  <option value="telecaller">Telecaller</option>
                  <option value="tl">Team Leader (TL)</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>
              <div className="form-group">
                <label>Employee Code</label>
                <input name="employee_code" required />
              </div>
              <div className="form-group">
                <label>PIN (for Admin & TL)</label>
                <input name="pin" type="password" />
              </div>
              <div className="form-group">
                <label>Program</label>
                <select name="program_id">
                  <option value="">None</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Team Leader (TL)</label>
                <select name="tl_id">
                  <option value="">None</option>
                  {users.filter((u) => u.role === 'tl').map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({t.employee_code})</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Photo URL (Optional)</label>
                <input name="photo_url" placeholder="https://..." />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create User</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT USER */}
      {modal === 'user_edit' && editingItem && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Edit User: {editingItem.name}</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.target;
                const body = {
                  name: form.name.value,
                  role: form.role.value,
                  program_id: form.program_id.value ? Number(form.program_id.value) : null,
                  tl_id: form.tl_id.value ? Number(form.tl_id.value) : null,
                  photo_url: form.photo_url.value || null,
                  active: form.active.value === '1' ? 1 : 0,
                };
                if (form.pin.value) {
                  body.pin = form.pin.value;
                }
                try {
                  await api(`/api/admin/users/${editingItem.id}`, {
                    method: 'PATCH',
                    token,
                    body,
                  });
                  setModal(null);
                  setEditingItem(null);
                  fetchAll();
                } catch (err) {
                  alert(err.message);
                }
              }}
            >
              <div className="form-group">
                <label>Name</label>
                <input name="name" defaultValue={editingItem.name} required />
              </div>
              <div className="form-group">
                <label>Role</label>
                <select name="role" defaultValue={editingItem.role}>
                  <option value="telecaller">Telecaller</option>
                  <option value="tl">Team Leader (TL)</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>
              <div className="form-group">
                <label>Status</label>
                <select name="active" defaultValue={editingItem.active ? '1' : '0'}>
                  <option value="1">Active</option>
                  <option value="0">Inactive / Deactivated</option>
                </select>
              </div>
              <div className="form-group">
                <label>Reset PIN (Leave blank to keep current)</label>
                <input name="pin" type="password" placeholder="New PIN" />
              </div>
              <div className="form-group">
                <label>Program</label>
                <select name="program_id" defaultValue={editingItem.program_id || ''}>
                  <option value="">None</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Assigned Team Leader</label>
                <select name="tl_id" defaultValue={editingItem.tl_id || ''}>
                  <option value="">None</option>
                  {users.filter((u) => u.role === 'tl').map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({t.employee_code})</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Photo URL</label>
                <input name="photo_url" defaultValue={editingItem.photo_url || ''} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => { setModal(null); setEditingItem(null); }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD PROGRAM */}
      {modal === 'program_new' && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Add New Program</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.target;
                try {
                  await api('/api/admin/programs', {
                    method: 'POST',
                    token,
                    body: {
                      name: form.name.value,
                      daily_target: Number(form.daily_target.value) || 0,
                    },
                  });
                  setModal(null);
                  fetchAll();
                } catch (err) {
                  alert(err.message);
                }
              }}
            >
              <div className="form-group">
                <label>Program Name</label>
                <input name="name" required autoFocus placeholder="e.g. Program D" />
              </div>
              <div className="form-group">
                <label>Daily Sales Target</label>
                <input name="daily_target" type="number" defaultValue="15" required />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Program</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
