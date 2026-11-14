/**
 * Shared, policy-neutral helpers for removing a week's live detail.
 *
 * The caller must have already passed archive verification and explicit
 * authorization. Nothing here reads config or decides whether deletion is
 * allowed; src/prune.js no longer deletes at all.
 */

import fs from 'node:fs';
import path from 'node:path';
import { compareWeeks } from './week.js';

export const DETAIL_DIRS = ['pages', 'runs', 'screenshots'];

/** Rewrite newer dedup stubs so they survive deletion of this week's pages. */
export function promoteStubsForWeek(domainDir, prunedWeek) {
  const newerWeeks = fs.readdirSync(domainDir)
    .filter((week) => /^\d{4}-W\d{2}$/.test(week) && compareWeeks(week, prunedWeek) > 0)
    .sort(compareWeeks);
  let promoted = 0;
  for (const week of newerWeeks) {
    const pagesDir = path.join(domainDir, week, 'pages');
    if (!fs.existsSync(pagesDir)) continue;
    for (const file of fs.readdirSync(pagesDir).filter((name) => name.endsWith('.json'))) {
      const pagePath = path.join(pagesDir, file);
      const record = JSON.parse(fs.readFileSync(pagePath, 'utf8'));
      if (!record.unchanged || record.since !== prunedWeek) continue;
      const full = resolveFullRecord(domainDir, prunedWeek, record.pageId);
      if (!full) continue;
      fs.writeFileSync(pagePath, JSON.stringify({
        ...full,
        week: record.week,
        runId: record.runId,
        scannedAt: record.scannedAt,
        status: record.status,
      }));
      promoted++;
    }
  }
  return promoted;
}

function resolveFullRecord(domainDir, week, pageId) {
  const seen = new Set();
  let current = week;
  while (current && !seen.has(current)) {
    seen.add(current);
    const file = path.join(domainDir, current, 'pages', `${pageId}.json`);
    if (!fs.existsSync(file)) return null;
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!record.unchanged) return record;
    current = record.since;
  }
  return null;
}

export function weekDetailExists(domainDir, week) {
  return DETAIL_DIRS.some((subdir) => fs.existsSync(path.join(domainDir, week, subdir)));
}

/** Remove only pages/runs/screenshots, never summary.json or ledgers. */
export function removeWeekDetail(domainDir, week) {
  const removed = [];
  for (const subdir of DETAIL_DIRS) {
    const dir = path.join(domainDir, week, subdir);
    if (!fs.existsSync(dir)) continue;
    fs.rmSync(dir, { recursive: true });
    removed.push(dir);
  }
  return removed;
}
