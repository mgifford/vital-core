import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderAccessibilityPage, renderDomainReport, renderStandardsPage, renderSecurityPage, renderHistoryPage, renderLighthousePage, renderIndex, statTile, redirectStub, PAGE_REDIRECTS } from '../../src/report-html.js';

test('related-links: a domain page links the JSON API, API.md, and MCP.md in <head>', () => {
  const target = { key: 'd', domain: 'd' };
  const summary = {
    week: '2026-W24',
    standards: { pagesChecked: 10, checks: [{ id: 'title', label: 'Has a title', rate: 100, pass: 10, total: 10 }], social: [] },
  };
  const html = renderStandardsPage(target, summary);
  assert.match(
    html,
    /<link rel="alternate" type="application\/json" href="\.\.\/\.\.\/\.\.\/api\/v1\/d\/2026-W24\/findings\.json" title="This page's findings as JSON">/,
  );
  assert.match(html, /<link rel="help" href="https:\/\/github\.com\/mgifford\/vital-core\/blob\/main\/API\.md"/);
  assert.match(html, /<link rel="help" href="https:\/\/github\.com\/mgifford\/vital-core\/blob\/main\/MCP\.md"/);
});

test('related-links: help links appear on every domain sub-page (Standards, Security, Accessibility)', () => {
  const target = { key: 'd', domain: 'd' };
  const summary = {
    week: '2026-W24',
    standards: { pagesChecked: 10, checks: [{ id: 'title', label: 'Has a title', rate: 100, pass: 10, total: 10 }], social: [] },
    security: { passed: 1, total: 1, checks: [{ id: 'https', label: 'Serves HTTPS', pass: true }] },
  };
  for (const html of [renderStandardsPage(target, summary), renderSecurityPage(target, summary)]) {
    assert.match(html, /rel="help" href="https:\/\/github\.com\/mgifford\/vital-core\/blob\/main\/API\.md"/);
    assert.match(html, /rel="help" href="https:\/\/github\.com\/mgifford\/vital-core\/blob\/main\/MCP\.md"/);
  }
});

test('related-links: the fleet index has no domain-specific JSON alternate (no single domain+week)', () => {
  const html = renderIndex([]);
  assert.doesNotMatch(html, /rel="alternate" type="application\/json"/);
  // The help links (API.md/MCP.md) are unconditional, unlike the JSON alternate.
  assert.match(html, /rel="help" href="https:\/\/github\.com\/mgifford\/vital-core\/blob\/main\/API\.md"/);
  assert.match(html, /rel="help" href="https:\/\/github\.com\/mgifford\/vital-core\/blob\/main\/MCP\.md"/);
});

test('webmcp bridge: reaches every domain sub-page via layout(), not just Accessibility/index', () => {
  // Standards was one of 11 sub-pages that had no bridge before it moved into
  // layout() — a real regression test, not just re-testing webmcpBridgeScript
  // itself (already covered unit-by-unit in webmcp-bridge.test.js).
  const target = { key: 'd', domain: 'd', webmcpEnabled: true };
  const summary = {
    week: '2026-W24',
    standards: { pagesChecked: 10, checks: [{ id: 'title', label: 'Has a title', rate: 100, pass: 10, total: 10 }], social: [] },
  };
  const html = renderStandardsPage(target, summary);
  assert.match(html, /modelContext\.registerTool/);
  assert.match(html, /vital_get_project_context/);
});

test('webmcp bridge: absent when the domain has not opted in, even via layout()', () => {
  const target = { key: 'd', domain: 'd', webmcpEnabled: false };
  const summary = {
    week: '2026-W24',
    standards: { pagesChecked: 10, checks: [{ id: 'title', label: 'Has a title', rate: 100, pass: 10, total: 10 }], social: [] },
  };
  const html = renderStandardsPage(target, summary);
  assert.doesNotMatch(html, /registerTool/);
});

test('webmcp bridge: absent from the fleet index (no single target to scope tools to)', () => {
  const html = renderIndex([]);
  assert.doesNotMatch(html, /registerTool/);
});

// Regression: the fleet-wide "Median axe violations per page, all domains"
// overlay chart was the one remaining hand-rolled SVG chart with no
// data-parachart manifest — every other trend chart had already been
// converted to mount an accessible <para-chart> (distinct color per series,
// interactive legend) via the same ParaCharts loader. Dash patterns alone
// don't distinguish many overlapping domains.
test('cross-domain axe chart emits a per-domain ParaCharts manifest, not just dash patterns', () => {
  const wk = (week, medianViolations) => ({
    week, pagesScanned: 5, pagesAudited: 5,
    axe: { medianViolations, pagesWithViolations: 1, pagesScanned: 5 },
    alfa: { medianFailures: 0, pagesWithFailures: 0, pagesScanned: 5 },
  });
  const dashboard = [
    {
      target: { domain: 'alpha.gov', key: 'alpha.gov' },
      series: [wk('2026-W24', 8), wk('2026-W25', 5)],
      diffs: {}, bugs: [], windowSummary: wk('2026-W25', 5),
    },
    {
      target: { domain: 'beta.gov', key: 'beta.gov' },
      series: [wk('2026-W24', 3), wk('2026-W25', 2)],
      diffs: {}, bugs: [], windowSummary: wk('2026-W25', 2),
    },
  ];
  const html = renderIndex(dashboard);

  const start = html.indexOf('Median axe violations per page, all domains');
  assert.ok(start > -1, 'fleet overlay chart caption present');
  const figStart = html.lastIndexOf('<figure', start);
  assert.ok(figStart > -1, 'chart is wrapped in a <figure>');

  const figTag = html.slice(figStart, html.indexOf('>', figStart) + 1);
  assert.match(figTag, /data-parachart="/, 'figure carries a ParaCharts manifest, mountable as an accessible <para-chart>');

  const manifestMatch = figTag.match(/data-parachart="([^"]*)"/);
  const manifest = JSON.parse(manifestMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  const seriesKeys = manifest.datasets[0].series.map((s) => s.key);
  assert.deepEqual(seriesKeys.sort(), ['alpha.gov', 'beta.gov'], 'one manifest series per domain, so the runtime can color/legend each independently');

  // The SVG fallback must still carry chart-fallback so the loader hides it
  // once <para-chart> mounts (matching every other converted chart).
  const svgStart = html.indexOf('<svg', figStart);
  const svgTag = html.slice(svgStart, html.indexOf('>', svgStart) + 1);
  assert.match(svgTag, /class="linechart chart-fallback"/);
});

test('related-links: a visible footer sentence links the JSON API and MCP server on a domain page', () => {
  const target = { key: 'd', domain: 'd' };
  const summary = {
    week: '2026-W24',
    standards: { pagesChecked: 10, checks: [{ id: 'title', label: 'Has a title', rate: 100, pass: 10, total: 10 }], social: [] },
  };
  const html = renderStandardsPage(target, summary);
  assert.match(html, /Machine-readable data for this page is available through the/);
  assert.match(html, /<a href="\.\.\/\.\.\/\.\.\/api\/v1\/d\/2026-W24\/findings\.json">Vital Core JSON API<\/a>/);
  assert.match(html, /<a href="https:\/\/github\.com\/mgifford\/vital-core\/blob\/main\/MCP\.md">Vital MCP server<\/a>/);
});

test('related-links: the fleet index footer says "this site" and links the API index, not a per-domain file', () => {
  const html = renderIndex([]);
  assert.match(html, /Machine-readable data for this site is available through the/);
  assert.match(html, /<a href="api\/v1\/index\.json">Vital Core JSON API<\/a>/);
  assert.match(html, /<a href="https:\/\/github\.com\/mgifford\/vital-core\/blob\/main\/MCP\.md">Vital MCP server<\/a>/);
});

test('renderDomainReport links to History & Trends instead of embedding trend charts', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  const series = [
    {
      week: '2026-W24',
      pagesScanned: 10,
      pagesAudited: 10,
      generatedAt: '2026-06-08T00:00:00.000Z',
      axe: {
        medianViolations: 4,
        pagesScanned: 10,
        pagesWithViolations: 8,
        rules: {
          'color-contrast': { impact: 'serious', pages: 4 },
          'image-alt': { impact: 'critical', pages: 2 },
          'label': { impact: 'moderate', pages: 3 },
          'link-name': { impact: 'minor', pages: 1 },
        },
      },
      alfa: { medianFailures: 12, pagesScanned: 4, pagesWithFailures: 3 },
      sustainability: { medianBytes: 204800, medianRequests: 12 },
      plainLanguage: { medianReadingEase: 63 },
      lighthouse: {
        medianPerformance: 71,
        medianAccessibility: 76,
        medianBestPractices: 68,
        medianSeo: 74,
        metrics: {
          firstContentfulPaintMs: 1300,
          largestContentfulPaintMs: 2450,
          speedIndexMs: 3100,
          totalBlockingTimeMs: 160,
          cumulativeLayoutShift: 0.14,
        },
      },
      coverage: { axe: 10, alfa: 4, 'plain-language': 3, sustainability: 4, lighthouse: 2 },
    },
    {
      week: '2026-W25',
      pagesScanned: 11,
      pagesAudited: 11,
      generatedAt: '2026-06-15T00:00:00.000Z',
      axe: {
        medianViolations: 3,
        pagesScanned: 11,
        pagesWithViolations: 7,
        rules: {
          'color-contrast': { impact: 'serious', pages: 3 },
          'image-alt': { impact: 'critical', pages: 2 },
          'label': { impact: 'moderate', pages: 2 },
          'link-name': { impact: 'minor', pages: 1 },
        },
      },
      alfa: { medianFailures: 10, pagesScanned: 4, pagesWithFailures: 2 },
      sustainability: { medianBytes: 189440, medianRequests: 10 },
      plainLanguage: { medianReadingEase: 65 },
      lighthouse: {
        medianPerformance: 76,
        medianAccessibility: 79,
        medianBestPractices: 73,
        medianSeo: 78,
        metrics: {
          firstContentfulPaintMs: 1180,
          largestContentfulPaintMs: 2210,
          speedIndexMs: 2800,
          totalBlockingTimeMs: 120,
          cumulativeLayoutShift: 0.11,
        },
      },
      coverage: { axe: 11, alfa: 4, 'plain-language': 4, sustainability: 4, lighthouse: 2 },
    },
  ];

  const html = renderDomainReport(
    target,
    series[1],
    series[0],
    null,
    series,
    [],
    { byRule: {}, bugsAll: null },
    null
  );

  // WP2: the multi-week trend charts moved to the History & Trends page; the
  // overview links there rather than embedding them.
  assert.match(html, /History &amp; Trends →/);
  assert.match(html, /href="history\.html"/);
  assert.doesNotMatch(html, /Pages affected by axe severity over 2 weeks/);
  assert.doesNotMatch(html, /Lighthouse category scores over 2 weeks/);
  assert.doesNotMatch(html, /Score trends/);
  assert.doesNotMatch(html, /Accessibility score \(0-100\)/);
  assert.doesNotMatch(html, /Google Lighthouse score \(median\)/);
  assert.doesNotMatch(html, /Largest Contentful Paint \(median\)/);
  assert.doesNotMatch(html, /Median page weight \(KB\)/);
});

// Issue #177 (reopened scope): visitors look for the Lighthouse trend on the
// Lighthouse page itself (fast.html), not buried on the separate History &
// Trends page. renderLighthousePage should embed the same multi-category
// chart history.html already builds, when given multi-week series.
test('renderLighthousePage embeds the Lighthouse category trend chart when multi-week series is available', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  const lh = {
    medianPerformance: 76, medianAccessibility: 79, medianBestPractices: 73, medianSeo: 78,
    metrics: { firstContentfulPaintMs: 1180, largestContentfulPaintMs: 2210, speedIndexMs: 2800, totalBlockingTimeMs: 120, cumulativeLayoutShift: 0.11 },
    pageDetail: [{
      url: 'https://www.example.gov/a',
      scores: { performance: 76, accessibility: 79, bestPractices: 73, seo: 78, agentic: null },
      metrics: { firstContentfulPaintMs: 1180, largestContentfulPaintMs: 2210, speedIndexMs: 2800, totalBlockingTimeMs: 120, cumulativeLayoutShift: 0.11 },
    }],
  };
  const summary = { week: '2026-W25', lighthouse: lh };
  const series = [
    { week: '2026-W24', lighthouse: { medianPerformance: 71, medianAccessibility: 76, medianBestPractices: 68, medianSeo: 74 } },
    { week: '2026-W25', lighthouse: lh },
  ];

  const withHistory = renderLighthousePage(target, summary, null, null, series);
  assert.match(withHistory, /Lighthouse category scores over 2 weeks/, 'trend chart embedded with 2+ weeks of series data');
  assert.match(withHistory, /History &amp; Trends →/, 'still links to the full History \\& Trends page');
  assert.match(withHistory, /data-parachart="/, 'chart carries a ParaCharts manifest, same as every other trend chart');

  // Single-week (or omitted) series: no trend section, no crash, no dangling heading.
  const singleWeek = renderLighthousePage(target, summary, null, null, [series[1]]);
  assert.doesNotMatch(singleWeek, /Lighthouse category scores over/, 'no trend chart with fewer than 2 weeks');

  const omitted = renderLighthousePage(target, summary, null, null);
  assert.doesNotMatch(omitted, /Lighthouse category scores over/, 'no trend chart when series is omitted entirely (back-compat default)');
});

test('renderDomainReport surfaces the viewer exclusion control under the inventory line (issue #209)', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  const mkWeek = (week) => ({
    week, pagesScanned: 11, pagesAudited: 11, generatedAt: '2026-06-15T00:00:00.000Z',
    axe: { medianViolations: 3, pagesScanned: 11, pagesWithViolations: 7, rules: { 'image-alt': { impact: 'critical', pages: 2 } } },
    alfa: { medianFailures: 10, pagesScanned: 4, pagesWithFailures: 2 },
    sustainability: { medianBytes: 189440, medianRequests: 10 },
    plainLanguage: { medianReadingEase: 65 },
    lighthouse: { medianPerformance: 76, medianAccessibility: 79, medianBestPractices: 73, medianSeo: 78, metrics: {} },
    coverage: { axe: 11 },
  });
  const series = [mkWeek('2026-W24'), mkWeek('2026-W25')];
  const invSummary = { totalKnownPages: 100, pagesWithKnownIssues: 40, scannedThisWeek: 10 };
  const html = renderDomainReport(target, series[1], series[0], null, series, [], { byRule: {}, bugsAll: null }, invSummary);

  // The control renders on the landing page, keyed to the same per-domain store.
  assert.match(html, /<details class="exclude-box" id="exclude-box" hidden data-domain-key="www\.example\.gov">/);
  assert.match(html, /id="exclude-input"/);
  assert.match(html, /vital-exclude:/, 'shared client filter script present');

  // …positioned directly under the "unique pages scanned" inventory line.
  const invIdx = html.indexOf('unique pages have been scanned');
  const boxIdx = html.indexOf('id="exclude-box"');
  assert.ok(invIdx !== -1 && boxIdx !== -1 && boxIdx > invIdx, 'exclusion box comes after the inventory line');

  // C-02: a score-scope note exists (hidden; the script reveals it when a filter is active),
  // and the headline score is never recomputed server-side.
  assert.match(html, /id="score-scope-note" hidden/);
  assert.match(html, /this whole-site score still reflects every scanned page/);
});

test('renderDomainReport Layer-1: three deltas, biggest-win callout, demoted detail', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  const summary = {
    week: '2026-W24', pagesScanned: 10, pagesAudited: 10,
    generatedAt: '2026-06-08T00:00:00.000Z',
    axe: { medianViolations: 4, pagesScanned: 10, pagesWithViolations: 8, rules: {} },
    alfa: { medianFailures: 1, pagesScanned: 10, pagesWithFailures: 3, rules: {} },
    coverage: { axe: 10, alfa: 10 },
  };
  const bugs = [
    {
      instance_id: 'VS-abc12345', pattern_id: 'VS-pat1', tool: 'axe-core', rule_id: 'image-alt',
      summary: 'Images must have alternative text', severity: 'Critical', wcag_sc: '1.1.1',
      frequency: { pages_affected: 7, total_pages_scanned: 10, instances: 12 },
      remediation_tip: 'Add alt text to every informative image.',
      impact: { groups: [{ group: 'Blind', prevalence: 0.02 }] },
    },
    {
      instance_id: 'VS-def67890', pattern_id: 'VS-pat2', tool: 'axe-core', rule_id: 'label',
      summary: 'Form elements must have labels', severity: 'Serious', wcag_sc: '4.1.2',
      frequency: { pages_affected: 2, total_pages_scanned: 10, instances: 3 },
      impact: { groups: [] },
    },
  ];
  const progress = {
    new: [{ id: 'VS-pat1', severity: 'Critical' }],
    fixed: [{ id: 'VS-x', severity: 'Serious' }, { id: 'VS-y', severity: 'Minor' }],
    regressed: [],
    deltaSeries: [
      { week: '2026-W23', new: 0, fixed: 1, regressed: 0 },
      { week: '2026-W24', new: 1, fixed: 2, regressed: 0 },
    ],
  };

  const html = renderDomainReport(target, summary, null, null, [summary], bugs,
    { byRule: {}, bugsAll: null }, null, progress);

  // Three delta tiles with their counts (a momentum sparkline follows each).
  assert.match(html, /New this week<\/dt><dd>1[ <]/);
  assert.match(html, /Fixed this week<\/dt><dd>2[ <]/);
  assert.match(html, /Regressed this week<\/dt><dd>0[ <]/);
  // Momentum sparklines on the tiles (deltaSeries has >=2 points).
  assert.match(html, /Fixed this week<\/dt><dd>2 <svg class="spark"/);
  // Tone: fixed is a positive (better) tile when >0; regressed has no worse tone at 0.
  assert.match(html, /<div class="stat-better"><dt>Fixed this week/);
  assert.doesNotMatch(html, /stat-worse"><dt>Regressed/);

  // Biggest-win callout links to the top-ranked finding's canonical location.
  assert.match(html, /class="callout callout-win"/);
  assert.match(html, /Biggest available win/);
  assert.match(html, /<a href="accessible\.html#VS-abc12345"><strong>Images must have alternative text<\/strong><\/a>/);
  // The callout headlines the highest-priority finding (Critical, 7 pages), not the Serious one.
  const callout = html.match(/<aside class="callout callout-win"[\s\S]*?<\/aside>/)[0];
  assert.doesNotMatch(callout, /Form elements must have labels/);

  // Supporting detail is demoted into a collapsed drill-down (still in the DOM).
  assert.match(html, /<details class="drilldown">/);
  assert.match(html, /id="h-summary"/);
  assert.match(html, /This week at a glance/);
});

test('renderDomainReport progress panel: burndown, streaks, triage count, fixed list', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  const mk = (week, mv) => ({
    week, pagesScanned: 10, pagesAudited: 10, generatedAt: '2026-06-08T00:00:00.000Z',
    axe: { medianViolations: mv, pagesScanned: 10, pagesWithViolations: 8, rules: {} },
    alfa: { medianFailures: 1, pagesScanned: 10, pagesWithFailures: 3, rules: {} },
    coverage: { axe: 10, alfa: 10 },
  });
  const series = [mk('2026-W23', 6), mk('2026-W24', 4)];
  const bugs = [{
    instance_id: 'VS-abc12345', pattern_id: 'VS-p1', tool: 'axe-core', rule_id: 'image-alt',
    summary: 'Images must have alternative text', severity: 'Critical', wcag_sc: '1.1.1',
    frequency: { pages_affected: 7, total_pages_scanned: 10, instances: 12 }, impact: { groups: [] },
  }];
  const progress = {
    new: [],
    fixed: [{ id: 'VS-f1', severity: 'Serious', summary: 'Document must have a title element', lastAffectedPages: ['https://www.example.gov/about'] }],
    regressed: [],
    fixedUnconfirmed: [{ id: 'VS-f2', severity: 'Moderate', summary: 'Link name is not descriptive', lastAffectedPages: [] }],
    burndown: [
      { week: '2026-W23', critical: 2, serious: 1, moderate: 0, minor: 0 },
      { week: '2026-W24', critical: 0, serious: 1, moderate: 0, minor: 0 },
    ],
    streaks: [{ severity: 'critical', weeks: 1 }, { severity: 'moderate', weeks: 2 }, { severity: 'minor', weeks: 2 }],
  };

  const html = renderDomainReport(target, series[1], series[0], null, series, bugs,
    { byRule: {}, bugsAll: null }, null, progress);

  // Progress section with heading.
  assert.match(html, /id="h-progress"/);
  // Streak badge.
  assert.match(html, /class="streak-badge">✓ 1 week\(s\) with no Critical findings/);
  // Client-side triage-completion placeholder carries the page's instance ids + template.
  assert.match(html, /class="triage-progress" hidden data-triage-ids="\[&quot;VS-abc12345&quot;\]"/);
  assert.match(html, /data-tmpl="@done of @total triaged"/);
  assert.match(html, /localStorage\.getItem\('vital-triage:'/);
  // Burndown chart (finding counts) with its own caption, distinct from the pages-affected trend.
  assert.match(html, /Open findings by severity over 2 weeks/);
  // Fixed-this-week list: pattern id + evidence link (issue #222 FR-004).
  assert.match(html, /Document must have a title element/);
  assert.match(html, /<a href="https:\/\/www\.example\.gov\/about"><span class="pattern-id">VS-f1<\/span> Document must have a title element<\/a>/);

  // Coverage-lost findings render in a visibly separate list, never merged into "Fixed this week".
  assert.match(html, /Dropped from this week's sample/);
  assert.match(html, /fixed-list-unconfirmed/);
  assert.match(html, /Link name is not descriptive/);
  // No lastAffectedPages recorded for this one — degrades to plain text, not a dead link.
  assert.doesNotMatch(html, /<a href=""[^>]*>[^<]*Link name is not descriptive/);
  const fixedSection = html.slice(html.indexOf('Fixed this week'), html.indexOf("Dropped from this week's sample"));
  assert.doesNotMatch(fixedSection, /Link name is not descriptive/, 'coverage-lost finding must not appear inside the confirmed-fixed list');
});

test('renderAccessibilityPage shows engine and rule id in bug summaries', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  const summary = {
    week: '2026-W25',
    pagesScanned: 4,
    axe: { rules: { 'image-alt': { count: 2, pages: 2, help: 'Images must have alt text', helpUrl: 'https://example.gov/axe/image-alt', tags: ['wcag111'], examplePages: ['https://example.gov/a'], affectedPages: [{ url: 'https://example.gov/a', instances: 2 }], instances: [{ url: 'https://example.gov/a', target: 'img', html: '<img>' }], impact: 'serious' } } },
    alfa: { rules: { 'sia-r12': { count: 1, pages: 1, ruleUrl: 'https://example.gov/alfa/sia-r12', examplePages: ['https://example.gov/b'], affectedPages: [{ url: 'https://example.gov/b', instances: 1 }], instances: [{ url: 'https://example.gov/b', target: 'a', html: '<a>' }], impact: 'serious' } } },
    consensus: null,
  };
  const bugs = [
    {
      instance_id: 'VS-12345678',
      pattern_id: 'VS-12345678',
      url: 'https://example.gov/a',
      xpath: 'img',
      wcag_sc: '1.1.1',
      wcag_name: 'Non-text Content',
      wcag_level: 'A',
      wcag_version: '2.0',
      wcag_category: 'WCAG 2.0 A',
      rule_id: 'image-alt',
      rule_label: 'Images must have alternative text',
      engine_key: 'axe-core',
      tool: 'axe-core 4.11.0',
      rule_url: 'https://example.gov/axe/image-alt',
      severity: 'Critical',
      frequency: { instances: 2, pages_affected: 2, total_pages_scanned: 4 },
      summary: 'Images must have alternative text (WCAG 1.1.1)',
      description: 'Images must have alternative text. Detected by axe-core rule image-alt on 2 of 4 scanned pages (2 instances).',
      examples: [],
      example_pages: ['https://example.gov/a'],
      affected_pages: ['https://example.gov/a'],
      impact: { groups: [], summary: 'Affects vision users.' },
      testing_environment: 'Automated: axe-core 4.11.0, headless Chromium (Playwright). Manual AT verification: Not captured by automated scan — requires manual testing.',
      steps_to_reproduce: ['Open https://example.gov/a.', 'Locate the affected element.', 'Confirm the axe-core finding for rule image-alt against WCAG 1.1.1 Non-text Content.'],
      remediation_tip: null,
      suggested_fix: 'See remediation guidance: https://example.gov/axe/image-alt',
      default_visible: true,
      priority_tier: 0,
    },
  ];

  const html = renderAccessibilityPage(target, summary, bugs, { byRule: {}, bugsAll: null }, { keyPages: [] });

  assert.match(html, /<span class="engine-badge" data-engine="axe-core">axe<\/span>/);
  assert.match(html, /<span class="rule-badge">image-alt<\/span>/);
  assert.match(html, /Images must have alternative text/);
});

test('renderAccessibilityPage emits the viewer URL-exclusion control (issue #209)', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  const summary = {
    week: '2026-W25', pagesScanned: 4,
    axe: { rules: {} }, alfa: { rules: {} }, deprecatedHtml: { rules: {} },
    componentClusters: null, consensus: null,
  };
  const mkBug = (id, url, pages) => ({
    instance_id: id, pattern_id: id, url, xpath: 'img', wcag_sc: '1.1.1', wcag_name: 'Non-text Content',
    wcag_level: 'A', wcag_version: '2.0', wcag_category: 'WCAG 2.0 A', rule_id: 'image-alt',
    rule_label: 'Images must have alternative text', engine_key: 'axe-core', tool: 'axe-core 4.11.0',
    rule_url: 'https://example.gov/axe/image-alt', severity: 'Critical',
    frequency: { instances: pages.length, pages_affected: pages.length, total_pages_scanned: 4 },
    summary: `Alt text (${id})`, description: 'd', examples: [], example_pages: pages, affected_pages: pages,
    impact: { groups: [], summary: 's' }, testing_environment: 'e',
    steps_to_reproduce: ['a'], remediation_tip: null, suggested_fix: 'f', default_visible: true, priority_tier: 0,
  });
  const bugs = [
    mkBug('VS-medic01', 'https://example.gov/medicare/x', ['https://example.gov/medicare/x', 'https://example.gov/medicare/y']),
    mkBug('VS-about002', 'https://example.gov/about', ['https://example.gov/about']),
  ];
  const html = renderAccessibilityPage(target, summary, bugs, { byRule: {}, bugsAll: null }, { keyPages: [] });

  // Control box, keyed to the domain, hidden by default (revealed by the PE script).
  assert.match(html, /<details class="exclude-box" id="exclude-box" hidden data-domain-key="www\.example\.gov"/);
  // Phase 2: the Accessibility page carries the bugs.json href for filtered downloads.
  assert.match(html, /data-bugs-json="bugs\.json"/);
  assert.match(html, /id="exclude-dl-csv"/, 'has the filtered-CSV download control');
  assert.match(html, /id="exclude-dl-json"/, 'has the filtered-JSON download control');
  assert.match(html, /id="exclude-input"/, 'has the pattern textarea');
  assert.match(html, /id="exclude-apply"/, 'has an Apply button');
  assert.match(html, /id="exclude-clear"/, 'has a Clear button');
  assert.match(html, /id="exclude-banner"/, 'has the dynamic banner slot');

  // Client filter script is present and reads the per-domain localStorage key.
  assert.match(html, /vital-exclude:/, 'script references the localStorage key');

  // Per-finding data the client filter relies on.
  assert.match(html, /data-example-url="https:\/\/example\.gov\/medicare\/x"/);
  assert.match(html, /class="affected" data-complete="1"/);
  assert.match(html, /data-excluded=""/, 'findings start un-excluded (server never pre-hides for the viewer)');

  // JS-off baseline: every finding is in the server HTML; nothing pre-hidden by the viewer layer.
  assert.equal((html.match(/class="bug sev-/g) || []).length, 2, 'both findings render server-side');
  assert.doesNotMatch(html, /data-excluded="1"/, 'no finding is excluded in the static HTML');

  // Severity taxonomy unchanged (C-07): internal keys stay lowercase.
  assert.match(html, /class="bug sev-critical/);

  // Portability controls (WP04): export / import / copy-share reuse the triage IO pattern.
  assert.match(html, /id="exclude-export"/);
  assert.match(html, /id="exclude-import"/);
  assert.match(html, /id="exclude-share"/);
  assert.match(html, /['"]vital-exclude['"]/, 'share payload carries the vital-exclude type');
});

test('renderAccessibilityPage honours the config url_exclude_patterns baseline (excludePatterns arg)', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  const summary = {
    week: '2026-W25', pagesScanned: 4,
    axe: { rules: {} }, alfa: { rules: {} }, deprecatedHtml: { rules: {} },
    componentClusters: null, consensus: null,
  };
  const mkBug = (id, url, pages) => ({
    instance_id: id, pattern_id: id, url, xpath: 'img', wcag_sc: '1.1.1', wcag_name: 'Non-text Content',
    wcag_level: 'A', wcag_version: '2.0', wcag_category: 'WCAG 2.0 A', rule_id: 'image-alt',
    rule_label: 'Images must have alternative text', engine_key: 'axe-core', tool: 'axe-core 4.11.0',
    rule_url: 'https://example.gov/axe/image-alt', severity: 'Critical',
    frequency: { instances: pages.length, pages_affected: pages.length, total_pages_scanned: 4 },
    summary: `finding-${id}`, description: 'd', examples: [], example_pages: pages, affected_pages: pages,
    impact: { groups: [], summary: 's' }, testing_environment: 'e',
    steps_to_reproduce: ['a'], remediation_tip: null, suggested_fix: 'f', default_visible: true, priority_tier: 0,
  });
  const bugs = [
    mkBug('VS-legacy01', 'https://example.gov/legacy.aspx', ['https://example.gov/legacy.aspx?id=9']),
    mkBug('VS-keep0002', 'https://example.gov/about', ['https://example.gov/about']),
  ];
  // The 6th arg is the config baseline — must be threaded from aggregate.js.
  const html = renderAccessibilityPage(target, summary, bugs, { byRule: {}, bugsAll: null }, { keyPages: [] }, ['.aspx']);
  assert.doesNotMatch(html, /finding-VS-legacy01/, 'a finding only on .aspx pages is filtered out at build');
  assert.match(html, /finding-VS-keep0002/, 'other findings remain');
});

test('renderAccessibilityPage caps findings rendered in full at max_html_issues, summarising the rest', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  const summary = {
    week: '2026-W25', pagesScanned: 100,
    axe: { rules: {} }, alfa: { rules: {} }, deprecatedHtml: { rules: {} },
    componentClusters: null, consensus: null,
  };
  const mkBug = (i) => ({
    instance_id: `VS-cap${i}`, pattern_id: `VS-cap${i}`, url: `https://example.gov/p${i}`, xpath: 'img',
    wcag_sc: '1.1.1', wcag_name: 'Non-text Content', wcag_level: 'A', wcag_version: '2.0', wcag_category: 'WCAG 2.0 A',
    rule_id: `rule-${i}`, rule_label: `Rule ${i}`, engine_key: 'axe-core', tool: 'axe-core', rule_url: `https://example.gov/r${i}`,
    severity: 'Critical', frequency: { instances: 5, pages_affected: 20, total_pages_scanned: 100 },
    summary: `cap-finding-${i}`, description: 'd', examples: [], example_pages: [], affected_pages: [`https://example.gov/p${i}`],
    impact: { groups: [], summary: 's' }, testing_environment: 'e', steps_to_reproduce: ['a'], remediation_tip: null,
    suggested_fix: 'f', default_visible: true, priority_tier: 0,
  });
  const bugs = Array.from({ length: 8 }, (_, i) => mkBug(i));

  const capped = renderAccessibilityPage(target, summary, bugs, { byRule: {}, bugsAll: null }, { max_html_issues: 3, keyPages: [] });
  assert.equal((capped.match(/class="bug sev-/g) || []).length, 3, 'only 3 findings render in full');
  assert.match(capped, /class="overflow-findings"/, 'overflow summary section present');
  assert.match(capped, /5 more lower-priority/, '5 findings summarised (8 − 3)');

  const uncapped = renderAccessibilityPage(target, summary, bugs, { byRule: {}, bugsAll: null }, { max_html_issues: 0, keyPages: [] });
  assert.equal((uncapped.match(/class="bug sev-/g) || []).length, 8, 'cap disabled renders all in full');
  assert.doesNotMatch(uncapped, /overflow-findings/, 'no overflow section when uncapped');
});

test('renderAccessibilityPage includes expanded next-actions copy payload attributes', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  const summary = {
    week: '2026-W25',
    pagesScanned: 4,
    componentClusters: {
      design_system: 'cms-ds',
      design_system_theme: 'medicare',
      top_actions: [
        {
          id: 'cc-123',
          rule_id: 'color-contrast',
          engine_key: 'axe-core',
          severity: 'Serious',
          pages_affected: 2,
          instances: 3,
          selector_path: 'main .ds-c-alert a',
          representative_selector: 'main .ds-c-alert a',
          representative_snippet: '<a class="ds-c-alert__link">Read more</a>',
          design_components: ['ds-c-alert'],
          estimated_fix_impact: { statement: 'Fix one place, resolve ~3 finding(s) on 2 page(s).' },
          affected_pages: ['https://example.gov/a', 'https://example.gov/b'],
          affected_pages_csv: 'csv/cluster__cc-123.csv',
        },
      ],
      design_component_usage: [],
      drift_clusters: [],
    },
    axe: { rules: {} },
    alfa: { rules: {} },
    deprecatedHtml: { rules: {} },
  };
  const bugs = [
    {
      instance_id: 'VS-12345678',
      rule_id: 'color-contrast',
      rule_label: 'Elements must have sufficient color contrast',
      engine_key: 'axe-core',
      severity: 'Serious',
      wcag_sc: '1.4.3',
      wcag_name: 'Contrast (Minimum)',
      frequency: { instances: 3, pages_affected: 2, total_pages_scanned: 4 },
      impact: { groups: [{ group: 'Low vision users' }] },
      remediation_tip: 'Use a compliant foreground/background combination.',
      testing_environment: 'Automated: axe-core, headless Chromium (Playwright). Manual AT verification required.',
      steps_to_reproduce: ['Open page.', 'Inspect alert link.', 'Verify contrast ratio.'],
      example_pages: ['https://example.gov/a'],
      examples: [
        {
          url: 'https://example.gov/a',
          xpath: 'main .ds-c-alert a',
          html_snippet: '<a class="ds-c-alert__link">Read more</a>',
        },
      ],
    },
  ];

  const html = renderAccessibilityPage(target, summary, bugs, { byRule: {}, bugsAll: null }, { keyPages: [] });

  assert.match(html, /data-example-pages="\[/);
  assert.match(html, /data-affected-pages="\[/);
  assert.match(html, /data-examples="\[/);
  assert.match(html, /data-testing-environment="Automated: axe-core/);
  assert.match(html, /data-steps="\[/);

  // The "Copy as issue" / "Copy for JIRA" handlers run in the browser, so the
  // emitted inline scripts must not reference server-only symbols like the PAGES
  // map (a bare `PAGES.` there throws ReferenceError and the copy silently fails).
  // The accessibility page link must be baked in at render time instead.
  assert.doesNotMatch(html, /\bPAGES\./);
  assert.match(html, /Full scanner detail: accessible\.html/);
});

// Regression for issue #210: the Next 10 actions "Decision"/"Assigned to"/
// "Notes" fields and "Copy as issue"/"Copy for JIRA" buttons all silently did
// nothing. Root cause was `out.join('\n')` inside nextActionsScript()'s
// template literal — the outer JS engine collapsed `\n` to a real newline
// character *inside* the generated single-quoted string literal, which is a
// syntax error in a browser (only template literals allow raw newlines). The
// whole inline <script> failed to parse, so *no* listeners in it were ever
// attached — nothing was saved, and nothing was copied. Escaping to `\\n` in
// the source keeps the two characters `\` + `n` intact for the browser.
// A regex check for the literal string would not have caught this: it only
// surfaces by actually parsing the emitted script as JavaScript.
test('nextActionsSection emits a syntactically valid inline <script>', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  const summary = {
    week: '2026-W25',
    pagesScanned: 4,
    componentClusters: {
      design_system: 'none',
      top_actions: [
        {
          id: 'cc-abc',
          rule_id: 'color-contrast',
          engine_key: 'axe-core',
          severity: 'Serious',
          pages_affected: 2,
          instances: 3,
          selector_path: 'main a',
          representative_selector: 'main a',
          representative_snippet: '<a>Read more</a>',
          design_components: [],
          estimated_fix_impact: { statement: 'Fix one place, resolve ~3 finding(s) on 2 page(s).' },
          affected_pages: ['https://example.gov/a'],
          affected_pages_csv: null,
        },
      ],
      design_component_usage: [],
      drift_clusters: [],
    },
    axe: { rules: {} },
    alfa: { rules: {} },
    deprecatedHtml: { rules: {} },
  };
  const html = renderAccessibilityPage(target, summary, [], { byRule: {}, bugsAll: null }, { keyPages: [] });

  const start = html.indexOf('<script>', html.indexOf('id="action-io"'));
  const end = html.indexOf('</script>', start);
  assert.ok(start > -1 && end > start, 'expected the next-actions <script> block');
  const body = html.slice(start + '<script>'.length, end).replace(/<\\\//g, '</');

  // A syntax error throws when the Script is constructed, before any code runs.
  assert.doesNotThrow(() => new vm.Script(body), 'next-actions inline script must be valid JavaScript');
});

test('statTile renders a ledger cell with localized label and preformatted value', () => {
  const html = statTile('Median page weight', '128 KB');
  assert.match(html, /^<div><dt>Median page weight<\/dt><dd>128 KB<\/dd><\/div>$/);
});

test('statTile shows a delta only when deltaN is provided', () => {
  const withDelta = statTile('Broken links', '3', { deltaN: 2 });
  assert.match(withDelta, /<span class="delta worse">\+2 /);
  const noDelta = statTile('Broken links', '3');
  assert.doesNotMatch(noDelta, /class="delta/);
});

test('statTile honours deltaOpts (goodWhenDown/unit)', () => {
  // Fewer requests is better: a negative delta should read as "better".
  const html = statTile('Median requests', '42', { deltaN: -5, deltaOpts: { unit: ' req' } });
  assert.match(html, /<span class="delta better">-5 req /);
});

test('statTile emits a sparkline for two or more points, none for fewer', () => {
  const withSpark = statTile('Median axe violations', '4', { spark: [6, 5, 4] });
  assert.match(withSpark, /<svg class="spark"/);
  assert.doesNotMatch(statTile('Median axe violations', '4', { spark: [4] }), /<svg class="spark"/);
  assert.doesNotMatch(statTile('Median axe violations', '4'), /<svg class="spark"/);
});

test('statTile output nests inside a dl.ledger without extra wrappers', () => {
  const dl = `<dl class="ledger">${statTile('A', '1')}${statTile('B', '2')}</dl>`;
  assert.match(dl, /^<dl class="ledger"><div><dt>A<\/dt><dd>1<\/dd><\/div><div><dt>B<\/dt><dd>2<\/dd><\/div><\/dl>$/);
});

test('redirectStub redirects to the new page and preserves the URL fragment', () => {
  const html = redirectStub('accessible', 'en');
  assert.match(html, /<link rel="canonical" href="accessible\.html">/);
  assert.match(html, /<meta http-equiv="refresh" content="0;url=accessible\.html">/);
  // Hash-preserving: a pinned deep link keeps its #fragment through the redirect.
  assert.match(html, /location\.replace\("accessible\.html" \+ location\.hash\)/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<html lang="en">/);
});

test('PAGE_REDIRECTS maps every renamed page old→new', () => {
  assert.deepEqual(PAGE_REDIRECTS, {
    accessibility: 'accessible', lighthouse: 'fast', readability: 'findable', 'third-party': 'third-parties',
  });
});

test('subnav is grouped by outcome question and links to the renamed pages', () => {
  const target = { key: 'd', domain: 'd' };
  const summary = {
    week: '2026-W24', pagesScanned: 1, pagesAudited: 1, generatedAt: '2026-06-08T00:00:00.000Z',
    axe: { medianViolations: 0, pagesScanned: 1, pagesWithViolations: 0, rules: {} },
    alfa: { medianFailures: 0, pagesScanned: 1, pagesWithFailures: 0, rules: {} }, coverage: { axe: 1 },
  };
  const html = renderDomainReport(target, summary, null, null, [summary], [], { byRule: {}, bugsAll: null }, null);
  // Outcome group headings present.
  for (const q of ['Accessible?', 'Fast?', 'Findable?', 'Trustworthy?', 'Sustainable?']) {
    assert.match(html, new RegExp(`subnav-heading[^>]*>${q.replace('?', '\\?')}<`));
  }
  // Nav links use the outcome-aligned filenames.
  assert.match(html, /href="accessible\.html">Accessibility</);
  assert.match(html, /href="fast\.html">Lighthouse</);
  assert.match(html, /href="findable\.html">Readability</);
  assert.match(html, /href="third-parties\.html">Third parties</);
  // standards is now under Findable?, security under Trustworthy?.
  assert.match(html, /href="standards\.html">Standards</);
  assert.match(html, /href="security\.html">Security</);
});

test('standards page (Findable) and security page (Trustworthy) split cleanly', () => {
  const target = { key: 'd', domain: 'd' };
  const summary = {
    week: '2026-W24',
    standards: {
      pagesChecked: 10,
      checks: [
        { id: 'title', label: 'Has a title', rate: 100, pass: 10, total: 10 },
      ],
      social: [{ platform: 'mastodon', href: 'https://example.social/@x' }],
    },
    resilience: {
      pagesChecked: 10,
      checks: [
        { id: 'pwa-service-worker', label: 'Service worker registered', rate: 0, pass: 0, total: 10, why: 'Enables offline access.' },
      ],
      offline: null,
    },
    security: { passed: 3, total: 5, checks: [{ id: 'https', label: 'Serves HTTPS', pass: true }, { id: 'gov-tld', label: 'Uses a .gov domain', pass: false }] },
    publicInterest: { a11yStatement: { result: 'fail' }, carbonTxt: { result: 'unknown' }, greenWebFoundation: { result: 'pass' }, sitemaps: { xml: { found: true, url: 'https://d/sitemap.xml' }, human: { found: false } } },
  };
  const std = renderStandardsPage(target, summary);
  const sec = renderSecurityPage(target, summary);

  // Standards page: web-standards content, NOT security/public-interest.
  assert.match(std, /id="h-standards"/);
  assert.match(std, /Web standards &amp; metadata|Web standards/);
  assert.match(std, /Progressive Web Resilience/);
  assert.doesNotMatch(std, /id="h-security"/);
  assert.doesNotMatch(std, /Security & domain hygiene/);

  // Security page: security + public interest, NOT the standards table.
  assert.match(sec, /id="h-security"/);
  assert.match(sec, /Security & domain hygiene/);
  assert.match(sec, /Public interest/);
  assert.doesNotMatch(sec, /id="h-standards"/);
  // Each links to itself as the current nav item.
  assert.match(std, /<li aria-current="page">Standards<\/li>/);
  assert.match(sec, /<li aria-current="page">Security<\/li>/);
});
test('renderHistoryPage (WP1): scaffold with subnav, self-current nav, and multi-week summary', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  const series = [
    { week: '2026-W24', axe: { medianViolations: 4 } },
    { week: '2026-W25', axe: { medianViolations: 3 } },
  ];
  const html = renderHistoryPage(target, series, '2026-W25');

  // It's a real page in the subnav, marked current, linking back to the overview.
  // The ampersand in the label is HTML-escaped in the H1 and nav.
  assert.match(html, /<h1>www\.example\.gov: History &amp; Trends<\/h1>/);
  assert.match(html, /class="subnav"/);
  assert.match(html, /<li aria-current="page">History &amp; Trends<\/li>/);
  assert.match(html, /href="index\.html"/);
  // Longitudinal framing + the relocated trend-section headings.
  assert.match(html, /<strong>2<\/strong> weeks recorded/);
  assert.match(html, /Accessible\? — severity over time/);
  assert.match(html, /Fast\? — Lighthouse over time/);
  // Machine-readable trend download.
  assert.match(html, /href="\.\.\/\.\.\/\.\.\/data\/www\.example\.gov\/weekly\.json"/);
});

test('renderHistoryPage (WP2): renders the relocated severity and Lighthouse trend charts', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  const wk = (week, crit, perf) => ({
    week,
    axe: { medianViolations: 3, rules: { 'image-alt': { impact: 'critical', pages: crit } } },
    lighthouse: { medianPerformance: perf, medianBestPractices: 70, medianSeo: 75 },
  });
  const html = renderHistoryPage(target, [wk('2026-W24', 5, 71), wk('2026-W25', 3, 76)], '2026-W25');
  assert.match(html, /Pages affected by axe severity over 2 weeks/);
  assert.match(html, /Lighthouse category scores over 2 weeks/);
  assert.match(html, /class="linechart/);
});

test('renderHistoryPage (WP3): renders sustainability, readability and standards metric charts', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  const wk = (week, bytes, ease) => ({
    week,
    axe: { medianViolations: 3, rules: {} },
    sustainability: { medianBytes: bytes, medianRequests: 12, meanCo2g: 0.4 },
    plainLanguage: { medianReadingEase: ease, medianGrade: 11, medianWordsPerPage: 800 },
    tech: [{ name: 'Drupal' }, { name: 'jQuery' }],
    standards: { checks: [{ id: 'title', pass: 9, total: 10 }, { id: 'canonical', pass: 8, total: 10 }] },
    security: { passed: 6, total: 8 },
  });
  const html = renderHistoryPage(target, [wk('2026-W24', 300000, 55), wk('2026-W25', 250000, 60)], '2026-W25');
  assert.match(html, /Median page weight \(KB\) over 2 weeks/);
  assert.match(html, /Mean CO₂ per page \(g\) over 2 weeks/);
  assert.match(html, /Reading ease \(Flesch\) over 2 weeks/);
  assert.match(html, /Words per page \(median\) over 2 weeks/);
  assert.match(html, /Standards checks passing \(%\) over 2 weeks/);
  assert.match(html, /Security checks passing \(%\) over 2 weeks/);
  assert.match(html, /id="h-history-sustainable"/);
  assert.match(html, /id="h-history-findable"/);
  assert.match(html, /id="h-history-trustworthy"/);
});

test('renderHistoryPage (WP4): comparison table with look-back windows and CSV/JSON links', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  // Six weeks so the 4-week look-back window is reachable (needs length > 4).
  const series = Array.from({ length: 6 }, (_, i) => ({
    week: `2026-W${20 + i}`,
    pagesScanned: 10, pagesAudited: 10,
    axe: { medianViolations: 6 - i, pagesScanned: 10, pagesWithViolations: 5, rules: { 'image-alt': { impact: 'critical', pages: 6 - i } } },
    alfa: { medianFailures: 2, pagesScanned: 10, pagesWithFailures: 3, rules: {} },
    sustainability: { medianBytes: 300000 - i * 10000, medianRequests: 12, meanCo2g: 0.4 },
    plainLanguage: { medianReadingEase: 50 + i, medianGrade: 11, medianWordsPerPage: 800 },
    standards: { checks: [{ id: 'title', pass: 8 + (i % 2), total: 10 }] },
    coverage: { axe: 10, alfa: 10 },
  }));
  const html = renderHistoryPage(target, series, '2026-W25');

  // Look-back comparison section with the reachable window.
  assert.match(html, /id="h-history-compare"/);
  assert.match(html, /How the latest week compares/);
  assert.match(html, /vs 4 wk ago/);
  assert.doesNotMatch(html, /vs 52 wk ago/); // history isn't a year long yet
  assert.match(html, /Median page weight \(KB\)/);
  // Both machine-readable downloads.
  assert.match(html, /href="\.\.\/\.\.\/\.\.\/data\/www\.example\.gov\/trends\.csv"/);
  assert.match(html, /href="\.\.\/\.\.\/\.\.\/data\/www\.example\.gov\/weekly\.json"/);
});

test('renderHistoryPage (WP4): no comparison table until a look-back window is reachable', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  const series = [
    { week: '2026-W24', axe: { medianViolations: 4, rules: {} } },
    { week: '2026-W25', axe: { medianViolations: 3, rules: {} } },
  ];
  const html = renderHistoryPage(target, series, '2026-W25');
  assert.doesNotMatch(html, /id="h-history-compare"/);
});

test('renderHistoryPage (WP3): omits metric groups when a domain has no such data', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  const wk = (week) => ({ week, axe: { medianViolations: 3, rules: {} } });
  const html = renderHistoryPage(target, [wk('2026-W24'), wk('2026-W25')], '2026-W25');
  assert.doesNotMatch(html, /id="h-history-sustainable"/);
  assert.doesNotMatch(html, /id="h-history-trustworthy"/);
});

test('renderHistoryPage (WP1): single week shows an empty state, not a broken chart', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  const html = renderHistoryPage(target, [{ week: '2026-W24', axe: { medianViolations: 4 } }], '2026-W24');
  assert.match(html, /Only one week has been scanned so far/);
  assert.doesNotMatch(html, /weeks recorded/);
});
