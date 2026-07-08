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
 *   - new:       first observed this week (firstSeen === currentWeek), excluding
 *                coverage-expansion artifacts (_coverageNew).
 *   - fixed:     present last week, absent this week (lastSeen === prevWeek).
 *   - regressed: seen before, absent last week, back this week (present now,
 *                firstSeen < currentWeek, prevWeek not among its seen weeks).
 *
 * Each bucket is an array of { id, ...finding } entries. Counts are the array
 * lengths. With no prevWeek (first week) fixed/regressed are empty and every
 * present finding is new.
 */
export function weekDeltas(ledger, currentWeek, prevWeek = null) {
  const out = { new: [], fixed: [], regressed: [] };
  const findings = ledger?.findings ?? {};
  for (const [id, f] of Object.entries(findings)) {
    if (presentIn(f, currentWeek)) {
      if (f.firstSeen === currentWeek) {
        if (!f._coverageNew) out.new.push({ id, ...f });
      } else if (prevWeek && !seenWeeks(f).includes(prevWeek)) {
        out.regressed.push({ id, ...f });
      }
    } else if (prevWeek && f.lastSeen === prevWeek) {
      out.fixed.push({ id, ...f });
    }
  }
  return out;
}

/** Convenience: just the three counts (for the landing-page delta strip). */
export function weekDeltaCounts(ledger, currentWeek, prevWeek = null) {
  const d = weekDeltas(ledger, currentWeek, prevWeek);
  return { new: d.new.length, fixed: d.fixed.length, regressed: d.regressed.length };
}
