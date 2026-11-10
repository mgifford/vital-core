/**
 * Read-only retention metrics from one domain's data tree.
 *
 * The adaptive window uses an observed rate of distinct successful page
 * observations, not configured scan caps. If page detail has already been
 * pruned, the summary's audited-page count is a lower-confidence fallback.
 */

import fs from 'node:fs';
import path from 'node:path';

const MAX_PAGE_FILES = 50000;

function weekDirs(dataRoot, domainKey) {
  const dir = path.join(dataRoot, domainKey);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /^\d{4}-W\d{2}$/.test(name))
    .sort();
}

function readInventory(dataRoot, domainKey) {
  const p = path.join(dataRoot, domainKey, 'inventory.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function collectRetentionMetrics(dataRoot, domainKey, { lookbackWeeks = 8 } = {}) {
  const weeks = weekDirs(dataRoot, domainKey).slice(-lookbackWeeks);
  const inventory = readInventory(dataRoot, domainKey);
  const perWeek = [];
  let inventoryKnown = null;

  if (inventory) {
    const pageRows = Object.keys(inventory.pages ?? {}).length;
    const fixedRows = Object.keys(inventory.fixed ?? {}).length;
    const cleanRows = Number.isInteger(inventory.cleanCount) ? inventory.cleanCount : 0;
    inventoryKnown = pageRows + fixedRows + cleanRows;
  }

  for (const week of weeks) {
    const pagesDir = path.join(dataRoot, domainKey, week, 'pages');
    const summaryPath = path.join(dataRoot, domainKey, week, 'summary.json');
    let summary = null;
    try { summary = fs.existsSync(summaryPath) ? JSON.parse(fs.readFileSync(summaryPath, 'utf8')) : null; } catch { summary = null; }

    if (fs.existsSync(pagesDir)) {
      const files = fs.readdirSync(pagesDir).filter((file) => file.endsWith('.json')).slice(0, MAX_PAGE_FILES);
      const successful = new Set();
      let stubs = 0;
      let complete = files.length < MAX_PAGE_FILES;
      for (const file of files) {
        try {
          const record = JSON.parse(fs.readFileSync(path.join(pagesDir, file), 'utf8'));
          if (record.unchanged) stubs++;
          if (Number.isInteger(record.status) && record.status >= 200 && record.status < 400 && record.url) {
            successful.add(record.pageId ?? record.url);
          }
        } catch {
          complete = false;
        }
      }
      perWeek.push({
        week,
        basis: 'page-records',
        distinctSuccessful: successful.size,
        pageFiles: files.length,
        dedupStubs: stubs,
        complete,
      });
    } else {
      const audited = Number.isFinite(summary?.pagesAudited) ? summary.pagesAudited
        : (Number.isFinite(summary?.pagesScanned) ? summary.pagesScanned : null);
      perWeek.push({
        week,
        basis: 'summary-fallback',
        distinctSuccessful: audited,
        dedupStubs: null,
        complete: Boolean(summary),
      });
    }
  }

  const observed = perWeek
    .filter((entry) => entry.distinctSuccessful != null && entry.distinctSuccessful > 0)
    .map((entry) => entry.distinctSuccessful);
  const distinctUrlsPerWeek = median(observed);
  const pageRecordWeeks = perWeek.filter((entry) => entry.basis === 'page-records' && entry.complete).length;
  const knownUrls = inventoryKnown && inventoryKnown > 0
    ? inventoryKnown
    : (() => {
        const ids = new Set();
        for (const week of weeks) {
          const pagesDir = path.join(dataRoot, domainKey, week, 'pages');
          if (!fs.existsSync(pagesDir)) continue;
          for (const file of fs.readdirSync(pagesDir).filter((name) => name.endsWith('.json')).slice(0, MAX_PAGE_FILES)) {
            try {
              const record = JSON.parse(fs.readFileSync(path.join(pagesDir, file), 'utf8'));
              if (record.url) ids.add(record.pageId ?? record.url);
            } catch { /* unreadable record: do not count as known */ }
          }
        }
        return ids.size;
      })();

  return {
    weeks,
    observedWeeks: observed.length,
    knownUrls,
    knownBasis: inventoryKnown ? 'inventory-approximate' : 'retained-page-records',
    distinctUrlsPerWeek,
    distinctBasis: pageRecordWeeks > 0 ? 'page-records-median' : 'summary-median-fallback',
    confidence: pageRecordWeeks >= 3 ? 'high' : pageRecordWeeks > 0 ? 'medium' : 'low',
    perWeek,
    notes: 'Distinct successful observations are counted from retained page records; clean URLs may be approximate because the inventory folds clean pages into cleanCount.',
  };
}
