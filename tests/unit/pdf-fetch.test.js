import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fetchPdf } from '../../src/lib/pdf-fetch.js';
import { runSite, selectTargets } from '../../scripts/pdf-audit.js';
import { loadConfig } from '../../src/lib/config.js';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');

function site(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, () => resolve({ server, base: `http://localhost:${server.address().port}` }));
  });
}

function routes(req, res) {
  const p = req.url;
  if (p === '/robots.txt') return res.end('User-agent: *\nDisallow: /private/\n');
  if (p === '/a.pdf') {
    if (req.headers['if-none-match'] === '"v1"') { res.writeHead(304); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/pdf', etag: '"v1"', 'last-modified': 'Wed, 01 Oct 2025 00:00:00 GMT' });
    return res.end(PDF);
  }
  if (p === '/moved.pdf') { res.writeHead(301, { location: '/a.pdf' }); return res.end(); }
  if (p === '/off-site.pdf') { res.writeHead(302, { location: `http://127.0.0.1:${req.socket.localPort}/a.pdf` }); return res.end(); }
  if (p === '/loop.pdf') { res.writeHead(302, { location: '/loop.pdf' }); return res.end(); }
  if (p === '/big.pdf') { res.writeHead(200, { 'content-length': String(5 * 1048576) }); return res.end(); }
  if (p === '/streamed-big.pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); res.write(Buffer.alloc(700000)); return res.end(Buffer.alloc(700000)); }
  if (p === '/challenge.pdf') { res.writeHead(202, { 'x-amzn-waf-action': 'challenge', 'content-type': 'text/html' }); return res.end('<html>'); }
  if (p === '/login.pdf') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!DOCTYPE html><title>Sign in</title>'); }
  if (p === '/private/x.pdf') return res.end(PDF);
  res.writeHead(404);
  res.end('not found');
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-fetch-test-'));

test('fetchPdf: downloads with validators and an MD5; a known ETag gets a 304; redirects stay on the site', async () => {
  const { server, base } = await site(routes);
  const dir = tmp();
  const opts = { siteDomain: 'localhost', userAgent: 'vital-scans-test/0.1', maxBytes: 1048576 };
  try {
    const got = await fetchPdf(`${base}/a.pdf`, { ...opts, dest: path.join(dir, 'a.pdf') });
    assert.equal(got.kind, 'fetched');
    assert.deepEqual(fs.readFileSync(got.path), PDF);
    assert.equal(got.fetch.etag, '"v1"');
    assert.equal(got.fetch.lastModified, 'Wed, 01 Oct 2025 00:00:00 GMT');
    assert.equal(got.fetch.bytes, PDF.length);
    assert.match(got.fetch.md5, /^[0-9a-f]{32}$/);

    const again = await fetchPdf(`${base}/a.pdf`, { ...opts, dest: path.join(dir, 'b.pdf'), etag: '"v1"' });
    assert.deepEqual([again.kind, again.fetch.status, 'etag' in again.fetch], ['unchanged', 304, false], 'a 304 keeps the stored validators');
    assert.equal(fs.existsSync(path.join(dir, 'b.pdf')), false);

    const moved = await fetchPdf(`${base}/moved.pdf`, { ...opts, dest: path.join(dir, 'c.pdf') });
    assert.equal(moved.kind, 'fetched');
    assert.equal(moved.fetch.finalUrl, `${base}/a.pdf`);

    const off = await fetchPdf(`${base}/off-site.pdf`, { ...opts, dest: path.join(dir, 'd.pdf') });
    assert.deepEqual(off, { kind: 'error', error: 'redirects off the site, to 127.0.0.1' });
    assert.match((await fetchPdf(`${base}/loop.pdf`, { ...opts, dest: path.join(dir, 'e.pdf') })).error, /more than 5 redirects/);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fetchPdf: too large (declared or streamed), firewall, 404 and robots.txt are errors in words', async () => {
  const { server, base } = await site(routes);
  const dir = tmp();
  const opts = { siteDomain: 'localhost', userAgent: 'vital-scans-test/0.1', maxBytes: 1048576 };
  const robots = (await import('../../src/lib/robots.js')).parseRobots('User-agent: *\nDisallow: /private/\n', 'vital-scans-test/0.1');
  try {
    assert.match((await fetchPdf(`${base}/big.pdf`, { ...opts, dest: path.join(dir, '1.pdf') })).error, /^larger than the 1\.0 MB limit \(5\.0 MB\)$/);
    const streamed = await fetchPdf(`${base}/streamed-big.pdf`, { ...opts, dest: path.join(dir, '2.pdf') });
    assert.equal(streamed.error, 'larger than the 1.0 MB limit');
    assert.equal(fs.existsSync(path.join(dir, '2.pdf')), false, 'a partial download is removed');
    assert.match((await fetchPdf(`${base}/challenge.pdf`, { ...opts, dest: path.join(dir, '3.pdf') })).error, /^HTTP 202 \(a firewall challenge, AWS WAF/);
    assert.equal((await fetchPdf(`${base}/gone.pdf`, { ...opts, dest: path.join(dir, '4.pdf') })).error, 'HTTP 404');
    const blocked = await fetchPdf(`${base}/private/x.pdf`, { ...opts, dest: path.join(dir, '5.pdf'), isAllowed: async (u) => robots.isAllowed(u.pathname) });
    assert.equal(blocked.error, 'disallowed by robots.txt for the scanner');
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runSite: analyses what downloaded, records the rest, skips an unchanged MD5 and deletes every download', async () => {
  const { server, base } = await site(routes);
  const dir = tmp();
  const seen = [];
  const analyse = async (files) => files.map((f) => {
    seen.push(f.url);
    const isPdf = fs.readFileSync(f.path).subarray(0, 5).toString() === '%PDF-';
    return isPdf
      ? { status: 'analysed', report: { Accessible: false, TaggedTest: 'Fail', TitleTest: 'Pass', Pages: 1 }, errors: ['no tags'] }
      : { status: 'error', report: null, errors: ['Not a PDF file: no %PDF- header'] };
  });
  const ledger = { pdfs: {} };
  const s = { domain: 'localhost', userAgent: 'vital-scans-test/0.1', delayMs: 1, timeoutMs: 5000, maxFileMb: 1, perFileTimeout: 5 };
  try {
    const counts = await runSite({ ...s, items: [{ url: `${base}/a.pdf` }, { url: `${base}/login.pdf` }, { url: `${base}/gone.pdf` }, { url: `${base}/private/x.pdf` }] }, ledger, { analyse, tmpDir: dir, log: () => {} });
    assert.deepEqual(counts, { analysed: 1, unchanged: 0, error: 3, skipped: 0 });
    assert.deepEqual(seen, [`${base}/a.pdf`, `${base}/login.pdf`], 'a 404 and a robots.txt block never reach the checker');
    const a = ledger.pdfs[`${base}/a.pdf`];
    assert.deepEqual([a.status, a.report.checks.tagged, a.report.checks.title, a.errors, a.etag], ['analysed', 'fail', 'pass', ['no tags'], '"v1"']);
    assert.equal(ledger.pdfs[`${base}/login.pdf`].errors[0], 'Not a PDF file: no %PDF- header');
    assert.equal(ledger.pdfs[`${base}/private/x.pdf`].errors[0], 'disallowed by robots.txt for the scanner');
    assert.deepEqual(fs.readdirSync(dir), [], 'downloads are deleted');

    seen.length = 0;
    const again = await runSite({ ...s, items: [{ url: `${base}/a.pdf`, md5: a.md5 }] }, ledger, { analyse, tmpDir: dir, log: () => {} });
    assert.deepEqual(again, { analysed: 0, unchanged: 1, error: 0, skipped: 0 });
    assert.deepEqual(seen, [], 'the same MD5 is not analysed again');
    assert.equal(ledger.pdfs[`${base}/a.pdf`].report.checks.tagged, 'fail', 'and keeps its result');

    const late = await runSite({ ...s, items: [{ url: `${base}/a.pdf` }] }, ledger, { analyse, tmpDir: dir, deadline: Date.now() - 1, log: () => {} });
    assert.equal(late.skipped, 1, 'past the time budget nothing more is fetched');
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('selectTargets: enabled sites by default; a named site even when off; hf_only and unknown refused', () => {
  const config = loadConfig(`
targets:
  - domain: www.luton.gov.uk
    pdf_audit: { enabled: true }
  - domain: www.cms.gov
  - domain: www.va.gov
    hf_only: true
    pdf_audit: { enabled: true }
`);
  assert.deepEqual(selectTargets(config).map((t) => t.domain), ['www.luton.gov.uk']);
  assert.deepEqual(selectTargets(config, 'www.cms.gov').map((t) => t.domain), ['www.cms.gov'], 'a manual run ignores the setting');
  assert.deepEqual(selectTargets(config, 'cms.gov').map((t) => t.domain), ['www.cms.gov'], 'www. is ignored');
  assert.throws(() => selectTargets(config, 'va.gov'), /hf_only/);
  assert.throws(() => selectTargets(config, 'example.org'), /Unknown domain/);
});
