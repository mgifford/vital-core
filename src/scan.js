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
import { checkLinks } from './lib/links.js';
import { runAxe } from './engines/axe.js';
import { runAlfa } from './engines/alfa.js';
import { runPlainLanguage } from './engines/plain-language.js';
import { createLighthouseRunner } from './engines/lighthouse.js';
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
const engines = target.engines ?? ['axe', 'alfa', 'plain-language', 'sustainability'];

// Link checking: collect every resolvable http(s) link seen on scanned
// pages, then probe a capped sample once after the scan. Off unless
// link-check is in the engines list.
const checkLinksEnabled = engines.includes('link-check');
const linksSeen = new Set();
const linkSources = new Map(); // url -> a page it was found on (for reports)

// Lighthouse: slow (own Chrome), so sampled — audit at most this many
// pages per run, homepage first. Off unless lighthouse is enabled.
const lighthouseEnabled = engines.includes('lighthouse');
const lighthouseSampleCap = parseInt(process.env.VITAL_LIGHTHOUSE_SAMPLE ?? '5', 10);
let lighthouse = null;
let lighthouseAudited = 0;
if (lighthouseEnabled && !args['base-url']) {
  // Lighthouse audits the live URL directly, so it's skipped in test
  // mode (--base-url points at a local fixture server).
  lighthouse = await createLighthouseRunner({ timeoutMs: target.nav_timeout_ms, log });
}

// Checkpoint state every STATE_SAVE_EVERY pages rather than after every
// page. saveState re-serializes the whole crawl frontier, which grows as
// discovery adds URLs, so per-page saving is O(N^2) over a run on large
// sites. Checkpointing bounds the worst-case loss on an interrupted run
// to this many pages — cheap, since unsaved "scanned" marks just cause a
// little idempotent rescanning next run.
const STATE_SAVE_EVERY = 25;
let sincePersist = 0;

for (const item of batch) {
  const urlPath = new URL(item.url).pathname;
  if (!robots.isAllowed(urlPath)) {
    log(`robots disallow: ${item.url}`);
    state.pages[item.id].lastScannedWeek = week; // do not retry this week
    state.pages[item.id].lastStatus = 'robots-disallowed';
    if (++sincePersist >= STATE_SAVE_EVERY) {
      saveState(target.key, state);
      sincePersist = 0;
    }
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
    // Let late async rendering settle before auditing. Government sites
    // routinely fetch/hydrate after the load event, which produces
    // transient false positives if axe/alfa run too early.
    //
    //   1. Wait for the network to go quiet (best-effort: capped so a
    //      site with persistent connections — analytics beacons,
    //      websockets — can't stall the scan).
    //   2. Then always wait the fixed settle delay (default 1s).
    try {
      await page.waitForLoadState('networkidle', { timeout: target.nav_timeout_ms });
    } catch {
      // networkidle never reached within the cap; the settle delay below
      // still gives the page time to finish rendering.
    }
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
      if (engines.includes('plain-language')) record.plainLanguage = await runPlainLanguage(page);
      if (sustain) record.sustainability = sustain.collect();

      // Lighthouse: sampled. Audit the live URL (its own Chrome) up to
      // the per-run cap. Batch ordering puts low-depth pages (incl. the
      // homepage) first, so the sample favors the most important pages.
      if (lighthouse?.available && lighthouseAudited < lighthouseSampleCap) {
        const lh = await lighthouse.audit(item.url);
        if (lh) {
          record.lighthouse = lh;
          lighthouseAudited++;
          log(`lighthouse ${urlPath} perf:${lh.scores.performance ?? '-'} a11y:${lh.scores.accessibility ?? '-'} seo:${lh.scores.seo ?? '-'}`);
        }
      }

      // Extract links once; use them for discovery (same-host,
      // depth-capped) and, if enabled, for link checking (all links).
      const hrefs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'), (a) => a.getAttribute('href'))
      );

      // Discovery: same-host only, depth-capped.
      if (item.depth < target.max_crawl_depth) {
        let added = 0;
        for (const href of hrefs) {
          // Normalize against the canonical domain, not the test base-url.
          const norm = normalizeUrl(href, item.url, host === 'localhost' || host === '127.0.0.1' ? host : new URL(`https://${target.domain}`).hostname);
          if (norm && addPage(state, pageId(norm), norm, item.depth + 1)) added++;
        }
        if (added) log(`+${added} URLs discovered on ${urlPath}`);
      }

      // Link checking: collect absolute http(s) links (same-host and
      // external) resolved against the real page URL.
      if (checkLinksEnabled) {
        for (const href of hrefs) {
          let abs;
          try {
            abs = new URL(href, item.url);
          } catch {
            continue;
          }
          if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
          abs.hash = '';
          const u = abs.toString();
          if (!linksSeen.has(u)) {
            linksSeen.add(u);
            linkSources.set(u, item.url);
          }
        }
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

  // Checkpoint state periodically so an interrupted run loses little,
  // without re-serializing the whole frontier on every page.
  if (++sincePersist >= STATE_SAVE_EVERY) {
    saveState(target.key, state);
    sincePersist = 0;
  }
  await new Promise((r) => setTimeout(r, delayMs));
}

// --- Link check (post-scan, capped and polite) ------------------------
if (checkLinksEnabled && linksSeen.size > 0) {
  const cap = parseInt(process.env.VITAL_LINK_CHECK_CAP ?? '500', 10);
  log(`link-check: ${linksSeen.size} unique links seen; checking up to ${cap}`);
  const { checked, total, broken } = await checkLinks([...linksSeen], {
    userAgent: target.user_agent,
    timeoutMs: target.nav_timeout_ms,
    cap,
  });
  runLog.linkCheck = {
    total,
    checked,
    brokenCount: broken.length,
    broken: broken.map((b) => ({ url: b.url, status: b.status, reason: b.reason, foundOn: linkSources.get(b.url) ?? null })),
  };
  log(`link-check: ${broken.length} broken of ${checked} checked`);
}

if (lighthouse) {
  runLog.lighthouseAudited = lighthouseAudited;
  await lighthouse.close();
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
