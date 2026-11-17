import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPerformanceInvestigations } from '../../src/lib/performance-investigations.js';

test('builds a deterministic shared-resource investigation without causal claims', () => {
  const summary = { performanceResources: { pages_with_evidence: 10, resources: [
    { key: 'https://cdn.example/a.js', type: 'script', third_party: true, pages: 5, transfer_bytes: 500, examples: ['https://example.gov/a'] },
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
});
