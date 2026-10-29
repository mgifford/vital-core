import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { pickCanonicalOrigin, httpsProblem, resolveCanonicalOrigin } from '../../src/lib/canonical.js';
import { normalizeUrl, toCanonicalOrigin, urlMatchKey, pageId } from '../../src/lib/urls.js';
import { canonicalizeState, addPage } from '../../src/lib/state.js';
import { runSecurity } from '../../src/engines/security.js';
import { renderUrlLookup } from '../../src/report-html.js';

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('pickCanonicalOrigin: follows a same-site redirect, keeps the configured origin for another site', () => {
  assert.equal(pickCanonicalOrigin('https://hackney.gov.uk', 'https://www.hackney.gov.uk/'), 'https://www.hackney.gov.uk');
  assert.equal(pickCanonicalOrigin('https://www.luton.gov.uk', 'https://www.luton.gov.uk/home'), 'https://www.luton.gov.uk');
  assert.equal(pickCanonicalOrigin('https://example.gov', 'http://www.example.gov/'), 'http://www.example.gov', 'a downgrade is followed, and reported by httpsProblem');
  assert.equal(pickCanonicalOrigin('https://walsall.gov.uk', 'https://go.walsall.gov.uk/'), 'https://walsall.gov.uk', 'another subdomain is another site');
  assert.equal(pickCanonicalOrigin('https://example.gov', 'not a url'), 'https://example.gov');
});

test('httpsProblem: names why a site is scanned over http', () => {
  assert.equal(httpsProblem({ origin: 'https://a.gov', configured: 'https://a.gov' }), null);
  assert.equal(httpsProblem({ origin: 'http://a.gov', configured: 'https://a.gov', httpsError: 'CERT_HAS_EXPIRED' }), 'no working HTTPS (CERT_HAS_EXPIRED); served over http');
  assert.equal(httpsProblem({ origin: 'http://a.gov', configured: 'https://a.gov' }), 'HTTPS redirects to HTTP');
  assert.equal(httpsProblem({ origin: 'http://127.0.0.1:4000', configured: 'http://127.0.0.1:4000' }), 'http');
});

test('normalizeUrl: canonicalOrigin rewrites same-site scheme and host; without it nothing changes', () => {
  const c = 'https://go.walsall.gov.uk';
  assert.equal(normalizeUrl('http://go.walsall.gov.uk/events/x/', c, 'go.walsall.gov.uk', c), 'https://go.walsall.gov.uk/events/x');
  assert.equal(normalizeUrl('/a?b=2&a=1#top', 'http://go.walsall.gov.uk/x', 'go.walsall.gov.uk', c), 'https://go.walsall.gov.uk/a?a=1&b=2');
  assert.equal(normalizeUrl('https://hackney.gov.uk/x', 'https://hackney.gov.uk/', 'www.hackney.gov.uk', 'https://www.hackney.gov.uk'), 'https://www.hackney.gov.uk/x');
  assert.equal(normalizeUrl('https://x.example.org/', 'https://hackney.gov.uk/', 'hackney.gov.uk', 'https://www.hackney.gov.uk'), null, 'off-site links are still dropped');
  assert.equal(normalizeUrl('http://go.walsall.gov.uk/events/x', c, 'go.walsall.gov.uk'), 'http://go.walsall.gov.uk/events/x', 'unchanged without a canonical origin');
  const canonicalUrl = 'https://www.cms.gov/medicare';
  assert.equal(normalizeUrl(canonicalUrl, canonicalUrl, 'www.cms.gov', 'https://www.cms.gov'), canonicalUrl, 'an already-canonical URL keeps its page ID');
});

test('toCanonicalOrigin and urlMatchKey', () => {
  assert.equal(toCanonicalOrigin('http://hackney.gov.uk/a?x=1', 'https://www.hackney.gov.uk'), 'https://www.hackney.gov.uk/a?x=1');
  assert.equal(toCanonicalOrigin('https://data.cms.gov/a', 'https://www.cms.gov'), 'https://data.cms.gov/a', 'another subdomain is left alone');
  assert.equal(urlMatchKey('https://www.hackney.gov.uk/a#b'), 'hackney.gov.uk/a');
  assert.equal(urlMatchKey('http://hackney.gov.uk/a'), 'hackney.gov.uk/a');
  assert.equal(urlMatchKey('/events/x'), '/events/x');
});

test('canonicalizeState: moves variants to the canonical origin and merges duplicates without losing coverage', () => {
  const state = { domain: 'go.walsall.gov.uk', pages: {} };
  const add = (url, fields) => { addPage(state, pageId(url), url, 1); Object.assign(state.pages[pageId(url)], fields); };
  add('http://go.walsall.gov.uk/council-tax', { lastScannedWeek: '2026-W44', lastScannedAt: '2026-10-28T10:00:00Z', lastStatus: 200, failCount: 0 });
  add('https://go.walsall.gov.uk/council-tax', { priority: true, failCount: 1, depth: 0 });
  add('http://go.walsall.gov.uk/events/x', { failCount: 2 });
  add('https://go.walsall.gov.uk/', { depth: 0 });

  const r = canonicalizeState(state, 'https://go.walsall.gov.uk');
  assert.deepEqual(r, { moved: 1, merged: 1 });
  assert.equal(Object.keys(state.pages).length, 3);
  const tax = state.pages[pageId('https://go.walsall.gov.uk/council-tax')];
  assert.equal(tax.url, 'https://go.walsall.gov.uk/council-tax');
  assert.equal(tax.lastScannedWeek, '2026-W44', "this week's scan is kept, so it isn't repeated");
  assert.equal(tax.lastStatus, 200);
  assert.equal(tax.priority, true);
  assert.equal(tax.depth, 0);
  assert.equal(tax.failCount, 0);
  assert.equal(state.pages[pageId('https://go.walsall.gov.uk/events/x')].failCount, 2);
  assert.ok(state.pages[pageId('https://go.walsall.gov.uk/')], 'the canonical homepage keeps its ID');
  assert.deepEqual(canonicalizeState(state, 'https://go.walsall.gov.uk'), { moved: 0, merged: 0 }, 'idempotent');
});

test('resolveCanonicalOrigin: an https origin that fails falls back to http and reports it', async () => {
  const server = await listen((req, res) => {
    if (req.url === '/') { res.writeHead(301, { location: '/home' }); res.end(); return; }
    res.end('ok');
  });
  const port = server.address().port;
  try {
    const plain = await resolveCanonicalOrigin(`http://127.0.0.1:${port}`, 'ua', 5000);
    assert.equal(plain.origin, `http://127.0.0.1:${port}`, 'a redirect within the origin keeps it');
    assert.equal(plain.note, null);

    const r = await resolveCanonicalOrigin(`https://127.0.0.1:${port}`, 'ua', 5000);
    assert.equal(r.origin, `http://127.0.0.1:${port}`);
    assert.match(r.httpsProblem, /^no working HTTPS \(.+\); served over http$/);
    assert.match(r.note, /homepage redirects from https:/);

    const sec = await runSecurity(r.origin, 'ua', 2000, { httpsProblem: r.httpsProblem });
    const https = sec.checks.find((c) => c.id === 'https');
    assert.equal(https.pass, false, 'an HTTP-only site fails "Served over HTTPS"');
    assert.match(https.detail, /no working HTTPS/);
  } finally {
    server.close();
  }
});

test('resolveCanonicalOrigin: keeps the configured origin when nothing answers', async () => {
  const server = await listen(() => {});
  const port = server.address().port;
  server.close();
  const r = await resolveCanonicalOrigin(`https://127.0.0.1:${port}`, 'ua', 2000);
  assert.equal(r.origin, `https://127.0.0.1:${port}`);
  assert.equal(r.httpsProblem, null, 'an unreachable site is not reported as missing HTTPS');
  assert.match(r.note, /homepage unreachable/);
});

test('URL lookup script matches like urlMatchKey, ignoring scheme, www. and a trailing slash', () => {
  const html = renderUrlLookup([{ key: 'go.walsall.gov.uk', domain: 'go.walsall.gov.uk', week: '2026-W44' }]);
  const src = /function matchKey\(s\) \{[\s\S]*?\n  \}/.exec(html)?.[0];
  assert.ok(src, 'matchKey is in the page script');
  const matchKey = new Function(`${src}; return matchKey;`)();
  const stored = 'http://go.walsall.gov.uk/events/junior-paint-master-workshop-rob-conway-morning';
  for (const pasted of [
    'https://go.walsall.gov.uk/events/junior-paint-master-workshop-rob-conway-morning',
    'https://www.go.walsall.gov.uk/events/junior-paint-master-workshop-rob-conway-morning#main',
    '/events/junior-paint-master-workshop-rob-conway-morning',
  ]) {
    assert.ok(matchKey(stored).includes(matchKey(pasted)), pasted);
    assert.equal(matchKey(pasted), urlMatchKey(pasted).toLowerCase(), 'mirrors urlMatchKey');
  }
});
