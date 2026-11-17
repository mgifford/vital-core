import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDomainReport } from '../../src/report-html.js';
test('domain report lists investigation candidates without claiming a defect', () => {
  const target = { key: 'example.gov', domain: 'example.gov' };
  const summary = { week: '2026-W46', pagesScanned: 10, pagesAudited: 10, generatedAt: '2026-11-16T00:00:00Z', axe: { medianViolations: 0, pagesScanned: 10, pagesWithViolations: 0, rules: {} }, alfa: { medianFailures: 0, pagesScanned: 10, pagesWithFailures: 0, rules: {} }, performanceInvestigations: { schema_version: 'performance-investigation/1', candidates: [{ id: 'x', resource: { key: 'https://example.gov/a.js', type: 'script', pages: 3, transfer_bytes: 100 }, status: 'investigation-candidate', hypothesis: 'may be adding work', proposed_test: 'compare with the resource deferred' }], limitations: [] } };
  const html = renderDomainReport(target, summary, null, null, [summary]);
  assert.match(html, /Performance investigation candidates/);
  assert.match(html, /https:\/\/example\.gov\/a\.js/);
  assert.match(html, /investigation-candidate/);
  assert.match(html, /not confirmed defects/);
});
