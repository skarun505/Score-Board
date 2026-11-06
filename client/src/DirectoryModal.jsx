import { useState, useEffect } from 'react';
import { api } from './api.js';

export default function DirectoryModal({ onSelectCode, onClose, roleFilter }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    api('/api/auth/directory')
      .then((d) => setUsers(d.users || []))
      .catch((err) => console.error('Directory fetch err:', err))
      .finally(() => setLoading(false));
  }, []);

  const filtered = users.filter((u) => {
    if (roleFilter && u.role !== roleFilter) return false;
    if (!q) return true;
    const term = q.toLowerCase();
    return (
      u.name.toLowerCase().includes(term) ||
      u.employee_code.toLowerCase().includes(term) ||
      (u.program_name && u.program_name.toLowerCase().includes(term)) ||
      (u.tl_name && u.tl_name.toLowerCase().includes(term))
    );
  });

  return (
    <div className="directory-modal-overlay" onClick={onClose}>
      <div className="directory-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="directory-modal-header">
          <div className="directory-title">
            <i className="fas fa-users-viewfinder" />
            <h3>Floor Login Directory</h3>
          </div>
          <button className="directory-close-btn" onClick={onClose} title="Close directory">
            <i className="fas fa-times" />
          </button>
        </div>
        <p className="directory-hint">
          Default security PIN for all accounts is <b>111111</b>. Tap your name to autofill your login.
        </p>
        <div className="directory-search-bar">
          <i className="fas fa-search" />
          <input
            autoFocus
            type="text"
            placeholder="Type your name, employee code, or team..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button className="clear-search" onClick={() => setQ('')}>
              <i className="fas fa-times" />
            </button>
          )}
        </div>
        <div className="directory-list-scroll">
          {loading ? (
            <div className="dir-loading">
              <i className="fas fa-spinner fa-spin" /> Loading team directory...
            </div>
          ) : filtered.length === 0 ? (
            <div className="dir-empty">No matching users found</div>
          ) : (
            filtered.map((u) => (
              <div
                key={u.id}
                className="dir-user-row"
                onClick={() => {
                  if (onSelectCode) onSelectCode(u.employee_code);
                  onClose();
                }}
                title="Click to autofill login code"
              >
                <div className="dir-user-code">
                  <code>{u.employee_code}</code>
                  <span className={`dir-role-pill ${u.role}`}>{u.role.toUpperCase()}</span>
                </div>
                <div className="dir-user-info">
                  <span className="dir-user-name">{u.name}</span>
                  <span className="dir-user-team">
                    {u.tl_name ? `TL: ${u.tl_name} · ` : ''}{u.program_name || 'Floor Operations'}
                  </span>
                </div>
                <button className="dir-select-btn">Select</button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

