# Live Sales Dashboard Project Rules

You are building a 24/7 live sales dashboard for a 108-inch TV plus a mobile page for team leaders.
Always read DEVELOPMENT_GUIDE.md before working; it is the source of truth for scope, architecture and reference code.

Rules:
- Stack: Node 20+, Express, Socket.IO, better-sqlite3 (SQLite, WAL), React 18 + Vite. Do not add other frameworks or a different database without asking.
- Counts only on screen; never display money values anywhere.
- TLs enter data manually. Every change must be audit-logged (who, what, when).
- All timestamps stored as UTC ISO strings; business_date computed in Asia/Kolkata using DAY_START_HOUR.
- Never hardcode secrets. Use .env and keep .env.example updated.
- Validate all input on the server. Use parameterised SQL only.
- The TV must never silently show stale data: show "Data delayed" when disconnected or no update for 75 seconds.
- Keep the TV UI sized in em units relative to screen width, dark theme, high contrast, readable from 10 metres.
- Keep functions small, add comments only where the reason is not obvious, and keep the folder structure from section 5 of the guide.
- After each task: run the app, run tests, summarise what changed, and list anything you were unsure about.
