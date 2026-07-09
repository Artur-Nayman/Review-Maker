const { execSync } = require('child_process');

const SHEET_ID = 'YOUR_SHEET_ID_HERE';

const SPRING_SUMMER_WINDOW_DAYS = 38;

function dateToDayOfYear(m, d) {
  const t = new Date(2000, m - 1, d);
  return Math.floor((t - new Date(2000, 0, 0)) / 86400000);
}

function isInSeason(m, d, start, end) {
  const today = dateToDayOfYear(m, d);
  const sStart = dateToDayOfYear(start.m, start.d);
  const sEnd = dateToDayOfYear(end.m, end.d);
  if (start.m > end.m) {
    return today >= sStart || today <= sEnd;
  }
  return today >= sStart && today <= sEnd;
}

function isBeforeThreshold(today, thresholdDay) {
  return today <= thresholdDay;
}

function getSeasonName(m, d, year) {
  const today = dateToDayOfYear(m, d);
  const summerStart = dateToDayOfYear(6, 21);
  const springSummerThreshold = summerStart - SPRING_SUMMER_WINDOW_DAYS;

  // Spring: Mar 20 - Jun 20
  const inSpring = isInSeason(m, d, { m: 3, d: 20 }, { m: 6, d: 20 });
  // Summer: Jun 21 - Sep 22
  const inSummer = isInSeason(m, d, { m: 6, d: 21 }, { m: 9, d: 22 });
  // Fall: Sep 23 - Dec 20
  const inFall = isInSeason(m, d, { m: 9, d: 23 }, { m: 12, d: 20 });
  // Winter: Dec 21 - Mar 19
  const inWinter = isInSeason(m, d, { m: 12, d: 21 }, { m: 3, d: 19 });

  if (inSpring && !isBeforeThreshold(today, springSummerThreshold)) {
    return `Spring-Summer ${year}`;
  }
  if (inSpring) return `Spring ${year}`;
  if (inSummer) return `Summer ${year}`;
  if (inFall) return `Fall ${year}`;
  if (inWinter) {
    const wyear = m <= 3 ? year : year + 1;
    return `Winter ${wyear}`;
  }
  return `Spring ${year}`;
}

function exec(cmd) {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

async function createSeasonTab() {
  const now = new Date();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const year = now.getFullYear();
  const tabName = getSeasonName(m, d, year);

  try {
    exec(`gog sheets metadata "${SHEET_ID}" --json`);
  } catch (e) {
    return { created: false, tabName, reason: 'metadata fetch failed', error: e.message };
  }

  const meta = JSON.parse(exec(`gog sheets metadata "${SHEET_ID}" --json`));
  const currentTabs = meta.sheets.map(s => s.properties.title);

  if (currentTabs.includes(tabName)) {
    return { created: false, tabName, reason: 'already exists' };
  }

  try {
    exec(`gog sheets add-tab "${SHEET_ID}" "${tabName}"`);
  } catch (e) {
    return { created: false, tabName, reason: 'add-tab failed', error: e.message };
  }

  const headers = JSON.stringify([['#', 'MR IID', 'Title', 'Type', 'Author', 'Assignee', 'Source Branch', 'Target Branch', 'Approved (👍👍👍)', 'Rev ID', 'How Much Approved', 'Merged', 'Linked Backlog #', 'User storie ID', 'Enabler ID', 'Final Status', 'Testing Status', 'URL', 'Created', 'Notes', 'Who Approved']]);

  try {
    exec(`gog sheets update "${SHEET_ID}" "${tabName}!A1:U1" --values-json '${headers}' --input USER_ENTERED`);
  } catch (e) {
    return { created: false, tabName, reason: 'header write failed', error: e.message };
  }

  return { created: true, tabName };
}

function getNextTabName() {
  const now = new Date();
  return getSeasonName(now.getMonth() + 1, now.getDate(), now.getFullYear());
}

module.exports = { createSeasonTab, getNextTabName };
