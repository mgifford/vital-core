import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './config.js';
import { writeLedgerIfChanged } from './fs-utils.js';

/**
 * Rolling per-domain page inventory: the most recent known result for
 * every URL ever scanned, even pages not scanned this week.
 *
 * The weekly scan only covers a sampled slice, and page-level detail is
 * pruned after retention_weeks — so neither the weekly summary nor the
 * page records can answer "what's the known state of the whole site?".
 * This inventory does: it accumulates last-known status per URL and is
 * committed (data/<domain>/inventory.json), so it survives pruning and
 * grows into a complete picture of the site over time.
 *
 * Unlike the findings ledger (recomputed from retained summaries each
 * run), the inventory must be UPDATED incrementally — once a week's page
 * records are pruned, the only memory of those pages is here.
 *
 * Only pages with known issues get a full row (git-history cost is what
 * you need to reproduce a bug, not proof a page passed). A page that has
 * never had an issue is folded into `cleanCount`; a page that HAD an
 * issue and is now clean gets a small `fixed[url]` marker instead of a
 * full row, so "when was this fixed" stays answerable without paying
 * per-page storage for pages nothing is wrong with.
 *
 * `pages` entry shape (keyed by page URL, issues only):
 *   { pageId, lastWeek, lastScannedAt, status,
 *     axeViolations, alfaFailures, hasIssues: true }
 *
 * `fixed` entry shape (keyed by page URL):
 *   { fixedAsOf }
 *
 * `cleanCount` is deliberately NOT exact per-URL tracking (that would mean
 * storing every clean URL forever, defeating the point). aggregate.js
 * replays every retained week's page records on every run — without
 * guarding against that, the same week's same clean pages would be
 * re-counted every single run, growing without bound. `countedWeeks`
 * (a small array of ISO week strings, bounded by retention_weeks) is the
 * guard: a week's clean observations are folded into cleanCount once,
 * the first time that week is seen, and ignored on every later replay.
 */

function inventoryPath(domainKey) {
  return path.join(DIRS.data, domainKey, 'inventory.json');
}

export function loadInventory(domainKey, domain) {
  const p = inventoryPath(domainKey);
  if (!fs.existsSync(p)) return { domain, updatedAt: null, pages: {}, fixed: {}, cleanCount: 0, countedWeeks: [] };
  const inv = JSON.parse(fs.readFileSync(p, 'utf8'));
  inv.fixed ??= {};
  inv.cleanCount ??= 0;
  inv.countedWeeks ??= [];
  // One-time migration: older files (pre clean-page-pruning) carry a full
  // row for every page ever scanned, including hasIssues:false. Purge those
  // on load rather than waiting for that URL to be re-scanned — we don't
  // know when each one actually went clean, so there's no accurate
  // `fixedAsOf` to give it; fold it into cleanCount instead. Mark each
  // purged row's lastWeek as counted so a subsequent updateInventory()
  // replay of that same week doesn't count the same URLs again.
  for (const [url, rec] of Object.entries(inv.pages)) {
    if (!rec.hasIssues) {
      delete inv.pages[url];
      inv.cleanCount += 1;
      if (rec.lastWeek && !inv.countedWeeks.includes(rec.lastWeek)) inv.countedWeeks.push(rec.lastWeek);
    }
  }
  return inv;
}

export function saveInventory(domainKey, inv) {
  writeLedgerIfChanged(inventoryPath(domainKey), inv);
}

/**
 * Update the inventory from one week's page records. `records` is an
 * array of the per-page JSON objects for the week. Only advances an
 * entry when this record is at least as recent as what's stored, so
 * re-running an older week never clobbers newer data.
 */
export function updateInventory(inv, week, records) {
  inv.fixed ??= {};
  inv.cleanCount ??= 0;
  inv.countedWeeks ??= [];
  // aggregate.js replays every retained week on every run, not just newly
  // scanned data — a week already folded into cleanCount must not be
  // re-counted on a later replay, or cleanCount grows without bound even
  // with zero new data. Once counted, a week is never counted again.
  const alreadyCounted = inv.countedWeeks.includes(week);

  for (const rec of records) {
    if (!rec.url) continue;
    const prev = inv.pages[rec.url];
    const prevFixed = inv.fixed[rec.url];
    if (prev && prev.lastWeek > week) continue; // keep the newer result
    if (prevFixed && prevFixed.fixedAsOf > week) continue; // keep the newer fix
    const hasIssues = (rec.axe?.violationCount ?? 0) > 0 || (rec.alfa?.failedCount ?? 0) > 0;

    if (hasIssues) {
      // Real finding: keep the full row (this is the repro evidence).
      delete inv.fixed[rec.url]; // broke again after being fixed, if it was
      inv.pages[rec.url] = {
        pageId: rec.pageId ?? prev?.pageId ?? null,
        lastWeek: week,
        lastScannedAt: rec.scannedAt ?? null,
        status: rec.status ?? null,
        axeViolations: rec.axe?.violationCount ?? null,
        alfaFailures: rec.alfa?.failedCount ?? null,
        hasIssues: true,
      };
    } else if (prev) {
      // Previously had issues, now clean: drop the row, leave a fix marker.
      // This is exact tracking (keyed by URL), so it applies regardless of
      // whether this week was already counted.
      delete inv.pages[rec.url];
      inv.fixed[rec.url] = { fixedAsOf: week };
    } else if (!prevFixed && !alreadyCounted) {
      // Clean, no prior row/fix marker, and this week hasn't been folded
      // into cleanCount yet. cleanCount is an approximate report-only stat
      // (NOT exact per-URL tracking — that would require storing every
      // clean URL, defeating the point); the countedWeeks guard keeps it
      // bounded rather than growing on every replay of the same week.
      inv.cleanCount += 1;
    }
  }
  if (!alreadyCounted) inv.countedWeeks.push(week);
  return inv;
}

/**
 * Roll the inventory up into headline numbers for reports: total known
 * pages, how many have known issues, and how stale the coverage is.
 */
export function inventorySummary(inv, currentWeek) {
  const pages = Object.values(inv.pages);
  const withIssues = pages.length;
  const fixedCount = Object.keys(inv.fixed ?? {}).length;
  const cleanCount = inv.cleanCount ?? 0;
  const scannedThisWeek = pages.filter((p) => p.lastWeek === currentWeek).length;
  // Distribution of how recently each known ISSUE page was actually scanned
  // (clean/fixed pages don't carry a lastWeek any more, so they can't
  // contribute to this breakdown).
  const weeks = {};
  for (const p of pages) weeks[p.lastWeek] = (weeks[p.lastWeek] ?? 0) + 1;
  return {
    totalKnownPages: pages.length + fixedCount + cleanCount,
    pagesWithKnownIssues: withIssues,
    scannedThisWeek,
    coverageByWeek: weeks,
  };
}
