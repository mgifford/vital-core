import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownDomain, pdfInventory, pdfQueue, compactReport, mergeResult, pdfReportView, MAX_ATTEMPTS } from '../../src/lib/pdf-audit.js';
import { loadConfig } from '../../src/lib/config.js';

const res = (firstSeen, extra = {}) => ({ type: 'pdf', firstSeen, lastSeen: firstSeen, lastPages: 1, lastExamplePages: ['https://www.luton.gov.uk/page'], ...extra });
const resources = {
  'https://www.luton.gov.uk/a.pdf': res('2026-W42'),
  'https://static.luton.gov.uk/b.pdf': res('2026-W44'),
  'https://www.luton.gov.uk/c.pdf': res('2026-W43'),
  'https://assets.publishing.service.gov.uk/d.pdf': res('2026-W44'),
  'https://www.themenopausecharity.org/e.pdf': res('2026-W44'),
  'https://www.luton.gov.uk/page.docx': { type: 'office', firstSeen: '2026-W44' },
};
const now = new Date('2026-10-30T22:41:00Z');

test('ownDomain: the registrable domain decides, subdomains included', () => {
  assert.equal(ownDomain('https://static.luton.gov.uk/x.pdf', 'www.luton.gov.uk'), true);
  assert.equal(ownDomain('https://consultation.hackney.gov.uk/x.pdf', 'www.hackney.gov.uk'), true);
  assert.equal(ownDomain('https://assets.publishing.service.gov.uk/x.pdf', 'www.hackney.gov.uk'), false, 'gov.uk is a public suffix');
  assert.equal(ownDomain('https://www.cms.gov/x.pdf', 'www.medicaid.gov'), false);
  assert.equal(ownDomain('http://localhost:8080/x.pdf', 'localhost'), true);
  assert.equal(ownDomain('not a url', 'www.luton.gov.uk'), false);
});

test('pdfInventory: own PDFs, and other hosts counted but not listed for download', () => {
  const inv = pdfInventory(resources, 'www.luton.gov.uk');
  assert.deepEqual(inv.own.map((p) => p.url).sort(), ['https://static.luton.gov.uk/b.pdf', 'https://www.luton.gov.uk/a.pdf', 'https://www.luton.gov.uk/c.pdf']);
  assert.deepEqual(inv.otherHosts, [{ host: 'assets.publishing.service.gov.uk', count: 1 }, { host: 'www.themenopausecharity.org', count: 1 }]);
});

test('pdfQueue: never checked newest first, then retries from an earlier week, then stale checks, capped', () => {
  assert.deepEqual(pdfQueue(resources, null, 'www.luton.gov.uk', { now }).map((q) => q.url),
    ['https://static.luton.gov.uk/b.pdf', 'https://www.luton.gov.uk/c.pdf', 'https://www.luton.gov.uk/a.pdf']);
  assert.equal(pdfQueue(resources, null, 'www.luton.gov.uk', { now, perRun: 2 }).length, 2);

  const ledger = { pdfs: {
    'https://static.luton.gov.uk/b.pdf': { status: 'error', attempts: 1, week: '2026-W43', checkedAt: '2026-10-20T00:00:00Z' },
    'https://www.luton.gov.uk/c.pdf': { status: 'error', attempts: 1, week: '2026-W44', checkedAt: '2026-10-29T00:00:00Z' },
    'https://www.luton.gov.uk/a.pdf': { status: 'analysed', checkedAt: '2026-07-01T00:00:00Z', etag: '"v1"', md5: 'abc' },
  } };
  const q = pdfQueue(resources, ledger, 'www.luton.gov.uk', { now });
  assert.deepEqual(q.map((i) => i.url), ['https://static.luton.gov.uk/b.pdf', 'https://www.luton.gov.uk/a.pdf'], 'a failure from this week waits for next week');
  assert.deepEqual(q[1], { url: 'https://www.luton.gov.uk/a.pdf', linkedFrom: 'https://www.luton.gov.uk/page', etag: '"v1"', md5: 'abc' }, 'a recheck carries what makes it conditional');

  ledger.pdfs['https://static.luton.gov.uk/b.pdf'].attempts = MAX_ATTEMPTS;
  ledger.pdfs['https://www.luton.gov.uk/a.pdf'].checkedAt = '2026-10-01T00:00:00Z';
  assert.deepEqual(pdfQueue(resources, ledger, 'www.luton.gov.uk', { now }), [], 'gave up after three attempts; checked a month ago is not stale');
});

test('compactReport: each check as pass / fail / null, plus the facts the page shows', () => {
  const c = compactReport({ Accessible: false, TaggedTest: 'Pass', TitleTest: 'Fail', LanguageTest: null, Date: '2024-10-24 10:00:00+01:00', Title: ' Pupil Place Plan ', Pages: 60, Words: '1200', Images: null, Exempt: false, FormFieldSummary: ['huge list'] });
  assert.equal(c.accessible, false);
  assert.equal(c.checks.tagged, 'pass');
  assert.equal(c.checks.title, 'fail');
  assert.equal(c.checks.language, null);
  assert.equal(c.published, '2024-10-24');
  assert.equal(c.title, 'Pupil Place Plan');
  assert.equal(c.pages, 60);
  assert.equal(c.words, 1200);
  assert.equal(c.images, null);
  assert.equal(JSON.stringify(c).includes('huge list'), false, 'issue lists are not stored');
});

test('mergeResult: analysed, unchanged keeps the earlier result, errors count attempts', () => {
  const ledger = { pdfs: {} };
  const url = 'https://www.luton.gov.uk/a.pdf';
  const first = mergeResult(ledger, url, { kind: 'analysed', fetch: { status: 200, md5: 'abc', bytes: 1000, etag: '"v1"', lastModified: null }, report: { Accessible: true, TaggedTest: 'Pass' } }, now);
  assert.deepEqual([first.status, first.attempts, first.md5, first.etag, first.week, first.report.checks.tagged], ['analysed', 0, 'abc', '"v1"', '2026-W44', 'pass']);

  const later = new Date('2027-02-01T00:00:00Z');
  const same = mergeResult(ledger, url, { kind: 'unchanged', fetch: { status: 304 } }, later);
  assert.equal(same.status, 'analysed');
  assert.equal(same.checkedAt, later.toISOString());
  assert.equal(same.report.checks.tagged, 'pass', 'the earlier result stands');
  assert.equal(same.etag, '"v1"');

  const gone = mergeResult(ledger, 'https://www.luton.gov.uk/gone.pdf', { kind: 'error', fetch: { status: 404 }, error: 'HTTP 404' }, now);
  assert.deepEqual([gone.status, gone.attempts, gone.errors], ['error', 1, ['HTTP 404']]);
  assert.equal(mergeResult(ledger, 'https://www.luton.gov.uk/gone.pdf', { kind: 'error', error: 'HTTP 404' }, later).attempts, 2);
});

test('pdfReportView: counts, most failed checks first, errors, waiting and other hosts', () => {
  const ledger = { checker: { name: 'pdf-crawler', ref: 'abc1234' }, pdfs: {} };
  mergeResult(ledger, 'https://www.luton.gov.uk/a.pdf', { kind: 'analysed', report: { Accessible: true, TaggedTest: 'Pass', TitleTest: 'Pass' } }, now);
  mergeResult(ledger, 'https://static.luton.gov.uk/b.pdf', { kind: 'analysed', report: { Accessible: false, TaggedTest: 'Fail', TitleTest: 'Fail' } }, now);
  mergeResult(ledger, 'https://www.luton.gov.uk/c.pdf', { kind: 'error', error: 'Not a PDF file: no %PDF- header' }, now);
  const v = pdfReportView(resources, ledger, 'www.luton.gov.uk', { enabled: true });
  assert.deepEqual(v.counts, { checked: 2, accessible: 1, issues: 1, errors: 1 });
  assert.equal(v.checked[0].url, 'https://static.luton.gov.uk/b.pdf', 'most failed checks first');
  assert.equal(v.checked[0].linkedFrom, 'https://www.luton.gov.uk/page');
  assert.equal(v.errors[0].error, 'Not a PDF file: no %PDF- header');
  assert.equal(v.waiting, 0);
  assert.equal(v.found, 3);
  assert.equal(v.otherCount, 2);
  assert.deepEqual(v.checker, { name: 'pdf-crawler', ref: 'abc1234' });
  assert.equal(pdfReportView(resources, null, 'www.luton.gov.uk').waiting, 3);
});

test('config: pdf_audit is off by default, merges partially from defaults, and is validated', () => {
  const c = loadConfig(`
defaults:
  pdf_audit: { enabled: true, per_run: 10 }
targets:
  - domain: www.luton.gov.uk
  - domain: www.hackney.gov.uk
    pdf_audit: { enabled: false }
`);
  assert.deepEqual(c.targets[0].pdfAudit, { enabled: true, perRun: 10, maxFileMb: 25, perFileTimeout: 120, recheckDays: 90 });
  assert.deepEqual(c.targets[1].pdfAudit, { enabled: false, perRun: 10, maxFileMb: 25, perFileTimeout: 120, recheckDays: 90 }, 'a target override keeps the other defaults');
  assert.equal(loadConfig('targets:\n  - domain: example.gov\n').targets[0].pdfAudit.enabled, false);
  assert.throws(() => loadConfig('targets:\n  - domain: a.gov\n    pdf_audit: { enable: true }\n'), /Unknown pdf_audit key\(s\) enable/);
  assert.throws(() => loadConfig('targets:\n  - domain: a.gov\n    pdf_audit: { enabled: "yes" }\n'), /must be true or false/);
  assert.throws(() => loadConfig('targets:\n  - domain: a.gov\n    pdf_audit: { per_run: 0 }\n'), /per_run .* must be a positive number/);
});
