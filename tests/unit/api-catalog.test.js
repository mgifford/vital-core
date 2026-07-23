import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApiCatalog } from '../../src/lib/api-catalog.js';

const CONFIG = { reportBaseUrl: 'https://mgifford.github.io/vital-core' };
const ENTRIES = [
  {
    key: 'www.cms.gov',
    snapshot_url: '/api/v1/www.cms.gov/snapshot.json',
    findings_url: '/api/v1/www.cms.gov/2026-W30/findings.json',
  },
];

describe('buildApiCatalog', () => {
  test('emits well-known catalog with core API endpoint and schema links', () => {
    const c = buildApiCatalog(CONFIG, ENTRIES);
    assert.equal(c.catalog_version, '1.0');
    assert.ok(Array.isArray(c.apis) && c.apis.length >= 1);

    const api = c.apis.find((a) => a.id === 'vital-json-api-v1');
    assert.ok(api, 'v1 API section exists');
    assert.equal(api.auth, 'none');
    assert.equal(api.base_url, 'https://mgifford.github.io/vital-core/api/v1');
    assert.ok(api.schemas.includes('https://mgifford.github.io/vital-core/api/v1/schema/index.schema.json'));

    const indexEp = api.endpoints.find((e) => e.id === 'index');
    assert.equal(indexEp.url, 'https://mgifford.github.io/vital-core/api/v1/index.json');
  });

  test('includes example domain snapshot/findings URLs from index entries', () => {
    const c = buildApiCatalog(CONFIG, ENTRIES);
    const api = c.apis.find((a) => a.id === 'vital-json-api-v1');
    const snap = api.endpoints.find((e) => e.id === 'domain_snapshot');
    const find = api.endpoints.find((e) => e.id === 'week_findings');

    assert.deepEqual(snap.examples, ['https://mgifford.github.io/vital-core/api/v1/www.cms.gov/snapshot.json']);
    assert.deepEqual(find.examples, ['https://mgifford.github.io/vital-core/api/v1/www.cms.gov/2026-W30/findings.json']);
  });
});
