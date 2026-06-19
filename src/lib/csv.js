import fs from 'node:fs';
import path from 'node:path';

/**
 * CSV exports of the pages affected by each finding, so a developer can
 * pull the full list of URLs to reproduce and fix an issue — the report
 * shows a few examples and links to the complete CSV.
 *
 * Files are written under docs/reports/<domain>/<week>/csv/. Filenames
 * are slugged from the rule id so they're stable and linkable.
 */

const csvField = (s) => {
  const v = String(s ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

export function toCsv(headers, rows) {
  const lines = [headers.map(csvField).join(',')];
  for (const row of rows) lines.push(row.map(csvField).join(','));
  return lines.join('\n') + '\n';
}

/** Filesystem- and URL-safe slug for a rule id (e.g. "sia-r12", "color-contrast"). */
export function ruleSlug(engine, ruleId) {
  return `${engine}__${ruleId}`.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
}

/**
 * Write the resource inventory CSV (every linked/embedded non-HTML
 * resource: PDFs, docs, iframes, media) with type, pages it appears on,
 * and when it was first seen (from the resource ledger). Returns the
 * relative path "resources.csv".
 */
/** Write the per-page Lighthouse CSV (scores + Core Web Vitals). */
export function writeLighthouseCsv(repDir, lighthouse) {
  if (!lighthouse?.pageDetail?.length) return null;
  const rows = lighthouse.pageDetail.map((p) => [
    p.url, p.scores.performance, p.scores.accessibility, p.scores.bestPractices,
    p.scores.seo, p.scores.pwa ?? '', p.scores.agentic,
    p.metrics.firstContentfulPaintMs, p.metrics.largestContentfulPaintMs,
    p.metrics.speedIndexMs, p.metrics.totalBlockingTimeMs, p.metrics.cumulativeLayoutShift,
  ]);
  fs.writeFileSync(path.join(repDir, 'lighthouse.csv'),
    toCsv(['url', 'performance', 'accessibility', 'best_practices', 'seo', 'pwa', 'agentic', 'fcp_ms', 'lcp_ms', 'speed_index_ms', 'tbt_ms', 'cls'], rows));
  return 'lighthouse.csv';
}

/**
 * Write Lighthouse results as JSON — per-page scores and recommendations.
 * Designed for AI consumption: compact, self-describing, includes PWA signals.
 */
export function writeLighthouseJson(repDir, domain, week, generatedAt, lighthouse) {
  if (!lighthouse?.pageDetail?.length) return null;
  const doc = {
    domain,
    week,
    generated_at: generatedAt,
    summary: {
      pages_sampled: lighthouse.pagesSampled,
      median_performance: lighthouse.medianPerformance,
      median_accessibility: lighthouse.medianAccessibility,
      median_best_practices: lighthouse.medianBestPractices,
      median_seo: lighthouse.medianSeo,
      median_pwa: lighthouse.medianPwa ?? null,
      median_agentic: lighthouse.medianAgentic ?? null,
      core_web_vitals: lighthouse.metrics,
    },
    recommendations: lighthouse.recommendations ?? [],
    pwa_signals: lighthouse.pwaSignals ?? [],
    pages: lighthouse.pageDetail.map((p) => ({
      url: p.url,
      scores: p.scores,
      core_web_vitals: p.metrics,
    })),
  };
  fs.writeFileSync(path.join(repDir, 'lighthouse.json'), JSON.stringify(doc, null, 1));
  return 'lighthouse.json';
}

/** Write per-page readability CSV (words, Flesch reading ease, grade). */
export function writeReadabilityCsv(repDir, plRows) {
  if (!plRows?.length) return null;
  const rows = plRows.map((r) => [r.url, r.wordCount, r.fleschReadingEase, r.fleschKincaidGrade, r.scored]);
  fs.writeFileSync(path.join(repDir, 'readability.csv'),
    toCsv(['url', 'words', 'reading_ease', 'grade', 'scored'], rows));
  return 'readability.csv';
}

/** Write spelling CSV (misspelled word, pages affected, example URLs). */
export function writeSpellingCsv(repDir, spellRows) {
  if (!spellRows?.length) return null;
  const rows = spellRows.map((s) => [s.word, s.pages, (s.examplePages ?? []).join(' ')]);
  fs.writeFileSync(path.join(repDir, 'spelling.csv'),
    toCsv(['word', 'pages_affected', 'example_pages'], rows));
  return 'spelling.csv';
}

/** Write tech CSV (technology, category, confidence, pages, example URLs). */
export function writeTechCsv(repDir, tech) {
  if (!tech?.length) return null;
  const headers = ['technology', 'category', 'all_categories', 'confidence', 'version', 'pages_confirmed', 'website', 'example_pages'];
  const rows = tech.map((d) => [
    d.name,
    d.category,
    (d.categories ?? []).join(' | '),
    d.confidence,
    d.version ?? '',
    d.pagesConfirmed ?? '',
    d.website ?? '',
    (d.examplePages ?? []).join(' '),
  ]);
  fs.writeFileSync(path.join(repDir, 'tech.csv'), toCsv(headers, rows));
  return 'tech.csv';
}

/** Write acronyms CSV (unexplained acronym, pages affected, example URLs). */
export function writeAcronymsCsv(repDir, acronymRows) {
  if (!acronymRows?.length) return null;
  const rows = acronymRows.map((a) => [a.acronym, a.pages, (a.examplePages ?? []).join(' ')]);
  fs.writeFileSync(path.join(repDir, 'acronyms.csv'),
    toCsv(['acronym', 'pages_affected', 'example_pages'], rows));
  return 'acronyms.csv';
}

export function writeResourceCsv(repDir, resources, ledger) {
  const rows = resources.list.map((r) => {
    const led = ledger.resources[r.url];
    return [r.url, r.type, r.pages, led?.firstSeen ?? '', led?.lastSeen ?? ''];
  });
  fs.writeFileSync(path.join(repDir, 'resources.csv'), toCsv(['url', 'type', 'pages', 'first_seen', 'last_seen'], rows));
  return 'resources.csv';
}

/**
 * Write a flat bugs.csv containing one row per bug report (one per failing
 * rule), with every field an accessibility engineer needs to triage, filter,
 * reproduce, and file in JIRA — matching what the HTML report shows:
 *
 * Identity: bug_id, pattern_id, combined_id (JIRA filter format)
 * Classification: engine, rule_id, wcag_category, wcag_sc, wcag_name,
 *   wcag_level, wcag_version, severity
 * Frequency: pages_affected, instances, total_pages_scanned
 * Reproduction: example_url, xpath, html_snippet
 * Narrative: summary, description, steps_to_reproduce, suggested_fix,
 *   remediation_tip, testing_environment
 * Impact: impact_summary, impact_groups (serialized)
 * History: first_seen, last_seen, weeks_seen
 * Deduplication: possible_duplicate_of, possible_duplicate_pattern
 * Links: affected_pages_csv, rule_url
 *
 * Returns the relative path "bugs.csv" (from index.html) or null.
 */
export function writeBugsCsv(repDir, bugs) {
  if (!bugs?.length) return null;
  const headers = [
    'bug_id', 'pattern_id', 'combined_id',
    'engine', 'rule_id', 'rule_url',
    'wcag_category', 'wcag_sc', 'wcag_name', 'wcag_level', 'wcag_version',
    'severity', 'pages_affected', 'instances', 'total_pages_scanned',
    'example_url', 'xpath', 'html_snippet',
    'summary', 'description', 'steps_to_reproduce', 'suggested_fix',
    'remediation_tip', 'testing_environment',
    'impact_summary', 'impact_groups',
    'first_seen', 'last_seen', 'weeks_seen',
    'possible_duplicate_of', 'possible_duplicate_pattern',
    'affected_pages_csv',
  ];
  const rows = bugs.map((b) => {
    const groups = (b.impact?.groups ?? [])
      .map((g) => `${g.group} (${g.percent})`)
      .join('; ');
    return [
      b.instance_id,
      b.pattern_id,
      `${b.instance_id} (pattern ${b.pattern_id})`,
      b.engine_key,
      b.rule_id,
      b.rule_url ?? '',
      b.wcag_category ?? '',
      b.wcag_sc ?? '',
      b.wcag_name ?? '',
      b.wcag_level ?? '',
      b.wcag_version ?? '',
      b.severity,
      b.frequency.pages_affected,
      b.frequency.instances,
      b.frequency.total_pages_scanned,
      b.url ?? '',
      b.xpath ?? '',
      b.html_snippet ?? '',
      b.summary ?? '',
      b.description ?? '',
      (b.steps_to_reproduce ?? []).join(' | '),
      b.suggested_fix ?? '',
      b.remediation_tip ?? '',
      b.testing_environment ?? '',
      b.impact?.summary ?? '',
      groups,
      b.first_seen ?? '',
      b.last_seen ?? '',
      b.weeks_seen ?? '',
      b.possible_duplicate_of ?? '',
      b.possible_duplicate_pattern ?? '',
      b.affected_pages_csv ?? '',
    ];
  });
  fs.writeFileSync(path.join(repDir, 'bugs.csv'), toCsv(headers, rows));
  return 'bugs.csv';
}

/**
 * Write a flat images.csv — one row per image found across scanned pages.
 * Returns the relative path "images.csv" or null if there's nothing to write.
 */
export function writeImagesCsv(repDir, summary) {
  const rows = summary.images?.imageRows;
  if (!rows?.length) return null;
  const headers = ['page_url', 'src', 'alt', 'alt_verdict', 'alt_reason', 'has_alt', 'is_decorative', 'is_missing_alt', 'width', 'height', 'natural_width', 'natural_height', 'loading', 'decoding', 'bytes'];
  const data = rows.map((img) => [
    img.pageUrl,
    img.src,
    img.alt ?? '',
    img.altVerdict ?? '',
    img.altReason ?? '',
    img.hasAlt ? 'true' : 'false',
    img.isDecorative ? 'true' : 'false',
    img.isMissingAlt ? 'true' : 'false',
    img.width ?? '',
    img.height ?? '',
    img.naturalWidth ?? '',
    img.naturalHeight ?? '',
    img.loading ?? '',
    img.decoding ?? '',
    img.bytes ?? '',
  ]);
  fs.writeFileSync(path.join(repDir, 'images.csv'), toCsv(headers, data));
  return 'images.csv';
}

/**
 * Write a flat third-party.csv — one row per third-party vendor (registrable
 * domain) with its load cost and finding co-occurrence. Returns the relative
 * path "third-party.csv" or null if there's nothing to write.
 */
export function writeThirdPartyCsv(repDir, summary) {
  const vendors = summary.thirdParty?.vendors;
  if (!vendors?.length) return null;
  const headers = ['origin', 'is_script_vendor', 'pages', 'pages_with_scripts', 'median_bytes', 'median_requests', 'median_duration_ms', 'pages_with_finding', 'first_seen', 'last_seen', 'weeks_seen', 'example_pages'];
  const data = vendors.map((v) => [
    v.origin,
    v.isScriptVendor ? 'true' : 'false',
    v.pages,
    v.pagesWithScripts ?? '',
    v.medianBytes,
    v.medianRequests,
    v.medianDurationMs,
    v.pagesWithFindings,
    v.firstSeen ?? '',
    v.lastSeen ?? '',
    v.weeksSeen ?? '',
    Array.isArray(v.examplePages) ? v.examplePages.join(' | ') : '',
  ]);
  fs.writeFileSync(path.join(repDir, 'third-party.csv'), toCsv(headers, data));
  return 'third-party.csv';
}

/**
 * Write a flat errors.csv for broken links and non-404 error pages.
 * Returns the relative path "errors.csv" or null if there's nothing to write.
 */
export function writeErrorsCsv(repDir, summary) {
  const broken = summary.linkCheck?.broken ?? [];
  const errors = (summary.errorPages ?? []).filter((e) => Number(e.status) !== 404);
  if (!broken.length && !errors.length) return null;

  const headers = ['type', 'url', 'status', 'linked_from'];
  const rows = [
    ...broken.map((b) => [
      'broken_link',
      b.url,
      b.status || b.reason || '',
      Array.isArray(b.foundOn) ? b.foundOn.join(' | ') : (b.foundOn ?? ''),
    ]),
    ...errors.map((e) => [
      'page_error',
      e.url,
      e.status,
      '',
    ]),
  ];
  fs.writeFileSync(path.join(repDir, 'errors.csv'), toCsv(headers, rows));
  return 'errors.csv';
}

/**
 * Write all CSVs for one domain/week into <repDir>/csv/. Returns a map of
 * { axeAll, alfaAll, byRule: { "<engine>:<ruleId>": "<relative csv path>" } }
 * so the report can link to each. Relative paths are from the report's
 * index.html (i.e. "csv/<file>.csv").
 */
export function writeCsvs(repDir, summary) {
  const csvDir = path.join(repDir, 'csv');
  fs.mkdirSync(csvDir, { recursive: true });
  const links = { axeAll: null, alfaAll: null, byRule: {} };

  const writeFile = (name, content) => {
    fs.writeFileSync(path.join(csvDir, name), content);
    return `csv/${name}`;
  };

  // "All pages with an axe violation" / "...Alfa failure".
  if (summary.pagesWithAxeList?.length) {
    links.axeAll = writeFile('axe-pages-with-violations.csv', toCsv(['url'], summary.pagesWithAxeList.map((u) => [u])));
  }
  if (summary.pagesWithAlfaList?.length) {
    links.alfaAll = writeFile('alfa-pages-with-failures.csv', toCsv(['url'], summary.pagesWithAlfaList.map((u) => [u])));
  }

  // Per-rule affected-page CSVs (axe, alfa, deprecated-html).
  const ruleSets = [
    ['axe-core', summary.axe?.rules],
    ['alfa', summary.alfa?.rules],
    ['deprecated-html', summary.deprecatedHtml?.rules],
  ];
  for (const [engine, rules] of ruleSets) {
    for (const [ruleId, rule] of Object.entries(rules ?? {})) {
      if (!rule.affectedPages?.length) continue;
      const name = `${ruleSlug(engine, ruleId)}.csv`;
      const rows = rule.affectedPages.map((p) => [p.url, p.instances]);
      links.byRule[`${engine}:${ruleId}`] = writeFile(name, toCsv(['url', 'instances'], rows));
    }
  }
  return links;
}

/**
 * Build a priority-pages view: for every URL that has been scanned by at
 * least one engine, compute a composite score to rank the most problematic
 * pages — factoring in accessibility bug severity, Lighthouse performance
 * score, and page coverage across engines. Returns an array sorted by
 * descending priority (worst pages first).
 *
 * Inputs:
 *   bugs       — array of bug report objects (from buildBugReports)
 *   lhDetail   — array of { url, scores, metrics } from lighthouse.pageDetail
 *   total      — total pages scanned (for percentage calculations)
 *
 * Each output row has:
 *   url, priority_score, a11y_critical_bugs, a11y_high_bugs,
 *   a11y_medium_bugs, a11y_low_bugs, lh_performance, lh_accessibility,
 *   lh_lcp_ms, lh_tbt_ms, top_a11y_issues (pipe-separated rule labels)
 */
export function buildPriorityPages(bugs, lhDetail, total) {
  const byUrl = new Map(); // url -> accumulator

  const get = (url) => {
    if (!byUrl.has(url)) {
      byUrl.set(url, {
        url,
        a11y_critical: 0, a11y_serious: 0, a11y_moderate: 0, a11y_minor: 0,
        a11y_issues: [], // { severity, label }
        lh_performance: null, lh_accessibility: null,
        lh_lcp_ms: null, lh_tbt_ms: null, lh_cls: null,
      });
    }
    return byUrl.get(url);
  };

  // Tally accessibility bugs per affected page.
  const sevKey = { Critical: 'a11y_critical', Serious: 'a11y_serious', Moderate: 'a11y_moderate', Minor: 'a11y_minor' };
  for (const bug of bugs ?? []) {
    const affectedUrls = bug.affected_pages ?? bug.example_pages ?? (bug.url ? [bug.url] : []);
    for (const url of affectedUrls) {
      const row = get(url);
      const k = sevKey[bug.severity];
      if (k) row[k]++;
      if (row.a11y_issues.length < 5) {
        row.a11y_issues.push({ severity: bug.severity, label: bug.rule_label ?? bug.rule_id });
      }
    }
  }

  // Merge Lighthouse per-page data.
  for (const p of lhDetail ?? []) {
    const row = get(p.url);
    row.lh_performance = p.scores?.performance ?? null;
    row.lh_accessibility = p.scores?.accessibility ?? null;
    row.lh_lcp_ms = p.metrics?.largestContentfulPaintMs ?? null;
    row.lh_tbt_ms = p.metrics?.totalBlockingTimeMs ?? null;
    row.lh_cls = p.metrics?.cumulativeLayoutShift ?? null;
  }

  // Compute composite priority score (higher = worse page, fix first):
  //   Critical bugs: 40 pts each
  //   Serious bugs: 20 pts each
  //   Moderate bugs: 8 pts each
  //   Minor bugs: 2 pts each
  //   Lighthouse performance penalty: (100 - score) × 0.3, capped at 30
  // Only pages with at least one a11y finding or a very low LH score are included.
  const rows = [];
  for (const [, row] of byUrl) {
    const lhPenalty = row.lh_performance != null ? Math.min(30, (100 - row.lh_performance) * 0.3) : 0;
    const a11yScore = row.a11y_critical * 40 + row.a11y_serious * 20 + row.a11y_moderate * 8 + row.a11y_minor * 2;
    const priority_score = Math.round(a11yScore + lhPenalty);
    const hasA11y = a11yScore > 0;
    const hasLhProblem = row.lh_performance != null && row.lh_performance < 50;
    if (!hasA11y && !hasLhProblem) continue;
    rows.push({
      url: row.url,
      priority_score,
      a11y_critical_bugs: row.a11y_critical,
      a11y_serious_bugs: row.a11y_serious,
      a11y_moderate_bugs: row.a11y_moderate,
      a11y_minor_bugs: row.a11y_minor,
      lh_performance: row.lh_performance,
      lh_accessibility: row.lh_accessibility,
      lh_lcp_ms: row.lh_lcp_ms,
      lh_tbt_ms: row.lh_tbt_ms,
      lh_cls: row.lh_cls,
      top_a11y_issues: row.a11y_issues.map((i) => `[${i.severity}] ${i.label}`).join(' | '),
    });
  }

  return rows.sort((a, b) => b.priority_score - a.priority_score);
}

/**
 * Write priority-pages.csv and priority-pages.json.
 * Returns { csv, json } with relative paths or nulls.
 */
export function writePriorityPages(repDir, domain, week, generatedAt, bugs, lhDetail, total) {
  const rows = buildPriorityPages(bugs, lhDetail, total);
  if (!rows.length) return { csv: null, json: null };

  // CSV: flat, spreadsheet-ready.
  const headers = ['priority_score', 'url', 'a11y_critical_bugs', 'a11y_serious_bugs', 'a11y_moderate_bugs', 'a11y_minor_bugs', 'lh_performance', 'lh_accessibility', 'lh_lcp_ms', 'lh_tbt_ms', 'lh_cls', 'top_a11y_issues'];
  const csvRows = rows.map((r) => [
    r.priority_score, r.url,
    r.a11y_critical_bugs, r.a11y_serious_bugs, r.a11y_moderate_bugs, r.a11y_minor_bugs,
    r.lh_performance ?? '', r.lh_accessibility ?? '',
    r.lh_lcp_ms ?? '', r.lh_tbt_ms ?? '', r.lh_cls ?? '',
    r.top_a11y_issues,
  ]);
  fs.writeFileSync(path.join(repDir, 'priority-pages.csv'), toCsv(headers, csvRows));

  // JSON: richer, AI-friendly.
  const doc = {
    domain,
    week,
    generated_at: generatedAt,
    description: 'Pages ranked by composite accessibility + performance priority score. Critical a11y bugs = 40 pts, Serious = 20, Moderate = 8, Minor = 2. Lighthouse performance penalty up to 30 pts. Higher score = fix first.',
    total_pages_scanned: total,
    priority_pages: rows,
  };
  fs.writeFileSync(path.join(repDir, 'priority-pages.json'), JSON.stringify(doc, null, 1));

  return { csv: 'priority-pages.csv', json: 'priority-pages.json' };
}
