/**
 * A single comparable accessibility score per domain, so a non-expert can
 * see at a glance who is doing well and who is improving — with the loud
 * caveat that automated testing finds only ~a third of barriers, so a
 * high score is a floor, not a finish line.
 *
 * Score (0-100) is derived from a week's summary using two signals that
 * are comparable across sites of any size:
 *   - reach:    share of scanned pages with NO accessibility violation
 *               (axe or Alfa). Rewards broad cleanliness.
 *   - density:  the typical (median) number of issues on a page. Penalizes
 *               pages that are heavily affected.
 *
 * Both are page-normalized, so a 50-page site and a 5,000-page site are
 * judged on the same scale.
 */

export function scoreFor(summary) {
  const axePages = summary.axe?.pagesScanned ?? 0;
  const alfaPages = summary.alfa?.pagesScanned ?? 0;
  const auditedPages = summary.pagesAudited ?? Math.max(axePages, alfaPages);
  if (!auditedPages) return null;

  // Reach: fraction of audited pages with no violations from either engine.
  // We approximate union cleanliness with the worse of the two engines'
  // "pages with issues" counts (a page is clean only if both are clean).
  const pagesWithAxe = summary.axe?.pagesWithViolations ?? 0;
  const pagesWithAlfa = summary.alfa?.pagesWithFailures ?? 0;
  const dirtyPages = Math.max(pagesWithAxe, pagesWithAlfa);
  const cleanShare = Math.max(0, 1 - dirtyPages / auditedPages); // 0..1

  // Density: median issues/page, mapped so 0 -> 1.0 and falls off as the
  // typical page accrues issues (10/page ≈ 0.5, 30/page ≈ 0.25).
  const medianIssues = Math.max(summary.axe?.medianViolations ?? 0, summary.alfa?.medianFailures ?? 0);
  const densityScore = 1 / (1 + medianIssues / 10); // 0..1, smooth

  // Weight reach more than density: broad cleanliness matters most.
  const raw = 0.65 * cleanShare + 0.35 * densityScore;
  const score = Math.round(raw * 100);
  return { score, grade: grade(score), cleanShare: Math.round(cleanShare * 100), medianIssues };
}

/** Letter grade from a 0-100 score. */
export function grade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Trajectory of a metric across a series of summaries: compares the
 * latest score against the one `lookback` weeks earlier.
 * Returns { direction: 'improving'|'stable'|'worsening', delta } or null.
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
