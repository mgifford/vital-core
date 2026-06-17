#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { loadConfig, getTarget, DIRS } from './lib/config.js';
import { normalizeUrl, pageId, buildUrlFilter } from './lib/urls.js';
import { loadState, saveState, addPage, pickBatch } from './lib/state.js';
import { isoWeek } from './lib/week.js';
import { fetchRobots } from './lib/robots.js';
import { discoverFromSitemaps } from './lib/sitemap.js';
import { checkLinks } from './lib/links.js';
import { ratesFor, shouldRun, normalizeRate } from './lib/sampling.js';
import { runAxe } from './engines/axe.js';
import { runAlfa } from './engines/alfa.js';
import { runPlainLanguage } from './engines/plain-language.js';
import { runDeprecatedHtml } from './engines/deprecated-html.js';
import { runResources } from './engines/resources.js';
import { runImages, createImageCollector } from './engines/images.js';
import { runStandards } from './engines/standards.js';
import { runSecurity } from './engines/security.js';
import { runTech } from './engines/tech.js';
import { createLighthouseRunner } from './engines/lighthouse.js';
import { createSustainabilityCollector } from './engines/sustainability.js';
import { createThirdPartyCollector } from './engines/third-party.js';

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

// --- Priority URLs ----------------------------------------------------
// Top tasks (e.g. from top-task-finder) that must be covered every week.
// Re-applied every run so the list can change and newly-added priority
// URLs are promoted in the frontier. pickBatch scans these first.
const priorityUrls = loadPriorityUrls(target, baseOrigin, host);
if (priorityUrls.length) {
  let promoted = 0;
  for (const u of priorityUrls) if (addPage(state, pageId(u), u, 0, { priority: true })) promoted++;
  log(`priority: ${priorityUrls.length} configured, ${promoted} added/promoted`);
  saveState(target.key, state);
}

// --- URL filter -------------------------------------------------------
// url_include / url_exclude substrings from targets.yml. Applied when
// adding URLs to the frontier and before scanning each page. Priority URLs
// bypass the filter so must-cover pages are never accidentally excluded.
const urlFilter = buildUrlFilter(target);
if (target.url_include?.length || target.url_exclude?.length) {
  log(`URL filter: include=${JSON.stringify(target.url_include ?? [])}, exclude=${JSON.stringify(target.url_exclude ?? [])}`);
}

// --- Robots -----------------------------------------------------------
const robots = await fetchRobots(baseOrigin, target.user_agent);
const delayMs = Math.max(
  target.delay_ms,
  robots.crawlDelay ? Math.min(robots.crawlDelay * 1000, 10000) : 0
);

// --- Batch ------------------------------------------------------------
// importance (1-5, default 3) scales the weekly cap so low-value domains
// (e.g. near-identical open-data sites) consume less budget than key
// sites. importance 3 = the configured cap; 1 = 1/3; 5 = 5/3.
const importance = Math.max(1, Math.min(5, target.importance ?? 3));
const weeklyCap = Math.max(1, Math.round((target.max_pages_per_week * importance) / 3));
const { batch, scannedThisWeek } = pickBatch(state, week, budget, weeklyCap);
log(`${scannedThisWeek} scanned in ${week}; cap ${weeklyCap} (importance ${importance}); batch of ${batch.length}`);
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

// Per-engine weekly sampling rates (config single source of truth). An
// engine runs on a page iff shouldRun(engine, pageId, week, rate). Each
// page's per-engine membership is recorded so reports can show coverage.
const rates = ratesFor(config, target);
const enginesRun = {}; // engine -> count of pages it ran on this run
const tally = { ok: 0, blocked: 0, timeout: 0, robots_skipped: 0, url_filtered: 0, non_html: 0, error: 0 };
const runLog = { runId, week, domain: target.domain, startedAt: new Date().toISOString(), scanned: [], errors: [], sampling: rates };

// Link checking: collect links seen on pages that are in link-check's
// sample, then probe them once after the scan. Rate > 0 enables it.
const checkLinksEnabled = normalizeRate(rates['link-check']) > 0;
const linksSeen = new Set();
const linkSources = new Map(); // url -> Set of pages that link to it (capped)

// Lighthouse: slow (own Chrome). Launched once if its rate is > 0 and
// not in test mode (it audits the live URL, not a local fixture).
const lighthouseEnabled = normalizeRate(rates['lighthouse']) > 0;
let lighthouse = null;
if (lighthouseEnabled && !args['base-url']) {
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

  // URL filter: skip pages that don't match url_include / url_exclude, unless
  // explicitly marked as a priority URL (those bypass filtering).
  if (!item.priority && !urlFilter(item.url)) {
    log(`url-filter skip: ${item.url}`);
    state.pages[item.id].lastScannedWeek = week;
    state.pages[item.id].lastStatus = 'url-filtered';
    tally.url_filtered++;
    if (++sincePersist >= STATE_SAVE_EVERY) { saveState(target.key, state); sincePersist = 0; }
    continue;
  }

  if (!robots.isAllowed(urlPath)) {
    log(`robots disallow: ${item.url}`);
    tally.robots_skipped++;
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

  // Decide this page's engine sample up front. sustainability must be
  // decided before navigation because its collector listens to responses.
  const runs = (engine) => shouldRun(engine, item.id, week, rates[engine]);
  const mark = (engine) => { enginesRun[engine] = (enginesRun[engine] ?? 0) + 1; };

  // Pre-flight HEAD check: some links have no file extension but serve a
  // PDF/binary (e.g. /files/document/...pdf). Navigating to those makes
  // Chromium start a download and throws. A cheap HEAD lets us detect the
  // content type first and skip navigation for non-HTML, recording it as
  // a non-HTML resource instead of erroring.
  const headType = await headContentType(fetchUrl, target.user_agent, target.nav_timeout_ms);
  if (headType && !headType.includes('html') && !headType.includes('xml')) {
    state.pages[item.id].lastScannedWeek = week;
    state.pages[item.id].lastScannedAt = new Date().toISOString();
    state.pages[item.id].lastStatus = 'non-html';
    fs.writeFileSync(
      path.join(pagesDir, `${item.id}.json`),
      JSON.stringify({ pageId: item.id, url: item.url, week, runId, scannedAt: new Date().toISOString(), status: 200, depth: item.depth, nonHtml: { contentType: headType } })
    );
    tally.non_html++;
    runLog.scanned.push(item.id);
    log(`skip non-HTML (${headType.split(';')[0]}): ${urlPath}`);
    if (++sincePersist >= STATE_SAVE_EVERY) { saveState(target.key, state); sincePersist = 0; }
    await new Promise((r) => setTimeout(r, delayMs));
    continue;
  }

  const page = await context.newPage();
  const sustain = runs('sustainability') ? createSustainabilityCollector(page) : null;
  const imgCollector = runs('images') ? createImageCollector(page) : null;
  // Third-party collector must be attached before navigation so it sees every
  // response (like sustainability). Keyed on the page's canonical URL so
  // same-site subdomains are classified first-party.
  const thirdParty = runs('third-party') ? createThirdPartyCollector(page, item.url) : null;

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

    // Measure page weight from the page load itself — BEFORE running the
    // audit engines. The audits (Alfa's DOM serialization, axe injection,
    // any lazy content they trigger) generate their own network traffic;
    // collecting after them would conflate audit activity with the real
    // page weight and couple the number to which engines happened to run.
    if (sustain) { record.sustainability = sustain.collect(); mark('sustainability'); }

    if (status >= 200 && status < 400 && (response?.headers()['content-type'] ?? '').includes('html')) {
      if (runs('axe')) { record.axe = await runAxe(page); mark('axe'); }
      if (runs('alfa')) { record.alfa = await runAlfa(page); mark('alfa'); }
      if (runs('plain-language')) { record.plainLanguage = await runPlainLanguage(page, { extraAllowlist: target.spelling_allowlist ?? [] }); mark('plain-language'); }
      if (runs('deprecated-html')) { record.deprecatedHtml = await runDeprecatedHtml(page); mark('deprecated-html'); }
      if (runs('resources')) { record.resources = await runResources(page, item.url); mark('resources'); }
      if (imgCollector) {
        const imgs = await runImages(page, item.url);
        record.images = { ...imgs, images: imgCollector.collect(imgs.images) };
        mark('images');
      }
      if (runs('standards')) { record.standards = await runStandards(page); mark('standards'); }
      // Security is per-origin (headers/TLD/security.txt), so check it only
      // when this page is in the sample; aggregate keeps the latest result.
      if (runs('security')) { record.security = await runSecurity(baseOrigin, target.user_agent, target.nav_timeout_ms); mark('security'); }
      // Tech detection: identify CMS, frameworks, CDNs, analytics.
      // Runs on a small sample (default 10%) because the tech stack doesn't
      // change page-to-page; aggregate merges all detections for the week
      // into a unified result for the tech page.
      if (runs('tech')) {
        const pageHeaders = (await response?.allHeaders?.()) ?? {};
        record.tech = await runTech(page, pageHeaders);
        mark('tech');
      }

      // Third-party resource/JS cost: collected from the page's own network
      // and Resource Timing, before navigating away. Audit traffic shares the
      // page's origin so it doesn't add third-party origins.
      if (thirdParty) { record.thirdParty = await thirdParty.collect(); mark('third-party'); }

      // Lighthouse: only when this page is in lighthouse's sample AND its
      // own Chrome launched. The sample rate keeps the (slow) audit count
      // proportional to the week's pages.
      if (lighthouse?.available && runs('lighthouse')) {
        const lh = await lighthouse.audit(item.url);
        if (lh) {
          record.lighthouse = lh;
          mark('lighthouse');
          log(`lighthouse ${urlPath} perf:${lh.scores.performance ?? '-'} a11y:${lh.scores.accessibility ?? '-'} seo:${lh.scores.seo ?? '-'}`);
        }
      }

      // Extract links once; use them for discovery (same-host,
      // depth-capped) and, if enabled, for link checking (all links).
      const hrefs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'), (a) => a.getAttribute('href'))
      );

      // Discovery: same-host only, depth-capped, URL-filtered.
      if (item.depth < target.max_crawl_depth) {
        let added = 0;
        for (const href of hrefs) {
          // Normalize against the canonical domain, not the test base-url.
          const norm = normalizeUrl(href, item.url, host === 'localhost' || host === '127.0.0.1' ? host : new URL(`https://${target.domain}`).hostname);
          if (norm && urlFilter(norm) && addPage(state, pageId(norm), norm, item.depth + 1)) added++;
        }
        if (added) log(`+${added} URLs discovered on ${urlPath}`);
      }

      // Link checking: collect absolute http(s) links from pages in
      // link-check's sample (resolved against the real page URL).
      if (checkLinksEnabled && runs('link-check')) {
        mark('link-check');
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
          linksSeen.add(u);
          // Record every page that links to this URL, so a broken link can
          // be traced back to all the pages that need fixing (capped).
          let srcs = linkSources.get(u);
          if (!srcs) {
            srcs = new Set();
            linkSources.set(u, srcs);
          }
          if (srcs.size < 50) srcs.add(item.url);
        }
      }
    }

    fs.writeFileSync(path.join(pagesDir, `${item.id}.json`), JSON.stringify(record));
    runLog.scanned.push(item.id);
    state.pages[item.id].lastScannedWeek = week;
    state.pages[item.id].lastScannedAt = record.scannedAt;
    state.pages[item.id].lastStatus = status;
    state.pages[item.id].failCount = 0;
    if (status >= 400) tally.blocked++;
    else tally.ok++;
    log(`${status} ${urlPath} ${record.axe ? `axe:${record.axe.violationCount}` : ''} ${record.alfa ? `alfa:${record.alfa.failedCount}` : ''}`);
  } catch (err) {
    const msg = String(err);
    // A download (binary the HEAD check missed) is not a failure — record
    // it as a non-HTML page and move on, don't count it as an error.
    if (/Download is starting/i.test(msg)) {
      state.pages[item.id].lastScannedWeek = week;
      state.pages[item.id].lastStatus = 'non-html';
      fs.writeFileSync(
        path.join(pagesDir, `${item.id}.json`),
        JSON.stringify({ pageId: item.id, url: item.url, week, runId, scannedAt: new Date().toISOString(), status: 200, depth: item.depth, nonHtml: { contentType: 'download' } })
      );
      tally.non_html++;
      runLog.scanned.push(item.id);
      log(`skip non-HTML (download): ${urlPath}`);
    } else {
      if (/timeout/i.test(msg) || /TimeoutError/i.test(msg)) tally.timeout++;
      else tally.error++;
      state.pages[item.id].failCount = (state.pages[item.id].failCount ?? 0) + 1;
      runLog.errors.push({ pageId: item.id, url: item.url, error: msg.slice(0, 300) });
      log(`ERROR ${urlPath}: ${msg.slice(0, 120)}`);
    }
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
    broken: broken.map((b) => ({ url: b.url, status: b.status, reason: b.reason, foundOn: [...(linkSources.get(b.url) ?? [])] })),
  };
  log(`link-check: ${broken.length} broken of ${checked} checked`);
}

if (lighthouse) await lighthouse.close();

// Per-engine page counts for this run (coverage = enginesRun / scanned).
runLog.enginesRun = enginesRun;
runLog.tally = tally;
runLog.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(runsDir, `${runId}.json`), JSON.stringify(runLog, null, 1));
saveState(target.key, state);
await browser.close();
const coverage = Object.entries(enginesRun).map(([e, n]) => `${e}:${n}`).join(' ');
const tallyStr = `ok:${tally.ok} blocked:${tally.blocked} timeout:${tally.timeout} robots:${tally.robots_skipped} url-filter:${tally.url_filtered} non-html:${tally.non_html} error:${tally.error}`;
log(`done: ${runLog.scanned.length} scanned | ${tallyStr}${coverage ? ` | ${coverage}` : ''}`);

/**
 * Cheap HEAD request to learn a URL's content-type before navigating, so
 * we can skip non-HTML resources (PDFs/binaries) instead of letting
 * Chromium try to download them. Returns the lowercased content-type, or
 * null if HEAD is unsupported/failed (then we fall back to navigating).
 */
async function headContentType(url, userAgent, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(timeoutMs ?? 15000, 15000));
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': userAgent } });
    return (res.headers.get('content-type') || '').toLowerCase() || null;
  } catch {
    return null; // HEAD blocked/failed — let goto handle it (with the download catch)
  } finally {
    clearTimeout(timer);
  }
}

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

/**
 * Collect a target's priority (top-task) URLs from an inline
 * `priority_urls` list and/or a `priority_urls_file` (one URL per line,
 * `#` comments allowed — the format top-task-finder emits). URLs are
 * normalized to the canonical host; off-host or unparseable entries are
 * dropped. Returns a deduplicated list of normalized URLs.
 */
function loadPriorityUrls(target, origin, hostName) {
  const raw = [...(target.priority_urls ?? [])];
  if (target.priority_urls_file) {
    const file = target.priority_urls_file;
    // A relative path is resolved against config/ first (where the file
    // lives next to targets.yml — e.g. "profiles/x.txt" ->
    // config/profiles/x.txt), then the repo root as a fallback.
    const candidates = path.isAbsolute(file)
      ? [file]
      : [path.join(DIRS.config, file), path.join(DIRS.root, file)];
    const p = candidates.find((c) => fs.existsSync(c));
    if (p) {
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const t = line.trim();
        if (t && !t.startsWith('#')) raw.push(t);
      }
    } else {
      console.warn(`[${target.key}] priority_urls_file not found: tried ${candidates.join(', ')}`);
    }
  }
  const seen = new Set();
  const out = [];
  for (const u of raw) {
    // Canonicalize to the target's host first, so an apex-host entry in
    // the file (e.g. cms.gov/x) gets the same identity as the www-host
    // links discovered by the crawler (www.cms.gov/x) — they share a
    // pageId and aren't scanned twice. www-equivalence keeps them valid.
    const canon = canonicalizeHost(u, hostName);
    const norm = normalizeUrl(canon, origin, hostName);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

/**
 * Rewrite a URL's host to `hostName` when it differs only by a leading
 * `www.` (apex <-> www), so priority URLs match the host the crawler
 * uses. Leaves genuinely different hosts untouched (normalizeUrl rejects
 * those as off-host).
 */
function canonicalizeHost(rawUrl, hostName) {
  try {
    const u = new URL(rawUrl);
    const bare = (h) => h.toLowerCase().replace(/^www\./, '');
    if (bare(u.hostname) === bare(hostName)) u.hostname = hostName;
    return u.toString();
  } catch {
    return rawUrl; // relative or unparseable; normalizeUrl handles it
  }
}
