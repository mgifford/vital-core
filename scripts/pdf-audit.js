#!/usr/bin/env node
/**
 * Check the PDFs each site links to (.github/workflows/pdf-audit.yml).
 *
 *   node scripts/pdf-audit.js plan [--domain www.luton.gov.uk] [--count 25] [--out queue.json]
 *   node scripts/pdf-audit.js run --queue queue.json --checker .pdf-crawler [--budget-minutes 50]
 *
 * `plan` lists, per site, the PDFs to check next (src/lib/pdf-audit.js):
 * every non-hf_only site with pdf_audit enabled, or the one site named,
 * enabled or not. `run` downloads them politely, analyses them with
 * pdf-crawler's scripts/analyse_files.py from the checkout in --checker, and
 * merges the results into data/<domain>/pdf-audit.json. The downloads are
 * deleted; only the results are kept.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from '../src/lib/config.js';
import { loadResourceLedger } from '../src/lib/resource-ledger.js';
import { loadPdfLedger, savePdfLedger, pdfQueue, mergeResult } from '../src/lib/pdf-audit.js';
import { fetchPdf } from '../src/lib/pdf-fetch.js';
import { fetchRobots } from '../src/lib/robots.js';

const sameHost = (a, b) => a.replace(/^www\./, '') === b.replace(/^www\./, '');

/** The sites a run covers, refusing hf_only and unknown domains by key or host. */
export function selectTargets(config, domain = '') {
  if (!domain) return config.targets.filter((t) => !t.hf_only && t.pdfAudit?.enabled);
  const wanted = String(domain).trim().toLowerCase();
  const t = config.targets.find((x) => x.key === wanted || sameHost(x.domain.toLowerCase(), wanted));
  if (!t) throw new Error(`Unknown domain: ${domain}`);
  if (t.hf_only) throw new Error(`${t.domain} is hf_only: its PDFs must not be fetched from CI.`);
  return [t];
}

export function planSites(config, { domain = '', count = null, now = new Date() } = {}) {
  return selectTargets(config, domain).map((t) => {
    const resources = loadResourceLedger(t.key, t.domain).resources;
    const items = pdfQueue(resources, loadPdfLedger(t.key, t.domain), t.domain, {
      perRun: count ?? t.pdfAudit.perRun,
      recheckDays: t.pdfAudit.recheckDays,
      now,
    });
    return {
      key: t.key,
      domain: t.domain,
      userAgent: t.user_agent,
      delayMs: t.delay_ms ?? 1500,
      timeoutMs: t.nav_timeout_ms ?? 30000,
      maxFileMb: t.pdfAudit.maxFileMb,
      perFileTimeout: t.pdfAudit.perFileTimeout,
      items,
    };
  });
}

function robotsCache(userAgent) {
  const byOrigin = new Map();
  const get = (origin) => {
    if (!byOrigin.has(origin)) byOrigin.set(origin, fetchRobots(origin, userAgent));
    return byOrigin.get(origin);
  };
  return {
    isAllowed: async (u) => (await get(u.origin)).isAllowed(u.pathname),
    delayFor: async (u) => Math.min(((await get(u.origin)).crawlDelay ?? 0) * 1000, 10000),
  };
}

/**
 * Check one site's queued PDFs. `analyse(files, site)` runs pdf-crawler on
 * [{ path, url, site }] and resolves to its results, in order. Returns
 * per-outcome counts; `ledger` is updated in place.
 */
export async function runSite(site, ledger, { analyse, tmpDir, deadline = Infinity, now = () => new Date(), log = console.log }) {
  const robots = robotsCache(site.userAgent);
  const maxBytes = site.maxFileMb * 1048576;
  const pending = [];
  const counts = { analysed: 0, unchanged: 0, error: 0, skipped: 0 };
  let first = true;
  for (const [i, item] of site.items.entries()) {
    if (Date.now() >= deadline) {
      counts.skipped = site.items.length - i;
      log(`  time budget reached; ${counts.skipped} PDF(s) left for the next run`);
      break;
    }
    if (!first) await sleep(Math.max(site.delayMs, await robots.delayFor(new URL(item.url))));
    first = false;
    const dest = path.join(tmpDir, `${String(i).padStart(4, '0')}.pdf`);
    const got = await fetchPdf(item.url, {
      siteDomain: site.domain,
      userAgent: site.userAgent,
      dest,
      maxBytes,
      timeoutMs: Math.max(site.timeoutMs, 60000),
      etag: item.etag,
      lastModified: item.lastModified,
      isAllowed: robots.isAllowed,
    });
    if (got.kind === 'fetched' && item.md5 && got.fetch.md5 === item.md5 && ledger.pdfs[item.url]?.status === 'analysed') {
      fs.rmSync(got.path, { force: true });
      got.kind = 'unchanged';
    }
    if (got.kind === 'fetched') {
      pending.push({ item, got });
      continue;
    }
    mergeResult(ledger, item.url, got, now());
    counts[got.kind === 'unchanged' ? 'unchanged' : 'error']++;
    log(`  ${got.kind === 'unchanged' ? 'unchanged' : `error (${got.error})`}: ${item.url}`);
  }

  if (pending.length) {
    const results = await analyse(pending.map(({ item, got }) => ({ path: got.path, url: item.url, site: site.domain })), site);
    pending.forEach(({ item, got }, i) => {
      const r = results[i];
      const outcome = r?.status === 'analysed'
        ? { kind: 'analysed', fetch: got.fetch, report: r.report, notes: r.errors ?? [] }
        : { kind: 'error', fetch: got.fetch, error: r?.errors?.[0] ?? 'no result from the checker' };
      mergeResult(ledger, item.url, outcome, now());
      counts[outcome.kind === 'analysed' ? 'analysed' : 'error']++;
      log(`  ${outcome.kind === 'analysed' ? (r.report?.Accessible ? 'passed' : 'issues found') : `error (${outcome.error})`}: ${item.url}`);
      fs.rmSync(got.path, { force: true });
    });
  }
  return counts;
}

function pythonAnalyser(checkerDir, python) {
  return (files, site) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-audit-io-'));
    try {
      const input = path.join(dir, 'files.json');
      const output = path.join(dir, 'results.json');
      fs.writeFileSync(input, JSON.stringify(files));
      const r = spawnSync(python, [
        path.join(checkerDir, 'scripts', 'analyse_files.py'),
        '--input', input,
        '--output', output,
        '--per-file-timeout', String(site.perFileTimeout),
        '--max-file-size', String(site.maxFileMb),
      ], { stdio: ['ignore', 'inherit', 'inherit'], timeout: (site.perFileTimeout + 30) * 1000 * files.length });
      if (r.status !== 0) throw new Error(`analyse_files.py exited with ${r.status ?? r.signal}`);
      return JSON.parse(fs.readFileSync(output, 'utf8')).results;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

function checkerRef(checkerDir) {
  if (process.env.PDF_CRAWLER_REF) return process.env.PDF_CRAWLER_REF;
  try {
    return execFileSync('git', ['-C', checkerDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function arg(argv, name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}

async function main(argv) {
  const [command] = argv;
  if (command === 'plan') {
    const count = arg(argv, 'count');
    if (count !== null && !/^[1-9]\d*$/.test(count)) throw new Error('--count must be a positive integer');
    const sites = planSites(loadConfig(), { domain: arg(argv, 'domain', ''), count: count === null ? null : Number(count) });
    const queued = sites.reduce((n, s) => n + s.items.length, 0);
    for (const s of sites) console.log(`${s.domain}: ${s.items.length} PDF(s) to check`);
    if (!sites.length) console.log('No site has pdf_audit enabled.');
    fs.writeFileSync(arg(argv, 'out', 'pdf-queue.json'), JSON.stringify({ sites }, null, 2));
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `queued=${queued}\n`);
    return;
  }
  if (command === 'run') {
    const checker = arg(argv, 'checker');
    if (!checker) throw new Error('--checker <pdf-crawler checkout> is required');
    const { sites } = JSON.parse(fs.readFileSync(arg(argv, 'queue', 'pdf-queue.json'), 'utf8'));
    const deadline = Date.now() + Number(arg(argv, 'budget-minutes', '50')) * 60000;
    const analyse = pythonAnalyser(checker, arg(argv, 'python', path.join(checker, '.venv', 'bin', 'python')));
    const ref = checkerRef(checker);
    for (const site of sites) {
      if (!site.items.length) continue;
      console.log(`${site.domain}: checking ${site.items.length} PDF(s)`);
      const ledger = loadPdfLedger(site.key, site.domain);
      ledger.checker = { name: 'pdf-crawler', url: 'https://github.com/mgifford/pdf-crawler', ref, checks: 'original' };
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-audit-'));
      try {
        const counts = await runSite(site, ledger, { analyse, tmpDir, deadline });
        console.log(`${site.domain}: ${JSON.stringify(counts)}`);
      } finally {
        savePdfLedger(site.key, ledger);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
    return;
  }
  throw new Error('usage: pdf-audit.js plan|run [options]');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
