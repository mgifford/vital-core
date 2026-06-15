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
import { normalizeRate, shouldRun } from '../../src/lib/sampling.js';
import { updateFindings } from '../../src/lib/findings.js';
import { findMisspellings } from '../../src/lib/spell.js';
import { impactFor, estimateExcluded, pct } from '../../src/lib/fpc.js';
import { toCsv, ruleSlug } from '../../src/lib/csv.js';
import { updateResourceLedger } from '../../src/lib/resource-ledger.js';

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
  // a excluded (already scanned this week); c (never scanned) before b (stale).
  assert.equal(batch.find((x) => x.id === 'a'), undefined, 'a excluded — already scanned this week');
  assert.deepEqual(batch.map((b) => b.id), ['c', 'b'], 'never-scanned (c) before previously-scanned (b)');

  // Weekly cap: 1 already scanned this week, cap 2 -> only 1 more allowed.
  const { batch: capped } = pickBatch(state, '2026-W24', 10, 2);
  assert.equal(capped.length, 1);

  // Failing pages excluded after 3 failures.
  state.pages.c.failCount = 3;
  const { batch: noFail } = pickBatch(state, '2026-W24', 10, 100);
  assert.deepEqual(noFail.map((b) => b.id), ['b']);
});

test('pickBatch: priority URLs scanned first, no rescan within a week', () => {
  const state = { domain: 'x', pages: {} };
  // 5 normal pages, 1 priority page added later (so not first by insertion).
  for (let i = 0; i < 5; i++) addPage(state, 'n' + i, `https://x/n${i}`, 1);
  addPage(state, 'top', 'https://x/top', 0, { priority: true });

  const { batch } = pickBatch(state, '2026-W24', 3, 100);
  assert.equal(batch[0].id, 'top', 'priority page comes first regardless of insertion order');
  assert.equal(batch[0].priority, true);

  // Simulate scanning the batch this week; none reappear in the same week.
  for (const b of batch) state.pages[b.id].lastScannedWeek = '2026-W24';
  const { batch: next } = pickBatch(state, '2026-W24', 10, 100);
  assert.ok(!next.some((b) => batch.some((p) => p.id === b.id)), 'already-scanned pages not repeated this week');
});

test('pickBatch: non-priority order is stable per week but varies across weeks', () => {
  const state = { domain: 'x', pages: {} };
  for (let i = 0; i < 50; i++) addPage(state, 'p' + i, `https://x/p${i}`, 1);

  const w24a = pickBatch(state, '2026-W24', 50, 100).batch.map((b) => b.id);
  const w24b = pickBatch(state, '2026-W24', 50, 100).batch.map((b) => b.id);
  const w25 = pickBatch(state, '2026-W25', 50, 100).batch.map((b) => b.id);

  assert.deepEqual(w24a, w24b, 'same week -> identical order (deterministic, replayable)');
  assert.notDeepEqual(w24a, w25, 'different week -> different random spread');
  // Same set, just reordered.
  assert.deepEqual([...w24a].sort(), [...w25].sort(), 'same pages, different order');
});

test('addPage: priority promotes an existing page without duplicating', () => {
  const state = { domain: 'x', pages: {} };
  assert.equal(addPage(state, 'a', 'https://x/a', 1), true, 'first add');
  assert.equal(addPage(state, 'a', 'https://x/a', 1), false, 'duplicate add is a no-op');
  assert.equal(state.pages.a.priority, false);
  assert.equal(addPage(state, 'a', 'https://x/a', 0, { priority: true }), true, 'promotion counts as a change');
  assert.equal(state.pages.a.priority, true, 'existing page promoted to priority');
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

  // Impact: WCAG 1.4.3 (contrast) maps to vision-related FPC groups.
  assert.ok(reports[0].impact.groups.length > 0, 'mapped SC yields impact groups');
  assert.ok(reports[0].impact.groups.some((g) => /vision/i.test(g.group)), 'contrast affects a vision group');
  assert.match(reports[0].impact.summary, /Affects/);

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

test('sampling: normalizeRate accepts fractions, percents, and junk', () => {
  assert.equal(normalizeRate(0.3), 0.3);
  assert.equal(normalizeRate(30), 0.3);
  assert.equal(normalizeRate('30%'), 0.3);
  assert.equal(normalizeRate(100), 1);
  assert.equal(normalizeRate(150), 1, 'clamped to 1');
  assert.equal(normalizeRate(null), 0, 'missing -> off');
  assert.equal(normalizeRate('nonsense'), 0);
  assert.equal(normalizeRate(-5), 0);
});

test('sampling: shouldRun is deterministic, ~rate, and per-engine independent', () => {
  const week = '2026-W24';
  // Deterministic: same inputs, same answer.
  assert.equal(shouldRun('alfa', 'p1', week, 30), shouldRun('alfa', 'p1', week, 30));
  // 0 and 100 are absolute.
  assert.equal(shouldRun('x', 'p1', week, 0), false);
  assert.equal(shouldRun('x', 'p1', week, 100), true);
  // Distribution lands near the target over many pages.
  const N = 3000;
  let alfa = 0, lh = 0, both = 0;
  for (let i = 0; i < N; i++) {
    const a = shouldRun('alfa', 'pid-' + i, week, 30);
    const l = shouldRun('lighthouse', 'pid-' + i, week, 10);
    if (a) alfa++;
    if (l) lh++;
    if (a && l) both++;
  }
  assert.ok(Math.abs(alfa / N - 0.3) < 0.04, `alfa ~30% (got ${(100 * alfa / N).toFixed(1)}%)`);
  assert.ok(Math.abs(lh / N - 0.1) < 0.04, `lighthouse ~10% (got ${(100 * lh / N).toFixed(1)}%)`);
  // Independence: P(both) ~ P(alfa)*P(lighthouse) ~ 0.03, not correlated.
  assert.ok(Math.abs(both / N - 0.03) < 0.03, 'engines sampled independently');
});

test('findings: ledger tracks first/last-seen and is idempotent per week', () => {
  const ledger = { domain: 'x', findings: {} };
  const reportA = { pattern_id: 'VS-aaa', tool: 'axe-core', rule_id: 'image-alt', summary: 'Images need alt (WCAG 1.1.1)', wcag_sc: '1.1.1', severity: 'Critical', frequency: { pages_affected: 5 } };
  const reportB = { pattern_id: 'VS-bbb', tool: 'alfa', rule_id: 'sia-r12', summary: 'Button name (WCAG 4.1.2)', wcag_sc: '4.1.2', severity: 'Medium', frequency: { pages_affected: 2 } };

  updateFindings(ledger, '2026-W23', [reportA, reportB]);
  assert.equal(ledger.findings['VS-aaa'].firstSeen, '2026-W23');
  assert.equal(ledger.findings['VS-aaa'].weeksSeen, 1);

  // Week 2: A persists (lastSeen advances), B gone (lastSeen stays W23).
  updateFindings(ledger, '2026-W24', [reportA]);
  assert.equal(ledger.findings['VS-aaa'].firstSeen, '2026-W23');
  assert.equal(ledger.findings['VS-aaa'].lastSeen, '2026-W24');
  assert.equal(ledger.findings['VS-aaa'].weeksSeen, 2);
  assert.equal(ledger.findings['VS-bbb'].lastSeen, '2026-W23', 'resolved finding keeps last-seen');

  // Idempotent: re-running W24 does not inflate weeksSeen.
  updateFindings(ledger, '2026-W24', [reportA]);
  assert.equal(ledger.findings['VS-aaa'].weeksSeen, 2, 're-run same week is idempotent');
});

test('spell: flags real misspellings, skips numbers/acronyms/allowlist/jargon', () => {
  const r = findMisspellings([
    'The', 'quick', 'accessibility', // correct dictionary words
    'teh', 'recieve', 'xyzzy',        // genuine misspellings
    'Medicaid', 'telehealth',          // allowlisted jargon
    'COVID', 'API',                    // ALL-CAPS acronyms -> skipped
    '2026', 'v4',                      // contain digits -> skipped
    'a', 'to',                         // too short -> skipped
  ]);
  assert.equal(r.misspelledCount, 3);
  assert.deepEqual(r.misspelled.sort(), ['recieve', 'teh', 'xyzzy']);
});

test('spell: tolerates possessives and caps the distinct list', () => {
  const r = findMisspellings(["government's", 'agency’s']);
  assert.equal(r.misspelledCount, 0, "possessive of a real word is not a misspelling");

  const many = Array.from({ length: 40 }, (_, i) => `xqzzx${String.fromCharCode(97 + (i % 26))}${i}`)
    .map((w) => w.replace(/\d/g, '')); // strip digits so they're checkable
  const capped = findMisspellings(many, 25);
  assert.ok(capped.misspelled.length <= 25, 'distinct list is capped');
  assert.ok(capped.misspelledCount >= capped.misspelled.length, 'count tracks all, list is capped');
});

test('fpc: maps WCAG SC to disability groups with prevalence', () => {
  const contrast = impactFor('1.4.3');
  assert.ok(contrast.groups.some((g) => g.code === 'LV'), 'contrast affects limited vision');
  assert.ok(contrast.maxPrevalence > 0 && contrast.maxPrevalence < 1);
  const altText = impactFor('1.1.1');
  assert.ok(altText.groups.some((g) => g.code === 'WV'), 'non-text content affects without-vision');
  assert.equal(impactFor('9.9.9'), null, 'unknown SC -> null');
  assert.equal(pct(0.024), '2.4%');
});

test('fpc: estimateExcluded scales prevalence by page loads', () => {
  assert.equal(estimateExcluded(0.01, 1_000_000), 10000);
  assert.equal(estimateExcluded(0.024, 0), null, 'no loads -> null');
  assert.equal(estimateExcluded(0.01, undefined), null);
});

test('csv: escapes fields and slugs rule ids', () => {
  const csv = toCsv(['url', 'instances'], [['https://x/a,b', 3], ['https://x/"q"', 1]]);
  assert.match(csv, /^url,instances\n/);
  assert.match(csv, /"https:\/\/x\/a,b",3/, 'comma field quoted');
  assert.match(csv, /"https:\/\/x\/""q""",1/, 'quotes doubled');
  assert.equal(ruleSlug('axe-core', 'color-contrast'), 'axe-core__color-contrast');
  assert.equal(ruleSlug('alfa', 'sia-r12'), 'alfa__sia-r12');
  assert.equal(ruleSlug('x', 'weird/id:1'), 'x__weird-id-1', 'unsafe chars slugged');
});

test('buildBugReports: page-load estimate appears when target sets page_loads_per_week', () => {
  const target = { domain: 'x', key: 'x', page_loads_per_week: 1_000_000 };
  const summary = {
    domain: 'x', week: '2026-W24', generatedAt: '2026-06-13T00:00:00Z', pagesScanned: 10,
    axe: { rules: { 'color-contrast': { count: 5, pages: 10, impact: 'serious',
      help: 'Contrast', helpUrl: 'https://x', tags: ['wcag143'], examplePages: ['https://x/a'],
      instances: [{ url: 'https://x/a', target: '.b', html: '<a>' }] } } },
    alfa: { rules: {} },
  };
  const [r] = buildBugReports(target, summary);
  assert.ok(r.impact.groups.length > 0);
  // 100% of pages affected, prevalence applied to full page loads.
  assert.ok(r.impact.groups.every((g) => g.estimatedExcluded > 0), 'excluded estimates present with page loads');

  // Without page_loads_per_week, no estimate (just percentages).
  const [r2] = buildBugReports({ domain: 'x', key: 'x' }, summary);
  assert.ok(r2.impact.groups.every((g) => g.estimatedExcluded == null), 'no estimate without page loads');
});

test('resource ledger: tracks first/last-seen and flags new-this-week', () => {
  const ledger = { domain: 'x', resources: {} };
  const w1 = updateResourceLedger(ledger, '2026-W23', [
    { url: 'https://x/a.pdf', type: 'pdf', pages: 3 },
    { url: 'https://x/embed', type: 'iframe', pages: 1 },
  ]);
  assert.equal(w1.length, 2, 'all resources are new in the first week');
  assert.equal(ledger.resources['https://x/a.pdf'].firstSeen, '2026-W23');

  // Week 2: a.pdf persists, b.pdf is brand new.
  const w2 = updateResourceLedger(ledger, '2026-W24', [
    { url: 'https://x/a.pdf', type: 'pdf', pages: 4 },
    { url: 'https://x/b.pdf', type: 'pdf', pages: 1 },
  ]);
  assert.deepEqual(w2.map((r) => r.url), ['https://x/b.pdf'], 'only the genuinely new resource is flagged');
  assert.equal(ledger.resources['https://x/a.pdf'].firstSeen, '2026-W23', 'persisting resource keeps first-seen');
  assert.equal(ledger.resources['https://x/a.pdf'].lastSeen, '2026-W24', 'lastSeen advances');
  assert.equal(ledger.resources['https://x/b.pdf'].firstSeen, '2026-W24');

  // Re-running the same week is idempotent for weeksSeen (no inflation);
  // a resource first seen this week is still correctly "new this week".
  const again = updateResourceLedger(ledger, '2026-W24', [{ url: 'https://x/b.pdf', type: 'pdf', pages: 1 }]);
  assert.deepEqual(again.map((r) => r.url), ['https://x/b.pdf'], 'a this-week resource is new on re-run too');
  assert.equal(ledger.resources['https://x/b.pdf'].weeksSeen, 1, 're-run does not inflate weeksSeen');
});

test('act + consensus: axe and alfa for the same ACT rule are one issue', async () => {
  const { canonicalRuleKey, actRuleIdsFor } = await import('../../src/lib/act.js');
  const { buildConsensus } = await import('../../src/lib/consensus.js');

  // image-alt (axe) and sia-r2 (alfa) are both ACT rule 23a2a8.
  assert.deepEqual(actRuleIdsFor('axe-core', 'image-alt'), ['23a2a8']);
  assert.deepEqual(actRuleIdsFor('alfa', 'sia-r2'), ['23a2a8']);
  assert.equal(canonicalRuleKey('axe-core', 'image-alt'), canonicalRuleKey('alfa', 'sia-r2'));
  // An unmapped rule keeps its own engine-scoped key (never merged).
  assert.equal(canonicalRuleKey('axe-core', 'made-up-rule'), 'axe-core:made-up-rule');

  const axe = { 'image-alt': { affectedPages: [{ url: 'p/a', instances: 1 }, { url: 'p/b', instances: 1 }] } };
  const alfa = { 'sia-r2': { affectedPages: [{ url: 'p/a', instances: 1 }] } };
  const c = buildConsensus(axe, alfa);
  // /a: both engines -> consensus; /b: axe only. 2 unique from 3 raw.
  assert.equal(c.uniqueIssues, 2, 'deduped to 2 unique issues');
  assert.equal(c.consensus, 1, '/a caught by both');
  assert.equal(c.axeOnly, 1, '/b axe only');
  assert.equal(c.alfaOnly, 0);
  assert.equal(c.rawAxe + c.rawAlfa, 3, 'naive count would be 3');
  assert.equal(c.byKey['act:23a2a8'].engines, 'both');
});

test('consensus: unmapped rules from different engines stay separate', async () => {
  const { buildConsensus } = await import('../../src/lib/consensus.js');
  // Two unmapped rules on the same page must NOT merge.
  const axe = { 'zzz-unmapped': { affectedPages: [{ url: 'p/a', instances: 1 }] } };
  const alfa = { 'sia-rZZZ': { affectedPages: [{ url: 'p/a', instances: 1 }] } };
  const c = buildConsensus(axe, alfa);
  assert.equal(c.uniqueIssues, 2, 'distinct unmapped rules are distinct issues');
  assert.equal(c.consensus, 0, 'no false consensus across unrelated rules');
});

test('remediation: tips resolve for known rules, null otherwise', async () => {
  const { remediationTip } = await import('../../src/lib/remediation.js');
  assert.match(remediationTip('axe-core', 'image-alt'), /alt/i);
  assert.match(remediationTip('alfa', 'sia-r2'), /alt/i);
  assert.equal(remediationTip('axe-core', 'no-such-rule'), null);
});

test('score: density-based, spreads across a curve so F is rare and meaningful', async () => {
  const { scoreFor, grade, band, trajectory } = await import('../../src/lib/score.js');
  const mk = (med) => ({ pagesAudited: 100, axe: { pagesScanned: 100, pagesWithViolations: 100, medianViolations: med }, alfa: { pagesScanned: 100, pagesWithFailures: 100, medianFailures: 0 } });

  // The key fix: sites where every page has SOME issue no longer all get F.
  const excellent = scoreFor(mk(1)); // ~1/page
  const typical = scoreFor(mk(6)); // typical gov page
  const poor = scoreFor(mk(16)); // heavy burden
  assert.ok(excellent.score > typical.score && typical.score > poor.score, 'monotonic: fewer issues score higher');
  assert.ok(excellent.grade === 'A' || excellent.grade === 'B', `low density is A/B (${excellent.grade} ${excellent.score})`);
  assert.equal(typical.grade, 'C', `typical site is a C, not F (${typical.score})`);
  assert.equal(poor.grade, 'F', `heavy burden is F (${poor.score})`);
  // A typical site is NOT failing — the whole point.
  assert.ok(typical.score >= 65, `typical site passes (${typical.score})`);

  // Score is axe-only: Alfa's (sampled, element-level) count must not move it.
  const lowAxeHighAlfa = scoreFor({ pagesAudited: 100, axe: { pagesScanned: 100, pagesWithViolations: 100, medianViolations: 1 }, alfa: { pagesScanned: 30, pagesWithFailures: 30, medianFailures: 99 } });
  assert.equal(lowAxeHighAlfa.score, excellent.score, 'Alfa median does not affect the score (axe-only)');

  assert.equal(grade(90), 'A'); assert.equal(grade(70), 'C'); assert.equal(grade(40), 'F');
  assert.equal(band(90), 'Leading'); assert.equal(band(70), 'Typical'); assert.equal(band(40), 'At risk');
  assert.equal(scoreFor({ pagesAudited: 0 }), null, 'no audited pages -> null');

  // Trajectory: improving when the typical page's burden drops.
  const series = [mk(16), mk(4)];
  const t = trajectory(series, 4);
  assert.equal(t.direction, 'improving');
  assert.ok(t.delta > 0);
});

test('priority: ranks by pages x severity x reach; fleet flattens across domains', async () => {
  const { priorityScore, rankBugs, fleetWorstOffenders } = await import('../../src/lib/priority.js');
  const bug = (sev, pages, prev) => ({ severity: sev, frequency: { pages_affected: pages }, impact: { groups: prev != null ? [{ prevalence: prev }] : [] }, summary: `${sev}/${pages}` });
  const widespreadCritical = bug('Critical', 50, 0.1);
  const rareLow = bug('Low', 1, 0.01);
  assert.ok(priorityScore(widespreadCritical) > priorityScore(rareLow), 'widespread critical outranks rare low');

  const ranked = rankBugs([rareLow, widespreadCritical], 5);
  assert.equal(ranked[0].summary, 'Critical/50', 'highest priority first');

  const fleet = fleetWorstOffenders([
    { target: { domain: 'a.gov', key: 'a' }, bugs: [rareLow] },
    { target: { domain: 'b.gov', key: 'b' }, bugs: [widespreadCritical] },
  ], 10);
  assert.equal(fleet[0].domain, 'b.gov', 'worst issue across domains floats to the top, tagged with its domain');
});

test('inventory: accumulates last-known status, keeps newer over older', async () => {
  const { updateInventory, inventorySummary } = await import('../../src/lib/inventory.js');
  const inv = { domain: 'x', pages: {} };
  updateInventory(inv, '2026-W20', [
    { url: 'x/a', pageId: 'a', status: 200, scannedAt: 't1', axe: { violationCount: 3 } },
    { url: 'x/b', pageId: 'b', status: 200, scannedAt: 't1', axe: { violationCount: 0 }, alfa: { failedCount: 0 } },
  ]);
  // Later week re-checks /a (now clean); /b not re-scanned this week.
  updateInventory(inv, '2026-W24', [{ url: 'x/a', pageId: 'a', status: 200, scannedAt: 't2', axe: { violationCount: 0 } }]);
  assert.equal(inv.pages['x/a'].lastWeek, '2026-W24', '/a advanced to newer week');
  assert.equal(inv.pages['x/a'].hasIssues, false, '/a now clean');
  assert.equal(inv.pages['x/b'].lastWeek, '2026-W20', '/b retains its older last-known result');

  // Re-applying an older week must NOT clobber the newer /a result.
  updateInventory(inv, '2026-W20', [{ url: 'x/a', pageId: 'a', status: 200, scannedAt: 't0', axe: { violationCount: 9 } }]);
  assert.equal(inv.pages['x/a'].lastWeek, '2026-W24', 'older re-run did not overwrite newer');

  const s = inventorySummary(inv, '2026-W24');
  assert.equal(s.totalKnownPages, 2);
  assert.equal(s.scannedThisWeek, 1);
});

test('security: classifies TLD, HTTPS, and headers from a mocked origin', async () => {
  const { runSecurity } = await import('../../src/engines/security.js');
  const realFetch = globalThis.fetch;
  try {
    // Origin with good headers; security.txt + www both resolve.
    globalThis.fetch = async (u) => ({
      ok: true, status: 200,
      headers: new Map([
        ['strict-transport-security', 'max-age=63072000'],
        ['content-security-policy', "default-src 'self'; frame-ancestors 'none'"],
        ['x-content-type-options', 'nosniff'],
      ]),
    });
    // Map needs a .has(); Map has it. .get() too. Good enough for the engine.
    const r = await runSecurity('https://example.gov', 'ua', 1000);
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c.pass]));
    assert.equal(by['https'], true, 'https detected');
    assert.equal(by['hsts'], true);
    assert.equal(by['csp'], true);
    assert.equal(by['x-content-type-options'], true);
    assert.equal(by['clickjacking'], true, 'CSP frame-ancestors counts as clickjacking protection');
    assert.equal(by['gov-tld'], true, '.gov is a sponsored TLD');

    // A non-gov http origin with no headers fails the right checks.
    globalThis.fetch = async () => ({ ok: false, status: 404, headers: new Map() });
    const r2 = await runSecurity('http://example.com', 'ua', 1000);
    const by2 = Object.fromEntries(r2.checks.map((c) => [c.id, c.pass]));
    assert.equal(by2['https'], false, 'http is not https');
    assert.equal(by2['gov-tld'], false, '.com is not sponsored');
    assert.equal(by2['security-txt'], false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('remediation: expanded tips cover landmark-unique and aria rules', async () => {
  const { remediationTip } = await import('../../src/lib/remediation.js');
  assert.match(remediationTip('axe-core', 'landmark-unique'), /aria-label|accessible name/i);
  assert.match(remediationTip('axe-core', 'aria-required-parent'), /parent/i);
  assert.match(remediationTip('axe-core', 'target-size'), /24|spacing/i);
  assert.equal(remediationTip('axe-core', 'totally-made-up'), null);
});

test('affected pages: inline <=25, list 25 + CSV when more (Markdown)', async () => {
  const { buildBugReports, bugReportToMarkdown } = await import('../../src/lib/bug-report.js');
  const mkRule = (n) => ({
    count: n, pages: n, impact: 'serious', help: 'X', helpUrl: 'https://x', tags: ['wcag412'],
    examplePages: [], affectedPages: Array.from({ length: Math.min(n, 5000) }, (_, i) => ({ url: `https://x/p${i}`, instances: 1 })),
    instances: [{ url: 'https://x/p0', target: '.a', html: '<a>' }],
  });
  const summary = (n) => ({ domain: 'x', week: '2026-W24', generatedAt: '2026-06-15T00:00:00Z', pagesScanned: 1200, axe: { rules: { 'select-name': mkRule(n) } }, alfa: { rules: {} } });

  // 1 affected page: the URL is listed, no "download CSV".
  let [bug] = buildBugReports({ domain: 'x', key: 'x' }, summary(1));
  bug.affected_pages_csv = 'csv/x.csv';
  let md = bugReportToMarkdown(bug);
  assert.match(md, /- https:\/\/x\/p0/, 'single affected page listed inline');
  assert.doesNotMatch(md.split('### Affected pages')[1].split('###')[0], /download CSV/, 'no CSV link for a single page');

  // 25 affected pages: all listed inline, still no CSV.
  [bug] = buildBugReports({ domain: 'x', key: 'x' }, summary(25));
  bug.affected_pages_csv = 'csv/x.csv';
  md = bugReportToMarkdown(bug);
  const sect25 = md.split('### Affected pages')[1].split('###')[0];
  assert.equal((sect25.match(/- https:\/\/x\/p\d+/g) || []).length, 25, '25 pages listed inline');
  assert.doesNotMatch(sect25, /download CSV/, 'no CSV link at exactly 25');

  // 26 affected pages: list first 25 + CSV link.
  [bug] = buildBugReports({ domain: 'x', key: 'x' }, summary(26));
  bug.affected_pages_csv = 'csv/x.csv';
  md = bugReportToMarkdown(bug);
  const sect26 = md.split('### Affected pages')[1].split('###')[0];
  assert.equal((sect26.match(/- https:\/\/x\/p\d+/g) || []).length, 25, 'first 25 listed');
  assert.match(sect26, /26 pages total/);
  assert.match(sect26, /download CSV/, 'CSV link appears above 25');
});
