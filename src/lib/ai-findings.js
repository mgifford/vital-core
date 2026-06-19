/**
 * AI-oriented findings summary for one domain/week.
 *
 * Produces a compact, problem-focused JSON artifact that answers:
 *   - What is broken, where, and how widespread?
 *   - Is it new, persistent, worsening, or improving?
 *   - What components, technologies, or third-party scripts are associated?
 *   - What should a human investigate first?
 *
 * This is NOT a replacement for bugs.json or domain.json. Those are the
 * archival sources of truth. This file is a compressed diagnostic view for
 * LLM-assisted analysis: healthy pages are intentionally excluded,
 * representative examples replace exhaustive lists, and every finding carries
 * a stable fingerprint for cross-week tracking.
 *
 * Schema version: 0.1
 */

import crypto from 'node:crypto';

const SCHEMA_VERSION = '0.1';
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB soft cap — warn, don't fail
const MAX_EXAMPLES = 5;
const MAX_FRAGMENTS = 3;
const MAX_SELECTORS = 3;
const MAX_TOP_RISKS = 10;
const SEVERITY_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const PRIORITY_THRESHOLDS = {
  p1: { severities: ['Critical', 'High'], minPages: 1 },
  p2: { severities: ['Medium'], minPages: 10 },
  p3: { severities: ['Low'], minPages: 25 },
};

// ---------------------------------------------------------------------------
// Fingerprint helpers
// ---------------------------------------------------------------------------

function sha8(...parts) {
  return crypto.createHash('sha256').update(parts.join('\x00')).digest('hex').slice(0, 8);
}

/**
 * Stable finding fingerprint. Based only on attributes that are stable across
 * weeks and don't depend on scan ordering, timestamps, or generated UUIDs.
 */
function findingFingerprint(engineKey, ruleId, wcagSc) {
  return sha8('finding', engineKey, ruleId, wcagSc ?? '');
}

/**
 * Fragment fingerprint: groups similar HTML failures across pages.
 * Normalises whitespace, strips attribute values that vary per-instance
 * (ids, aria-labelledby targets, data-* values), keeps tag + structure.
 */
function fragmentFingerprint(htmlFragment) {
  if (!htmlFragment) return null;
  const normalised = htmlFragment
    .replace(/\s+/g, ' ')
    .replace(/\bid="[^"]*"/gi, 'id="…"')
    .replace(/\baria-labelledby="[^"]*"/gi, 'aria-labelledby="…"')
    .replace(/\bdata-[a-z-]+="[^"]*"/gi, 'data-…="…"')
    .replace(/\bstyle="[^"]*"/gi, 'style="…"')
    .trim();
  return sha8('fragment', normalised);
}

/**
 * URL pattern fingerprint: groups pages that share the same path template.
 * Strips numeric segments and UUIDs so /article/123 and /article/456 cluster.
 */
function urlPatternFingerprint(url) {
  try {
    const u = new URL(url);
    const pattern = u.pathname
      .replace(/\/\d+/g, '/{id}')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{uuid}')
      .replace(/[?#].*$/, '');
    return sha8('urlpat', u.hostname, pattern);
  } catch {
    return sha8('urlpat', url);
  }
}

// ---------------------------------------------------------------------------
// Trend / status derivation
// ---------------------------------------------------------------------------

function deriveTrend(ledgerEntry, currentPages, prevPages) {
  if (!ledgerEntry) return 'new';
  const { weeksSeen, firstSeen, lastSeen } = ledgerEntry;
  if (weeksSeen <= 1) return 'new';
  if (currentPages == null || prevPages == null) return 'persistent';
  const delta = currentPages - prevPages;
  if (Math.abs(delta) <= Math.max(1, Math.round(currentPages * 0.05))) return 'persistent';
  return delta > 0 ? 'worsening' : 'improving';
}

function priorityFor(severity, pagesAffected, isOnKeyPage, isPersistent) {
  if (severity === 'Critical' || (severity === 'High' && pagesAffected >= 1)) return 'p1';
  if (severity === 'High' || (severity === 'Medium' && (isOnKeyPage || pagesAffected >= 50))) return 'p2';
  if (severity === 'Medium' || (severity === 'Low' && pagesAffected >= 100)) return 'p3';
  return 'p4';
}

function priorityRationale(bug, priority, trend, isOnKeyPage) {
  const parts = [];
  if (priority === 'p1') parts.push(`${bug.severity} severity`);
  if (bug.frequency.pages_affected >= 100) parts.push(`affects ${bug.frequency.pages_affected} pages`);
  if (isOnKeyPage) parts.push('appears on key/top-task page');
  if (trend === 'worsening') parts.push('worsening trend');
  if (trend === 'persistent') parts.push('persistent across weeks');
  return parts.join('; ') || `${bug.severity} severity on ${bug.frequency.pages_affected} pages`;
}

// ---------------------------------------------------------------------------
// URL pattern clustering
// ---------------------------------------------------------------------------

function clusterByUrlPattern(bug) {
  const urlCounts = {};
  for (const pageUrl of bug.affected_pages ?? []) {
    try {
      const u = new URL(pageUrl);
      const pattern = u.pathname.replace(/\/\d+/g, '/{id}');
      urlCounts[pattern] = (urlCounts[pattern] ?? 0) + 1;
    } catch { /* skip unparseable */ }
  }
  return Object.entries(urlCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([pattern, count]) => ({ pattern, count }));
}

// ---------------------------------------------------------------------------
// Technology / third-party association
// ---------------------------------------------------------------------------

function techAssociationsFor(ruleKey, techFindings) {
  const associations = techFindings?.associations ?? [];
  return associations
    .filter((a) => a.finding === ruleKey && a.lift >= 1.5 && a.pairPages >= 5)
    .sort((a, b) => b.lift - a.lift)
    .slice(0, 3)
    .map((a) => ({ technology: a.tech, lift: a.lift, pages_with_both: a.pairPages }));
}

function thirdPartyRisksFor(vendors) {
  if (!Array.isArray(vendors)) return [];
  return vendors
    .filter((v) => v.isScriptVendor && (v.pagesWithFindings / (v.pages || 1)) > 0.3 && v.pages >= 10)
    .sort((a, b) => (b.pagesWithFindings / b.pages) - (a.pagesWithFindings / a.pages))
    .slice(0, 5)
    .map((v) => ({
      origin: v.origin,
      pages_served: v.pages,
      pages_with_findings: v.pagesWithFindings,
      finding_co_occurrence_rate: Math.round((v.pagesWithFindings / v.pages) * 100) / 100,
      median_bytes: v.medianBytes,
      example_pages: (v.examplePages ?? []).slice(0, 3),
    }));
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Build the AI findings summary for one domain/week.
 *
 * @param {object} target     - Target config entry (domain, priority_urls, etc.)
 * @param {object} summary    - Weekly summary (from summarizeWeek)
 * @param {object[]} bugs     - Bug reports (from buildBugReports), already annotated
 *                              with first_seen / last_seen / weeks_seen from the ledger
 * @param {object} ledger     - Findings ledger (findings.json contents)
 * @param {object[]} series   - Full week series for this domain (trend context)
 * @param {object} invSummary - Inventory summary (pages known, pages with issues)
 * @param {string} repDir     - Report output directory (for source_files refs)
 * @returns {object} The AI findings document, or null if there's nothing to report
 */
export function buildAiFindings(target, summary, bugs, ledger, series, invSummary, repDir) {
  const warnings = [];

  if (!summary) { warnings.push('No summary data — cannot generate AI findings.'); return { _warnings: warnings }; }
  if (!bugs?.length) { warnings.push('No accessibility findings this week.'); }

  const domain = target.domain;
  const week = summary.week;
  const total = summary.pagesScanned ?? 0;
  const prev = series.length >= 2 ? series[series.length - 2] : null;

  // Key pages (priority URLs) for priority bump
  const keyPageSet = new Set(target.priority_urls ?? []);

  // Tech findings associations index
  const techFindings = summary.techFindings;

  // Third-party risks
  const thirdPartyRisks = thirdPartyRisksFor(summary.thirdParty?.vendors);

  // ---------------------------------------------------------------------------
  // Build per-finding records
  // ---------------------------------------------------------------------------
  const findings = [];

  for (const bug of bugs) {
    const ledgerEntry = ledger.findings?.[bug.pattern_id];
    const prevRule = prev?.axe?.rules?.[bug.rule_id]
      ?? prev?.alfa?.rules?.[bug.rule_id]
      ?? prev?.deprecatedHtml?.rules?.[bug.rule_id]
      ?? null;
    const currentPages = bug.frequency.pages_affected;
    const prevPages = prevRule?.pages ?? null;
    const trend = deriveTrend(ledgerEntry, currentPages, prevPages);
    const isOnKeyPage = (bug.example_pages ?? []).some((u) => keyPageSet.has(u))
      || (bug.affected_pages ?? []).some((u) => keyPageSet.has(u));
    const priority = priorityFor(bug.severity, currentPages, isOnKeyPage, trend === 'persistent' || trend === 'worsening');
    const fingerprint = findingFingerprint(bug.engine_key, bug.rule_id, bug.wcag_sc);

    // Normalised HTML fragments with fingerprints
    const fragmentMap = new Map();
    for (const ex of bug.examples ?? []) {
      if (!ex.html_snippet) continue;
      const fp = fragmentFingerprint(ex.html_snippet);
      if (!fragmentMap.has(fp)) fragmentMap.set(fp, { fragment: ex.html_snippet, fingerprint: fp, selectors: [] });
      if (ex.xpath) fragmentMap.get(fp).selectors.push(ex.xpath);
    }
    const fragments = [...fragmentMap.values()].slice(0, MAX_FRAGMENTS).map((f) => ({
      fingerprint: f.fingerprint,
      html: f.fragment,
      selectors: [...new Set(f.selectors)].slice(0, MAX_SELECTORS),
    }));

    // URL pattern clustering
    const urlPatterns = clusterByUrlPattern(bug);

    // Technology associations
    const ruleKey = `${bug.engine_key}:${bug.rule_id}`;
    const associatedTech = techAssociationsFor(ruleKey, techFindings);

    findings.push({
      finding_id: bug.pattern_id,
      fingerprint,
      rule_id: bug.rule_id,
      rule_label: bug.rule_label,
      engine: bug.engine_key,
      tool: bug.tool,
      wcag_sc: bug.wcag_sc,
      wcag_name: bug.wcag_name,
      wcag_level: bug.wcag_level,
      wcag_version: bug.wcag_version,
      wcag_category: bug.wcag_category,
      rule_url: bug.rule_url,
      severity: bug.severity,
      priority,
      confidence: currentPages >= 10 ? 'high' : currentPages >= 3 ? 'medium' : 'low',
      rationale: priorityRationale(bug, priority, trend, isOnKeyPage),
      trend: {
        status: trend,
        first_observed: ledgerEntry?.firstSeen ?? week,
        last_observed: ledgerEntry?.lastSeen ?? week,
        weeks_observed: ledgerEntry?.weeksSeen ?? 1,
        affected_pages_current: currentPages,
        affected_pages_previous: prevPages,
      },
      frequency: bug.frequency,
      on_key_page: isOnKeyPage,
      summary: bug.summary,
      description: bug.description,
      remediation_tip: bug.remediation_tip ?? null,
      suggested_fix: bug.suggested_fix ?? null,
      expected_behavior: `Element passes ${bug.tool} rule ${bug.rule_id}${bug.wcag_sc ? ` (WCAG ${bug.wcag_sc})` : ''}.`,
      actual_behavior: bug.description,
      testing_environment: bug.testing_environment,
      // Representative evidence — not every page
      representative_urls: (bug.example_pages ?? []).slice(0, MAX_EXAMPLES),
      html_fragments: fragments,
      url_patterns: urlPatterns,
      associated_technologies: associatedTech,
      impact: bug.impact,
    });
  }

  if (!findings.length && !warnings.length) {
    warnings.push('No findings to include — site may be clean or scan data is insufficient.');
  }

  // ---------------------------------------------------------------------------
  // Sort findings: P1 first, then by pages affected desc
  // ---------------------------------------------------------------------------
  findings.sort((a, b) =>
    (a.priority.localeCompare(b.priority)) ||
    (b.frequency.pages_affected - a.frequency.pages_affected) ||
    ((SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9))
  );

  // ---------------------------------------------------------------------------
  // Clusters: group findings by WCAG criterion
  // ---------------------------------------------------------------------------
  const wcagClusters = new Map();
  for (const f of findings) {
    const key = f.wcag_sc ?? `no-wcag:${f.rule_id}`;
    if (!wcagClusters.has(key)) {
      wcagClusters.set(key, {
        cluster_id: sha8('cluster-wcag', key),
        type: 'wcag_criterion',
        wcag_sc: f.wcag_sc,
        wcag_name: f.wcag_name,
        wcag_level: f.wcag_level,
        findings: [],
        total_pages_affected: 0,
        max_severity: f.severity,
      });
    }
    const cl = wcagClusters.get(key);
    cl.findings.push(f.finding_id);
    cl.total_pages_affected += f.frequency.pages_affected;
    if ((SEVERITY_RANK[f.severity] ?? 9) < (SEVERITY_RANK[cl.max_severity] ?? 9)) {
      cl.max_severity = f.severity;
    }
  }

  // URL-pattern clusters: findings where a single URL template accounts for
  // more than 20% of affected pages
  const urlPatternClusters = [];
  const patternIndex = new Map();
  for (const f of findings) {
    for (const up of f.url_patterns ?? []) {
      const share = f.frequency.pages_affected > 0 ? up.count / f.frequency.pages_affected : 0;
      if (share < 0.2) continue;
      const key = sha8('urlpat-cluster', up.pattern);
      if (!patternIndex.has(key)) {
        patternIndex.set(key, { cluster_id: key, type: 'url_pattern', pattern: up.pattern, findings: [], total_pages: 0 });
      }
      const cl = patternIndex.get(key);
      if (!cl.findings.includes(f.finding_id)) {
        cl.findings.push(f.finding_id);
        cl.total_pages += up.count;
      }
    }
  }
  urlPatternClusters.push(
    ...[...patternIndex.values()]
      .filter((c) => c.findings.length >= 2)
      .sort((a, b) => b.total_pages - a.total_pages)
      .slice(0, 10)
  );

  // ---------------------------------------------------------------------------
  // Top risks: P1+P2, worsening/persistent, sorted by severity then pages
  // ---------------------------------------------------------------------------
  const topRisks = findings
    .filter((f) => f.priority === 'p1' || f.priority === 'p2' || f.trend.status === 'worsening')
    .slice(0, MAX_TOP_RISKS)
    .map((f) => ({
      finding_id: f.finding_id,
      rule_id: f.rule_id,
      rule_label: f.rule_label,
      severity: f.severity,
      priority: f.priority,
      trend: f.trend.status,
      pages_affected: f.frequency.pages_affected,
      rationale: f.rationale,
      top_url: f.representative_urls[0] ?? null,
    }));

  // ---------------------------------------------------------------------------
  // Technology findings summary
  // ---------------------------------------------------------------------------
  const technologyFindings = (techFindings?.associations ?? [])
    .filter((a) => a.lift >= 2.0 && a.pairPages >= 5)
    .sort((a, b) => b.lift - a.lift)
    .slice(0, 15)
    .map((a) => ({
      technology: a.tech,
      finding: a.finding,
      lift: a.lift,
      pages_with_both: a.pairPages,
      technology_pages: a.techPages,
      interpretation: `Pages using ${a.tech} are ${a.lift}× more likely to have finding ${a.finding}.`,
    }));

  // ---------------------------------------------------------------------------
  // Counts for summary block
  // ---------------------------------------------------------------------------
  const newFindings = findings.filter((f) => f.trend.status === 'new').length;
  const persistentFindings = findings.filter((f) => f.trend.status === 'persistent' || f.trend.status === 'worsening').length;
  const highPriority = findings.filter((f) => f.priority === 'p1' || f.priority === 'p2').length;

  // ---------------------------------------------------------------------------
  // Assemble document
  // ---------------------------------------------------------------------------
  const doc = {
    schema_version: SCHEMA_VERSION,
    site: domain,
    scan_week: week,
    generated_at: new Date().toISOString(),
    source_files: [
      `docs/reports/${target.key ?? domain}/${week}/bugs.json`,
      `data/${target.key ?? domain}/findings.json`,
      `data/${target.key ?? domain}/${week}/summary.json`,
    ],
    summary: {
      pages_known: invSummary?.totalKnownPages ?? null,
      pages_scanned_this_week: total,
      pages_with_known_issues: invSummary?.pagesWithKnownIssues ?? null,
      findings: findings.length,
      clusters: wcagClusters.size + urlPatternClusters.length,
      new_findings: newFindings,
      persistent_findings: persistentFindings,
      high_priority_findings: highPriority,
    },
    top_risks: topRisks,
    findings,
    clusters: {
      by_wcag_criterion: [...wcagClusters.values()]
        .sort((a, b) => b.total_pages_affected - a.total_pages_affected)
        .slice(0, 20),
      by_url_pattern: urlPatternClusters,
    },
    technology_findings: technologyFindings,
    third_party_findings: thirdPartyRisks,
    metadata: {
      generator: 'vital-core',
      schema_version: SCHEMA_VERSION,
      total_pages_scanned: total,
      notes: [
        'Healthy pages (no known issues) are intentionally excluded.',
        'Representative examples are used instead of complete occurrence lists.',
        'Fingerprints are stable hashes for tracking recurring patterns over time.',
        'Fragment fingerprints normalize volatile attributes (id, style, data-*) before hashing.',
        'Technology lift values indicate association, not causation.',
        'Confidence reflects sample size: high=10+ affected pages, medium=3-9, low=1-2.',
        ...warnings,
      ],
    },
  };

  // Size check
  const json = JSON.stringify(doc, null, 1);
  if (json.length > MAX_SIZE_BYTES) {
    doc.metadata.notes.push(
      `WARNING: output is ${Math.round(json.length / 1024)}KB, exceeding the ${Math.round(MAX_SIZE_BYTES / 1024)}KB soft cap. ` +
      'Consider reducing MAX_EXAMPLES or MAX_TOP_RISKS if LLM context limits are a concern.'
    );
  }

  return doc;
}
