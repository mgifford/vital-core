import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPerformanceResourceCollector } from '../../src/engines/performance-resources.js';

const page = (entries) => ({ evaluate: async () => entries });
const entry = (name, extra = {}) => ({ name, initiatorType: 'script', transferSize: 100, encodedBodySize: 120, decodedBodySize: 300, duration: 12, renderBlockingStatus: null, ...extra });

test('resource inventory is bounded, keyed without query strings and classified by party', async () => {
  const collector = createPerformanceResourceCollector(page([
    entry('https://example.gov/app.js?v=1'),
    entry('https://cdn.other.org/lib.js?v=2', { transferSize: 500 }),
  ]), 'https://example.gov/');
  const result = await collector.collect();
  assert.equal(result.schema_version, 'performance-resource-inventory/1');
  assert.equal(result.resource_count, 2);
  assert.ok(result.resources.some((r) => r.key === 'https://example.gov/app.js'));
  assert.equal(result.resources.find((r) => r.key.includes('lib.js')).third_party, true);
  assert.equal(result.total_transfer_bytes, 600);
  assert.match(result.measurement.limitations[0], /zero or unavailable size/);
  assert.equal(result.observed_entries, 2);
  assert.equal(result.truncated, false);
  assert.equal(result.measurement.main_document_included, false);
});

test('resource inventory reports an empty result rather than inventing data', async () => {
  const result = await createPerformanceResourceCollector(page([]), 'https://example.gov/').collect();
  assert.equal(result.resource_count, 0);
  assert.deepEqual(result.resources, []);
  assert.equal(result.total_transfer_bytes, 0);
});
