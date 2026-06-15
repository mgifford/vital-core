/**
 * A single comparable accessibility score per domain, designed to drive
 * action — not to award a participation F to everyone.
 *
 * Why not "share of perfectly clean pages": with two strict engines
 * (axe + Alfa), almost every real government page has at least one minor
 * finding, so "perfectly clean" is ~0 everywhere and every site collapses
 * to F. That score differentiates nothing.
 *
 * Instead we score the TYPICAL page's burden — the median issues per page
 * — against realistic government-web benchmarks. This spreads sites
 * across a curve, rewards reducing the everyday burden (the thing teams
 * can actually act on), and makes an F genuinely rare and bad.
 *
 * Benchmark anchors (median axe+Alfa findings per page), from observed
 * government sites:
 *   ~0   -> 100   exceptional
 *   2    -> 90    (A) very good
 *   4    -> 80    (B) good
 *   6    -> 70    (C) typical / acceptable
 *   10   -> 55    (D) needs work
 *   16   -> 40    (F) poor
 *   30+  -> ~20   severe
 * A typical site lands around C, better and worse sites spread around it.
 */

// Piecewise-linear map from median issues/page to a 0-100 score, through
// the benchmark anchors above. Monotonic: fewer issues always scores higher.
const ANCHORS = [
  [0, 100], [2, 90], [4, 80], [6, 70], [10, 55], [16, 40], [30, 20], [60, 5],
];

function scoreFromDensity(median) {
  if (median <= 0) return 100;
  for (let i = 1; i < ANCHORS.length; i++) {
    const [x0, y0] = ANCHORS[i - 1];
    const [x1, y1] = ANCHORS[i];
    if (median <= x1) {
      const t = (median - x0) / (x1 - x0);
      return Math.round(y0 + t * (y1 - y0));
    }
  }
  return ANCHORS[ANCHORS.length - 1][1]; // floor for very high densities
}

export function scoreFor(summary) {
  const axePages = summary.axe?.pagesScanned ?? 0;
  const alfaPages = summary.alfa?.pagesScanned ?? 0;
  const auditedPages = summary.pagesAudited ?? Math.max(axePages, alfaPages);
  if (!auditedPages) return null;

  // The score is based on axe ALONE, deliberately:
  //  - axe runs on 100% of pages; Alfa is sampled (~30%), so Alfa's median
  //    is over a different, smaller page set — mixing two coverage levels
  //    into one number is unsound.
  //  - axe counts unique rule violations (stable, comparable across
  //    sites); Alfa counts individual failing elements, which inflates
  //    by an order of magnitude for one repeated pattern.
  // Alfa still runs and is reported separately as independent cross-engine
  // confirmation — it just doesn't skew the comparable score.
  const medianIssues = summary.axe?.medianViolations ?? 0;
  const score = scoreFromDensity(medianIssues);

  // Kept for context in the report copy (not part of the score).
  const dirtyPages = summary.axe?.pagesWithViolations ?? 0;
  const cleanShare = Math.round(Math.max(0, 1 - dirtyPages / auditedPages) * 100);

  return { score, grade: grade(score), band: band(score), medianIssues, cleanShare };
}

/**
 * Letter grade calibrated to the density scale above, so a typical
 * government site (~6 issues/page) lands at C — not F. An F now means
 * the typical page carries a heavy, unusual burden.
 */
export function grade(score) {
  if (score >= 85) return 'A';
  if (score >= 75) return 'B';
  if (score >= 65) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

/** Plain-language band label (avoids school-grade baggage where useful). */
export function band(score) {
  if (score >= 85) return 'Leading';
  if (score >= 75) return 'On track';
  if (score >= 65) return 'Typical';
  if (score >= 50) return 'Needs work';
  return 'At risk';
}

/**
 * One-line, plain explanation of what the score means and the single
 * highest-leverage next step, given the week's summary.
 */
export function scoreMeaning(summary, sc) {
  if (!sc) return '';
  const topAxe = topRule(summary.axe?.rules);
  const action = topAxe
    ? `Biggest lever: fix “${topAxe.id}” — it affects ${topAxe.pages} page(s).`
    : 'Keep the typical page’s issue count low.';
  return `The typical page has ${sc.medianIssues} axe violation(s). ${action}`;
}

function topRule(rules) {
  if (!rules) return null;
  let best = null;
  for (const [id, r] of Object.entries(rules)) {
    if (!best || r.pages > best.pages) best = { id, pages: r.pages };
  }
  return best;
}

/**
 * Trajectory of the score across a series of summaries: latest vs
 * `lookback` weeks earlier.
 */
export function trajectory(series, lookback = 4) {
  if (!series || series.length < 2) return null;
  const latest = scoreFor(series[series.length - 1]);
  const idx = Math.max(0, series.length - 1 - lookback);
  const past = scoreFor(series[idx]);
  if (!latest || !past) return null;
  const delta = latest.score - past.score;
  const direction = delta >= 3 ? 'improving' : delta <= -3 ? 'worsening' : 'stable';
  return { direction, delta, fromWeek: series[idx].week };
}
