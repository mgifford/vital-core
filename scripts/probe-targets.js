#!/usr/bin/env node
/**
 * Find out why a target's pages fail to load for the scanner. Run it where
 * the scans run (the `diagnose` workflow runs it on GitHub's runners). For
 * each domain it:
 *   - fetches the homepage, its apex/www. twin, robots.txt and the first
 *     sitemap, with the scanner's user agent and with a desktop browser's,
 *     following redirects hop by hop;
 *   - loads the homepage in Chromium the way scan.js does, timing
 *     DOMContentLoaded and load and listing requests still open at the end.
 * Only a short list of response headers, cookie names and page titles are
 * kept; nothing is committed.
 *
 * Usage:
 *   node scripts/probe-targets.js                          # every non-hf_only target
 *   node scripts/probe-targets.js --domains "lbhf.gov.uk blackburn.gov.uk"
 *   node scripts/probe-targets.js --json lbhf.gov.uk       # raw JSON
 *
 * Writes Markdown to stdout and, when set, $GITHUB_STEP_SUMMARY, plus a
 * ::warning annotation per domain that needs attention. Exit code 0, except
 * 1 for invalid domains or hf_only targets.
 */

import fs from 'node:fs';
import { loadConfig } from '../src/lib/config.js';
import { parseRobots } from '../src/lib/robots.js';
import {
  parseDomains, resolveProbeTargets, twinHost, pickHeaders, cookieNames,
  protectionHints, extractTitle, verdict, renderMarkdown, describeNetworkError,
} from '../src/lib/probe.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 30000;
const BODY_CAP = 256 * 1024;

const args = process.argv.slice(2);
const json = args.includes('--json');
const listed = [];
for (let n = 0; n < args.length; n++) {
  if (args[n] === '--domains') listed.push(args[++n] ?? '');
  else if (!args[n].startsWith('--')) listed.push(args[n]);
}

let domains;
try {
  domains = parseDomains(listed.join(' '));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const { targets, refused } = resolveProbeTargets(loadConfig(), domains);
if (refused.length) {
  console.error(`Refusing hf_only targets (never run in GitHub Actions): ${refused.join(', ')}`);
  if (domains.length) process.exit(1);
}

async function readCapped(res) {
  const reader = res.body?.getReader();
  if (!reader) return { text: '', truncated: false };
  const chunks = [];
  let n = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
    if (n >= BODY_CAP) { truncated = true; break; }
  }
  await reader.cancel().catch(() => {});
  return { text: Buffer.concat(chunks).toString('utf8'), truncated };
}

/**
 * Follow redirects by hand so every hop is recorded. The scanner's own
 * fetches send no Accept-Language; the browser-like fetch sends Chromium's
 * default, which is what the scan's Playwright browser sends.
 */
async function fetchChain(url, userAgent, { acceptLanguage = null } = {}) {
  const hops = [];
  const started = Date.now();
  let current = url;
  for (let n = 0; n < 10; n++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const hopStarted = Date.now();
    try {
      const res = await fetch(current, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'user-agent': userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...(acceptLanguage ? { 'accept-language': acceptLanguage } : {}),
        },
      });
      const hop = {
        url: current,
        status: res.status,
        ms: Date.now() - hopStarted,
        headers: pickHeaders(res.headers),
        cookies: cookieNames(res.headers.getSetCookie?.() ?? []),
      };
      hops.push(hop);
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => {});
        current = new URL(location, current).href;
        continue;
      }
      const { text: body, truncated } = await readCapped(res);
      hop.bytes = Buffer.byteLength(body);
      hop.title = extractTitle(body);
      return { hops, totalMs: Date.now() - started, body, truncated };
    } catch (err) {
      const reason = err.name === 'AbortError'
        ? `no response within ${FETCH_TIMEOUT_MS / 1000} s`
        : describeNetworkError(err.cause?.code ?? err.cause?.message ?? err.message);
      hops.push({ url: current, error: reason, ms: Date.now() - hopStarted });
      return { hops, totalMs: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }
  hops.push({ url: current, error: 'more than 10 redirects' });
  return { hops, totalMs: Date.now() - started };
}

const stripQuery = (u) => { try { const x = new URL(u); return `${x.host}${x.pathname}`; } catch { return u; } };

/** Load the homepage like scan.js: same launch args, viewport and user agent. */
async function loadInBrowser(url, userAgent, timeoutMs) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (err) {
    return { error: `Playwright unavailable: ${err.message}` };
  }
  let browser;
  try {
    browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  } catch (err) {
    return { error: `Chromium didn't start: ${String(err.message).split('\n')[0]}` };
  }
  try {
    const context = await browser.newContext({ userAgent, viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const open = new Map();
    const done = [];
    page.on('request', (r) => open.set(r, Date.now()));
    const finish = (r) => {
      const t0 = open.get(r);
      if (t0 == null) return;
      open.delete(r);
      done.push({ url: stripQuery(r.url()), ms: Date.now() - t0 });
    };
    page.on('requestfinished', finish);
    page.on('requestfailed', finish);
    const started = Date.now();
    let response = null;
    let domContentLoadedMs = null;
    let loadMs = null;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      domContentLoadedMs = Date.now() - started;
      await page.waitForLoadState('load', { timeout: Math.max(1000, timeoutMs - domContentLoadedMs) });
      loadMs = Date.now() - started;
    } catch (err) {
      if (domContentLoadedMs == null) {
        return { error: `${err.name}: ${String(err.message).split('\n')[0]}`, timeoutMs, pending: [...open.keys()].slice(0, 10).map((r) => stripQuery(r.url())) };
      }
    }
    return {
      status: response?.status() ?? null,
      finalUrl: page.url(),
      title: await page.title().catch(() => null),
      domContentLoadedMs,
      loadMs,
      timeoutMs,
      requests: open.size + done.length,
      pending: [...open.keys()].slice(0, 10).map((r) => stripQuery(r.url())),
      slowest: done.sort((a, b) => b.ms - a.ms).slice(0, 5),
    };
  } finally {
    await browser.close();
  }
}

async function probe(target) {
  const { domain, userAgent, navTimeoutMs } = target;
  const urls = [`https://${domain}/`, `https://${twinHost(domain)}/`, `https://${domain}/robots.txt`];
  const fetches = [];
  for (const url of urls) {
    fetches.push({ url, scanner: await fetchChain(url, userAgent), browser: await fetchChain(url, BROWSER_UA, { acceptLanguage: 'en-US,en;q=0.9' }) });
  }

  const robotsFetch = fetches[2].scanner;
  const robotsHop = robotsFetch.hops[robotsFetch.hops.length - 1];
  let robots = null;
  if (robotsHop) {
    const ok = !robotsHop.error && robotsHop.status >= 200 && robotsHop.status < 300;
    const text = ok ? robotsFetch.body ?? '' : '';
    const sitemaps = [...text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
    robots = { status: robotsHop.status, error: robotsHop.error, sitemaps, rootAllowed: parseRobots(text, userAgent).isAllowed('/') };
  }

  const sitemapUrl = robots?.sitemaps?.[0] ?? `https://${domain}/sitemap.xml`;
  const sitemapFetch = await fetchChain(sitemapUrl, userAgent);
  const smHop = sitemapFetch.hops[sitemapFetch.hops.length - 1];
  const smBody = sitemapFetch.body ?? '';
  const sitemap = {
    url: sitemapUrl,
    status: smHop?.status,
    error: smHop?.error,
    isIndex: /<sitemapindex[\s>]/i.test(smBody),
    locs: (smBody.match(/<loc>/gi) ?? []).length,
    truncated: !!sitemapFetch.truncated,
  };

  const page = await loadInBrowser(`https://${domain}/`, userAgent, navTimeoutMs);
  const home = fetches[0];
  const homeHop = home.scanner.hops[home.scanner.hops.length - 1] ?? {};
  const hints = [...new Set([
    ...home.scanner.hops.flatMap((h) => protectionHints({ headers: h.headers ?? {}, cookies: h.cookies ?? [] })),
    ...home.browser.hops.flatMap((h) => protectionHints({ headers: h.headers ?? {}, cookies: h.cookies ?? [] })),
  ])];
  for (const f of fetches) { delete f.scanner.body; delete f.browser.body; }
  return {
    ...target,
    fetches,
    robots,
    sitemap,
    page,
    hints,
    homeHeaders: homeHop.headers ?? {},
    verdict: verdict({ domain, scanner: home.scanner, browser: home.browser, page }),
  };
}

const results = [];
for (const target of targets) {
  console.error(`probing ${target.domain} ...`);
  results.push(await probe(target));
}

if (json) {
  console.log(JSON.stringify({ refused, results }, null, 1));
} else {
  const md = renderMarkdown(results, { refused });
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
}
if (process.env.GITHUB_ACTIONS) {
  for (const r of results) {
    const msg = r.verdict.text.replace(/%/g, '%25').replace(/\r?\n/g, ' ');
    console.log(`::${r.verdict.ok ? 'notice' : 'warning'} title=diagnose ${r.domain}::${msg}`);
  }
}
