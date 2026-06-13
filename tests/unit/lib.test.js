import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, pageId } from '../../src/lib/urls.js';
import { isoWeekOf, previousWeekOf } from '../../src/lib/week.js';
import { parseRobots } from '../../src/lib/robots.js';
import { addPage, pickBatch } from '../../src/lib/state.js';
import { resolveWcag, severityFor } from '../../src/lib/wcag.js';
import { buildBugReports, bugReportToMarkdown } from '../../src/lib/bug-report.js';
import { splitSentences, estimateSyllables } from '../../src/engines/plain-language.js';
import { checkLink } from '../../src/lib/links.js';

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

test('resolveWcag: axe tags and alfa rule ids map to criteria', () => {
  assert.deepEqual(resolveWcag('axe-core', { tags: ['cat.color', 'wcag2aa', 'wcag143'] }), {
    sc: '1.4.3', name: 'Contrast (Minimum)', level: 'AA',
  });
  assert.deepEqual(resolveWcag('axe-core', { tags: ['wcag412'] }), {
    sc: '4.1.2', name: 'Name, Role, Value', level: 'A',
  });
  assert.equal(resolveWcag('axe-core', { tags: ['best-practice', 'wcag2a'] }), null, 'level-only tags have no SC');
  assert.deepEqual(resolveWcag('alfa', { ruleId: 'sia-r12' }), {
    sc: '4.1.2', name: 'Name, Role, Value', level: 'A',
  });
  assert.equal(resolveWcag('alfa', { ruleId: 'sia-r9999' }), null, 'unknown alfa rule undetermined');
});

test('severityFor: axe impact maps, frequency amplifies', () => {
  assert.equal(severityFor('critical', 1, 50), 'Critical');
  assert.equal(severityFor('minor', 1, 50), 'Low', 'rare minor stays Low');
  assert.equal(severityFor('minor', 30, 50), 'Medium', 'site-wide minor escalates one level');
  assert.equal(severityFor('serious', 40, 50), 'Critical', 'site-wide serious escalates to Critical');
  assert.equal(severityFor(null, 1, 50), 'Medium', 'no impact (alfa) defaults Medium');
});

test('buildBugReports: shape, ids stable, sorted, placeholders present', () => {
  const target = { domain: 'example.gov', key: 'example.gov' };
  const summary = {
    domain: 'example.gov',
    week: '2026-W24',
    generatedAt: '2026-06-13T00:00:00.000Z',
    pagesScanned: 10,
    axe: { rules: {
      'color-contrast': { count: 8, pages: 6, impact: 'serious', help: 'Elements must have sufficient color contrast',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.9/color-contrast', tags: ['wcag143', 'wcag2aa'],
        examplePages: ['https://example.gov/a'],
        instances: [{ url: 'https://example.gov/a', target: '.btn', html: '<a class="btn">Go</a>' }] },
    } },
    alfa: { rules: {
      'sia-r12': { count: 2, pages: 1, ruleUrl: 'https://act-rules.github.io/rules/97a4e1',
        examplePages: ['https://example.gov/b'],
        instances: [{ url: 'https://example.gov/b', target: '<button>', html: null }] },
    } },
  };

  const reports = buildBugReports(target, summary);
  assert.equal(reports.length, 2);

  // Sorted: serious+site-wide axe (escalated to Critical) before medium alfa.
  assert.equal(reports[0].rule_id, 'color-contrast');
  assert.equal(reports[0].severity, 'Critical', '6/10 pages escalates serious to critical');
  assert.equal(reports[0].wcag_sc, '1.4.3');
  assert.equal(reports[0].wcag_level, 'AA');
  assert.match(reports[0].summary, /\(WCAG 1\.4\.3\)$/);
  assert.equal(reports[0].frequency.pages_affected, 6);
  assert.equal(reports[0].xpath, '.btn');
  assert.ok(reports[0].html_snippet.includes('btn'));

  // Honest placeholder for unobservable field.
  assert.match(reports[0].impact, /requires manual testing/i);

  // Stable ids: same input -> same ids.
  const again = buildBugReports(target, summary);
  assert.equal(again[0].instance_id, reports[0].instance_id);
  assert.equal(again[0].pattern_id, reports[0].pattern_id);

  // Alfa report: no impact -> Medium, mapped SC.
  const alfa = reports.find((r) => r.rule_id === 'sia-r12');
  assert.equal(alfa.severity, 'Medium');
  assert.equal(alfa.wcag_sc, '4.1.2');

  // Markdown renders the required headings.
  const md = bugReportToMarkdown(reports[0]);
  assert.match(md, /\*\*Severity:\*\* Critical/);
  assert.match(md, /### Steps to reproduce/);
  assert.match(md, /\*\*WCAG SC:\*\* 1\.4\.3/);
});

test('plain-language: sentence splitting and syllable estimation', () => {
  const s = splitSentences('The cat sat. It was happy! Was it? Yes.');
  assert.equal(s.length, 4);
  // Short words = 1 syllable; multi-vowel-group words counted.
  assert.equal(estimateSyllables('cat'), 1);
  assert.equal(estimateSyllables('happy'), 2);
  assert.equal(estimateSyllables('accessibility') >= 4, true);
  assert.equal(estimateSyllables(''), 0);
});

test('checkLink: classifies status codes, soft-ok, and network errors', async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ status: 200 });
    assert.deepEqual(await pick(checkLink('https://x/ok')), { ok: true, broken: false, status: 200 });

    globalThis.fetch = async () => ({ status: 404 });
    assert.deepEqual(await pick(checkLink('https://x/missing')), { ok: false, broken: true, status: 404 });

    // 403/429 are soft-ok: bots get challenged but the link is fine.
    globalThis.fetch = async () => ({ status: 403 });
    assert.deepEqual(await pick(checkLink('https://x/forbidden')), { ok: true, broken: false, status: 403 });

    // HEAD unsupported (405) retries with GET.
    let calls = 0;
    globalThis.fetch = async (_u, opts) => {
      calls++;
      return { status: opts.method === 'HEAD' ? 405 : 200 };
    };
    const retried = await checkLink('https://x/headless');
    assert.equal(retried.ok, true);
    assert.equal(calls, 2, 'retried with GET after 405');

    // Network failure -> broken with reason.
    globalThis.fetch = async () => {
      throw Object.assign(new Error('boom'), { cause: { code: 'ENOTFOUND' } });
    };
    const dead = await checkLink('https://nope/');
    assert.equal(dead.broken, true);
    assert.equal(dead.status, 0);
    assert.match(dead.reason, /ENOTFOUND/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

async function pick(p) {
  const r = await p;
  return { ok: r.ok, broken: r.broken, status: r.status };
}
