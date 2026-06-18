import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DIRS } from './config.js';

/**
 * Per-domain crawl state. This is the ONLY mutable state in the system.
 * Everything under data/ is append-only; everything under docs/ is
 * derived. If state is lost, the crawler reseeds from the sitemap and
 * history in data/ is unaffected.
 *
 * Shape:
 * {
 *   domain: "example.gov",
 *   seededAt: "2026-06-12T...",
 *   pages: {
 *     "<pageId>": {
 *       url, discoveredAt, depth,
 *       lastScannedWeek, lastScannedAt, lastStatus, failCount
 *     }
 *   }
 * }
 */

function statePath(domainKey) {
  return path.join(DIRS.state, domainKey, 'crawl.json');
}

export function loadState(domainKey, domain) {
  const p = statePath(domainKey);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  return { domain, seededAt: null, pages: {} };
}

export function saveState(domainKey, state) {
  const p = statePath(domainKey);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, p); // atomic-ish: never leave a half-written state file
}

export function addPage(state, id, url, depth, { priority = false } = {}) {
  if (state.pages[id]) {
    // A URL already in the frontier that is now also a configured priority
    // URL gets promoted (e.g. discovered by crawl, then added to the
    // top-tasks file). Promotion only, never demotion.
    if (priority && !state.pages[id].priority) {
      state.pages[id].priority = true;
      return true;
    }
    return false;
  }
  state.pages[id] = {
    url,
    discoveredAt: new Date().toISOString(),
    depth,
    priority,
    lastScannedWeek: null,
    lastScannedAt: null,
    lastStatus: null,
    failCount: 0,
  };
  return true;
}

/**
 * Pick the next batch to scan this week.
 *
 * Pages with a completed outcome are not rescanned in the same ISO week:
 * pages with lastScannedWeek === week are excluded, so coverage accumulates
 * across the week's runs without repeats.
 *
 * Timeout/error pages are intentionally left unmarked for the week and can
 * be retried in-week (up to the fail threshold) to recover from transient
 * failures. Within that constraint, ordering is:
 *
 *   1. Priority pages (configured top tasks) first, so they are always
 *      covered early in the week before the budget runs out.
 *   2. Then the rest in a stable per-week random order — a different
 *      random spread of a large site each week, deterministic for replay.
 *
 * Pages with failCount >= 3 are excluded until a successful scan resets
 * the counter.
 */
export function pickBatch(state, week, budget, scannedThisWeekCap) {
  const entries = Object.entries(state.pages);
  const scannedThisWeek = entries.filter(([, p]) => p.lastScannedWeek === week).length;
  const remainingWeekly = Math.max(0, scannedThisWeekCap - scannedThisWeek);
  const n = Math.min(budget, remainingWeekly);
  if (n === 0) return { batch: [], scannedThisWeek };

  const candidates = entries
    .filter(([, p]) => p.lastScannedWeek !== week && p.failCount < 3)
    .map(([id, p]) => ({ id, p, rank: weeklyRank(id, week) }))
    .sort((a, b) => {
      // Priority first.
      const ap = a.p.priority ? 0 : 1;
      const bp = b.p.priority ? 0 : 1;
      if (ap !== bp) return ap - bp;
      // Then never-scanned before previously-scanned (freshness for trends).
      const an = a.p.lastScannedWeek === null ? 0 : 1;
      const bn = b.p.lastScannedWeek === null ? 0 : 1;
      if (an !== bn) return an - bn;
      // Then a stable per-week random order, so large sites get a
      // different random sample each week rather than the same shallow set.
      return a.rank - b.rank;
    })
    .slice(0, n)
    .map(({ id, p }) => ({ id, url: p.url, depth: p.depth, priority: !!p.priority }));

  return { batch: candidates, scannedThisWeek };
}

/** Stable per-week uniform rank in [0,1) for shuffling the frontier. */
function weeklyRank(pageId, week) {
  const hex = crypto.createHash('sha256').update(`${pageId}|${week}`).digest('hex').slice(0, 13);
  return parseInt(hex, 16) / 2 ** 52;
}
