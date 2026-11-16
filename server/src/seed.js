import bcrypt from 'bcryptjs';
import { db, ensureDefaultBatches } from './db.js';

const hash = (pin) => bcrypt.hashSync(String(pin), 10);

/* Statuses */
const statuses = [
  // code, label, is_sale, sound, color, sort_order, show_in_feed
  ['sale_closed', 'Sale Closed', 1, 'bell', '#10b981', 1, 1],
  ['interested', 'Interested', 0, 'chime', '#2563eb', 2, 1],
  ['follow_up', 'Follow-up', 0, 'soft', '#d97706', 3, 1],
  ['l1_selected', 'L1 Selected', 0, 'chime', '#7c3aed', 4, 1],
  ['l2_selected', 'L2 Selected', 0, 'chime', '#c026d3', 5, 1],
];
const insStatus = db.prepare(
  `INSERT INTO statuses (code,label,is_sale,sound,color,sort_order,show_in_feed)
   VALUES (?,?,?,?,?,?,?)
   ON CONFLICT(code) DO UPDATE SET
     label = excluded.label,
     is_sale = excluded.is_sale,
     sound = excluded.sound,
     color = excluded.color,
     sort_order = excluded.sort_order,
     show_in_feed = excluded.show_in_feed,
     active = 1`
);
statuses.forEach((s) => insStatus.run(...s));
db.prepare("UPDATE statuses SET active = 0 WHERE code IN ('callback', 'not_interested')").run();

/* Default settings */
const defaults = {
  sound_enabled: '1',
  normal_volume: '1',
  quiet_start: '22:00',
  quiet_end: '07:00',
  quiet_volume: '0.3',
  tv_rotation_sec: '25',
  gamification_enabled: '0',
  streaks_enabled: '0',
  badges_enabled: '0',
  hot_now_enabled: '0',
  nudges_enabled: '0',
  celebrations_banner_enabled: '0',
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)');
Object.entries(defaults).forEach(([k, v]) => insSetting.run(k, v));

/* Admin */
const adminCode = process.env.ADMIN_CODE || 'ADMIN';
if (!db.prepare('SELECT 1 FROM users WHERE employee_code = ?').get(adminCode)) {
  db.prepare(`INSERT INTO users (name, role, employee_code, pin_hash) VALUES (?,?,?,?)`)
    .run('Administrator', 'admin', adminCode, hash(process.env.ADMIN_PIN || '123456'));
  console.log(`Created admin ${adminCode}. CHANGE THE PIN IMMEDIATELY.`);
}

/* Check if DSA.xlsx roster is already applied */
const dsaCheck = db.prepare("SELECT 1 FROM programs WHERE name IN ('Axis Retail Lending / Axis Ops', 'ABRL / Ops') AND active = 1").get();
if (dsaCheck) {
  const existingTeamCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role IN ('tl', 'telecaller') AND active = 1").get()?.c || 0;
  if (existingTeamCount >= 46) {
    console.log(`Database already configured with official DSA.xlsx roster (${existingTeamCount} team members). Skipping seed to preserve live sales closures.`);
    db.prepare('DELETE FROM login_attempts').run();
    process.exit(0);
  }
}

/* Official Programs, Team Leaders, and Counselors from DSA.xlsx:
   4 Team Leaders:
   1. Tanmay Makhija (TL001) -> 4 Programs (HDFC Life, ABC, TATA AIG, Care) - 12 Counselors
   2. Sowmya Nagaraj (TL002) -> 5 Programs (Axis Retail Lending / Axis Ops, IDFC, Grihum, DCB, Mahindra) - 12 Counselors
   3. Saniya Farheen (TL003) -> 4 Programs (Kotak Sky, Kotak Ops, Kotak Next Gen, Kotak Ops / Sky) - 10 Counselors
   4. Monjil Kakoti (TL004) -> 3 Programs (ABYBP, Bandhan, ABYBP / Bandhan) - 12 Counselors

   Total: Exactly 16 distinct active programs across the floor, 4 TLs, 46 Counselors.
   (Note: Aparajita Mondal from operations team excluded from sales counselor roster).
*/
export const officialTLs = [
  { code: 'TL001', name: 'Tanmay Makhija' },
  { code: 'TL002', name: 'Sowmya Nagaraj' },
  { code: 'TL003', name: 'Saniya Farheen' },
  { code: 'TL004', name: 'Monjil Kakoti' },
];

export const officialProgramRoster = [
  // Team: Tanmay Makhija (TL001) - 12 Counselors
  {
    name: 'HDFC Life',
    dailyTarget: 8,
    tlCode: 'TL001',
    counselors: [
      'Suprith Arun Kumar',
      'Vinoth V Shekhar',
      'Sadath Baig',
      'Ayesha Amreen',
    ],
  },
  {
    name: 'ABC',
    dailyTarget: 8,
    tlCode: 'TL001',
    counselors: [
      'Ashwini Selva Kumar',
      'Mohammed Faisal',
      'Aman Bhardwaj',
      'Neha Shreya',
    ],
  },
  {
    name: 'TATA AIG',
    dailyTarget: 6,
    tlCode: 'TL001',
    counselors: [
      'Puja Choudhary',
      'Haniya Shariffa',
      'Gagan Babu',
    ],
  },
  {
    name: 'Care',
    dailyTarget: 4,
    tlCode: 'TL001',
    counselors: [
      'Yesuraj Emmanuel',
    ],
  },

  // Team: Sowmya Nagaraj (TL002) - 12 Counselors
  {
    name: 'Axis Retail Lending / Axis Ops',
    dailyTarget: 6,
    tlCode: 'TL002',
    counselors: [
      'Sushmitha Muniyallappa',
      'Monisha Mohan',
      'Bhavani Veeraiah',
    ],
  },
  {
    name: 'IDFC',
    dailyTarget: 8,
    tlCode: 'TL002',
    counselors: [
      'Shaik Shanawaz',
      'Priyanka Sundarraman',
      'Syed Arshur Rehman',
      'Shalini Ramanath Rao',
    ],
  },
  {
    name: 'Grihum',
    dailyTarget: 4,
    tlCode: 'TL002',
    counselors: [
      'Sandhya Narayanaswamy',
      'Afshan Khan',
    ],
  },
  {
    name: 'DCB',
    dailyTarget: 4,
    tlCode: 'TL002',
    counselors: [
      'Chethan Murali Naik',
      'Khathijatul Kubra',
    ],
  },
  {
    name: 'Mahindra',
    dailyTarget: 4,
    tlCode: 'TL002',
    counselors: [
      'Saira Hashamee',
    ],
  },

  // Team: Saniya Farheen (TL003) - 10 Counselors
  {
    name: 'Kotak Sky',
    dailyTarget: 4,
    tlCode: 'TL003',
    counselors: [
      'Vishal Karali',
    ],
  },
  {
    name: 'Kotak Ops',
    dailyTarget: 6,
    tlCode: 'TL003',
    counselors: [
      'Puni Priya',
      'Umme Kulsum',
      'Megha Chaithra',
    ],
  },
  {
    name: 'Kotak Next Gen',
    dailyTarget: 10,
    tlCode: 'TL003',
    counselors: [
      'Avathuf Begum',
      'Keshava Murthy',
      'Safar Jawed',
      'Rabiya Taj',
      'Aquib Ur Rahaman',
    ],
  },
  {
    name: 'Kotak Ops / Sky',
    dailyTarget: 4,
    tlCode: 'TL003',
    counselors: [
      'Harshith Venkatesh',
    ],
  },

  // Team: Monjil Kakoti (TL004) - 12 Counselors
  {
    name: 'ABYBP',
    dailyTarget: 18,
    tlCode: 'TL004',
    counselors: [
      'Ashwini Naveen',
      'Bantupalli Sravan Kumar',
      'Murapala Karthik',
      'Zainab Jahan',
      'Pritam Das',
      'Afeefa Afeefa',
      'Suhel Aktar',
      'Kriti Pandey',
      'Pawan Maddeshiya',
    ],
  },
  {
    name: 'Bandhan',
    dailyTarget: 4,
    tlCode: 'TL004',
    counselors: [
      'Veda Nagaraj',
      'Suprita Umesh',
    ],
  },
  {
    name: 'ABYBP / Bandhan',
    dailyTarget: 4,
    tlCode: 'TL004',
    counselors: [
      'Patnam Sushmitha',
    ],
  },
];

// Seed or update all 17 individual programs
const progMap = {};
for (const p of officialProgramRoster) {
  let prog = db.prepare('SELECT id FROM programs WHERE name = ?').get(p.name);
  let pid;
  if (!prog) {
    pid = Number(
      db.prepare('INSERT INTO programs (name, daily_target, active) VALUES (?,?,1)').run(
        p.name,
        p.dailyTarget
      ).lastInsertRowid
    );
  } else {
    pid = prog.id;
    db.prepare('UPDATE programs SET daily_target = ?, active = 1 WHERE id = ?').run(p.dailyTarget, pid);
  }
  progMap[p.name] = pid;
}

// Seed or update Team Leaders
const tlMap = {};
for (const tl of officialTLs) {
  let existing = db.prepare('SELECT id FROM users WHERE employee_code = ?').get(tl.code);
  let tlId;
  const primaryProgId = tl.code === 'TL001' ? progMap['HDFC Life']
    : tl.code === 'TL002' ? progMap['Axis Retail Lending / Axis Ops']
    : tl.code === 'TL003' ? progMap['Kotak Ops']
    : progMap['ABYBP'];

  if (!existing) {
    tlId = Number(
      db.prepare(
        `INSERT INTO users (name, role, employee_code, pin_hash, program_id, tl_id, active) VALUES (?,?,?,?,?,?,1)`
      ).run(tl.name, 'tl', tl.code, hash('111111'), primaryProgId, null).lastInsertRowid
    );
  } else {
    tlId = existing.id;
    db.prepare("UPDATE users SET name = ?, role = 'tl', program_id = ?, active = 1 WHERE id = ?").run(
      tl.name,
      primaryProgId,
      tlId
    );
  }
  tlMap[tl.code] = tlId;
}

// Seed or update all 47 Counselors with their individual program and TL from DSA.xlsx
let tcCounter = 1;
for (const group of officialProgramRoster) {
  const pid = progMap[group.name];
  const tlId = tlMap[group.tlCode];

  for (const cName of group.counselors) {
    let existing = db.prepare("SELECT * FROM users WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))").get(cName);
    if (!existing) {
      while (db.prepare('SELECT 1 FROM users WHERE employee_code = ?').get(`TC${String(tcCounter).padStart(3, '0')}`)) {
        tcCounter++;
      }
      const empCode = `TC${String(tcCounter++).padStart(3, '0')}`;
      db.prepare(
        `INSERT INTO users (name, role, employee_code, pin_hash, program_id, tl_id, active) VALUES (?,?,?,?,?,?,1)`
      ).run(cName, 'telecaller', empCode, hash('111111'), pid, tlId);
    } else {
      db.prepare(
        `UPDATE users SET name = ?, role = 'telecaller', program_id = ?, tl_id = ?, active = 1 WHERE id = ?`
      ).run(cName, pid, tlId, existing.id);
    }
  }
}

// Re-map any legacy events to valid program IDs
db.prepare(`
  UPDATE events
  SET program_id = (SELECT program_id FROM users WHERE id = events.telecaller_id)
  WHERE telecaller_id IN (SELECT id FROM users WHERE role = 'telecaller')
`).run();

// Clean up old legacy and duplicate placeholder programs
const validProgIds = Object.values(progMap);
const validProgIdList = validProgIds.join(',');
db.prepare(`
  UPDATE programs SET active = 0 WHERE id NOT IN (${validProgIdList})
`).run();

// Ensure default batches exist for all 17 active programs
ensureDefaultBatches();

console.log(`Configured exactly 17 distinct Programs from DSA.xlsx, 4 TLs (TL001-TL004), and 47 Counselors (TC001-TC047)`);

db.prepare('DELETE FROM login_attempts').run();
console.log('Seed complete.');
