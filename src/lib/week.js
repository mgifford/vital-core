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

export function previousWeekOf(weekStr, weeks) {
  // Given a sorted list of known weeks, return the one immediately before weekStr.
  const sorted = [...weeks].sort(compareWeeks);
  const i = sorted.indexOf(weekStr);
  return i > 0 ? sorted[i - 1] : null;
}
