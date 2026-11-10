/**
 * ISO-week helpers for retention planning.
 *
 * The planner works in UTC so a report run and a local dry run agree on week
 * boundaries. `isoWeekMonday` validates that the requested week actually exists
 * in that ISO year (2025 has 52 weeks; 2026 has 53), rather than treating
 * `W53` as a valid label for every year.
 */

export function isoWeekMonday(value) {
  const match = /^(\d{4})-W(\d{2})$/.exec(String(value));
  if (!match) throw new Error('Invalid ISO week');
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isInteger(year) || week < 1 || week > 53) throw new Error('Invalid ISO week');

  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1) + (week - 1) * 7);

  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  if (thursday.getUTCFullYear() !== year) throw new Error('ISO week outside year');
  return monday;
}

export function isoWeeksInYear(year) {
  const dec28 = new Date(Date.UTC(year, 11, 28));
  const day = dec28.getUTCDay() || 7;
  const thursday = new Date(dec28);
  thursday.setUTCDate(dec28.getUTCDate() + (4 - day));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstDay = firstThursday.getUTCDay() || 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() + (4 - firstDay));
  return Math.round((thursday - firstThursday) / 604800000) + 1;
}

/** Whole weeks between an ISO week's Monday and the UTC date of `now`. */
export function ageInWeeks(value, now = new Date()) {
  const monday = isoWeekMonday(value).getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - monday) / 604800000);
}
