import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSustainabilityCollector, SUSTAINABILITY_MEASUREMENT_VERSION } from '../../src/engines/sustainability.js';

function fakePage(timing = []) {
  const handlers = [];
  return {
    on(event, fn) { if (event === 'response') handlers.push(fn); },
    off(event, fn) { if (event === 'response') { const i = handlers.indexOf(fn); if (i >= 0) handlers.splice(i, 1); } },
    async emit(response) { for (const fn of handlers) await fn(response); },
    async evaluate() { return timing; },
    handlerCount() { return handlers.length; },
  };
}
const response = (length, type = 'script', body = null) => ({
  headers: () => (length == null ? {} : { 'content-length': String(length) }),
  body: async () => body,
  request: () => ({ resourceType: () => type }),
});

test('sustainability keeps legacy bytes and adds explicit measurement provenance', async () => {
  const page = fakePage([
    { transferSize: 80, encodedBodySize: 90, decodedBodySize: 300 },
    { transferSize: 0, encodedBodySize: 0, decodedBodySize: 0 },
  ]);
  const collector = createSustainabilityCollector(page);
  await page.emit(response(100, 'script'));
  await page.emit(response(null, 'document', Buffer.alloc(300)));
  await page.emit(response(null, 'image', null));
  const result = await collector.collect();
  assert.equal(page.handlerCount(), 0, 'collector detaches the response listener');
  assert.equal(result.bytes, 400, 'historical bytes retain content-length-or-body semantics');
  assert.equal(result.requests, 3);
  assert.equal(result.byType.script, 100);
  assert.equal(result.measurement.schema_version, SUSTAINABILITY_MEASUREMENT_VERSION);
  assert.equal(result.measurement.legacy_bytes.value, 400);
  assert.equal(result.measurement.legacy_bytes.content_length_bytes, 100);
  assert.equal(result.measurement.legacy_bytes.decoded_fallback_bytes, 300);
  assert.equal(result.measurement.legacy_bytes.unmeasured_resources, 1);
  assert.equal(result.measurement.resource_timing.transfer_bytes, 80);
  assert.equal(result.measurement.resource_timing.zero_transfer_entries, 1);
  assert.equal(result.measurement.energy.basis, 'model-derived from CO2 / grid intensity; not observed client energy');
  assert.match(result.measurement.co2.basis, /not measured emissions/);
  assert.ok(result.measurement.limitations.length >= 3);
  assert.equal(result.model, 'swd-v4 (co2.js)');
});

test('missing Resource Timing produces unknowns, not zero', async () => {
  const page = fakePage([]);
  const collector = createSustainabilityCollector(page);
  await page.emit(response(50, 'stylesheet'));
  const result = await collector.collect();
  assert.equal(result.measurement.resource_timing.entries, 0);
  assert.equal(result.measurement.resource_timing.transfer_bytes, null);
  assert.match(result.measurement.resource_timing.note, /unavailable/);
});
