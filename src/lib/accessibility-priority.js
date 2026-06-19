const DEFAULT_REPORTING = {
  max_html_issues: 50,
  moderate_issue_threshold_percent: 5,
  include_key_page_issues: true,
};

const SEVERITY_RANK = { Critical: 0, Serious: 1, Moderate: 2, Minor: 3 };

export function normalizeAccessibilityReporting(reporting = {}) {
  return {
    ...DEFAULT_REPORTING,
    ...reporting,
    max_html_issues: Math.max(0, Number(reporting.max_html_issues ?? DEFAULT_REPORTING.max_html_issues) || 0),
    moderate_issue_threshold_percent: Math.max(
      0,
      Number(reporting.moderate_issue_threshold_percent ?? DEFAULT_REPORTING.moderate_issue_threshold_percent) || 0
    ),
    include_key_page_issues: reporting.include_key_page_issues ?? DEFAULT_REPORTING.include_key_page_issues,
  };
}

export function prioritizeAccessibilityBugs(summary, bugs, { keyPages = [], reporting = {} } = {}) {
  const cfg = normalizeAccessibilityReporting(reporting);
  const keyPageSet = cfg.include_key_page_issues ? new Set(keyPages) : new Set();
  const totalPages = summary.pagesScanned || bugs[0]?.frequency.total_pages_scanned || 0;
  const threshold = cfg.moderate_issue_threshold_percent;

  const decorated = bugs.map((bug) => {
    const pagesAffected = bug.frequency?.pages_affected ?? 0;
    const prevalencePercent = totalPages > 0 ? (100 * pagesAffected) / totalPages : 0;
    const keyPageHit = keyPageSet.size > 0 && bugHasKeyPageHit(summary, bug, keyPageSet);
    const tier = priorityTier(bug, prevalencePercent, keyPageHit, threshold, cfg.include_key_page_issues);
    return {
      ...bug,
      priority_tier: tier,
      priority_key_page: keyPageHit,
      priority_prevalence_percent: Math.round(prevalencePercent * 100) / 100,
    };
  });

  decorated.sort((a, b) =>
    a.priority_tier - b.priority_tier ||
    (b.frequency?.pages_affected ?? 0) - (a.frequency?.pages_affected ?? 0) ||
    (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99) ||
    (b.frequency?.instances ?? 0) - (a.frequency?.instances ?? 0) ||
    String(a.summary ?? '').localeCompare(String(b.summary ?? ''))
  );

  // Tiers 0–2 are the VITAL default view (Critical/Serious on WCAG A/AA;
  // Moderate/Minor on WCAG A/AA with ≥10 pages). Tier 5 is hidden by default
  // (Best Practice, Undetermined, low-page-count findings).
  const visible = decorated.filter((bug) => bug.priority_tier <= 2);

  const visibleSet = new Set(visible.map((b) => b.instance_id));
  return {
    bugs: decorated.map((bug) => ({
      ...bug,
      default_visible: visibleSet.has(bug.instance_id),
    })),
    visibleCount: visibleSet.size,
    totalCount: bugs.length,
    reporting: cfg,
  };
}

function priorityTier(bug, prevalencePercent, keyPageHit, thresholdPercent, includeKeyPages) {
  const sev = bug.severity;
  const pagesAffected = bug.frequency?.pages_affected ?? 0;
  const isWcag = isWcagAorAa(bug.wcag_category);
  const isBestPractice = bug.wcag_category === 'Best Practice';

  // VITAL errors: Critical/Serious on any WCAG A/AA issue, always surface.
  if ((sev === 'Critical' || sev === 'Serious') && isWcag) return 0;
  // Critical/Serious on Best Practice or Undetermined — show but lower priority.
  if (sev === 'Critical' || sev === 'Serious') return 1;
  // Moderate/Minor on WCAG A/AA with ≥10 pages affected.
  if (isWcag && !isBestPractice && pagesAffected >= 10) return 2;
  // Key-page hits on WCAG A/AA with enough prevalence.
  if (includeKeyPages && keyPageHit && isWcag && prevalencePercent > thresholdPercent) return 2;
  // Best Practice and Undetermined, and low-page-count WCAG findings — hidden by default.
  return 5;
}

function isWcagAorAa(category) {
  return /^WCAG \d\.\d [A]{1,2}$/.test(category ?? '');
}

function bugHasKeyPageHit(summary, bug, keyPageSet) {
  const rule = ruleForBug(summary, bug);
  const affected = rule?.affectedPages?.map((p) => p.url).filter(Boolean) ?? bug.affected_pages ?? [];
  return affected.some((url) => keyPageSet.has(url));
}

function ruleForBug(summary, bug) {
  const rules = {
    'axe-core': summary.axe?.rules,
    alfa: summary.alfa?.rules,
    'deprecated-html': summary.deprecatedHtml?.rules,
  }[bug.engine_key];
  return rules?.[bug.rule_id] ?? null;
}