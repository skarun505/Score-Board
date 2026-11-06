import bcrypt from 'bcryptjs';
import { db } from './db.js';

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

/* Programs and Team Leaders from DSA.pdf:
   4 Team Leaders:
   1. Tanmay Makhija (TL001) -> 3 Programs (TATA AIG, HDFC Life, ABC)
   2. Sowmya Nagaraj (TL002) -> 7 Programs (Axis Ops, Axis Retail Lending, IDFC Emerging, IDFC Elevate, Bandhan, Mahindra, Grihum)
   3. Saniya Farheen (TL003) -> 3 Programs (Kotak Ops, Kotak Next Gen, Kotak Sky Premium)
   4. Monjil Kakoti (TL004) -> 2 Programs (Bandhan, ABYBP)

   Total: Exactly 15 distinct programs across the floor.
*/
export const officialTLs = [
  { code: 'TL001', name: 'Tanmay Makhija' },
  { code: 'TL002', name: 'Sowmya Nagaraj' },
  { code: 'TL003', name: 'Saniya Farheen' },
  { code: 'TL004', name: 'Monjil Kakoti' },
];

export const officialProgramRoster = [
  // Team 1: Tanmay Makhija (3 Programs, 13 Counselors)
  {
    name: 'TATA AIG',
    dailyTarget: 10,
    tlCode: 'TL001',
    counselors: [
      'Suprith Arun Kumar',
      'Aparajita Mondal',
      'Ashwini Selva Kumar',
      'Vinoth V Shekhar',
      'Puja Choudhary',
    ],
  },
  {
    name: 'HDFC Life',
    dailyTarget: 8,
    tlCode: 'TL001',
    counselors: [
      'Sadath Baig',
      'Mohammed Faisal',
      'Aman Bhardwaj',
      'Yesuraj Emmanuel',
    ],
  },
  {
    name: 'ABC',
    dailyTarget: 8,
    tlCode: 'TL001',
    counselors: [
      'Neha Shreya',
      'Haniya Shariffa',
      'Gagan Babu',
      'Ayesha Amreen',
    ],
  },

  // Team 2: Sowmya Nagaraj (7 Programs, 12 Counselors)
  {
    name: 'Axis Ops',
    dailyTarget: 4,
    tlCode: 'TL002',
    counselors: [
      'Sushmitha Muniyallappa',
      'Shaik Shanawaz',
    ],
  },
  {
    name: 'Axis Retail Lending',
    dailyTarget: 4,
    tlCode: 'TL002',
    counselors: [
      'Sandhya Narayanaswamy',
      'Priyanka Sundarraman',
    ],
  },
  {
    name: 'IDFC Emerging',
    dailyTarget: 4,
    tlCode: 'TL002',
    counselors: [
      'Syed Arshur Rehman',
      'Afshan Khan',
    ],
  },
  {
    name: 'IDFC Elevate',
    dailyTarget: 4,
    tlCode: 'TL002',
    counselors: [
      'Chethan Murali Naik',
      'Monisha Mohan',
    ],
  },
  {
    name: 'Bandhan (Sowmya)',
    dailyTarget: 4,
    tlCode: 'TL002',
    counselors: [
      'Saira Hashamee',
      'Bhavani Veeraiah',
    ],
  },
  {
    name: 'Mahindra',
    dailyTarget: 2,
    tlCode: 'TL002',
    counselors: [
      'Shalini Ramanath Rao',
    ],
  },
  {
    name: 'Grihum',
    dailyTarget: 2,
    tlCode: 'TL002',
    counselors: [
      'Khathijatul Kubra',
    ],
  },

  // Team 3: Saniya Farheen (3 Programs, 11 Counselors)
  {
    name: 'Kotak Ops',
    dailyTarget: 8,
    tlCode: 'TL003',
    counselors: [
      'Vishal Karali',
      'Puni Priya',
      'Avathuf Begum',
      'Keshava Murthy',
    ],
  },
  {
    name: 'Kotak Next Gen',
    dailyTarget: 8,
    tlCode: 'TL003',
    counselors: [
      'Safar Jawed',
      'Rabiya Taj',
      'Aquib Ur Rahaman',
      'Harshith Venkatesh',
    ],
  },
  {
    name: 'Kotak Sky Premium',
    dailyTarget: 6,
    tlCode: 'TL003',
    counselors: [
      'Umme Kulsum',
      'Megha Chaithra',
      'Ashwini Naveen',
    ],
  },

  // Team 4: Monjil Kakoti (2 Programs, 11 Counselors)
  {
    name: 'Bandhan (Monjil)',
    dailyTarget: 12,
    tlCode: 'TL004',
    counselors: [
      'Bantupalli Sravan Kumar',
      'Veda Nagaraj',
      'Murapala Karthik',
      'Zainab Jahan',
      'Pritam Das',
      'Afeefa Afeefa',
    ],
  },
  {
    name: 'ABYBP',
    dailyTarget: 10,
    tlCode: 'TL004',
    counselors: [
      'Suhel Aktar',
      'Patnam Sushmitha',
      'Suprita Umesh',
      'Kriti Pandey',
      'Pawan Maddeshiya',
    ],
  },
];

// Seed or update all 15 individual programs
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
  const primaryProgId = tl.code === 'TL001' ? progMap['TATA AIG']
    : tl.code === 'TL002' ? progMap['Axis Ops']
    : tl.code === 'TL003' ? progMap['Kotak Ops']
    : progMap['Bandhan (Monjil)'];

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

// Seed or update all 47 Counselors with their individual program and TL
let tcCounter = 1;
for (const group of officialProgramRoster) {
  const pid = progMap[group.name];
  const tlId = tlMap[group.tlCode];

  for (const cName of group.counselors) {
    const empCode = `TC${String(tcCounter++).padStart(3, '0')}`;
    const existing = db.prepare('SELECT id FROM users WHERE employee_code = ?').get(empCode);
    if (!existing) {
      db.prepare(
        `INSERT INTO users (name, role, employee_code, pin_hash, program_id, tl_id, active) VALUES (?,?,?,?,?,?,1)`
      ).run(cName, 'telecaller', empCode, hash('111111'), pid, tlId);
    } else {
      db.prepare(
        `UPDATE users SET name = ?, role = 'telecaller', pin_hash = COALESCE(pin_hash, ?), program_id = ?, tl_id = ?, active = 1 WHERE id = ?`
      ).run(cName, hash('111111'), pid, tlId, existing.id);
    }
  }
}

// Re-map any legacy events to valid program IDs
const validProgIds = Object.values(progMap);
const validProgIdList = validProgIds.join(',');
db.prepare(`
  UPDATE events SET program_id = (SELECT program_id FROM users WHERE id = events.telecaller_id)
  WHERE program_id NOT IN (${validProgIdList})
`).run();

// Clean up old legacy and duplicate placeholder programs so admin panel shows ONLY the 15 active programs
db.prepare(`
  DELETE FROM programs WHERE id NOT IN (${validProgIdList})
`).run();

console.log(`Configured exactly 15 distinct Programs, 4 TLs (TL001-TL004), and 47 Counselors (TC001-TC047)`);

db.prepare('DELETE FROM login_attempts').run();
console.log('Seed complete.');
