import { db, ensureDefaultBatches } from '../src/db.js';
import bcrypt from 'bcryptjs';

const hash = (pin) => bcrypt.hashSync(String(pin), 10);

export const officialTLs = [
  { code: 'TL001', name: 'Tanmay Makhija' },
  { code: 'TL002', name: 'Sowmya Nagaraj' },
  { code: 'TL003', name: 'Saniya Farheen' },
  { code: 'TL004', name: 'Monjil Kakoti' },
];

export const officialProgramRoster = [
  // Team: Tanmay Makhija (TL001) - 13 Counselors
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
    name: 'Axis Ops',
    dailyTarget: 4,
    tlCode: 'TL001',
    counselors: [
      'Aparajita Mondal',
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

export function runSync() {
  console.log('--- Syncing DSA.xlsx Program & Counselor Roster ---');

  // Migrate legacy program names to official expanded names:
  // ABRL / Ops -> Axis Retail Lending / Axis Ops
  // Operation -> Axis Ops
  const oldAbrl = db.prepare("SELECT id FROM programs WHERE name = 'ABRL / Ops'").get();
  const oldOp = db.prepare("SELECT id FROM programs WHERE name = 'Operation'").get();

  // 1. Upsert Programs
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
      console.log(`Created new program: ${p.name} (id ${pid})`);
    } else {
      pid = prog.id;
      db.prepare('UPDATE programs SET active = 1, daily_target = ? WHERE id = ?').run(p.dailyTarget, pid);
    }
    progMap[p.name] = pid;
  }

  // Safely migrate any historical events and users from legacy names
  if (oldAbrl && progMap['Axis Retail Lending / Axis Ops']) {
    const newPid = progMap['Axis Retail Lending / Axis Ops'];
    db.prepare('UPDATE events SET program_id = ? WHERE program_id = ?').run(newPid, oldAbrl.id);
    db.prepare('UPDATE users SET program_id = ? WHERE program_id = ?').run(newPid, oldAbrl.id);
    db.prepare('UPDATE programs SET active = 0 WHERE id = ?').run(oldAbrl.id);
  }
  if (oldOp && progMap['Axis Ops']) {
    const newPid = progMap['Axis Ops'];
    db.prepare('UPDATE events SET program_id = ? WHERE program_id = ?').run(newPid, oldOp.id);
    db.prepare('UPDATE users SET program_id = ? WHERE program_id = ?').run(newPid, oldOp.id);
    db.prepare('UPDATE programs SET active = 0 WHERE id = ?').run(oldOp.id);
  }

  // 2. Ensure Team Leaders exist and point to valid primary programs
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

  // 3. Assign each Counselor to their exact Program and TL from DSA.xlsx
  let updatedCount = 0;
  let createdCount = 0;
  let nextTcNum = 1;

  for (const group of officialProgramRoster) {
    const pid = progMap[group.name];
    const tlId = tlMap[group.tlCode];

    for (const cName of group.counselors) {
      let existing = db.prepare("SELECT * FROM users WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))").get(cName);
      if (existing) {
        db.prepare(`
          UPDATE users
          SET program_id = ?, tl_id = ?, active = 1
          WHERE id = ?
        `).run(pid, tlId, existing.id);
        updatedCount++;
      } else {
        while (db.prepare('SELECT 1 FROM users WHERE employee_code = ?').get(`TC${String(nextTcNum).padStart(3, '0')}`)) {
          nextTcNum++;
        }
        const code = `TC${String(nextTcNum++).padStart(3, '0')}`;
        db.prepare(`
          INSERT INTO users (name, role, employee_code, pin_hash, program_id, tl_id, active)
          VALUES (?, 'telecaller', ?, ?, ?, ?, 1)
        `).run(cName, code, hash('111111'), pid, tlId);
        createdCount++;
      }
    }
  }

  console.log(`Counselor sync complete: ${updatedCount} updated, ${createdCount} created.`);

  // 4. Update existing events to point to the counselor's assigned program
  db.prepare(`
    UPDATE events
    SET program_id = (SELECT program_id FROM users WHERE id = events.telecaller_id)
    WHERE telecaller_id IN (SELECT id FROM users WHERE role = 'telecaller')
  `).run();

  // 5. Deactivate unused legacy programs (e.g. Bandhan (Monjil), Bandhan (Sowmya), Axis Ops, etc.)
  const validProgIds = Object.values(progMap);
  const validProgIdList = validProgIds.join(',');

  db.prepare(`
    UPDATE programs SET active = 0 WHERE id NOT IN (${validProgIdList})
  `).run();

  // 6. Ensure default batches exist for all 17 active programs
  ensureDefaultBatches();

  console.log(`Active programs count: ${validProgIds.length}`);
  console.log('DSA assignment completed successfully!');
}

if (process.argv[1]?.includes('sync_dsa.mjs')) {
  runSync();
}
