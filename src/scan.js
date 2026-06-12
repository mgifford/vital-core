#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { loadConfig, getTarget, DIRS } from './lib/config.js';
import { normalizeUrl, pageId } from './lib/urls.js';
import { loadState, saveState, addPage, pickBatch } from './lib/state.js';
import { isoWeek } from './lib/week.js';
import { fetchRobots } from './lib/robots.js';
import { discoverFromSitemaps } from './lib/sitemap.js';
import { runAxe } from './engines/axe.js';
import { runAlfa } from './engines/alfa.js';
import { createSustainabilityCollector } from './engines/sustainability.js';

/**
 * One scan run for one domain. Designed to be boring:
 *
 *  1. Load state (the only mutable file).
 *  2. Seed from sitemap + homepage if state is empty.
 *  3. Pick a batch of pages not yet scanned this ISO week.
 *  4. Scan each page; write one JSON record per page under
 *     data/<domain>/<week>/pages/. Discover same-host links into state.
 *  5. Append a run log; save state. Done.
 *
 * Reports never read state. They read data/. There is exactly one
 * source of truth for every view.
 *
 * Usage: node src/scan.js --domain example.gov [--budget 50] [--base-url http://localhost:8080]
 *   --base-url is for tests: scan a local server while keeping the
 *   domain identity from config.
 */

const args = parseArgs(process.argv.slice(2));
if (!args.domain) {
  console.error('Usage: node src/scan.js --domain <domain> [--budget N] [--base-url URL]');
  process.exit(1);
}

const config = loadConfig();
const target = getTarget(config, args.domain);
const week = isoWeek();
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
const budget = args.budget ? parseInt(args.budget, 10) : target.pages_per_run;
const baseOrigin = args['base-url'] ?? `https://${target.domain}`;
const host = new URL(baseOrigin).hostname;
const settleDelay = parseInt(process.env.VITAL_A11Y_SETTLE_DELAY_MS ?? target.settle_delay_ms, 10);

const log = (...m) => console.log(`[${target.key}]`, ...m);
log(`run ${runId} week ${week} budget ${budget}`);

const state = loadState(target.key, target.domain);

// --- Seed -------------------------------------------------------------
if (Object.keys(state.pages).length === 0) {
  log('state empty; seeding from sitemap and homepage');
  const seeds = await discoverFromSitemaps(baseOrigin, host, target.user_agent);
  log(`sitemap yielded ${seeds.length} URLs`);
  const homeNorm = normalizeUrl(baseOrigin + '/', baseOrigin, host);
  if (homeNorm) addPage(state, pageId(homeNorm), homeNorm, 0);
  for (const u of seeds) addPage(state, pageId(u), u, 1);
  state.seededAt = new Date().toISOString();
  saveState(target.key, state);
}

// --- Robots -----------------------------------------------------------
const robots = await fetchRobots(baseOrigin, target.user_agent);
const delayMs = Math.max(
  target.delay_ms,
  robots.crawlDelay ? Math.min(robots.crawlDelay * 1000, 10000) : 0
);

// --- Batch ------------------------------------------------------------
const { batch, scannedThisWeek } = pickBatch(state, week, budget, target.max_pages_per_week);
log(`${scannedThisWeek} pages already scanned in ${week}; batch of ${batch.length}`);
if (batch.length === 0) {
  log('nothing to do');
  process.exit(0);
}

// --- Scan -------------------------------------------------------------
const pagesDir = path.join(DIRS.data, target.key, week, 'pages');
const runsDir = path.join(DIRS.data, target.key, week, 'runs');
fs.mkdirSync(pagesDir, { recursive: true });
fs.mkdirSync(runsDir, { recursive: true });

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
const context = await browser.newContext({
  userAgent: target.user_agent,
  viewport: { width: 1280, height: 800 },
});
context.setDefaultNavigationTimeout(target.nav_timeout_ms);

const runLog = { runId, week, domain: target.domain, startedAt: new Date().toISOString(), scanned: [], errors: [] };
const engines = target.engines ?? ['axe', 'alfa', 'sustainability'];

for (const item of batch) {
  const urlPath = new URL(item.url).pathname;
  if (!robots.isAllowed(urlPath)) {
    log(`robots disallow: ${item.url}`);
    state.pages[item.id].lastScannedWeek = week; // do not retry this week
    state.pages[item.id].lastStatus = 'robots-disallowed';
    continue;
  }

  // In test mode (--base-url), rewrite the target host to the local server.
  const fetchUrl = args['base-url']
    ? item.url.replace(/^https?:\/\/[^/]+/, args['base-url'])
    : item.url;

  const page = await context.newPage();
  const sustain = engines.includes('sustainability') ? createSustainabilityCollector(page) : null;

  try {
    const response = await page.goto(fetchUrl, { waitUntil: 'load' });
    const status = response?.status() ?? 0;
    // Settle delay: let client-side hydration finish before auditing.
    // This is the documented fix for transient pre-hydration findings.
    await page.waitForTimeout(settleDelay);

    const record = {
      pageId: item.id,
      url: item.url,
      week,
      runId,
      scannedAt: new Date().toISOString(),
      status,
      depth: item.depth,
    };

    if (status >= 200 && status < 400 && (response?.headers()['content-type'] ?? '').includes('html')) {
      if (engines.includes('axe')) record.axe = await runAxe(page);
      if (engines.includes('alfa')) record.alfa = await runAlfa(page);
      if (sustain) record.sustainability = sustain.collect();

      // Link discovery: same-host only, depth-capped.
      if (item.depth < target.max_crawl_depth) {
        const hrefs = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href]'), (a) => a.getAttribute('href'))
        );
        let added = 0;
        for (const href of hrefs) {
          // Normalize against the canonical domain, not the test base-url.
          const norm = normalizeUrl(href, item.url, host === 'localhost' || host === '127.0.0.1' ? host : new URL(`https://${target.domain}`).hostname);
          if (norm && addPage(state, pageId(norm), norm, item.depth + 1)) added++;
        }
        if (added) log(`+${added} URLs discovered on ${urlPath}`);
      }
    } else if (sustain) {
      sustain.collect(); // detach listener
    }

    fs.writeFileSync(path.join(pagesDir, `${item.id}.json`), JSON.stringify(record));
    runLog.scanned.push(item.id);
    state.pages[item.id].lastScannedWeek = week;
    state.pages[item.id].lastScannedAt = record.scannedAt;
    state.pages[item.id].lastStatus = status;
    state.pages[item.id].failCount = 0;
    log(`${status} ${urlPath} ${record.axe ? `axe:${record.axe.violationCount}` : ''} ${record.alfa ? `alfa:${record.alfa.failedCount}` : ''}`);
  } catch (err) {
    state.pages[item.id].failCount = (state.pages[item.id].failCount ?? 0) + 1;
    runLog.errors.push({ pageId: item.id, url: item.url, error: String(err).slice(0, 300) });
    log(`ERROR ${urlPath}: ${String(err).slice(0, 120)}`);
  } finally {
    await page.close().catch(() => {});
  }

  // Persist state incrementally so an interrupted run loses little.
  saveState(target.key, state);
  await new Promise((r) => setTimeout(r, delayMs));
}

runLog.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(runsDir, `${runId}.json`), JSON.stringify(runLog, null, 1));
saveState(target.key, state);
await browser.close();
log(`done: ${runLog.scanned.length} scanned, ${runLog.errors.length} errors`);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      out[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return out;
}
