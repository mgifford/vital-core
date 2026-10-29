import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBlock, isBlockedRecord, withoutBlockedAudits, assessAccess } from '../../src/lib/access.js';
import { accessAlert, accessBanner, renderIndex } from '../../src/report-html.js';

const page = (status, extra = {}) => ({ pageId: `p${Math.random()}`, url: 'https://www.lbhf.gov.uk/x', status, ...extra });
const run = (tally, extra = {}) => ({ startedAt: '2026-10-29T03:00:00Z', tally: { ok: 0, blocked: 0, timeout: 0, robots_skipped: 0, error: 0, ...tally }, ...extra });

test('detectBlock: challenges and refusals, with the firewall named; ordinary responses pass', () => {
  assert.deepEqual(detectBlock({ status: 202, headers: { 'X-Amzn-Waf-Action': 'challenge', via: '1.1 x.cloudfront.net (CloudFront)' } }),
    { kind: 'challenge', status: 202, by: ['AWS WAF challenge (x-amzn-waf-action)', 'Amazon CloudFront'] });
  assert.equal(detectBlock({ status: 403, headers: { 'cf-mitigated': 'challenge', 'cf-ray': 'x' } }).kind, 'challenge');
  assert.deepEqual(detectBlock({ status: 403, headers: { server: 'AkamaiGHost' } }), { kind: 'refusal', status: 403, by: ['Akamai'] });
  assert.equal(detectBlock({ status: 429, cookies: ['TS01abc'] }).by[0], 'F5 BIG-IP');
  assert.equal(detectBlock({ status: 200, headers: { 'x-drupal-cache': 'HIT' } }), null);
  assert.equal(detectBlock({ status: 404, headers: { server: 'cloudflare' } }), null, 'a plain 404 is not a block');
});

test('withoutBlockedAudits: a challenge page keeps identity and status but no audit results', () => {
  const legacy = page(202, { axe: { violationCount: 4, violations: {} }, alfa: { failedCount: 1 } });
  const ok = page(200, { axe: { violationCount: 1, violations: {} } });
  assert.equal(isBlockedRecord(legacy), true, 'records from before detectBlock() count by status');
  const [stripped, kept] = withoutBlockedAudits([legacy, ok]);
  assert.equal(stripped.axe, undefined);
  assert.equal(stripped.alfa, undefined);
  assert.deepEqual(stripped.blocked, { kind: 'challenge', status: 202, by: [] });
  assert.equal(kept, ok);
});

test('assessAccess: LBHF, a firewall challenge with every other page refused', () => {
  const records = withoutBlockedAudits([
    page(202, { blocked: { kind: 'challenge', status: 202, by: ['AWS WAF challenge (x-amzn-waf-action)'] }, axe: { violationCount: 4 } }),
    page(202, { axe: { violationCount: 4 } }),
    ...Array.from({ length: 39 }, () => page(404)),
  ]);
  const a = assessAccess({ records, runs: [run({ ok: 1, blocked: 39 })] });
  assert.equal(a.level, 'blocked');
  assert.equal(a.audited, 0);
  assert.deepEqual(a.firewall, { pages: 2, challenges: 2, refusals: 0, statuses: { 202: 2 }, by: ['AWS WAF challenge (x-amzn-waf-action)'] });
  assert.deepEqual(a.errorStatuses, { 404: 39 });
});

test('assessAccess: Blackburn, no page in three runs, with the connection error in words', () => {
  const runs = [1, 2, 3].map((n) => run({ timeout: 1 }, {
    startedAt: `2026-10-29T0${n}:00:00Z`,
    errors: [{ url: 'https://blackburn.gov.uk/', error: 'TimeoutError: page.goto: Timeout 60000ms exceeded.\nCall log:' }],
  }));
  assert.deepEqual(assessAccess({ runs }).connection, { runs: 3, error: 'TimeoutError: page.goto: Timeout 60000ms exceeded.' });
  runs[2].canonical = { homeError: 'UND_ERR_CONNECT_TIMEOUT' };
  const a = assessAccess({ runs });
  assert.equal(a.level, 'blocked');
  assert.match(a.connection.error, /^no connection within 10 s/);
});

test('assessAccess: robots.txt, partial blocks, ok and not scanned', () => {
  const robots = assessAccess({ runs: [run({ robots_skipped: 50 }, { robots: { rootAllowed: false } })] });
  assert.equal(robots.level, 'blocked');
  assert.deepEqual(robots.robots, { rootBlocked: true, skipped: 50 });

  const audited = Array.from({ length: 9 }, () => page(200, { axe: { violationCount: 0 } }));
  assert.equal(assessAccess({ records: [...audited, page(403)] }).level, 'partial', '1 of 10 refused');
  assert.equal(assessAccess({ records: [...audited, ...audited, page(403)] }).level, 'ok', '1 of 19 is below the threshold');
  assert.equal(assessAccess({ records: audited, runs: [run({ ok: 9, robots_skipped: 1 })] }).level, 'partial', 'robots.txt skips count too');
  assert.equal(assessAccess().level, 'not-scanned');
  assert.equal(assessAccess({ runs: [run({})] }).level, 'not-scanned', 'a run that had nothing to do is not a block');
});

test('accessAlert and accessBanner: causes and actions in text', () => {
  const lbhf = assessAccess({ records: [page(202, { blocked: { kind: 'challenge', status: 202, by: ['AWS WAF challenge (x-amzn-waf-action)'] } })] });
  const blackburn = assessAccess({ runs: [run({ timeout: 1 }, { canonical: { homeError: 'UND_ERR_CONNECT_TIMEOUT' } })] });
  const html = accessAlert([
    { domain: 'www.lbhf.gov.uk', href: 'reports/www.lbhf.gov.uk/2026-W44/index.html', userAgent: 'vital-scans/0.1 (+https://x)', access: lbhf },
    { domain: 'blackburn.gov.uk', access: blackburn },
    { domain: 'www.hackney.gov.uk', access: { level: 'ok' } },
    { domain: 'new.gov.uk', access: { level: 'not-scanned' } },
  ]);
  assert.match(html, /<section class="access-notice" aria-labelledby="h-access">\n<details>\n<summary><span id="h-access">Sites blocking the scanner \(2\): www\.lbhf\.gov\.uk, blackburn\.gov\.uk<\/span><\/summary>/,
    'a closed disclosure whose summary names the count and the sites, labelling its region');
  assert.doesNotMatch(html, /<summary>[^]*?<h\d/, 'no heading inside the summary');
  assert.match(html, /<a href="reports\/www\.lbhf\.gov\.uk\/2026-W44\/index\.html">www\.lbhf\.gov\.uk<\/a><\/strong>: Blocked\./);
  assert.match(html, /<strong>Blocked by a firewall<\/strong>: 1 page\(s\) got a challenge or refusal instead of the page \(HTTP 202 × 1\)\. Identified as AWS WAF challenge/);
  assert.match(html, /let the user agent <code>vital-scans<\/code> through its firewall/);
  assert.match(html, /<strong>Unreachable<\/strong>: no page loaded in 1 run\(s\) \(no connection within 10 s/);
  assert.match(html, /Actions → diagnose/);
  assert.doesNotMatch(html, /hackney/, 'a site that scans fine is not listed');
  assert.match(html, /Not scanned yet: new\.gov\.uk\./);
  assert.equal(accessAlert([{ domain: 'a', access: { level: 'ok' } }]), '');

  const many = accessAlert(['a.gov.uk', 'b.gov.uk', 'c.gov.uk', 'd.gov.uk', 'e.gov.uk'].map((domain) => ({ domain, access: blackburn })));
  assert.match(many, /Sites blocking the scanner \(5\): a\.gov\.uk, b\.gov\.uk, c\.gov\.uk and 2 more</);

  const partial = { level: 'partial', firewall: { pages: 0 }, robots: { rootBlocked: false, skipped: 12 }, connection: null, errorStatuses: {} };
  const banner = accessBanner(partial, 'vital-scans/0.1');
  assert.match(banner, /<details>\n<summary><span id="h-access-banner">Part of this site blocks the scanner: blocked by robots\.txt<\/span><\/summary>/, 'closed when only part of the site is blocked');
  assert.match(accessBanner(lbhf), /<details open>\n<summary><span id="h-access-banner">This site blocks the scanner: blocked by a firewall</, 'open when nothing could be audited');
  assert.match(banner, /<strong>Blocked by robots\.txt<\/strong>: 12 page\(s\) skipped/);
  assert.match(banner, /allow <code>vital-scans<\/code> in its robots\.txt/);
  assert.equal(accessBanner({ level: 'ok' }), '');
});

test('renderIndex: blocked and unscanned sites are listed above the ranking, not left out', () => {
  const series = (access, extra = {}) => [{ week: '2026-W44', access, pagesScanned: 41, pagesAudited: 0, axe: { medianViolations: null }, alfa: { medianFailures: null }, ...extra }];
  const html = renderIndex(
    [{ target: { key: 'www.lbhf.gov.uk', domain: 'www.lbhf.gov.uk', user_agent: 'vital-scans/0.1' }, series: series(assessAccess({ records: [page(202)] })) }],
    { unscanned: [{ target: { key: 'blackburn.gov.uk', domain: 'blackburn.gov.uk' }, access: assessAccess({ runs: [run({ timeout: 1 })] }) }] },
  );
  const alert = html.indexOf('id="h-access"');
  assert.ok(alert > 0 && alert < html.indexOf('every target is blocked'), 'the alert comes before the empty ranking note');
  assert.match(html, /www\.lbhf\.gov\.uk<\/a><\/strong>: Blocked\./);
  assert.match(html, /blackburn\.gov\.uk<\/strong>: Blocked\./);
  assert.doesNotMatch(html, /<details class="blocked-accordion"/);
});
