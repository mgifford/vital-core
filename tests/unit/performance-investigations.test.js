import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPerformanceInvestigations } from '../../src/lib/performance-investigations.js';

test('builds a deterministic shared-resource investigation without causal claims', () => {
  const summary = { performanceResources: { pages_with_evidence: 10, resources: [
    { key: 'https://cdn.example/a.js', type: 'script', third_party: false, pages: 5, transfer_bytes: 500, examples: ['https://example.gov/a'] },
    { key: 'https://example.gov/b.css', type: 'link', third_party: false, pages: 2, transfer_bytes: 900 },
  ] } };
  const q = buildPerformanceInvestigations(summary);
  assert.equal(q.schema_version, 'performance-investigation/1');
  assert.equal(q.candidates.length, 1);
  assert.equal(q.candidates[0].status, 'investigation-candidate');
  assert.match(q.candidates[0].hypothesis, /may be adding/);
  assert.match(q.limitations[0], /correlation/);
});

test('adds slow-page and repeated Lighthouse candidates without calling them field metrics', () => {
  const q = buildPerformanceInvestigations({
    performanceResources: { resources: [] },
    lighthouse: {
      pagesSampled: 4,
      pageDetail: [{ url: 'https://example.gov/slow', scores: { performance: 22 }, metrics: { largestContentfulPaintMs: 4000, totalBlockingTimeMs: 900 } }],
      recommendations: [{ id: 'render-blocking-resources', title: 'Eliminate render-blocking resources', category: 'performance', pages: 4, savingsMs: 300, savingsBytes: 0 }],
    },
  });
  assert.ok(q.candidates.some((c) => c.category === 'slow-representative-page'));
  assert.ok(q.candidates.some((c) => c.category === 'repeated-lighthouse-recommendation'));
  assert.match(q.candidates.find((c) => c.category === 'slow-representative-page').evidence.limitations[0], /not field/);
});

test('matched-page regression is a possible regression, not a confirmed defect', () => {
  const previous = { week: '2026-W45', lighthouse: { pageDetail: [{ url: 'https://example.gov/a', scores: { performance: 80 }, metrics: { largestContentfulPaintMs: 2000 } }] } };
  const current = { week: '2026-W46', performanceResources: { resources: [] }, lighthouse: { pageDetail: [{ url: 'https://example.gov/a', scores: { performance: 50 }, metrics: { largestContentfulPaintMs: 4000 } }] } };
  const q = buildPerformanceInvestigations(current, { previous });
  const regression = q.candidates.find((c) => c.category === 'possible-matched-page-regression');
  assert.ok(regression);
  assert.equal(regression.status, 'possible-regression');
  assert.equal(regression.page.delta, -30);
  assert.match(regression.evidence.limitations[0], /not a confirmed field regression/);
  assert.equal(regression.evidence.confirmation, 'single-observation');
  assert.equal(regression.evidence.stable_cohort_member, null);
});


test('regression candidates require stable-cohort membership when the list is present', () => {
  const previous = { week: '2026-W45', lighthouse: { pageDetail: [{ url: 'https://example.gov/a', scores: { performance: 80 } }] } };
  const current = { week: '2026-W46', performanceCohort: { stable_urls: ['https://example.gov/other'] }, performanceResources: { resources: [] }, lighthouse: { pageDetail: [{ url: 'https://example.gov/a', scores: { performance: 50 } }] } };
  assert.equal(buildPerformanceInvestigations(current, { previous }).candidates.some((c) => c.category === 'possible-matched-page-regression'), false);
});

test('declared page family with repeated poor Lighthouse scores becomes a candidate', () => {
  const summary = { pageFamilies: { families: [{ id: 'forms', label: 'Forms', route: '/forms*' }] }, lighthouse: { pagesSampled: 4, medianPerformance: 70, pageDetail: [{ url: 'https://example.gov/forms/a', scores: { performance: 40 } }, { url: 'https://example.gov/forms/b', scores: { performance: 35 } }, { url: 'https://example.gov/about', scores: { performance: 90 } }] } };
  const q = buildPerformanceInvestigations(summary);
  const family = q.candidates.find((c) => c.category === 'page-family-performance-pattern');
  assert.ok(family);
  assert.equal(family.page.family_id, 'forms');
  assert.match(family.evidence.limitations[0], /not establish/);
});

test('render-blocking and third-party resources get distinct candidates', () => {
  const summary = { performanceResources: { pages_with_evidence: 5, resources: [
    { key: 'https://example.gov/a.css', type: 'link', pages: 2, transfer_bytes: 100, render_blocking_pages: 2 },
    { key: 'https://cdn.other.org/a.js', type: 'script', pages: 3, transfer_bytes: 500, third_party: true },
  ] } };
  const q = buildPerformanceInvestigations(summary);
  assert.ok(q.candidates.some((c) => c.category === 'potential-render-blocking-resource'));
  assert.ok(q.candidates.some((c) => c.category === 'third-party-resource-concern'));
  assert.equal(q.candidates.some((c) => c.category === 'shared-expensive-resource'), false);
});

test('ranking is deterministic and exposes priority reasons', () => {
  const summary = { performanceResources: { pages_with_evidence: 10, resources: [
    { key: 'https://example.gov/small.js', type: 'script', pages: 2, transfer_bytes: 90 },
    { key: 'https://example.gov/big.js', type: 'script', pages: 4, transfer_bytes: 900 },
    { key: 'https://cdn.other.org/a.js', type: 'script', pages: 3, transfer_bytes: 500, third_party: true },
  ] } };
  const q1 = buildPerformanceInvestigations(summary);
  const q2 = buildPerformanceInvestigations(summary);
  assert.deepEqual(q1.candidates.map((c) => c.id), q2.candidates.map((c) => c.id));
  assert.ok(q1.rank_basis.includes('sampled-page reach'));
  assert.ok(q1.candidates.every((c) => Array.isArray(c.priority_reasons) && c.priority_reasons.length >= 3));
  assert.equal(q1.candidates[0].category, 'third-party-resource-concern');
});
