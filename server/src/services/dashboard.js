import { db, businessDate } from '../db.js';

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function rankTelecallers(fromDate, toDate, limit = 10) {
  return db.prepare(`
    SELECT u.id, u.name, u.photo_url, p.name AS program,
           SUM(CASE WHEN s.is_sale = 1 THEN 1 ELSE 0 END) AS sales,
           COUNT(*) AS updates
    FROM events e
    JOIN users u ON u.id = e.telecaller_id
    JOIN programs p ON p.id = e.program_id
    JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date BETWEEN ? AND ? AND e.voided = 0
    GROUP BY u.id
    HAVING sales > 0
    ORDER BY sales DESC, updates ASC
    LIMIT ?`).all(fromDate, toDate, limit)
    .map((r) => ({ ...r, conversion: Math.round((r.sales / r.updates) * 100) }));
}

export function calculateProgramStreak(programId, dailyTarget, today, customDb = db) {
  if (!dailyTarget || dailyTarget <= 0) return 0;
  const rows = customDb.prepare(`
    SELECT e.business_date, COUNT(*) AS sales
    FROM events e
    JOIN statuses s ON s.id = e.status_id
    WHERE e.program_id = ? AND e.voided = 0 AND s.is_sale = 1 AND e.business_date <= ?
    GROUP BY e.business_date
    ORDER BY e.business_date DESC
    LIMIT 35
  `).all(programId, today);

  const salesByDate = Object.fromEntries(rows.map((r) => [r.business_date, r.sales]));
  let streak = 0;
  const d = new Date(today + 'T12:00:00Z');

  // Check today first
  const todaySales = salesByDate[today] || 0;
  if (todaySales >= dailyTarget) {
    streak++;
    d.setUTCDate(d.getUTCDate() - 1);
  } else {
    // If today hasn't hit target yet, check previous days from yesterday
    d.setUTCDate(d.getUTCDate() - 1);
  }

  // Count consecutive past days
  for (let i = 0; i < 30; i++) {
    const dateStr = d.toISOString().slice(0, 10);
    const daySales = salesByDate[dateStr] || 0;
    if (daySales >= dailyTarget) {
      streak++;
      d.setUTCDate(d.getUTCDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

export function calculateCounselorRankTier(salesToday = 0) {
  if (salesToday >= 8) {
    return {
      tier: 'Diamond Legend',
      level: 5,
      icon: 'fas fa-gem',
      color: '#06b6d4',
      badge_bg: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
      next_tier: 'Max Rank',
      sales_needed: 0,
      progress_pct: 100,
    };
  }
  if (salesToday >= 6) {
    return {
      tier: 'Gold Closer',
      level: 4,
      icon: 'fas fa-trophy',
      color: '#f59e0b',
      badge_bg: 'linear-gradient(135deg, #f59e0b, #d97706)',
      next_tier: 'Diamond Legend',
      sales_needed: 8 - salesToday,
      progress_pct: Math.round(((salesToday - 6) / 2) * 100),
    };
  }
  if (salesToday >= 4) {
    return {
      tier: 'Silver Closer',
      level: 3,
      icon: 'fas fa-medal',
      color: '#94a3b8',
      badge_bg: 'linear-gradient(135deg, #94a3b8, #64748b)',
      next_tier: 'Gold Closer',
      sales_needed: 6 - salesToday,
      progress_pct: Math.round(((salesToday - 4) / 2) * 100),
    };
  }
  if (salesToday >= 2) {
    return {
      tier: 'Bronze Closer',
      level: 2,
      icon: 'fas fa-award',
      color: '#d97706',
      badge_bg: 'linear-gradient(135deg, #d97706, #b45309)',
      next_tier: 'Silver Closer',
      sales_needed: 4 - salesToday,
      progress_pct: Math.round(((salesToday - 2) / 2) * 100),
    };
  }
  if (salesToday >= 1) {
    return {
      tier: 'Rookie Closer',
      level: 1,
      icon: 'fas fa-star',
      color: '#10b981',
      badge_bg: 'linear-gradient(135deg, #10b981, #059669)',
      next_tier: 'Bronze Closer',
      sales_needed: 1,
      progress_pct: 50,
    };
  }
  return {
    tier: 'Cadet',
    level: 0,
    icon: 'fas fa-shield',
    color: '#64748b',
    badge_bg: 'linear-gradient(135deg, #64748b, #475569)',
    next_tier: 'Rookie Closer',
    sales_needed: 1,
    progress_pct: 0,
  };
}

export function calculateOnFireUsers(now = new Date(), customDb = db) {
  const cutoff = new Date(now.getTime() - 60 * 60_000).toISOString();
  const rows = customDb.prepare(`
    SELECT u.id, u.name, u.photo_url, u.employee_code, p.name AS program, tl.name AS tl,
           COUNT(*) AS recent_sales,
           MAX(e.created_at) AS last_sale_at
    FROM events e
    JOIN users u ON u.id = e.telecaller_id
    JOIN programs p ON p.id = e.program_id
    JOIN users tl ON tl.id = e.tl_id
    JOIN statuses s ON s.id = e.status_id
    WHERE e.voided = 0 AND s.is_sale = 1 AND e.created_at >= ?
    GROUP BY u.id
    HAVING recent_sales >= 2
    ORDER BY recent_sales DESC, last_sale_at DESC
  `).all(cutoff);

  return rows.map((r) => ({
    ...r,
    level: r.recent_sales >= 3 ? 'inferno' : 'flame',
    label: r.recent_sales >= 3 ? '🔥 HAT-TRICK INFERNO' : '🔥 ON FIRE',
  }));
}

export function calculateTlArena(today, customDb = db) {
  const tls = customDb.prepare(`
    SELECT id, name, employee_code, photo_url
    FROM users
    WHERE role = 'tl' AND active = 1
    ORDER BY employee_code ASC
  `).all();

  const activeBatches = customDb.prepare(`
    SELECT id, program_id, name, target, start_date
    FROM batches
    WHERE active = 1
  `).all();
  const batchMap = Object.fromEntries(activeBatches.map((b) => [b.program_id, b]));

  const arenaTeams = tls.map((tl) => {
    const counselors = customDb.prepare(`
      SELECT u.id, u.name, u.photo_url, u.program_id, p.name as program_name, p.daily_target
      FROM users u
      LEFT JOIN programs p ON p.id = u.program_id
      WHERE u.tl_id = ? AND u.role = 'telecaller' AND u.active = 1
    `).all(tl.id);

    const progIds = [...new Set(counselors.map((c) => c.program_id).filter(Boolean))];

    const todaySales = customDb.prepare(`
      SELECT COUNT(*) as n FROM events e
      JOIN statuses s ON s.id = e.status_id
      WHERE e.tl_id = ? AND e.business_date = ? AND e.voided = 0 AND s.is_sale = 1
    `).get(tl.id, today)?.n || 0;

    let batchSales = 0;
    let batchTarget = 0;

    for (const pid of progIds) {
      const b = batchMap[pid];
      const pRow = customDb.prepare('SELECT daily_target FROM programs WHERE id = ?').get(pid);
      const target = b?.target || (pRow?.daily_target > 0 ? pRow.daily_target * 5 : 50);
      batchTarget += target;

      if (b?.id) {
        const bs = customDb.prepare(`
          SELECT COUNT(*) as n FROM events e
          JOIN statuses s ON s.id = e.status_id
          WHERE e.program_id = ? AND e.voided = 0 AND s.is_sale = 1
            AND (e.batch_id = ? OR e.created_at >= ?)
        `).get(pid, b.id, b.start_date || '2000-01-01')?.n || 0;
        batchSales += bs;
      } else {
        const bs = customDb.prepare(`
          SELECT COUNT(*) as n FROM events e
          JOIN statuses s ON s.id = e.status_id
          WHERE e.program_id = ? AND e.business_date = ? AND e.voided = 0 AND s.is_sale = 1
        `).get(pid, today)?.n || 0;
        batchSales += bs;
      }
    }

    const pct = batchTarget > 0 ? Math.round((batchSales / batchTarget) * 100) : 0;
    const avgPerCounselor = counselors.length > 0 ? Number((todaySales / counselors.length).toFixed(1)) : 0;

    const firstName = tl.name.split(' ')[0];
    const nick = tl.employee_code === 'TL001' || tl.name.includes('Tanmay') ? 'Titans'
      : tl.employee_code === 'TL002' || tl.name.includes('Sowmya') ? 'Spartans'
      : tl.employee_code === 'TL003' || tl.name.includes('Saniya') ? 'Strikers'
      : 'Mavericks';

    const color = tl.employee_code === 'TL001' || tl.name.includes('Tanmay') ? '#3b82f6'
      : tl.employee_code === 'TL002' || tl.name.includes('Sowmya') ? '#10b981'
      : tl.employee_code === 'TL003' || tl.name.includes('Saniya') ? '#8b5cf6'
      : '#f59e0b';

    return {
      tl_id: tl.id,
      tl_name: tl.name,
      tl_code: tl.employee_code,
      team_name: `Team ${firstName} ${nick}`,
      color,
      counselor_count: counselors.length,
      programs_count: progIds.length,
      today_sales: todaySales,
      batch_sales: batchSales,
      batch_target: batchTarget,
      target_pct: pct,
      avg_per_counselor: avgPerCounselor,
    };
  }).sort((a, b) => b.target_pct - a.target_pct || b.today_sales - a.today_sales);

  return arenaTeams.map((t, idx) => ({
    ...t,
    rank: idx + 1,
    trophy: idx === 0 ? '👑 1ST PLACE' : idx === 1 ? '🥈 2ND PLACE' : idx === 2 ? '🥉 3RD PLACE' : '4TH PLACE',
  }));
}

export function calculateBadges(today, yesterday, customDb = db) {
  const firstSaleRow = customDb.prepare(`
    SELECT e.telecaller_id
    FROM events e
    JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date = ? AND e.voided = 0 AND s.is_sale = 1
    ORDER BY e.id ASC
    LIMIT 1
  `).get(today);
  const firstSaleCallerId = firstSaleRow?.telecaller_id;

  const todayRows = customDb.prepare(`
    SELECT e.telecaller_id, COUNT(*) AS sales
    FROM events e
    JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date = ? AND e.voided = 0 AND s.is_sale = 1
    GROUP BY e.telecaller_id
  `).all(today);

  const ydayRows = customDb.prepare(`
    SELECT e.telecaller_id, COUNT(*) AS sales
    FROM events e
    JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date = ? AND e.voided = 0 AND s.is_sale = 1
    GROUP BY e.telecaller_id
  `).all(yesterday);
  const ydayMap = Object.fromEntries(ydayRows.map((r) => [r.telecaller_id, r.sales]));

  // Lifetime sales per telecaller for Century Club
  const lifetimeRows = customDb.prepare(`
    SELECT e.telecaller_id, COUNT(*) AS lifetime
    FROM events e
    JOIN statuses s ON s.id = e.status_id
    WHERE e.voided = 0 AND s.is_sale = 1
    GROUP BY e.telecaller_id
  `).all();
  const lifetimeMap = Object.fromEntries(lifetimeRows.map((r) => [r.telecaller_id, r.lifetime]));

  // Late evening clutch sales (after 18:30 IST)
  const clutchRows = customDb.prepare(`
    SELECT DISTINCT e.telecaller_id
    FROM events e
    JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date = ? AND e.voided = 0 AND s.is_sale = 1
      AND strftime('%H:%M', datetime(e.created_at, '+5 hours', '30 minutes')) >= '18:30'
  `).all(today);
  const clutchSet = new Set(clutchRows.map((r) => r.telecaller_id));

  const badges = {};
  for (const row of todayRows) {
    const list = [];
    if (row.telecaller_id === firstSaleCallerId) {
      list.push({ code: 'first_sale', label: '🌅 First Blood', icon: 'fas fa-medal', color: '#f59e0b' });
    }
    if (row.sales >= 5) {
      list.push({ code: 'closer', label: '⭐ Star Closer', icon: 'fas fa-star', color: '#eab308' });
    }
    const ySales = ydayMap[row.telecaller_id] || 0;
    if (row.sales > ySales && (ySales > 0 || row.sales >= 2)) {
      list.push({ code: 'comeback', label: '🚀 Comeback Kid', icon: 'fas fa-rocket', color: '#8b5cf6' });
    }
    if (row.sales >= 4) {
      list.push({ code: 'target_smasher', label: '🎯 Target Smasher', icon: 'fas fa-bullseye', color: '#10b981' });
    }
    if (clutchSet.has(row.telecaller_id)) {
      list.push({ code: 'clutch', label: '⏱️ Clutch Finisher', icon: 'fas fa-stopwatch', color: '#ef4444' });
    }
    const lifetime = lifetimeMap[row.telecaller_id] || 0;
    if (lifetime >= 25) {
      list.push({ code: 'century', label: `👑 Century Club (${lifetime})`, icon: 'fas fa-crown', color: '#f59e0b' });
    }
    if (list.length) badges[row.telecaller_id] = list;
  }
  return badges;
}

export function calculateHotNow(now = new Date(), customDb = db) {
  const cutoff = new Date(now.getTime() - 60 * 60_000).toISOString();
  return customDb.prepare(`
    SELECT u.id, u.name, u.photo_url, p.name AS program, COUNT(*) AS recent_sales
    FROM events e
    JOIN users u ON u.id = e.telecaller_id
    JOIN programs p ON p.id = e.program_id
    JOIN statuses s ON s.id = e.status_id
    WHERE e.voided = 0 AND s.is_sale = 1 AND e.created_at >= ?
    GROUP BY u.id
    HAVING recent_sales >= 2
    ORDER BY recent_sales DESC
    LIMIT 1
  `).get(cutoff) || null;
}

export function calculateNudges(programRows) {
  const nudges = [];
  for (let i = 0; i < programRows.length - 1; i++) {
    const higher = programRows[i];
    const lower = programRows[i + 1];
    if (higher.sales > lower.sales) {
      const diff = higher.sales - lower.sales;
      if (diff <= 4) {
        nudges.push(`${lower.name} is only ${diff} sale${diff > 1 ? 's' : ''} behind ${higher.name}!`);
      }
    }
  }
  return nudges;
}

export function calculateCelebrations(todayDateStr, customDb = db) {
  const users = customDb.prepare(`
    SELECT id, name, role, photo_url, birthday, hire_date
    FROM users
    WHERE active = 1 AND (birthday IS NOT NULL OR hire_date IS NOT NULL)
  `).all();

  const [yearStr, monthStr, dayStr] = todayDateStr.split('-');
  const mmdd = `${monthStr}-${dayStr}`;
  const currentYear = Number(yearStr);
  const banners = [];

  for (const u of users) {
    if (u.birthday) {
      const bmmdd = u.birthday.length === 5 ? u.birthday : u.birthday.slice(5);
      if (bmmdd === mmdd) {
        banners.push({ type: 'birthday', text: `Happy Birthday, ${u.name}!`, user: u });
      }
    }
    if (u.hire_date && u.hire_date.length >= 10) {
      const hmmdd = u.hire_date.slice(5, 10);
      const hYear = Number(u.hire_date.slice(0, 4));
      const years = currentYear - hYear;
      if (hmmdd === mmdd && years > 0) {
        banners.push({
          type: 'anniversary',
          text: `Happy ${years} Year Work Anniversary, ${u.name}!`,
          user: u,
        });
      }
    }
  }
  return banners;
}

export function getSnapshot() {
  const now = new Date();
  const today = businessDate(now);
  const weekFrom = businessDate(new Date(now.getTime() - 6 * 86400_000));
  const monthFrom = today.slice(0, 8) + '01';
  const sameTimeYesterday = new Date(now.getTime() - 86400_000);
  const yday = businessDate(sameTimeYesterday);
  const settings = getSettings();

  const statuses = db.prepare(
    `SELECT id, code, label, is_sale, sound, color FROM statuses WHERE active = 1 ORDER BY sort_order`
  ).all();

  const programs = db.prepare(`
    SELECT p.id, p.name, p.daily_target,
      (SELECT group_concat(name, ', ') FROM users
        WHERE role = 'tl' AND program_id = p.id AND active = 1) AS tl_name
    FROM programs p WHERE p.active = 1`).all();

  const counts = db.prepare(`
    SELECT e.program_id, s.code, s.is_sale, COUNT(*) AS n
    FROM events e JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date = ? AND e.voided = 0
    GROUP BY e.program_id, s.code`).all(today);

  const ydayRows = db.prepare(`
    SELECT e.program_id, COUNT(*) AS n
    FROM events e JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date = ? AND e.voided = 0 AND s.is_sale = 1 AND e.created_at <= ?
    GROUP BY e.program_id`).all(yday, sameTimeYesterday.toISOString());
  const ydayMap = Object.fromEntries(ydayRows.map((r) => [r.program_id, r.n]));

  const streaksEnabled = settings.gamification_enabled === '1' || settings.streaks_enabled === '1';
  const badgesEnabled = settings.gamification_enabled === '1' || settings.badges_enabled === '1';
  const hotNowEnabled = settings.gamification_enabled === '1' || settings.hot_now_enabled === '1';
  const nudgesEnabled = settings.gamification_enabled === '1' || settings.nudges_enabled === '1';
  const celebrationBannersEnabled = settings.gamification_enabled === '1' || settings.celebrations_banner_enabled === '1';

  // Active batches per program
  const activeBatches = db.prepare(`
    SELECT id, program_id, name, target, start_date
    FROM batches
    WHERE active = 1
  `).all();
  const batchMap = Object.fromEntries(activeBatches.map((b) => [b.program_id, b]));

  const programRows = programs.map((p) => {
    const mine = counts.filter((c) => c.program_id === p.id);
    const todaySales = mine.filter((c) => c.is_sale).reduce((a, c) => a + c.n, 0);
    const activeBatch = batchMap[p.id];
    const batchName = activeBatch?.name || 'Batch 1';
    const batchTarget = activeBatch?.target || (p.daily_target > 0 ? p.daily_target * 5 : 50);
    const batchId = activeBatch?.id || null;

    let batchSales = 0;
    if (batchId) {
      const bRow = db.prepare(`
        SELECT COUNT(*) AS n FROM events e
        JOIN statuses s ON s.id = e.status_id
        WHERE e.program_id = ? AND e.voided = 0 AND s.is_sale = 1
          AND (e.batch_id = ? OR e.created_at >= ?)
      `).get(p.id, batchId, activeBatch.start_date || '2000-01-01');
      batchSales = bRow?.n || 0;
    } else {
      batchSales = todaySales;
    }

    const y = ydayMap[p.id] || 0;
    const streak = streaksEnabled ? calculateProgramStreak(p.id, batchTarget, today) : 0;
    return {
      ...p,
      batch_id: batchId,
      batch_name: batchName,
      batch_target: batchTarget,
      batch_sales: batchSales,
      sales: batchSales,
      today_sales: todaySales,
      daily_target: batchTarget,
      target: batchTarget,
      by_status: Object.fromEntries(mine.map((c) => [c.code, c.n])),
      yesterday_same_time: y,
      trend: todaySales > y ? 'up' : todaySales < y ? 'down' : 'flat',
      streak,
    };
  }).sort((a, b) => b.batch_sales - a.batch_sales || b.today_sales - a.today_sales);

  // Program-wise champions: rank counselors in each program for 30s TV rotation
  const programChampions = programRows.map((p) => {
    const callers = db.prepare(`
      SELECT u.id, u.name, u.photo_url, u.employee_code, p.name AS program,
             SUM(CASE WHEN s.is_sale = 1 THEN 1 ELSE 0 END) AS sales,
             COUNT(*) AS updates
      FROM events e
      JOIN users u ON u.id = e.telecaller_id
      JOIN programs p ON p.id = e.program_id
      JOIN statuses s ON s.id = e.status_id
      WHERE e.program_id = ? AND e.voided = 0
      GROUP BY u.id
      HAVING sales > 0
      ORDER BY sales DESC, updates ASC
      LIMIT 8
    `).all(p.id).map((r) => ({ ...r, conversion: Math.round((r.sales / (r.updates || 1)) * 100) }));

    return {
      program_id: p.id,
      program_name: p.name,
      batch_id: p.batch_id,
      batch_name: p.batch_name,
      batch_target: p.batch_target,
      batch_sales: p.batch_sales,
      top_performer: callers.length > 0 ? callers[0] : null,
      leaders: callers,
    };
  });

  const monthSales = db.prepare(`
    SELECT COUNT(*) AS n FROM events e JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date BETWEEN ? AND ? AND e.voided = 0 AND s.is_sale = 1`).get(monthFrom, today).n;

  const weekSales = db.prepare(`
    SELECT COUNT(*) AS n FROM events e JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date BETWEEN ? AND ? AND e.voided = 0 AND s.is_sale = 1`).get(weekFrom, today).n;

  const totalBatchTarget = programRows.reduce((a, p) => a + (p.batch_target || 0), 0);
  const totalBatchSales = programRows.reduce((a, p) => a + (p.batch_sales || 0), 0);
  const totalTodaySales = programRows.reduce((a, p) => a + (p.today_sales || 0), 0);

  const feed = db.prepare(`
    SELECT e.id, e.created_at, u.name AS telecaller, u.photo_url, p.name AS program,
           tl.name AS tl, s.code, s.label, s.is_sale
    FROM events e
    JOIN users u ON u.id = e.telecaller_id
    JOIN users tl ON tl.id = e.tl_id
    JOIN programs p ON p.id = e.program_id
    JOIN statuses s ON s.id = e.status_id
    WHERE e.voided = 0 AND e.business_date = ? AND s.show_in_feed = 1
    ORDER BY e.id DESC LIMIT 20`).all(today);

  const topToday = rankTelecallers(today, today, 10);
  const topWeek = rankTelecallers(weekFrom, today, 10);

  const badges = badgesEnabled ? calculateBadges(today, yday) : {};
  topToday.forEach((t) => {
    t.badges = badges[t.id] || [];
    t.tier = calculateCounselorRankTier(t.sales);
  });
  topWeek.forEach((t) => {
    t.badges = badges[t.id] || [];
    t.tier = calculateCounselorRankTier(t.sales);
  });

  const hotNow = hotNowEnabled ? calculateHotNow(now) : null;
  const onFireUsers = calculateOnFireUsers(now);
  const tlArena = calculateTlArena(today);
  const nudges = nudgesEnabled ? calculateNudges(programRows) : [];
  const celebrationBanners = celebrationBannersEnabled ? calculateCelebrations(today) : [];

  const broadcastActive = settings.tv_broadcast_active === '1' && !!settings.tv_broadcast_message;
  const broadcast = broadcastActive ? {
    message: settings.tv_broadcast_message,
    style: settings.tv_broadcast_style || 'info'
  } : null;

  // Hourly sales velocity for today (09:00 to 20:00 IST)
  const hourlyRows = db.prepare(`
    SELECT strftime('%H', datetime(e.created_at, '+5 hours', '30 minutes')) AS hr,
           COUNT(*) AS count
    FROM events e JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date = ? AND e.voided = 0 AND s.is_sale = 1
    GROUP BY hr
  `).all(today);
  const hourlySales = {};
  for (let h = 9; h <= 20; h++) {
    hourlySales[h] = 0;
  }
  hourlyRows.forEach((r) => {
    const hrNum = Number(r.hr);
    if (!isNaN(hrNum)) hourlySales[hrNum] = r.count;
  });

  // Inactive teams (> 45 mins without an update during shift)
  const lastUpdateRows = db.prepare(`
    SELECT tl.id AS tl_id, tl.name AS tl_name, MAX(e.created_at) AS last_update
    FROM users tl
    LEFT JOIN events e ON e.tl_id = tl.id AND e.business_date = ? AND e.voided = 0
    WHERE tl.role = 'tl' AND tl.active = 1
    GROUP BY tl.id
  `).all(today);
  const inactiveTeams = lastUpdateRows.map((r) => {
    const minsAgo = r.last_update
      ? Math.round((now.getTime() - new Date(r.last_update).getTime()) / 60000)
      : 999;
    return { tl_id: r.tl_id, tl_name: r.tl_name, last_update: r.last_update, mins_ago: minsAgo, inactive: minsAgo >= 45 };
  });

  return {
    generated_at: now.toISOString(),
    date: today,
    totals: {
      sales: totalBatchSales,
      target: totalBatchTarget,
      batch_sales: totalBatchSales,
      batch_target: totalBatchTarget,
      today_sales: totalTodaySales,
      week_sales: weekSales,
      week_target: totalBatchTarget,
      month_sales: monthSales,
    },
    programs: programRows,
    program_champions: programChampions,
    top_today: topToday,
    top_week: topWeek,
    feed,
    statuses,
    settings,
    broadcast,
    hourly_sales: hourlySales,
    inactive_teams: inactiveTeams,
    tl_arena: tlArena,
    on_fire: onFireUsers,
    gamification: {
      streaks_enabled: streaksEnabled,
      badges_enabled: badgesEnabled,
      hot_now_enabled: hotNowEnabled,
      nudges_enabled: nudgesEnabled,
      celebration_banners_enabled: celebrationBannersEnabled,
      hot_now: hotNow,
      on_fire: onFireUsers,
      tl_arena: tlArena,
      nudges,
      celebrations: celebrationBanners,
    },
  };
}
