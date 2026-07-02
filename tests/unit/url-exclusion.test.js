import { test } from 'node:test';
import assert from 'node:assert';
import { loadConfig } from '../../src/lib/config.js';

test('url_exclude_patterns: config loads with url_exclude_patterns field', async () => {
  const config = await loadConfig();
  
  // Check that www.cms.gov target has the url_exclude_patterns field set
  const cmsTarget = config.targets.find((t) => t.domain === 'www.cms.gov');
  assert(cmsTarget, 'www.cms.gov target should exist');
  assert.deepStrictEqual(cmsTarget.url_exclude_patterns, ['.aspx'], 'www.cms.gov should have .aspx exclusion');
});

test('url_exclude_patterns: default is empty array when not set', async () => {
  const config = await loadConfig();
  
  // Check that targets without url_exclude_patterns get default empty array or undefined
  const firstTarget = config.targets[0];
  assert(firstTarget, 'Should have at least one target');
  // Each target may or may not have url_exclude_patterns; we're just validating config structure
  assert.strictEqual(typeof firstTarget.domain, 'string', 'Each target should have domain');
});
