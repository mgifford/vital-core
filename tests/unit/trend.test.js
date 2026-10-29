import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trendSummary, trendSeries, HEAVY_SUMMARY_KEYS, omitHeavyLists } from '../../src/lib/trend.js';

const evidence = { examplePages: ['https://a.gov/x'], affectedPages: [{ url: 'https://a.gov/x', instances: 2 }], instances: [{ url: 'https://a.gov/x', target: 'main' }] };

const week = () => ({
  week: '2026-W44',
  pagesScanned: 3,
  pagesWithAxeList: ['https://a.gov/x'],
  pagesWithAlfaList: ['https://a.gov/x'],
  axe: { violationTotal: 5, medianViolations: 1, rules: { 'image-alt': { count: 5, pages: 2, impact: 'critical', help: 'Images must have alternate text', tags: ['wcag111'], ...evidence } } },
  alfa: { failedTotal: 3, rules: { 'sia-r2': { count: 3, pages: 1, ruleUrl: 'https://alfa.siteimprove.com/rules/sia-r2', ...evidence } } },
  deprecatedHtml: { rules: { center: { count: 1, pages: 1, help: 'Use CSS', ...evidence } } },
  componentClusters: { total_clusters: 2, clusters: [{ id: 'c1', affected_pages: ['https://a.gov/x'] }], top_actions: [{ id: 'c1', rule_id: 'image-alt', pages_affected: 2, affected_pages: ['https://a.gov/x'] }] },
  resources: { total: 1, byType: { pdf: 1 }, list: [{ url: 'https://a.gov/r.pdf', type: 'pdf' }] },
  linkCheck: { brokenCount: 1, broken: [{ url: 'https://a.gov/gone', status: 404 }] },
  errorPages: [{ url: 'https://a.gov/gone', status: 404 }, { url: 'https://a.gov/no', status: 404 }, { url: 'https://a.gov/err', status: 500 }],
  images: { totalImages: 4, missingAlt: 1, imageRows: [{ src: 'x.png' }], uniqueImageList: [{ src: 'x.png' }] },
  plainLanguage: { medianGrade: 9, pageRows: [{ url: 'https://a.gov/x' }] },
  sustainability: { medianBytes: 1000, bytesList: [1000] },
  lighthouse: { medianPerformance: 50, pageDetail: [{ url: 'https://a.gov/x' }], recommendations: [{ id: 'unused-css', pages: 2, examplePages: ['https://a.gov/x'] }] },
  standards: { pagesChecked: 3, checks: [{ id: 'title', pass: 3, total: 3, rate: 100 }, { id: 'lang', pass: 1, total: 3, rate: 33 }] },
  security: { checks: [{ id: 'https', pass: true }, { id: 'hsts', pass: false }] },
  resilience: { checks: [{ id: 'pwa-manifest', pass: 0, total: 3, rate: 0, why: 'Needed to install' }] },
});

function keysDeep(v, out = new Set()) {
  if (Array.isArray(v)) for (const x of v) keysDeep(x, out);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out); }
  return out;
}

test('trendSummary: keeps what failed each week as numbers', () => {
  const t = trendSummary(week());
  assert.deepEqual(t.axe.rules['image-alt'], { count: 5, pages: 2, impact: 'critical', help: 'Images must have alternate text', tags: ['wcag111'] });
  assert.deepEqual(t.alfa.rules['sia-r2'], { count: 3, pages: 1, ruleUrl: 'https://alfa.siteimprove.com/rules/sia-r2' });
  assert.deepEqual(t.deprecatedHtml.rules.center, { count: 1, pages: 1, help: 'Use CSS' });
  assert.equal(t.axe.violationTotal, 5);
  assert.deepEqual(t.componentClusters, { total_clusters: 2, top_actions: [{ id: 'c1', rule_id: 'image-alt', pages_affected: 2 }] });
  assert.deepEqual(t.resources, { total: 1, byType: { pdf: 1 } });
  assert.deepEqual(t.linkCheck, { brokenCount: 1 });
  assert.deepEqual(t.errorStatuses, { 404: 2, 500: 1 });
  assert.equal(t.errorPages, undefined);
  assert.deepEqual(t.lighthouse.recommendations, [{ id: 'unused-css', pages: 2 }]);
});

test('trendSummary: drops passing checks but counts them', () => {
  const t = trendSummary(week());
  assert.deepEqual(t.standards.checks.map((c) => c.id), ['lang']);
  assert.equal(t.standards.checksPassing, 1);
  assert.deepEqual(t.security.checks.map((c) => c.id), ['hsts']);
  assert.equal(t.security.checksPassing, 1);
  assert.equal(t.resilience.checks[0].why, 'Needed to install', 'a failing check keeps its explanation');
});

test('trendSummary: no per-page list or repeated evidence anywhere, and the input is untouched', () => {
  const input = week();
  const t = trendSummary(input);
  const keys = keysDeep(t);
  for (const k of [...HEAVY_SUMMARY_KEYS, 'examplePages', 'affectedPages', 'instances', 'affected_pages', 'clusters', 'list', 'broken']) {
    assert.ok(!keys.has(k), `${k} is left out`);
  }
  assert.equal(input.axe.rules['image-alt'].affectedPages.length, 1, 'the in-memory summary keeps its evidence for the reports');
  assert.equal(input.componentClusters.clusters.length, 1);
  assert.equal(trendSeries([input, input]).length, 2);
});

test('omitHeavyLists: the summary.json replacer drops only the per-page lists', () => {
  const json = JSON.parse(JSON.stringify(week(), omitHeavyLists));
  assert.equal(json.images.imageRows, undefined);
  assert.equal(json.pagesWithAxeList, undefined);
  assert.equal(json.axe.rules['image-alt'].affectedPages.length, 1, "each week's summary.json keeps its evidence");
});
