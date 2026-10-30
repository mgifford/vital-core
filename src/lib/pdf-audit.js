/**
 * PDF checks for the PDFs each site links to. The scans list them in
 * data/<domain>/resources.json; the pdf-audit workflow checks the site's own
 * ones with pdf-crawler (scripts/pdf-audit.js) and keeps one compact result
 * per URL in data/<domain>/pdf-audit.json, which the report reads.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDomain } from 'tldts-icann';
import { DIRS } from './config.js';
import { writeLedgerIfChanged } from './fs-utils.js';
import { isoWeek } from './week.js';

/** A PDF that fails this many times is left alone until it changes in the inventory. */
export const MAX_ATTEMPTS = 3;

/** pdf-crawler result keys, as they appear on its reports. */
export const PDF_CHECKS = [
  ['tagged', 'TaggedTest'],
  ['title', 'TitleTest'],
  ['language', 'LanguageTest'],
  ['bookmarks', 'BookmarksTest'],
  ['taggedContent', 'TaggedContentTest'],
  ['figuresAlt', 'FiguresAltTextTest'],
  ['headings', 'HeadingsTest'],
  ['lists', 'ListsTest'],
  ['tables', 'TablesTest'],
  ['forms', 'FormsTest'],
  ['taggedForms', 'TaggedFormFieldsTest'],
  ['taggedAnnotations', 'TaggedAnnotationsTest'],
  ['emptyText', 'EmptyTextTest'],
  ['protected', 'ProtectedTest'],
];

const DAY_MS = 86400000;

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const registrable = (host) => getDomain(host) ?? host;

/** Whether `url` is on the site's own registrable domain (static.luton.gov.uk for www.luton.gov.uk). */
export function ownDomain(url, siteDomain) {
  const host = hostOf(url);
  return !!host && registrable(host) === registrable(String(siteDomain).toLowerCase());
}

const isPdf = (r) => r?.type === 'pdf';

/** The site's own PDFs from the resource ledger, and how many sit on other hosts. */
export function pdfInventory(resources = {}, siteDomain) {
  const own = [];
  const other = {};
  for (const [url, r] of Object.entries(resources)) {
    if (!isPdf(r)) continue;
    if (ownDomain(url, siteDomain)) {
      own.push({ url, firstSeen: r.firstSeen, lastSeen: r.lastSeen, pages: r.lastPages ?? 0, examplePages: r.lastExamplePages ?? [] });
    } else {
      const host = hostOf(url) ?? '(invalid URL)';
      other[host] = (other[host] ?? 0) + 1;
    }
  }
  const otherHosts = Object.entries(other).map(([host, count]) => ({ host, count })).sort((a, b) => b.count - a.count || a.host.localeCompare(b.host));
  return { own, otherHosts };
}

const newestFirst = (a, b) => String(b.firstSeen).localeCompare(String(a.firstSeen)) || String(b.lastSeen).localeCompare(String(a.lastSeen)) || a.url.localeCompare(b.url);
const oldestCheckFirst = (ledger) => (a, b) => String(ledger[a.url].checkedAt).localeCompare(String(ledger[b.url].checkedAt));

/**
 * The PDFs to check next: never checked (newest first), then failures from
 * an earlier ISO week under MAX_ATTEMPTS, then checks older than
 * `recheckDays`, capped at `perRun`.
 */
export function pdfQueue(resources, ledger, siteDomain, { perRun = 25, recheckDays = 90, now = new Date() } = {}) {
  const pdfs = ledger?.pdfs ?? {};
  const week = isoWeek(now);
  const { own } = pdfInventory(resources, siteDomain);
  const fresh = own.filter((p) => !pdfs[p.url]).sort(newestFirst);
  const retry = own
    .filter((p) => pdfs[p.url]?.status === 'error' && (pdfs[p.url].attempts ?? 1) < MAX_ATTEMPTS && pdfs[p.url].week !== week)
    .sort(oldestCheckFirst(pdfs));
  const stale = own
    .filter((p) => pdfs[p.url]?.status === 'analysed' && now - new Date(pdfs[p.url].checkedAt) >= recheckDays * DAY_MS)
    .sort(oldestCheckFirst(pdfs));
  return [...fresh, ...retry, ...stale].slice(0, perRun).map((p) => {
    const prev = pdfs[p.url];
    return {
      url: p.url,
      linkedFrom: p.examplePages[0] ?? null,
      ...(prev?.etag ? { etag: prev.etag } : {}),
      ...(prev?.lastModified ? { lastModified: prev.lastModified } : {}),
      ...(prev?.md5 ? { md5: prev.md5 } : {}),
    };
  });
}

/** The part of pdf-crawler's report a page needs: each check as pass / fail / null, plus a few facts. */
export function compactReport(report = {}) {
  const verdict = (v) => (v === 'Pass' ? 'pass' : v === 'Fail' ? 'fail' : null);
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  return {
    accessible: report.Accessible === true,
    totallyInaccessible: report.TotallyInaccessible === true,
    broken: report.BrokenFile === true,
    exempt: report.Exempt === true,
    published: typeof report.Date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(report.Date) ? report.Date.slice(0, 10) : null,
    title: typeof report.Title === 'string' && report.Title.trim() ? report.Title.trim().slice(0, 200) : null,
    pages: num(report.Pages),
    words: num(report.Words),
    images: num(report.Images),
    category: report.DocCategory ?? null,
    checks: Object.fromEntries(PDF_CHECKS.map(([key, field]) => [key, verdict(report[field])])),
  };
}

/**
 * Record one PDF's outcome. `outcome.kind` is 'analysed' (with `report`),
 * 'unchanged' (304, or the same MD5 as last time: the earlier result stands)
 * or 'error' (with `error`). `fetch` carries what the download learned.
 */
export function mergeResult(ledger, url, outcome, now = new Date()) {
  const prev = ledger.pdfs[url] ?? {};
  const f = outcome.fetch ?? {};
  const base = {
    ...prev,
    checkedAt: now.toISOString(),
    week: isoWeek(now),
    httpStatus: f.status ?? prev.httpStatus ?? null,
    ...(f.md5 ? { md5: f.md5, bytes: f.bytes } : {}),
    ...(f.etag !== undefined ? { etag: f.etag } : {}),
    ...(f.lastModified !== undefined ? { lastModified: f.lastModified } : {}),
    ...(f.finalUrl && f.finalUrl !== url ? { finalUrl: f.finalUrl } : {}),
  };
  if (outcome.kind === 'analysed') {
    ledger.pdfs[url] = { ...base, status: 'analysed', attempts: 0, report: compactReport(outcome.report), errors: outcome.notes ?? [] };
  } else if (outcome.kind === 'unchanged' && prev.status === 'analysed') {
    ledger.pdfs[url] = { ...base, status: 'analysed', attempts: 0 };
  } else {
    ledger.pdfs[url] = { ...base, status: 'error', attempts: (prev.status === 'error' ? prev.attempts ?? 1 : 0) + 1, errors: [outcome.error ?? 'unchanged, but never analysed'] };
  }
  ledger.updatedAt = now.toISOString();
  return ledger.pdfs[url];
}

function ledgerPath(domainKey) {
  return path.join(DIRS.data, domainKey, 'pdf-audit.json');
}

export function loadPdfLedger(domainKey, domain) {
  const p = ledgerPath(domainKey);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  return { domain, updatedAt: null, checker: null, pdfs: {} };
}

export function savePdfLedger(domainKey, ledger) {
  fs.mkdirSync(path.dirname(ledgerPath(domainKey)), { recursive: true });
  writeLedgerIfChanged(ledgerPath(domainKey), ledger);
}

const failedChecks = (report) => PDF_CHECKS.filter(([key]) => report?.checks?.[key] === 'fail').length;

/**
 * Everything the PDFs page shows, from the two ledgers: the checked PDFs
 * (most failed checks first), the ones that could not be checked, how many
 * wait, and the PDFs on other hosts, which are never fetched.
 */
export function pdfReportView(resources, ledger, siteDomain, { enabled = false } = {}) {
  const pdfs = ledger?.pdfs ?? {};
  const { own, otherHosts } = pdfInventory(resources, siteDomain);
  const checked = [];
  const errors = [];
  let waiting = 0;
  for (const p of own) {
    const e = pdfs[p.url];
    if (!e) {
      waiting++;
      continue;
    }
    const row = { url: p.url, linkedFrom: p.examplePages[0] ?? null, pages: p.pages, checkedAt: e.checkedAt, bytes: e.bytes ?? null };
    if (e.status === 'analysed') checked.push({ ...row, report: e.report });
    else errors.push({ ...row, error: (e.errors ?? [])[0] ?? 'unknown error', attempts: e.attempts ?? 1, httpStatus: e.httpStatus ?? null });
  }
  checked.sort((a, b) => failedChecks(b.report) - failedChecks(a.report) || Number(a.report.accessible) - Number(b.report.accessible) || a.url.localeCompare(b.url));
  errors.sort((a, b) => a.url.localeCompare(b.url));
  const accessible = checked.filter((r) => r.report.accessible).length;
  return {
    enabled,
    found: own.length,
    checked,
    errors,
    waiting,
    otherHosts,
    otherCount: otherHosts.reduce((n, h) => n + h.count, 0),
    counts: { checked: checked.length, accessible, issues: checked.length - accessible, errors: errors.length },
    checker: ledger?.checker ?? null,
  };
}
