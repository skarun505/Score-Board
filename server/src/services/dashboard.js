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

  const badges = {};
  for (const row of todayRows) {
    const list = [];
    if (row.telecaller_id === firstSaleCallerId) {
      list.push({ code: 'first_sale', label: 'First Sale', icon: 'fas fa-medal' });
    }
    if (row.sales >= 5) {
      list.push({ code: 'closer', label: 'Closer', icon: 'fas fa-star' });
    }
    const ySales = ydayMap[row.telecaller_id] || 0;
    if (row.sales > ySales && (ySales > 0 || row.sales >= 2)) {
      list.push({ code: 'comeback', label: 'Comeback', icon: 'fas fa-rocket' });
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

  const programRows = programs.map((p) => {
    const mine = counts.filter((c) => c.program_id === p.id);
    const sales = mine.filter((c) => c.is_sale).reduce((a, c) => a + c.n, 0);
    const y = ydayMap[p.id] || 0;
    const streak = streaksEnabled ? calculateProgramStreak(p.id, p.daily_target, today) : 0;
    return {
      ...p,
      sales,
      by_status: Object.fromEntries(mine.map((c) => [c.code, c.n])),
      yesterday_same_time: y,
      trend: sales > y ? 'up' : sales < y ? 'down' : 'flat',
      streak,
    };
  }).sort((a, b) => b.sales - a.sales);

  const monthSales = db.prepare(`
    SELECT COUNT(*) AS n FROM events e JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date BETWEEN ? AND ? AND e.voided = 0 AND s.is_sale = 1`).get(monthFrom, today).n;

  const weekSales = db.prepare(`
    SELECT COUNT(*) AS n FROM events e JOIN statuses s ON s.id = e.status_id
    WHERE e.business_date BETWEEN ? AND ? AND e.voided = 0 AND s.is_sale = 1`).get(weekFrom, today).n;

  // Weekly target = sum of each program's daily_target * 6 working days (Mon–Sat)
  const WEEK_DAYS = 6;
  const weekTarget = programRows.reduce((a, p) => a + (p.daily_target || 0), 0) * WEEK_DAYS;

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
  if (badgesEnabled) {
    topToday.forEach((t) => { t.badges = badges[t.id] || []; });
    topWeek.forEach((t) => { t.badges = badges[t.id] || []; });
  }

  const hotNow = hotNowEnabled ? calculateHotNow(now) : null;
  const nudges = nudgesEnabled ? calculateNudges(programRows) : [];
  const celebrationBanners = celebrationBannersEnabled ? calculateCelebrations(today) : [];

  const broadcastActive = settings.tv_broadcast_active === '1' && !!settings.tv_broadcast_message;
  const broadcast = broadcastActive ? {
    message: settings.tv_broadcast_message,
    style: settings.tv_broadcast_style || 'info'
  } : null;
  const powerHour = settings.power_hour_enabled === '1';

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
      sales: programRows.reduce((a, p) => a + p.sales, 0),
      target: programRows.reduce((a, p) => a + p.daily_target, 0),
      week_sales: weekSales,
      week_target: weekTarget,
      month_sales: monthSales,
    },
    programs: programRows,
    top_today: topToday,
    top_week: topWeek,
    feed,
    statuses,
    settings,
    broadcast,
    power_hour: powerHour,
    hourly_sales: hourlySales,
    inactive_teams: inactiveTeams,
    gamification: (streaksEnabled || badgesEnabled || hotNowEnabled || nudgesEnabled || celebrationBannersEnabled) ? {
      streaks_enabled: streaksEnabled,
      badges_enabled: badgesEnabled,
      hot_now_enabled: hotNowEnabled,
      nudges_enabled: nudgesEnabled,
      celebration_banners_enabled: celebrationBannersEnabled,
      hot_now: hotNow,
      nudges,
      celebrations: celebrationBanners,
    } : null,
  };
}
