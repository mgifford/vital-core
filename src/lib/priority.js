/**
 * "Fix these first" prioritization. Turns the week's bug reports into a
 * ranked action list so a team knows what to do next, and a program owner
 * can see where effort matters most across all domains.
 *
 * Priority score per issue = pages affected × severity weight × people
 * reach. Each factor is something we actually measure:
 *   - pages affected: how widespread (one fix often clears many pages)
 *   - severity: Critical/Serious/Moderate/Minor from axe impact + frequency
 *   - reach: the most-affected disability group's population prevalence
 *     (from the WCAG→FPC mapping), so issues hurting more people rank up.
 */

const SEVERITY_WEIGHT = { Critical: 4, Serious: 3, Moderate: 2, Minor: 1 };

/** Priority score for one bug report (higher = fix sooner). */
export function priorityScore(bug) {
  const pages = bug.frequency?.pages_affected ?? 0;
  const sev = SEVERITY_WEIGHT[bug.severity] ?? 1;
  // Reach: max prevalence among affected groups (0..1); default small so
  // unmapped issues still rank by pages × severity.
  const reach = bug.impact?.groups?.length
    ? Math.max(...bug.impact.groups.map((g) => g.prevalence ?? 0))
    : 0.05;
  return Math.round(pages * sev * (1 + reach) * 100) / 100;
}

/** Rank a domain's bugs into a "fix these first" list (top `n`). */
export function rankBugs(bugs, n = 10) {
  return bugs
    .map((b) => ({ ...b, priority: priorityScore(b) }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, n);
}

/**
 * Fleet-wide worst offenders: flatten ranked bugs across all domains into
 * a single ordered list, tagged with their domain.
 */
export function fleetWorstOffenders(perDomain, n = 20) {
  const all = [];
  for (const { target, bugs } of perDomain) {
    for (const b of bugs) {
      all.push({ domain: target.domain, key: target.key, week: b._week, ...b, priority: priorityScore(b) });
    }
  }
  return all.sort((a, b) => b.priority - a.priority).slice(0, n);
}
