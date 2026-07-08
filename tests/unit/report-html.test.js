import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderAccessibilityPage, renderDomainReport, statTile } from '../../src/report-html.js';

test('renderDomainReport shows severity trend and four-category Lighthouse trend', () => {
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

  assert.match(html, /Pages affected by axe severity over 2 weeks/);
  assert.match(html, /Lighthouse category scores over 2 weeks/);
  assert.match(html, /Performance/);
  assert.match(html, /Accessibility/);
  assert.match(html, /Best practices/);
  assert.match(html, /SEO/);
  assert.doesNotMatch(html, /Score trends/);
  assert.doesNotMatch(html, /Accessibility score \(0-100\)/);
  assert.doesNotMatch(html, /Google Lighthouse score \(median\)/);
  assert.doesNotMatch(html, /Largest Contentful Paint \(median\)/);
  assert.doesNotMatch(html, /Median page weight \(KB\)/);
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
  };

  const html = renderDomainReport(target, summary, null, null, [summary], bugs,
    { byRule: {}, bugsAll: null }, null, progress);

  // Three delta tiles with their counts.
  assert.match(html, /New this week<\/dt><dd>1</);
  assert.match(html, /Fixed this week<\/dt><dd>2</);
  assert.match(html, /Regressed this week<\/dt><dd>0</);

  // Biggest-win callout links to the top-ranked finding's canonical location.
  assert.match(html, /class="callout callout-win"/);
  assert.match(html, /Biggest available win/);
  assert.match(html, /<a href="accessibility\.html#VS-abc12345"><strong>Images must have alternative text<\/strong><\/a>/);
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
    new: [], fixed: [{ id: 'VS-f1', severity: 'Serious', summary: 'Document must have a title element' }], regressed: [],
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
  // Fixed-this-week list.
  assert.match(html, /Document must have a title element/);
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