import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, pageId, registrableDomain, isThirdParty } from '../../src/lib/urls.js';
import { isoWeekOf, previousWeekOf } from '../../src/lib/week.js';
import { parseRobots } from '../../src/lib/robots.js';
import { addPage, pickBatch } from '../../src/lib/state.js';
import { resolveWcag, severityFor, classifyFinding } from '../../src/lib/wcag.js';
import { buildUrlFilter } from '../../src/lib/urls.js';
import { buildBugReports, bugReportToMarkdown } from '../../src/lib/bug-report.js';
import { splitSentences, estimateSyllables } from '../../src/engines/plain-language.js';
import { checkLink } from '../../src/lib/links.js';
import { normalizeRate, shouldRun } from '../../src/lib/sampling.js';
import { updateFindings } from '../../src/lib/findings.js';
import { findMisspellings } from '../../src/lib/spell.js';
import { impactFor, estimateExcluded, pct } from '../../src/lib/fpc.js';
import { toCsv, ruleSlug } from '../../src/lib/csv.js';
import { updateResourceLedger } from '../../src/lib/resource-ledger.js';
import { buildAcrData, buildAcrYaml } from '../../src/lib/acr.js';
import { headersToWappalyzer } from '../../src/engines/tech.js';
import { buildCooccurrence, lift, rankAssociations, mergeFleet, rankFleetAssociations } from '../../src/lib/tech-findings.js';
import { rollupThirdParty } from '../../src/lib/third-party-rollup.js';
import { buildLineManifest } from '../../src/lib/paracharts.js';
import { extractAudits } from '../../src/engines/lighthouse.js';
import { assessAltText, isAltProblem, ALT_VERDICTS } from '../../src/lib/alt-text.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

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
    sc: '1.4.3', name: 'Contrast (Minimum)', level: 'AA', wcag_version: '2.0',
  });
  assert.deepEqual(resolveWcag('axe-core', { tags: ['wcag412'] }), {
    sc: '4.1.2', name: 'Name, Role, Value', level: 'A', wcag_version: '2.0',
  });
  assert.equal(resolveWcag('axe-core', { tags: ['best-practice', 'wcag2a'] }), null, 'level-only tags have no SC');
  assert.deepEqual(resolveWcag('alfa', { ruleId: 'sia-r12' }), {
    sc: '4.1.2', name: 'Name, Role, Value', level: 'A', wcag_version: '2.0',
  });
  assert.equal(resolveWcag('alfa', { ruleId: 'sia-r9999' }), null, 'unknown alfa rule undetermined');
});

test('severityFor: axe impact maps, frequency amplifies', () => {
  assert.equal(severityFor('critical', 1, 50), 'Critical');
  assert.equal(severityFor('minor', 1, 50), 'Low', 'rare minor stays low');
  assert.equal(severityFor('minor', 30, 50), 'Medium', 'site-wide minor escalates one level');
  assert.equal(severityFor('serious', 40, 50), 'Critical', 'site-wide serious escalates to critical');
  assert.equal(severityFor(null, 1, 50), 'Medium', 'no impact (alfa) defaults medium');
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

  // New sort order: WCAG 2.0 A (sia-r12 → 4.1.2) before WCAG 2.0 AA
  // (color-contrast → 1.4.3). Level A requirements sort before Level AA
  // so engineers tackle the baseline compliance obligations first.
  const alfaReport = reports.find((r) => r.rule_id === 'sia-r12');
  const axeReport = reports.find((r) => r.rule_id === 'color-contrast');
  assert.ok(alfaReport, 'alfa sia-r12 present');
  assert.ok(axeReport, 'axe color-contrast present');
  assert.ok(reports.indexOf(alfaReport) < reports.indexOf(axeReport),
    'WCAG 2.0 A (sia-r12) sorts before WCAG 2.0 AA (color-contrast)');

  assert.equal(axeReport.severity, 'Critical', '6/10 pages escalates serious to critical');
  assert.equal(axeReport.wcag_sc, '1.4.3');
  assert.equal(axeReport.wcag_level, 'AA');
  assert.equal(axeReport.wcag_version, '2.0');
  assert.equal(axeReport.wcag_category, 'WCAG 2.0 AA');
  assert.match(axeReport.summary, /\(WCAG 1\.4\.3\)$/);
  assert.equal(axeReport.frequency.pages_affected, 6);
  assert.equal(axeReport.xpath, '.btn');
  assert.ok(axeReport.html_snippet.includes('btn'));

  // Impact: WCAG 1.4.3 (contrast) maps to vision-related FPC groups.
  assert.ok(axeReport.impact.groups.length > 0, 'mapped SC yields impact groups');
  assert.ok(axeReport.impact.groups.some((g) => /vision/i.test(g.group)), 'contrast affects a vision group');
  assert.match(axeReport.impact.summary, /Affects/);

  // Stable ids: same input -> same ids.
  const again = buildBugReports(target, summary);
  assert.equal(again.find((r) => r.rule_id === 'color-contrast').instance_id, axeReport.instance_id);
  assert.equal(again.find((r) => r.rule_id === 'color-contrast').pattern_id, axeReport.pattern_id);

  // Alfa report: no impact -> Medium (default), mapped SC, WCAG category.
  const alfa = reports.find((r) => r.rule_id === 'sia-r12');
  assert.equal(alfa.severity, 'Medium');
  assert.equal(alfa.wcag_sc, '4.1.2');
  assert.equal(alfa.wcag_version, '2.0');
  assert.equal(alfa.wcag_category, 'WCAG 2.0 A');

  // Markdown renders the required headings.
  const md = bugReportToMarkdown(axeReport);
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
  const reportA = { pattern_id: 'VS-aaa', tool: 'axe-core', rule_id: 'image-alt', summary: 'Images need alt (WCAG 1.1.1)', wcag_sc: '1.1.1', severity: 'critical', frequency: { pages_affected: 5 } };
  const reportB = { pattern_id: 'VS-bbb', tool: 'alfa', rule_id: 'sia-r12', summary: 'Button name (WCAG 4.1.2)', wcag_sc: '4.1.2', severity: 'moderate', frequency: { pages_affected: 2 } };

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

test('spell: per-call extraAllowlist suppresses target-specific jargon', () => {
  const words = ['MACRA', 'CHIPRA', 'xyzzy', 'beneficiares']; // MACRA/CHIPRA = ALL-CAPS -> always skipped; xyzzy/beneficiares = misspellings
  const withoutExtra = findMisspellings(words);
  assert.ok(withoutExtra.misspelled.includes('xyzzy'), 'xyzzy flagged without allowlist');

  const withExtra = findMisspellings(words, 25, ['xyzzy', 'beneficiares']);
  assert.equal(withExtra.misspelledCount, 0, 'extraAllowlist suppresses domain-specific terms');
  assert.deepEqual(withExtra.misspelled, []);
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
  const widespreadCritical = bug('critical', 50, 0.1);
  const rareLow = bug('minor', 1, 0.01);
  assert.ok(priorityScore(widespreadCritical) > priorityScore(rareLow), 'widespread critical outranks rare minor');

  const ranked = rankBugs([rareLow, widespreadCritical], 5);
  assert.equal(ranked[0].summary, 'critical/50', 'highest priority first');

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

test('perf-impact: averages always; totals only with page loads', async () => {
  const { performanceImpact, humanDuration, humanBytes } = await import('../../src/lib/perf-impact.js');
  // Two pages: one over both benchmarks, one under.
  const lhPages = [
    { url: 'x/a', metrics: { largestContentfulPaintMs: 4500 } }, // 2s over 2.5s
    { url: 'x/b', metrics: { largestContentfulPaintMs: 2000 } }, // under -> 0
  ];
  const weights = [2_600_000, 1_000_000]; // 1 MB over 1.6 MB, and under -> 0
  const noTraffic = performanceImpact(lhPages, weights, null);
  assert.equal(noTraffic.avgExtraLcpMs, 1000, 'avg extra LCP = (2000+0)/2 ms');
  assert.equal(noTraffic.pagesOverLcp, 1);
  assert.equal(noTraffic.avgExtraWeightBytes, 500000, 'avg extra weight = (1MB+0)/2');
  assert.equal(noTraffic.totals, null, 'no totals without traffic');

  // With traffic, totals appear (loads spread across sampled pages).
  const withTraffic = performanceImpact(lhPages, weights, 1000);
  assert.ok(withTraffic.totals, 'totals present with page loads');
  // extra seconds = sum(maxOver/1000 * loads/nPages) = (2 + 0) * (1000/2) = 1000s
  assert.equal(withTraffic.totals.extraSeconds, 1000);
  assert.equal(withTraffic.totals.extraBytes, 500_000_000, '(1MB+0) * (1000/2)');

  assert.equal(performanceImpact([], [], null), null, 'no data -> null');
  assert.match(humanDuration(31557600 * 2 + 86400 * 3), /2 years, 3 days/);
  assert.equal(humanBytes(2.5e12), '2.5 TB');
});

test('dashboard: blocked targets render in a collapsed accordion, not up top', async () => {
  const { renderIndex } = await import('../../src/report-html.js');
  const wk = (week, blocked) => ({ week, blocked, pagesScanned: 1, pagesAudited: blocked ? 0 : 1,
    axe: { medianViolations: 0, pagesWithViolations: 0, pagesScanned: 1 },
    alfa: { medianFailures: 0, pagesWithFailures: 0, pagesScanned: 1 } });
  const dashboard = [
    { target: { domain: 'good.gov', key: 'good.gov' }, series: [wk('2026-W25', null)], diffs: {}, bugs: [], windowSummary: wk('2026-W25', null) },
    { target: { domain: 'blocked.gov', key: 'blocked.gov' }, series: [wk('2026-W25', { status: 403 })], diffs: {}, bugs: [] },
  ];
  const html = renderIndex(dashboard);
  assert.match(html, /<details class="blocked-accordion">/, 'blocked targets are in a <details> accordion');
  assert.match(html, /Blocked targets \(1\)/, 'accordion summary shows the count');
  // The blocked accordion comes AFTER the leaderboard table, not before it.
  assert.ok(html.indexOf('<table') < html.indexOf('blocked-accordion'), 'accordion is below the main content');
});

test('buildUrlFilter: no config passes everything', () => {
  const filter = buildUrlFilter({});
  assert.equal(filter('https://example.gov/any/path?q=1'), true);
});

test('buildUrlFilter: url_include restricts to matching URLs', () => {
  const filter = buildUrlFilter({ url_include: ['/children/'] });
  assert.equal(filter('https://example.gov/children/page'), true, 'path match');
  assert.equal(filter('https://example.gov/adults/page'), false, 'non-matching path');
});

test('buildUrlFilter: url_exclude blocks matching URLs after include', () => {
  const filter = buildUrlFilter({ url_exclude: ['press_release', '?page='] });
  assert.equal(filter('https://example.gov/news/press_release/2026'), false, 'exclude by keyword');
  assert.equal(filter('https://example.gov/list?page=2'), false, 'exclude by query string');
  assert.equal(filter('https://example.gov/about'), true, 'non-matching passes');
});

test('buildUrlFilter: url_include + url_exclude compose correctly', () => {
  const filter = buildUrlFilter({ url_include: ['/news/'], url_exclude: ['press_release'] });
  assert.equal(filter('https://example.gov/news/article'), true, 'include match, no exclude');
  assert.equal(filter('https://example.gov/news/press_release'), false, 'include match but excluded');
  assert.equal(filter('https://example.gov/about'), false, 'not in include list');
});

test('classifyFinding: WCAG version and level produce correct category', () => {
  const wcag20aa = { sc: '1.4.3', name: 'Contrast', level: 'AA', wcag_version: '2.0' };
  const wcag21a  = { sc: '1.3.4', name: 'Orientation', level: 'A', wcag_version: '2.1' };
  const wcag22aa = { sc: '2.4.11', name: 'Focus Appearance', level: 'AA', wcag_version: '2.2' };
  const wcagAAA  = { sc: '1.4.6', name: 'Contrast (Enhanced)', level: 'AAA', wcag_version: '2.0' };

  assert.equal(classifyFinding('axe-core', {}, wcag20aa), 'WCAG 2.0 AA');
  assert.equal(classifyFinding('axe-core', {}, wcag21a),  'WCAG 2.1 A');
  assert.equal(classifyFinding('axe-core', {}, wcag22aa), 'WCAG 2.2 AA');
  assert.equal(classifyFinding('axe-core', {}, wcagAAA),  'WCAG 2.x AAA');
});

test('classifyFinding: axe best-practice tag without WCAG mapping', () => {
  assert.equal(classifyFinding('axe-core', { tags: ['best-practice'] }, null), 'Best Practice');
});

test('classifyFinding: no mapping returns Undetermined', () => {
  assert.equal(classifyFinding('alfa', {}, null), 'Undetermined');
});

test('buildBugReports: WCAG sort order across version groups', () => {
  const makeRule = (tags, pages = 5) => ({ pages, tags, count: pages * 2, examplePages: ['https://x/a'] });
  const target = { domain: 'x.gov', key: 'x.gov' };
  const summary = {
    week: '2026-W25',
    pagesScanned: 10,
    axe: {
      pagesScanned: 10,
      rules: {
        'focus-appearance':    makeRule(['wcag2aa', 'wcag2411']),  // 2.4.11 → WCAG 2.2 AA
        reflow:                makeRule(['wcag21aa', 'wcag1410']), // 1.4.10 → WCAG 2.1 AA
        'color-contrast':      makeRule(['wcag2aa', 'wcag143']),   // 1.4.3  → WCAG 2.0 AA
        'avoid-inline-spacing': makeRule(['best-practice']),       // Best Practice
      },
    },
    alfa: { pagesScanned: 0, rules: {} },
  };
  // buildBugReports signature is (target, summary)
  const reports = buildBugReports(target, summary);
  const cats = reports.map((r) => r.wcag_category);

  const i22 = cats.findIndex((c) => c?.startsWith('WCAG 2.2'));
  const i21 = cats.findIndex((c) => c?.startsWith('WCAG 2.1'));
  const i20 = cats.findIndex((c) => c?.startsWith('WCAG 2.0'));
  const iBP = cats.findIndex((c) => c === 'Best Practice');

  assert.ok(i22 !== -1, `WCAG 2.2 finding present — got: ${JSON.stringify(cats)}`);
  assert.ok(i21 !== -1, 'WCAG 2.1 finding present');
  assert.ok(i20 !== -1, 'WCAG 2.0 finding present');
  assert.ok(iBP !== -1, 'Best Practice finding present');
  assert.ok(i22 < i21, 'WCAG 2.2 before 2.1');
  assert.ok(i21 < i20, 'WCAG 2.1 before 2.0');
  assert.ok(i20 < iBP, 'WCAG 2.0 before Best Practice');
});

test('buildAcrData: does-not-support when failures span ≥5% of pages', () => {
  const summary = {
    week: '2026-W25',
    pagesScanned: 100,
    axe: {
      pagesScanned: 100,
      rules: {
        // color-contrast → 1.4.3, 10/100 = 10% → does-not-support
        'color-contrast': { pages: 10, tags: ['wcag2aa', 'wcag143'], examplePages: ['https://x/a'] },
      },
    },
    alfa: { pagesScanned: 0, rules: {} },
  };
  const { scMap } = buildAcrData(summary);
  const sc143 = scMap.get('1.4.3');
  assert.ok(sc143, '1.4.3 entry present');
  assert.equal(sc143.adherence, 'does-not-support', '10% failure rate → does-not-support');
  assert.equal(sc143.pagesAffected, 10);
  assert.ok(sc143.engines.includes('axe-core'));
});

test('buildAcrData: partially-supports when failures span <5% of pages', () => {
  const summary = {
    week: '2026-W25',
    pagesScanned: 100,
    axe: {
      pagesScanned: 100,
      rules: {
        // color-contrast → 1.4.3, 4/100 = 4% → partially-supports
        'color-contrast': { pages: 4, tags: ['wcag2aa', 'wcag143'], examplePages: [] },
      },
    },
    alfa: { pagesScanned: 0, rules: {} },
  };
  const { scMap } = buildAcrData(summary);
  assert.equal(scMap.get('1.4.3').adherence, 'partially-supports');
});

test('buildAcrData: zero-page failure is partially-supports, not supports', () => {
  // A rule with pages=0 still enters scFailures (pages: max(0,0)=0).
  // fail.pages/axePages = 0/50 = 0% < 5% → partially-supports, not supports.
  // "supports" requires the SC to be in testedSCs but absent from scFailures,
  // which can only happen via Alfa's resolveWcag path when resolveWcag returns
  // an SC that was not reported at all in axe rules. This is an edge case of
  // the current conservative implementation.
  const summary = {
    week: '2026-W25',
    pagesScanned: 50,
    axe: {
      pagesScanned: 50,
      rules: {
        'image-alt': { pages: 0, tags: ['wcag2a', 'wcag111'], examplePages: [] },
      },
    },
    alfa: { pagesScanned: 0, rules: {} },
  };
  const { scMap } = buildAcrData(summary);
  const sc111 = scMap.get('1.1.1');
  assert.ok(sc111, '1.1.1 entry present');
  // pages=0 → fail rate 0% < 5% → partially-supports (not "supports")
  assert.equal(sc111.adherence, 'partially-supports', 'zero-page failure is partially-supports');
  assert.equal(sc111.pagesAffected, 0);
});

test('buildAcrData: not-evaluated for SCs no engine covers', () => {
  const summary = {
    week: '2026-W25',
    pagesScanned: 50,
    axe: { pagesScanned: 50, rules: {} },
    alfa: { pagesScanned: 0, rules: {} },
  };
  const { scMap } = buildAcrData(summary);
  // 1.2.5 (Audio Description) is rarely covered by automated tools
  const sc125 = scMap.get('1.2.5');
  assert.ok(sc125, '1.2.5 entry present in catalog');
  assert.equal(sc125.adherence, 'not-evaluated');
});

test('buildAcrYaml: valid YAML shape with required OpenACR fields', () => {
  const summary = {
    week: '2026-W25',
    pagesScanned: 10,
    axe: { pagesScanned: 10, version: '4.12.1', rules: {} },
    alfa: { pagesScanned: 0, rules: {} },
  };
  const acrData = buildAcrData(summary);
  const yaml = buildAcrYaml({ domain: 'example.gov' }, summary, '2026-W25', acrData);
  assert.match(yaml, /^title:/, 'starts with title field');
  assert.match(yaml, /catalog: 2\.5-edition-wcag-2\.2-en/, 'references WCAG 2.2 catalog');
  assert.match(yaml, /chapters:/, 'has chapters section');
  assert.match(yaml, /success_criteria_level_a:/, 'has Level A section');
  assert.match(yaml, /success_criteria_level_aa:/, 'has Level AA section');
  assert.match(yaml, /does-not-support|partially-supports|supports|not-evaluated/, 'contains adherence values');
});

test('headersToWappalyzer: produces array-valued, lowercased object shape', () => {
  const out = headersToWappalyzer({ 'Content-Type': 'text/html', Server: 'AkamaiGHost' });
  assert.deepEqual(out, { 'content-type': ['text/html'], server: ['AkamaiGHost'] });
  // Already-array values are flattened, not nested.
  assert.deepEqual(headersToWappalyzer({ 'Set-Cookie': ['a=1', 'b=2'] }), { 'set-cookie': ['a=1', 'b=2'] });
});

// Regression: Akamai-fronted sites (e.g. cms.gov) set ak_bmsc/bm_sv/bm_sz
// cookies that match a Wappalyzer fingerprint. If cookie/header values are
// bare strings instead of arrays, analyzeManyToMany throws "values.forEach
// is not a function" and crashes the whole page scan. This loads the real
// vendored Wappalyzer and asserts the shapes our tech engine produces are
// crash-free and actually detect Akamai.
test('wappalyzer: Akamai cookies/headers do not crash and are detected', () => {
  const require = createRequire(import.meta.url);
  const VENDOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../vendor/wappalyzer');
  const fn = new Function('module', 'exports', 'require', fs.readFileSync(path.join(VENDOR, 'wappalyzer.js'), 'utf8'));
  const m = { exports: {} };
  fn(m, m.exports, require);
  const W = m.exports;
  W.setCategories(JSON.parse(fs.readFileSync(path.join(VENDOR, 'categories.json'), 'utf8')));
  let tech = {};
  for (const f of fs.readdirSync(path.join(VENDOR, 'technologies'))) {
    if (f.endsWith('.json')) Object.assign(tech, JSON.parse(fs.readFileSync(path.join(VENDOR, 'technologies', f), 'utf8')));
  }
  W.setTechnologies(tech);

  // Cookies as the engine now builds them: { name -> [value] }.
  const cookies = {};
  for (const [k, v] of Object.entries({ ak_bmsc: 'F1', bm_sv: 'x', bm_sz: 'a' })) (cookies[k] ??= []).push(v);
  const headers = headersToWappalyzer({ Server: 'AkamaiGHost' });

  let detections;
  assert.doesNotThrow(() => {
    detections = W.resolve(W.analyze({ url: 'https://www.cms.gov', html: '<html></html>', scriptSrc: [], scripts: '', meta: {}, cookies, js: {}, headers }));
  }, 'string-valued cookies/headers must not crash analyzeManyToMany');
  assert.ok(detections.some((d) => /akamai/i.test(d.name)), 'Akamai detected from its cookies/headers');
});

test('tech-findings: co-occurrence dedupes findings per page', () => {
  const pages = [
    { techs: ['WordPress', 'GTM'], findings: ['axe:color-contrast', 'axe:color-contrast', 'axe:image-alt'] },
    { techs: ['WordPress'], findings: ['axe:color-contrast'] },
    { techs: ['Drupal'], findings: ['axe:region'] },
  ];
  const m = buildCooccurrence(pages);
  assert.equal(m.pages, 3);
  assert.equal(m.tech.WordPress, 2);
  assert.equal(m.tech.GTM, 1);
  // color-contrast counted once per page despite appearing twice on page 1.
  assert.equal(m.finding['axe:color-contrast'], 2);
  assert.equal(m.pair.WordPress['axe:color-contrast'], 2);
  assert.equal(m.pair.GTM['axe:image-alt'], 1);
});

test('tech-findings: lift over- and under-representation, support guard', () => {
  // 10 pages. GTM on 5 of them; every GTM page has the finding, only those do.
  const pages = [];
  for (let i = 0; i < 5; i++) pages.push({ techs: ['GTM'], findings: ['axe:contrast'] });
  for (let i = 0; i < 5; i++) pages.push({ techs: ['Other'], findings: [] });
  const m = buildCooccurrence(pages);
  // P(finding|GTM)=1, P(finding)=0.5 -> lift 2.0
  assert.equal(lift(m, 'GTM', 'axe:contrast', 5), 2);
  // Below min support -> null.
  assert.equal(lift(m, 'GTM', 'axe:contrast', 6), null, 'support guard rejects techPages < minPages');
  // Unknown pair -> null.
  assert.equal(lift(m, 'GTM', 'axe:missing', 1), null);
});

test('tech-findings: rankAssociations sorts by lift then support', () => {
  const pages = [];
  for (let i = 0; i < 6; i++) pages.push({ techs: ['A'], findings: ['axe:x'] });
  for (let i = 0; i < 6; i++) pages.push({ techs: ['B'], findings: i < 3 ? ['axe:x'] : [] });
  const m = buildCooccurrence(pages);
  const ranked = rankAssociations(m, { minPages: 3 });
  assert.ok(ranked.length >= 1);
  // A (finding on all 6) has higher lift than B (finding on 3 of 6).
  assert.equal(ranked[0].tech, 'A');
  assert.ok(ranked[0].lift >= (ranked[1]?.lift ?? 0));
});

test('tech-findings: fleet merge counts distinct sites and scores breadth', () => {
  // Each site: 6 GTM pages all with the finding + 6 other pages without it.
  // Per site P(finding)=0.5, P(finding|GTM)=1 -> lift 2.0.
  const mk = () => {
    const pages = [];
    for (let i = 0; i < 6; i++) pages.push({ techs: ['GTM'], findings: ['axe:x'] });
    for (let i = 0; i < 6; i++) pages.push({ techs: ['Other'], findings: [] });
    return buildCooccurrence(pages);
  };
  const fleet = mergeFleet([
    { domain: 'a.gov', model: mk() },
    { domain: 'b.gov', model: mk() },
    { domain: 'c.gov', model: mk() },
  ]);
  assert.equal(fleet.techSites.GTM, 3, 'GTM seen on 3 sites');
  assert.equal(fleet.pairSites.GTM['axe:x'], 3, 'pair seen on 3 sites');
  const ranked = rankFleetAssociations(fleet, { minPages: 5, minSites: 2 });
  assert.equal(ranked[0].tech, 'GTM');
  assert.equal(ranked[0].sites, 3);
  // score = lift(2.0) * sites(3) = 6.0
  assert.equal(ranked[0].score, 6);
});

test('tech-findings: fleet minSites filters single-site coincidences', () => {
  const pages = [];
  for (let i = 0; i < 6; i++) pages.push({ techs: ['Solo'], findings: ['axe:y'] });
  const fleet = mergeFleet([{ domain: 'only.gov', model: buildCooccurrence(pages) }]);
  const ranked = rankFleetAssociations(fleet, { minPages: 5, minSites: 2 });
  assert.equal(ranked.length, 0, 'single-site pair excluded by minSites=2');
});

test('registrableDomain: reduces to eTLD+1, handles multi-label suffixes', () => {
  assert.equal(registrableDomain('www.cdc.gov'), 'cdc.gov');
  assert.equal(registrableDomain('fonts.googleapis.com'), 'googleapis.com');
  assert.equal(registrableDomain('a.b.c.example.com'), 'example.com');
  assert.equal(registrableDomain('cms.gov'), 'cms.gov');
  assert.equal(registrableDomain('service.gov.uk'), 'service.gov.uk');
  assert.equal(registrableDomain('x.service.gov.uk'), 'service.gov.uk');
  assert.equal(registrableDomain('localhost'), 'localhost');
  assert.equal(registrableDomain(''), '');
});

test('isThirdParty: different registrable domain only', () => {
  const page = 'https://www.cms.gov/page';
  assert.equal(isThirdParty('https://www.googletagmanager.com/gtm.js', page), true);
  assert.equal(isThirdParty('https://cdn.cms.gov/app.js', page), false, 'same-site subdomain is first party');
  assert.equal(isThirdParty('https://cms.gov/a.js', page), false, 'apex of same site is first party');
  assert.equal(isThirdParty('data:text/js,1', page), false, 'data URI is not third party');
  assert.equal(isThirdParty('not a url', page), false, 'parse failure is not third party');
});

test('rollupThirdParty: per-vendor pages, medians, script flag, finding co-occurrence', () => {
  const pages = [
    { pageUrl: 'p1', hasFindings: true,  origins: [
      { origin: 'gtm.com', requests: 2, bytes: 100, scripts: 1, totalDurationMs: 50 },
      { origin: 'cdn.com', requests: 1, bytes: 400, scripts: 0, totalDurationMs: 20 },
    ] },
    { pageUrl: 'p2', hasFindings: false, origins: [
      { origin: 'gtm.com', requests: 4, bytes: 300, scripts: 1, totalDurationMs: 90 },
    ] },
    { pageUrl: 'p3', hasFindings: true,  origins: [
      { origin: 'gtm.com', requests: 3, bytes: 200, scripts: 1, totalDurationMs: 70 },
    ] },
  ];
  const r = rollupThirdParty(pages);
  assert.equal(r.pagesScanned, 3);
  const gtm = r.vendors.find((v) => v.origin === 'gtm.com');
  assert.equal(gtm.pages, 3);
  assert.equal(gtm.isScriptVendor, true);
  assert.equal(gtm.medianBytes, 200, 'median of [100,300,200] -> 200');
  assert.equal(gtm.medianRequests, 3);
  assert.equal(gtm.pagesWithFindings, 2, 'gtm on p1+p3 (with findings) and p2 (without)');
  // cdn.com is not a script vendor and appears on one page.
  const cdn = r.vendors.find((v) => v.origin === 'cdn.com');
  assert.equal(cdn.isScriptVendor, false);
  assert.equal(cdn.pages, 1);
  // Sorted by pages desc: gtm (3) before cdn (1).
  assert.equal(r.vendors[0].origin, 'gtm.com');
});

test('buildLineManifest: JIM shape with facets, string records, data.source', () => {
  const m = buildLineManifest('Median axe violations', 'Median axe violations',
    [{ week: '2026-W23', value: 6 }, { week: '2026-W24', value: 3 }, { week: '2026-W25', value: null }],
    { unit: ' KB' });
  assert.equal(m.datasets.length, 1);
  const d = m.datasets[0];
  assert.equal(d.type, 'line');
  assert.equal(d.data.source, 'inline', 'data.source present (runtime throws without it)');
  assert.ok(d.facets.x && d.facets.y, 'x and y facets present');
  assert.equal(d.facets.y.units, 'KB', 'unit trimmed onto y facet');
  // null-valued points dropped; remaining records are string-typed.
  assert.equal(d.series[0].records.length, 2, 'null value filtered out');
  assert.deepEqual(d.series[0].records[0], { x: '2026-W23', y: '6' });
  assert.equal(typeof d.series[0].records[0].y, 'string', 'y is a string per runtime contract');
});

test('extractAudits: pulls failing non-a11y audits, tags category, skips a11y/passing', () => {
  const categories = {
    performance: { auditRefs: [{ id: 'unused-css-rules' }, { id: 'server-response-time' }, { id: 'speed-index' }] },
    seo: { auditRefs: [{ id: 'meta-description' }] },
    accessibility: { auditRefs: [{ id: 'color-contrast' }] }, // must be ignored
    'agentic-browsing': { auditRefs: [{ id: 'llms-txt' }] },
  };
  const audits = {
    'unused-css-rules': { title: 'Reduce unused CSS', score: 0.5, scoreDisplayMode: 'metricSavings',
      metricSavings: { LCP: 350 }, details: { overallSavingsBytes: 177580, items: [1, 2, 3] } },
    'server-response-time': { title: 'Server response', score: 1, scoreDisplayMode: 'binary' }, // passing -> skip
    'speed-index': { title: 'Speed Index', score: 0.4, scoreDisplayMode: 'numeric', details: {} },
    'meta-description': { title: 'No meta description', score: 0, scoreDisplayMode: 'binary', details: { items: [] } },
    'color-contrast': { title: 'Contrast', score: 0, scoreDisplayMode: 'binary' }, // a11y -> skip
    'llms-txt': { title: 'llms.txt follows recommendations', score: null, scoreDisplayMode: 'notApplicable' },
  };
  const out = extractAudits(categories, audits);
  const ids = out.map((a) => a.id).sort();
  // unused-css-rules: metricSavings mode with 177580 bytes -> kept as a savings opportunity.
  // speed-index (numeric, 0.4) kept; meta-description (binary, 0) kept; llms-txt (agentic notApplicable) kept.
  assert.ok(ids.includes('unused-css-rules'), 'metricSavings opportunity with real savings kept');
  assert.ok(ids.includes('speed-index'), 'numeric failing audit kept');
  assert.ok(ids.includes('meta-description'), 'binary failing audit kept');
  assert.ok(ids.includes('llms-txt'), 'agentic notApplicable gap kept');
  assert.ok(!ids.includes('color-contrast'), 'accessibility audit excluded');
  assert.ok(!ids.includes('server-response-time'), 'passing audit excluded');
  const css = out.find((a) => a.id === 'unused-css-rules');
  assert.equal(css.savingsBytes, 177580, 'savings bytes captured');
  assert.equal(css.savingsMs, 350, 'max metricSavings ms captured');
  const seo = out.find((a) => a.id === 'meta-description');
  assert.equal(seo.category, 'seo', 'category tagged from auditRefs');
});

test('assessAltText: classifies each alt-text problem', () => {
  const v = (img) => assessAltText(img).verdict;
  // Missing / decorative / hidden.
  assert.equal(v({ isMissingAlt: true, hasAlt: false }), ALT_VERDICTS.MISSING);
  assert.equal(v({ hasAlt: true, alt: '', isDecorative: true }), ALT_VERDICTS.DECORATIVE);
  assert.equal(v({ hasAlt: true, alt: 'x', ariaHidden: true }), ALT_VERDICTS.DECORATIVE, 'aria-hidden wins');
  assert.equal(v({ hasAlt: true, alt: 'x', rolePresentation: true }), ALT_VERDICTS.DECORATIVE);
  // Filename-like.
  assert.equal(v({ hasAlt: true, alt: 'hero_banner_2024.jpg' }), ALT_VERDICTS.FILENAME);
  assert.equal(v({ hasAlt: true, alt: 'IMG_4821.PNG' }), ALT_VERDICTS.FILENAME);
  // Redundant / meaningless phrasing.
  assert.equal(v({ hasAlt: true, alt: 'Image of a senior couple smiling' }), ALT_VERDICTS.SUSPICIOUS);
  assert.equal(v({ hasAlt: true, alt: 'photo' }), ALT_VERDICTS.SUSPICIOUS);
  assert.equal(v({ hasAlt: true, alt: 'logo' }), ALT_VERDICTS.SUSPICIOUS);
  // Too short.
  assert.equal(v({ hasAlt: true, alt: '.' }), ALT_VERDICTS.SUSPICIOUS, 'bare dot is meaningless'); // '.' is in MEANINGLESS_EXACT
  assert.equal(v({ hasAlt: true, alt: 'ab' }), ALT_VERDICTS.TOO_SHORT);
  assert.equal(v({ hasAlt: true, alt: 'CMS' }), ALT_VERDICTS.TOO_SHORT, 'single 3-char word too short');
  // Too long.
  assert.equal(v({ hasAlt: true, alt: 'x '.repeat(200).trim() }), ALT_VERDICTS.TOO_LONG);
  // Good.
  assert.equal(v({ hasAlt: true, alt: 'Secretary signs the funding bill at a podium' }), ALT_VERDICTS.GOOD);
  // A real filename inside a sentence is NOT flagged as a filename.
  assert.equal(v({ hasAlt: true, alt: 'Screenshot of the report.pdf download page' }), ALT_VERDICTS.SUSPICIOUS, 'leads with "screenshot of"');
});

test('isAltProblem: GOOD and DECORATIVE are not problems', () => {
  assert.equal(isAltProblem(ALT_VERDICTS.GOOD), false);
  assert.equal(isAltProblem(ALT_VERDICTS.DECORATIVE), false);
  assert.equal(isAltProblem(ALT_VERDICTS.FILENAME), true);
  assert.equal(isAltProblem(ALT_VERDICTS.MISSING), true);
  assert.equal(isAltProblem(ALT_VERDICTS.TOO_SHORT), true);
});
