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
