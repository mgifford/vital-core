import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './config.js';

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
 * Entry shape (keyed by page URL):
 *   { pageId, lastWeek, lastScannedAt, status,
 *     axeViolations, alfaFailures, scored }
 */

function inventoryPath(domainKey) {
  return path.join(DIRS.data, domainKey, 'inventory.json');
}

export function loadInventory(domainKey, domain) {
  const p = inventoryPath(domainKey);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  return { domain, updatedAt: null, pages: {} };
}

export function saveInventory(domainKey, inv) {
  const p = inventoryPath(domainKey);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  inv.updatedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(inv, null, 1));
}

/**
 * Update the inventory from one week's page records. `records` is an
 * array of the per-page JSON objects for the week. Only advances an
 * entry when this record is at least as recent as what's stored, so
 * re-running an older week never clobbers newer data.
 */
export function updateInventory(inv, week, records) {
  for (const rec of records) {
    if (!rec.url) continue;
    const prev = inv.pages[rec.url];
    if (prev && prev.lastWeek > week) continue; // keep the newer result
    inv.pages[rec.url] = {
      pageId: rec.pageId ?? prev?.pageId ?? null,
      lastWeek: week,
      lastScannedAt: rec.scannedAt ?? null,
      status: rec.status ?? null,
      axeViolations: rec.axe?.violationCount ?? null,
      alfaFailures: rec.alfa?.failedCount ?? null,
      // A page "has known issues" if either engine found any last time.
      hasIssues: (rec.axe?.violationCount ?? 0) > 0 || (rec.alfa?.failedCount ?? 0) > 0,
    };
  }
  return inv;
}

/**
 * Roll the inventory up into headline numbers for reports: total known
 * pages, how many have known issues, and how stale the coverage is.
 */
export function inventorySummary(inv, currentWeek) {
  const pages = Object.values(inv.pages);
  const withIssues = pages.filter((p) => p.hasIssues).length;
  const scannedThisWeek = pages.filter((p) => p.lastWeek === currentWeek).length;
  // Distribution of how recently each known page was actually scanned.
  const weeks = {};
  for (const p of pages) weeks[p.lastWeek] = (weeks[p.lastWeek] ?? 0) + 1;
  return {
    totalKnownPages: pages.length,
    pagesWithKnownIssues: withIssues,
    scannedThisWeek,
    coverageByWeek: weeks,
  };
}
