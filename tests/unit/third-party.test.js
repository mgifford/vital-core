import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThirdPartyCollector } from '../../src/engines/third-party.js';

function fakePage(timing = []) {
  const handlers = [];
  return {
    on(event, fn) { if (event === 'response') handlers.push(fn); },
    off(event, fn) { if (event === 'response') { const i = handlers.indexOf(fn); if (i >= 0) handlers.splice(i, 1); } },
    async emit(response) { for (const fn of handlers) await fn(response); },
    async evaluate() { return timing; },
  };
}
const response = (url, length, type = 'script') => ({
  url: () => url,
  headers: () => length == null ? {} : { 'content-length': String(length) },
  body: async () => null,
  request: () => ({ resourceType: () => type }),
});

test('third-party costs retain legacy bytes and expose measurement provenance', async () => {
  const page = fakePage([
    { name: 'https://cdn.example.com/a.js', duration: 12, transferSize: 80, initiatorType: 'script' },
  ]);
  const collector = createThirdPartyCollector(page, 'https://example.gov/');
  await page.emit(response('https://cdn.example.com/a.js', 100));
  await page.emit(response('https://example.gov/app.js', 50));
  const result = await collector.collect();
  assert.equal(result.totalThirdPartyBytes, 100);
  assert.equal(result.firstPartyBytes, 50);
  assert.equal(result.totalThirdPartyScripts, 1);
  assert.equal(result.measurement.schema_version, 'resource-measurement/1');
  assert.match(result.measurement.legacy_bytes.basis, /content-length-or-decoded-body/);
  assert.equal(result.measurement.resource_timing.transfer_bytes, 80);
});
