/**
 * Progress derivations for the Layer-1 landing page: turn the committed findings
 * ledger (src/lib/findings.js) into the week-over-week story a manager reads in
 * ~10 seconds — what's new, what got fixed, what came back.
 *
 * These are pure functions over the ledger as it stands *for the current week*
 * (aggregate.js replays the ledger oldest-first and calls updateFindings before
 * rendering, so at render time `lastSeen`/`_weeks` reflect history through the
 * week being rendered — never future weeks). They classify finding-level, keyed
 * on pattern_id, which is finer than the rule-level appeared/resolved in the
 * week diff.
 */

/** A finding is present in `week` when the ledger last saw it that week. */
function presentIn(f, week) {
  return f.lastSeen === week;
}

/** The distinct weeks a finding has been seen (ledger `_weeks`, with fallback). */
function seenWeeks(f) {
  return f._weeks ?? [f.firstSeen];
}

/**
 * Classify every ledger finding for `currentWeek` against `prevWeek` (the
 * previous *scanned* week, i.e. the prior element of the domain's series, or
 * null for the first recorded week):
 *
 *   - new:              first observed this week (firstSeen === currentWeek),
 *                        excluding coverage-expansion artifacts (_coverageNew).
 *   - fixed:             present last week, absent this week (lastSeen ===
 *                        prevWeek), AND not flagged _coverageLost — i.e. its
 *                        prior pages were confirmed re-covered this week
 *                        (issue #222: a confirmed, defensible fix).
 *   - fixedUnconfirmed:  same disappearance pattern as `fixed`, but flagged
 *                        _coverageLost by updateFindings() (src/lib/findings.js)
 *                        — none of its prior pages were re-crawled this week,
 *                        so the disappearance cannot be credited as a
 *                        confirmed fix; it may just have dropped from this
 *                        week's sample. Never counted in both buckets.
 *   - regressed:         seen before, absent last week, back this week (present
 *                        now, firstSeen < currentWeek, prevWeek not among its
 *                        seen weeks).
 *
 * Each bucket is an array of { id, ...finding } entries. Counts are the array
 * lengths. With no prevWeek (first week) fixed/fixedUnconfirmed/regressed are
 * empty and every present finding is new.
 */
export function weekDeltas(ledger, currentWeek, prevWeek = null) {
  const out = { new: [], fixed: [], regressed: [], fixedUnconfirmed: [] };
  const findings = ledger?.findings ?? {};
  for (const [id, f] of Object.entries(findings)) {
    if (presentIn(f, currentWeek)) {
      if (f.firstSeen === currentWeek) {
        if (!f._coverageNew) out.new.push({ id, ...f });
      } else if (prevWeek && !seenWeeks(f).includes(prevWeek)) {
        out.regressed.push({ id, ...f });
      }
    } else if (prevWeek && f.lastSeen === prevWeek) {
      if (f._coverageLost) out.fixedUnconfirmed.push({ id, ...f });
      else out.fixed.push({ id, ...f });
    }
  }
  return out;
}

/** Convenience: just the bucket counts (for the landing-page delta strip). */
export function weekDeltaCounts(ledger, currentWeek, prevWeek = null) {
  const d = weekDeltas(ledger, currentWeek, prevWeek);
  return { new: d.new.length, fixed: d.fixed.length, regressed: d.regressed.length, fixedUnconfirmed: d.fixedUnconfirmed.length };
}

/**
 * Per-week new/fixed/regressed/fixedUnconfirmed counts across `weeks`
 * (oldest-first), reconstructed from the ledger's `_weeks` membership so it
 * works on the final ledger (unlike weekDeltas, which reads the incremental
 * lastSeen). Drives the sparklines on the landing-page delta tiles — the
 * momentum of each metric over time.
 *
 * Known limitation: the ledger stores only each finding's CURRENT
 * `_coverageLost` flag, not a per-week history of it (issue #222). A finding
 * that disappeared coverage-lost in one week, reappeared, then disappeared
 * again confirmed-fixed in a later week will have every historical row's
 * fixed/fixedUnconfirmed split determined by the finding's present-day flag
 * value, not the value that was true at that historical week. This is an
 * accepted simplification, not a bug — the ledger has nowhere else to read a
 * past week's flag from.
 */
export function deltaSeries(ledger, weeks) {
  const findings = Object.values(ledger?.findings ?? {});
  const seenIn = (f, w) => (f._weeks ?? [f.firstSeen]).includes(w);
  return weeks.map((week, i) => {
    const prev = i > 0 ? weeks[i - 1] : null;
    const row = { week, new: 0, fixed: 0, regressed: 0, fixedUnconfirmed: 0 };
    for (const f of findings) {
      const here = seenIn(f, week);
      if (here && f.firstSeen === week) { if (!f._coverageNew) row.new += 1; }
      else if (here && prev && !seenIn(f, prev) && f.firstSeen < week) row.regressed += 1;
      else if (!here && prev && seenIn(f, prev)) {
        if (f._coverageLost) row.fixedUnconfirmed += 1;
        else row.fixed += 1;
      }
    }
    return row;
  });
}

const SEVERITY_ORDER = ['critical', 'serious', 'moderate', 'minor'];

/**
 * Open-finding burndown: for each week in `weeks` (oldest-first), the count of
 * distinct findings that were present that week, bucketed by severity. Uses the
 * ledger's `_weeks` membership and each finding's (last-seen) severity, so it
 * needs no per-week bug lists. This is the "is the backlog shrinking?" series,
 * distinct from the pages-affected severity trend.
 *
 * Pass only the weeks known so far (series up to the rendered week) — the ledger
 * hasn't recorded future weeks yet, so they would read as zero.
 */
export function severityBurndown(ledger, weeks) {
  const findings = Object.values(ledger?.findings ?? {});
  return weeks.map((week) => {
    const row = { week, critical: 0, serious: 0, moderate: 0, minor: 0 };
    for (const f of findings) {
      const fw = f._weeks ?? [f.firstSeen];
      if (!fw.includes(week)) continue;
      const sev = String(f.severity ?? '').toLowerCase();
      if (sev in row) row[sev] += 1;
    }
    return row;
  });
}

/**
 * Clean-week streaks from a burndown series: for each severity that is at zero
 * in the most recent week, how many consecutive most-recent weeks it has stayed
 * at zero (e.g. "0 criticals for 3 weeks"). Returns [{ severity, weeks }] in
 * severity order, only for severities currently at zero with a run ≥ 1.
 */
export function streaks(burndown) {
  if (!Array.isArray(burndown) || burndown.length === 0) return [];
  const out = [];
  for (const severity of SEVERITY_ORDER) {
    let run = 0;
    for (let i = burndown.length - 1; i >= 0; i--) {
      if ((burndown[i][severity] ?? 0) === 0) run += 1;
      else break;
    }
    if (run > 0) out.push({ severity, weeks: run });
  }
  return out;
}
