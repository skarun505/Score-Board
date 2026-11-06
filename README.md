# Live Sales Dashboard (108" TV + Mobile TL Kiosk)

A 24/7 live sales dashboard designed for a 108-inch wall display with real-time audio celebrations (bell, gong, applause), burst merging, telecaller photo popups, mobile-first team leader quick updating, and an administrative portal.

---

## 1. Quick Start

### Prerequisites
- Node.js 20+ (Node 22 LTS or Node 24)
- npm 10+

### Quick Run on Windows (Without Docker)

You can run the server directly by double-clicking:
- **`start-server.bat`** in the project root!

Or run from the terminal root:
```bash
npm start
```

### Setup & Run Locally

1. **Install dependencies**:
   ```bash
   cd server && npm install
   cd ../client && npm install && npm run build
   ```
   *(Or from root: `npm run build`)*

2. **Configure Environment Variables**:
   In `server/.env`:
   ```bash
   PORT=4000
   JWT_SECRET=your-random-jwt-secret
   TV_KEY=your-tv-secret-key
   DB_PATH=./data/dashboard.db
   TZ_NAME=Asia/Kolkata
   DAY_START_HOUR=0
   UNDO_WINDOW_SEC=10
   DUPLICATE_WINDOW_SEC=20
   MILESTONE_EVERY=10
   CORS_ORIGIN=http://localhost:5173
   ADMIN_CODE=ADMIN
   ADMIN_PIN=123456
   ```

3. **Initialize Database**:
   ```bash
   npm run seed
   ```
   *Sets up admin account `ADMIN` (PIN `123456`), Team Leaders (PIN `111111`), and Counselors `TC001` to `TC016` (PIN `111111`).*

4. **Start the Production Server**:
   ```bash
   npm start
   ```
   *(Or double-click `start-server.bat`)*

---

## 2. Pages & Portals

| Screen | URL | Purpose & Credentials |
|---|---|---|
| **108" TV Display** | `/tv?key=<TV_KEY>&autosound=1` | Wallboard kiosk with live broadcast, animations & audio. No login required. |
| **Counselor Workstation** | `/counselor` | 1-tap call logger for Counselors (Interested, Follow-up, Callback, etc.). Logins: `TC001`–`TC016` / PIN: `111111`. |
| **TL Kiosk** | `/tl` | Team Leader management & team monitoring. Logins: `TL001`–`TL004` / PIN: `111111`. |
| **Admin Portal** | `/admin` | Programs, users, targets, audit logs & CSV export. Login: `ADMIN` / PIN: `123456`. |

### Programs & Team Leaders Roster

| Program | Team Leader | Daily Target | Counselor Logins (PIN: 111111) |
|---|---|---|---|
| **ABYB** | **Mojil** (`TL001`) | 25 | `TC001` (Aarav), `TC002` (Rohan), `TC003` (Pooja), `TC004` (Neha) |
| **HDFC** | **Tanmay** (`TL002`) | 20 | `TC005` (Vikram), `TC006` (Ananya), `TC007` (Karthik), `TC008` (Sneha) |
| **Kotak** | **Saniya** (`TL003`) | 18 | `TC009` (Farhan), `TC010` (Priya), `TC011` (Sameer), `TC012` (Riya) |
| **Axis Retail** | **Sowmya** (`TL004`) | 22 | `TC013` (Manoj), `TC014` (Kavya), `TC015` (Rahul), `TC016` (Deepak) |

---

## 3. Running with Docker

```bash
docker compose up -d --build
```
The service will start on port `4000` with automatic restarts and SQLite persistence mounted to `./data`.

---

## 4. Audio Celebrations & Sound Replacement

Sound files are located in `client/public/sounds/`:
- `bell.mp3`: Triggered on regular Sale Closed events.
- `gong.mp3`: Triggered on first sale of the day and every 10th milestone sale.
- `applause.mp3`: Triggered when a program hits its daily target.
- `chime.mp3`: Triggered on "Interested" engagement (half volume).
- `soft.mp3`: Triggered on "Follow-up" engagement (half volume).

To replace placeholder sounds with custom audio, drop 44.1kHz MP3 files (under 5 seconds) into `client/public/sounds/` and rebuild (`npm run build`).

---

## 5. TV Key Rotation

If the TV URL is leaked or needs rotation:
1. Generate a new key and update `TV_KEY` in `server/.env`.
2. Restart the server (`npm start` or `docker compose restart`).
3. Update `tv-kiosk.bat` / `tv-kiosk.sh` with the new key in the query parameter: `?key=NEW_KEY&autosound=1`.

---

## 6. Backups & Restore

### Online Backup
Run the backup script:
```bash
node scripts/backup.mjs
```
Backups are saved to `./backups/dashboard-YYYY-MM-DDTHH-mm-ss.db` using SQLite's online safe backup API.

### Restore
1. Stop the dashboard server.
2. Replace `./server/data/dashboard.db` with your selected backup file:
   ```powershell
   Copy-Item "backups/dashboard-<timestamp>.db" "server/data/dashboard.db"
   ```
3. Restart the server.

---

## 7. Testing & Verification

Run automated tests:
```bash
# Backend tests (ownership, duplicate guard, undo window, milestones, audit trail)
cd server && npm test

# Frontend unit tests (quiet hours logic, volume scaling)
cd ../client && npm test
```

To run the live event simulator:
```bash
cd server
node scripts/simulate.mjs TL001 111111
```
