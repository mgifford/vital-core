import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApiCatalog, writeApiCatalog } from '../../src/lib/api-catalog.js';

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

test('writeApiCatalog publishes the catalog at api/catalog.json, outside any dot-folder', () => {
  const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-catalog-'));
  try {
    writeApiCatalog(docs, CONFIG, ENTRIES);
    const linked = JSON.parse(fs.readFileSync(path.join(docs, 'api', 'catalog.json'), 'utf8'));
    assert.equal(linked.catalog_version, '1.0');
    assert.equal(fs.readFileSync(path.join(docs, '.well-known', 'api-catalog'), 'utf8'), JSON.stringify(linked, null, 1), 'well-known copies kept for hosts that serve them');
  } finally {
    fs.rmSync(docs, { recursive: true, force: true });
  }
});
