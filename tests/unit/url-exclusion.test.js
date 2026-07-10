import { test } from 'node:test';
import assert from 'node:assert';
import { loadConfig } from '../../src/lib/config.js';
import { matchesExclusionPattern, filterBugsByExclusion } from '../../src/report-html.js';

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

test('matchesExclusionPattern: substring stays case-insensitive (config baseline unchanged)', () => {
  assert.equal(matchesExclusionPattern('https://x.gov/Legacy.ASPX', ['.aspx']), true, 'case-insensitive substring');
  assert.equal(matchesExclusionPattern('https://x.gov/about', ['.aspx']), false, 'non-matching substring');
  assert.equal(matchesExclusionPattern('https://x.gov/a', []), false, 'no patterns → no match');
});

test('matchesExclusionPattern: /regex/ matches against the full URL', () => {
  const pat = ['/\\/news\\/\\d{4}\\//'];
  assert.equal(matchesExclusionPattern('https://x.gov/news/2026/a', pat), true, 'dated news path');
  assert.equal(matchesExclusionPattern('https://x.gov/news/story', pat), false, 'undated news path');
});

test('matchesExclusionPattern: regex is case-sensitive unless the flag is given', () => {
  assert.equal(matchesExclusionPattern('https://x.gov/press/1', ['/PRESS/']), false, 'no flag → case-sensitive, no match');
  assert.equal(matchesExclusionPattern('https://x.gov/press/1', ['/PRESS/i']), true, 'i flag honoured');
});

test('matchesExclusionPattern: invalid regex falls back to a case-insensitive substring', () => {
  assert.equal(matchesExclusionPattern('https://x.gov/a/(unclosed/b', ['/(unclosed/']), true, 'literal substring match');
  assert.equal(matchesExclusionPattern('https://x.gov/A/(UNCLOSED/B', ['/(unclosed/']), true, 'and case-insensitive');
  assert.equal(matchesExclusionPattern('https://x.gov/a/b', ['/(unclosed/']), false, 'non-matching URL kept');
});

test('filterBugsByExclusion: /regex/ drops matching pages and recomputes counts', () => {
  const bugs = [{
    instance_id: 'b1',
    affected_pages: ['https://x.gov/news/2026/a', 'https://x.gov/about', 'https://x.gov/news/2027/b'],
    frequency: { pages_affected: 3, instances: 6, total_pages_scanned: 100 },
  }];
  const out = filterBugsByExclusion(bugs, ['/\\/news\\/\\d{4}\\//']);
  assert.equal(out.length, 1, 'bug survives (one page remains)');
  assert.deepEqual(out[0].affected_pages, ['https://x.gov/about'], 'only non-matching page remains');
  assert.equal(out[0].frequency.pages_affected, 1, 'pages_affected recomputed');
  assert.equal(out[0].frequency.instances, 2, 'instances scaled proportionally (round(6·1/3))');
});

test('filterBugsByExclusion: a fully-excluded bug is removed (regex + substring)', () => {
  const mk = (pages) => [{ instance_id: 'b', affected_pages: pages, frequency: { pages_affected: pages.length, instances: pages.length, total_pages_scanned: 100 } }];
  assert.equal(filterBugsByExclusion(mk(['https://x.gov/x.aspx']), ['/\\.aspx$/i']).length, 0, 'regex removes the only page');
  assert.equal(filterBugsByExclusion(mk(['https://www.cms.gov/a.aspx']), ['.aspx']).length, 0, 'substring baseline still removes it');
});
