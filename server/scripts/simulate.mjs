// Usage: node scripts/simulate.mjs TL001 111111
const BASE = process.env.BASE || 'http://localhost:4000';
const [code = 'TL001', pin = '111111'] = process.argv.slice(2);
const json = (r) => r.json();

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ employee_code: code, pin }),
}).then(json);
if (!login.token) throw new Error(`Login failed: ${JSON.stringify(login)}`);

const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };
const team = await fetch(`${BASE}/api/team`, { headers }).then(json);
const pool = ['sale_closed', 'interested', 'interested', 'follow_up', 'callback', 'not_interested', 'not_interested'];

console.log(`Simulating ${team.length} telecallers as ${login.user.name}. Ctrl+C to stop.`);
setInterval(async () => {
  try {
    const tc = team[Math.floor(Math.random() * team.length)];
    const status_code = Math.random() < 0.2 ? 'sale_closed' : pool[Math.floor(Math.random() * pool.length)];
    const res = await fetch(`${BASE}/api/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ telecaller_id: tc.id, status_code, confirm_duplicate: true }),
    });
    console.log(tc.name, status_code, res.status);
  } catch (err) {
    console.error('Simulate error:', err.message);
  }
}, 3000);
