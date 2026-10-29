import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/lib/config.js';
import {
  parseDomains, resolveProbeTargets, twinHost, pickHeaders, cookieNames,
  protectionHints, extractTitle, describeOutcome, verdict, renderMarkdown,
} from '../../src/lib/probe.js';

const config = loadConfig(`
defaults:
  user_agent: "vital-scans/0.1 (+https://example.org)"
targets:
  - domain: lbhf.gov.uk
  - domain: blackburn.gov.uk
    nav_timeout_ms: 90000
  - domain: www.va.gov
    hf_only: true
`);

const chain = (...hops) => ({ hops, totalMs: 1200 });

test('parseDomains: splits on spaces and commas, lowercases, rejects non-domains', () => {
  assert.deepEqual(parseDomains(' LBHF.gov.uk, blackburn.gov.uk  lbhf.gov.uk '), ['lbhf.gov.uk', 'blackburn.gov.uk']);
  assert.deepEqual(parseDomains(''), []);
  assert.throws(() => parseDomains('lbhf.gov.uk; rm -rf /'), /Not a domain: lbhf\.gov\.uk;, rm, -rf, \//);
  assert.throws(() => parseDomains('https://lbhf.gov.uk'), /Not a domain/);
});

test('resolveProbeTargets: defaults to non-hf_only targets and refuses hf_only by key or host', () => {
  const all = resolveProbeTargets(config);
  assert.deepEqual(all.targets.map((t) => t.domain), ['lbhf.gov.uk', 'blackburn.gov.uk']);
  assert.deepEqual(all.refused, []);
  const asked = resolveProbeTargets(config, ['va.gov', 'blackburn.gov.uk', 'new-council.gov.uk']);
  assert.deepEqual(asked.refused, ['va.gov'], 'the apex of an hf_only www. target is refused too');
  assert.deepEqual(asked.targets.map((t) => [t.domain, t.configured, t.navTimeoutMs]), [
    ['blackburn.gov.uk', true, 90000],
    ['new-council.gov.uk', false, 60000],
  ]);
  assert.equal(asked.targets[0].userAgent, 'vital-scans/0.1 (+https://example.org)');
});

test('twinHost: apex and www. swap; another subdomain compares with its site', () => {
  assert.equal(twinHost('lbhf.gov.uk'), 'www.lbhf.gov.uk');
  assert.equal(twinHost('www.lbhf.gov.uk'), 'lbhf.gov.uk');
  assert.equal(twinHost('go.walsall.gov.uk'), 'walsall.gov.uk');
  assert.equal(twinHost('www.cms.gov'), 'cms.gov');
});

test('pickHeaders and cookieNames keep identifying details only', () => {
  const headers = new Headers({ server: 'cloudflare', 'cf-ray': 'abc-LHR', 'set-cookie': 'x=1', 'x-secret': 'no' });
  assert.deepEqual(pickHeaders(headers), { server: 'cloudflare', 'cf-ray': 'abc-LHR' });
  assert.deepEqual(pickHeaders({ 'x-amzn-waf-action': 'challenge', other: 'no' }), { 'x-amzn-waf-action': 'challenge' });
  assert.deepEqual(cookieNames(['__cf_bm=SECRET; path=/; HttpOnly', 'aws-waf-token=SECRET', '__cf_bm=again']), ['__cf_bm', 'aws-waf-token']);
});

test('protectionHints: names the firewall or CDN from headers and cookie names', () => {
  assert.deepEqual(protectionHints({ headers: { 'cf-mitigated': 'challenge', 'cf-ray': 'x' } }), ['Cloudflare challenge (cf-mitigated)']);
  assert.deepEqual(protectionHints({ headers: { server: 'cloudflare' } }), ['Cloudflare']);
  assert.deepEqual(protectionHints({ headers: { 'x-amzn-waf-action': 'captcha', via: '1.1 abc.cloudfront.net (CloudFront)' } }), ['AWS WAF captcha (x-amzn-waf-action)', 'Amazon CloudFront']);
  assert.deepEqual(protectionHints({ cookies: ['visid_incap_123', 'TS01abcd'] }), ['Imperva (Incapsula)', 'F5 BIG-IP']);
  assert.deepEqual(protectionHints({ headers: { server: 'AkamaiGHost', 'x-drupal-cache': 'HIT' } }), ['Akamai', 'Drupal page cache: HIT']);
  assert.deepEqual(protectionHints({ headers: { server: 'nginx' } }), []);
});

test('extractTitle: decodes common entities and collapses whitespace', () => {
  assert.equal(extractTitle('<html><head><title>\n  Hammersmith &amp; Fulham  Council </title>'), 'Hammersmith & Fulham Council');
  assert.equal(extractTitle('<title></title>'), null);
  assert.equal(extractTitle('no title here'), null);
});

test('describeOutcome: reads the last hop', () => {
  assert.equal(describeOutcome(chain({ url: 'https://a.gov.uk/', status: 301 }, { url: 'https://www.a.gov.uk/', status: 200 })), '200: OK');
  assert.match(describeOutcome(chain({ url: 'https://a.gov.uk/', status: 202 })), /bot challenge/);
  assert.equal(describeOutcome(chain({ url: 'https://a.gov.uk/', error: 'no response within 30 s' })), 'no response within 30 s');
  assert.equal(describeOutcome(chain({ url: 'https://a.gov.uk/', status: 403 })), '403: refused');
  assert.equal(describeOutcome(chain({ url: 'https://a.gov.uk/', status: 400 })), '400: client error');
  assert.equal(describeOutcome(chain({ url: 'https://a.gov.uk/', status: 302 })), '302: redirect without a usable location');
});

test('verdict: flags another subdomain, a different answer to a browser, and a load that never fires', () => {
  const ok = verdict({
    domain: 'hackney.gov.uk',
    scanner: chain({ url: 'https://www.hackney.gov.uk/', status: 200 }),
    browser: chain({ url: 'https://www.hackney.gov.uk/', status: 200 }),
    page: { loadMs: 3000, timeoutMs: 60000 },
  });
  assert.deepEqual(ok, { ok: true, text: '200: OK' });

  const redirected = verdict({
    domain: 'walsall.gov.uk',
    scanner: chain({ url: 'https://walsall.gov.uk/', status: 301 }, { url: 'https://go.walsall.gov.uk/', status: 200 }),
    browser: chain({ url: 'https://go.walsall.gov.uk/', status: 200 }),
    page: { loadMs: 3000, timeoutMs: 60000 },
  });
  assert.equal(redirected.ok, false);
  assert.match(redirected.text, /redirects to another host \(go\.walsall\.gov\.uk\)/);

  const challenged = verdict({
    domain: 'lbhf.gov.uk',
    scanner: chain({ url: 'https://lbhf.gov.uk/', status: 202 }),
    browser: chain({ url: 'https://lbhf.gov.uk/', status: 200 }),
    page: { loadMs: null, timeoutMs: 60000 },
  });
  assert.equal(challenged.ok, false);
  assert.match(challenged.text, /^202: accepted but not served/);
  assert.match(challenged.text, /answers a desktop browser differently \(200: OK\)/);
  assert.match(challenged.text, /load event didn't fire within 60 s/);
});

test('renderMarkdown: one section per domain with hops, hints, robots, sitemap and browser load', () => {
  const md = renderMarkdown([{
    domain: 'blackburn.gov.uk',
    configured: true,
    verdict: { ok: false, text: "200: OK; the load event didn't fire within 60 s" },
    fetches: [{
      url: 'https://blackburn.gov.uk/',
      scanner: chain({ url: 'https://blackburn.gov.uk/', status: 301 }, { url: 'https://www.blackburn.gov.uk/', status: 200, title: 'Home | Blackburn', bytes: 40960 }),
      browser: chain({ url: 'https://blackburn.gov.uk/', error: 'no response within 30 s' }),
    }],
    hints: ['Cloudflare'],
    robots: { status: 200, rootAllowed: true, sitemaps: ['https://www.blackburn.gov.uk/sitemap.xml'] },
    sitemap: { url: 'https://www.blackburn.gov.uk/sitemap.xml', status: 200, locs: 1234, isIndex: false },
    page: { status: 200, domContentLoadedMs: 2500, loadMs: null, timeoutMs: 60000, requests: 80, pending: ['chat.example.com/widget.js'], slowest: [{ url: 'chat.example.com/widget.js', ms: 60000 }] },
  }], { refused: ['www.va.gov'] });
  assert.match(md, /Refused \(hf_only, never probed from GitHub Actions\): www\.va\.gov/);
  assert.match(md, /## blackburn\.gov\.uk\n/);
  assert.match(md, /\*\*Verdict:\*\* needs attention: 200: OK; the load event/);
  assert.match(md, /\| https:\/\/blackburn\.gov\.uk\/ \| 301 → 200 \(“Home \\\| Blackburn”, 40 KB, 1\.2 s\) via blackburn\.gov\.uk → www\.blackburn\.gov\.uk \| no response within 30 s \(1\.2 s\) \|/);
  assert.match(md, /\*\*Protection hints:\*\* Cloudflare/);
  assert.match(md, /`\/` allowed for the scanner/);
  assert.match(md, /200, 1234 URLs/);
  assert.match(md, /load not reached in 60\.0 s, 80 requests/);
  assert.match(md, /Still open when it stopped waiting: `chat\.example\.com\/widget\.js`/);
  assert.doesNotMatch(md, /unreadable robots\.txt/);

  const unread = renderMarkdown([{
    domain: 'a.gov.uk',
    configured: true,
    verdict: { ok: true, text: '200: OK' },
    fetches: [{ url: 'https://a.gov.uk/', scanner: chain({ url: 'https://a.gov.uk/', status: 200, bytes: 512 }), browser: null }],
    hints: [],
    robots: { status: 403, rootAllowed: true, sitemaps: [] },
  }]);
  assert.match(unread, /\*\*robots\.txt:\*\* 403; `\/` allowed for the scanner \(the scan treats an unreadable robots\.txt as allowing everything\)/);
  assert.match(unread, /200 \(512 B, 1\.2 s\) \| — \|/);
});
