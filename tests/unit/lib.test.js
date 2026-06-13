import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, pageId } from '../../src/lib/urls.js';
import { isoWeekOf, previousWeekOf } from '../../src/lib/week.js';
import { parseRobots } from '../../src/lib/robots.js';
import { addPage, pickBatch } from '../../src/lib/state.js';

test('normalizeUrl: identity is stable and tracking-free', () => {
  const base = 'https://example.gov/';
  assert.equal(
    normalizeUrl('/a/b/?utm_source=x&z=1&a=2#frag', base, 'example.gov'),
    'https://example.gov/a/b?a=2&z=1'
  );
  assert.equal(normalizeUrl('https://EXAMPLE.gov:443/path/', base, 'example.gov'), 'https://example.gov/path');
  assert.equal(normalizeUrl('https://other.gov/x', base, 'example.gov'), null, 'off-host rejected');
  assert.equal(normalizeUrl('/file.pdf', base, 'example.gov'), null, 'binary rejected');
  assert.equal(normalizeUrl('mailto:x@y.z', base, 'example.gov'), null);
  assert.equal(normalizeUrl('https://example.gov/', base, 'example.gov'), 'https://example.gov/', 'root keeps slash');
});

test('normalizeUrl: apex and www are the same host, other subdomains are not', () => {
  // Target the apex: www links of the same registrable domain are accepted...
  assert.equal(
    normalizeUrl('https://www.cdc.gov/about', 'https://cdc.gov/', 'cdc.gov'),
    'https://www.cdc.gov/about',
    'www variant accepted, actual host preserved'
  );
  // ...and vice versa: target www, apex link accepted.
  assert.equal(
    normalizeUrl('https://cdc.gov/about', 'https://www.cdc.gov/', 'www.cdc.gov'),
    'https://cdc.gov/about',
    'apex variant accepted from a www target'
  );
  // Any other subdomain is a different site and is rejected.
  assert.equal(
    normalizeUrl('https://data.cms.gov/x', 'https://www.cms.gov/', 'www.cms.gov'),
    null,
    'non-www subdomain rejected'
  );
  assert.equal(
    normalizeUrl('https://www.cms.gov/x', 'https://data.cms.gov/', 'data.cms.gov'),
    null,
    'www of base domain rejected when target is a different subdomain'
  );
});

test('pageId: deterministic', () => {
  assert.equal(pageId('https://example.gov/a'), pageId('https://example.gov/a'));
  assert.notEqual(pageId('https://example.gov/a'), pageId('https://example.gov/b'));
});

test('isoWeek: known dates', () => {
  assert.equal(isoWeekOf(new Date(Date.UTC(2026, 0, 1))), '2026-W01');
  assert.equal(isoWeekOf(new Date(Date.UTC(2026, 5, 12))), '2026-W24');
  assert.equal(isoWeekOf(new Date(Date.UTC(2027, 0, 1))), '2026-W53'); // Jan 1 2027 is a Friday in ISO week 53 of 2026
  assert.equal(previousWeekOf('2026-W24', ['2026-W22', '2026-W24', '2026-W20']), '2026-W22');
});

test('robots: disallow, allow, wildcards, crawl-delay', () => {
  const r = parseRobots(
    `User-agent: *\nDisallow: /private/\nDisallow: /*.cgi$\nAllow: /private/ok\nCrawl-delay: 2\n`,
    'vital-scans/0.1'
  );
  assert.equal(r.isAllowed('/public/page'), true);
  assert.equal(r.isAllowed('/private/secret'), false);
  assert.equal(r.isAllowed('/private/ok/page'), true, 'longer Allow wins');
  assert.equal(r.isAllowed('/script.cgi'), false, '$ anchor');
  assert.equal(r.isAllowed('/script.cgi.html'), true);
  assert.equal(r.crawlDelay, 2);
});

test('robots: empty file allows everything', () => {
  const r = parseRobots('', 'vital-scans/0.1');
  assert.equal(r.isAllowed('/anything'), true);
  assert.equal(r.crawlDelay, null);
});

test('pickBatch: never-scanned first, weekly cap respected, no rescan same week', () => {
  const state = { domain: 'x', pages: {} };
  addPage(state, 'a', 'https://x/a', 0);
  addPage(state, 'b', 'https://x/b', 1);
  addPage(state, 'c', 'https://x/c', 2);
  state.pages.a.lastScannedWeek = '2026-W24';
  state.pages.b.lastScannedWeek = '2026-W23';

  const { batch } = pickBatch(state, '2026-W24', 10, 100);
  assert.deepEqual(batch.map((b) => b.id), ['c', 'b'], 'c (new) before b (stale); a excluded (already this week)');

  // Weekly cap: 1 already scanned this week, cap 2 -> only 1 more allowed.
  const { batch: capped } = pickBatch(state, '2026-W24', 10, 2);
  assert.equal(capped.length, 1);

  // Failing pages excluded after 3 failures.
  state.pages.c.failCount = 3;
  const { batch: noFail } = pickBatch(state, '2026-W24', 10, 100);
  assert.deepEqual(noFail.map((b) => b.id), ['b']);
});
