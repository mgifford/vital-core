import fs from 'node:fs';
import path from 'node:path';
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

export function addPage(state, id, url, depth) {
  if (state.pages[id]) return false;
  state.pages[id] = {
    url,
    discoveredAt: new Date().toISOString(),
    depth,
    lastScannedWeek: null,
    lastScannedAt: null,
    lastStatus: null,
    failCount: 0,
  };
  return true;
}

/**
 * Pick the next batch to scan this week.
 * Priority: never-scanned pages by depth then discovery order, then pages
 * whose lastScannedWeek is oldest. Pages already scanned this week and
 * pages that failed 3+ times this week are excluded.
 */
export function pickBatch(state, week, budget, scannedThisWeekCap) {
  const entries = Object.entries(state.pages);
  const scannedThisWeek = entries.filter(([, p]) => p.lastScannedWeek === week).length;
  const remainingWeekly = Math.max(0, scannedThisWeekCap - scannedThisWeek);
  const n = Math.min(budget, remainingWeekly);
  if (n === 0) return { batch: [], scannedThisWeek };

  const candidates = entries
    .filter(([, p]) => p.lastScannedWeek !== week && p.failCount < 3)
    .sort(([, a], [, b]) => {
      const aNew = a.lastScannedWeek === null ? 0 : 1;
      const bNew = b.lastScannedWeek === null ? 0 : 1;
      if (aNew !== bNew) return aNew - bNew; // never-scanned first
      if (aNew === 0) {
        if (a.depth !== b.depth) return a.depth - b.depth;
        return a.discoveredAt.localeCompare(b.discoveredAt);
      }
      return (a.lastScannedWeek ?? '').localeCompare(b.lastScannedWeek ?? '');
    })
    .slice(0, n)
    .map(([id, p]) => ({ id, url: p.url, depth: p.depth }));

  return { batch: candidates, scannedThisWeek };
}
