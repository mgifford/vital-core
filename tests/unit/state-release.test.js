import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateAssetName, assertReleasable, isNotFound, STATE_RELEASE_TAG } from '../../src/lib/state-release.js';
import { loadConfig } from '../../src/lib/config.js';

test('state-release: asset name is <key>.crawl.json.gz on the scan-state tag', () => {
  assert.equal(STATE_RELEASE_TAG, 'scan-state');
  assert.equal(stateAssetName('www.cms.gov'), 'www.cms.gov.crawl.json.gz');
});

test('state-release: hf_only targets are refused', () => {
  assert.throws(() => assertReleasable({ domain: 'www.va.gov', hf_only: true }), /hf_only/);
  assert.doesNotThrow(() => assertReleasable({ domain: 'www.cms.gov' }));
});

test('state-release: every configured hf_only target is refused', () => {
  const hf = loadConfig().targets.filter((t) => t.hf_only);
  for (const t of hf) assert.throws(() => assertReleasable(t), /hf_only/, t.domain);
});

test('state-release: only a missing release/asset counts as not found', () => {
  assert.ok(isNotFound('release not found'));
  assert.ok(isNotFound('no assets match the file pattern'));
  assert.ok(isNotFound('HTTP 404: Not Found'));
  assert.ok(!isNotFound('HTTP 401: Bad credentials'));
  assert.ok(!isNotFound('HTTP 403: API rate limit exceeded'));
  assert.ok(!isNotFound('dial tcp: i/o timeout'));
});
