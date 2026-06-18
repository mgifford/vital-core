const DEFAULT_REPORTING = {
  max_html_issues: 50,
  moderate_issue_threshold_percent: 5,
  include_key_page_issues: true,
};

const SEVERITY_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };

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

  const visible = [];
  for (const bug of decorated) {
    if (bug.priority_tier <= 1) visible.push(bug);
  }
  for (const bug of decorated) {
    if (bug.priority_tier <= 1) continue;
    if (cfg.max_html_issues > 0 && visible.length >= cfg.max_html_issues) break;
    visible.push(bug);
  }

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
  if (bug.severity === 'Critical' || bug.severity === 'High') return 0;
  if (includeKeyPages && keyPageHit && prevalencePercent > thresholdPercent) return 1;
  if (isWcagAorAa(bug.wcag_category)) return 2;
  if (bug.wcag_category === 'Best Practice') return 3;
  if (bug.wcag_category === 'WCAG 2.x AAA') return 4;
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