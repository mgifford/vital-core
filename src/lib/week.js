/**
 * All run grouping uses ISO 8601 weeks (e.g. "2026-W24").
 * The week can be overridden with VITAL_WEEK for deterministic tests.
 */

export function isoWeek(date = new Date()) {
  if (process.env.VITAL_WEEK) return process.env.VITAL_WEEK;
  return isoWeekOf(date);
}

export function isoWeekOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Thursday of the current week determines the ISO year.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Sort key: "2026-W09" < "2026-W24" lexicographically already, but be explicit. */
export function compareWeeks(a, b) {
  return a.localeCompare(b);
}

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

/**
 * Convert an ISO week string (e.g. "2026-W25") to a compact date stamp
 * anchored to the Monday of that week: "16JUN2026".
 * Used in download filenames so saved files carry date context.
 */
export function weekToDateStamp(weekStr) {
  // Parse year and week number.
  const m = /^(\d{4})-W(\d{1,2})$/.exec(weekStr);
  if (!m) return weekStr; // fall back to the raw string
  const year = Number(m[1]);
  const week = Number(m[2]);
  // ISO week 1 is the week containing the first Thursday of the year.
  // Monday of week W = Jan 4 of that year (always in W1) + (W-1)*7 days,
  // adjusted back to Monday.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7; // Mon=1 … Sun=7
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (dayOfWeek - 1) + (week - 1) * 7);
  const dd = String(monday.getUTCDate()).padStart(2, '0');
  const mon = MONTHS[monday.getUTCMonth()];
  const yyyy = monday.getUTCFullYear();
  return `${dd}${mon}${yyyy}`;
}

export function previousWeekOf(weekStr, weeks) {
  // Given a sorted list of known weeks, return the one immediately before weekStr.
  const sorted = [...weeks].sort(compareWeeks);
  const i = sorted.indexOf(weekStr);
  return i > 0 ? sorted[i - 1] : null;
}
