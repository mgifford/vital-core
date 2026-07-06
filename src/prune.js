#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, DIRS } from './lib/config.js';
import { compareWeeks, isoWeekOf } from './lib/week.js';

/**
 * Repo-size hygiene. Page-level JSON for thousands of pages adds up;
 * weekly summaries do not. This removes pages/ and runs/ directories
 * older than retention_weeks, but ONLY when a committed summary.json
 * exists for that week, so no history is ever lost; it just gets
 * coarser with age. Sustainability applies to the repo too.
 */

const config = loadConfig();
const now = new Date();
let removed = 0;

for (const target of config.targets) {
  const domainDir = path.join(DIRS.data, target.key);
  if (!fs.existsSync(domainDir)) continue;
  const cutoff = weekStringWeeksAgo(now, target.retention_weeks ?? 3);

  for (const week of fs.readdirSync(domainDir).filter((w) => /^\d{4}-W\d{2}$/.test(w))) {
    if (compareWeeks(week, cutoff) >= 0) continue;
    const summary = path.join(domainDir, week, 'summary.json');
    if (!fs.existsSync(summary)) {
      console.log(`skip ${target.key}/${week}: no summary.json yet (run aggregate first)`);
      continue;
    }

    // Keep dedup stubs resolvable across retention boundaries: if newer
    // retained weeks have { unchanged: true, since: <this week> }, rewrite
    // those stubs to full records before deleting this week's pages/.
    const promoted = promoteStubsForPrunedWeek(domainDir, week);
    if (promoted > 0) {
      console.log(`promoted ${promoted} stub(s) off ${target.key}/${week} before pruning`);
    }

    for (const sub of ['pages', 'runs']) {
      const dir = path.join(domainDir, week, sub);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
        console.log(`pruned ${target.key}/${week}/${sub}`);
        removed++;
      }
    }
  }
}
console.log(removed ? `pruned ${removed} directories` : 'nothing to prune');

function promoteStubsForPrunedWeek(domainDir, prunedWeek) {
  const newerWeeks = fs.readdirSync(domainDir)
    .filter((w) => /^\d{4}-W\d{2}$/.test(w) && compareWeeks(w, prunedWeek) > 0)
    .sort(compareWeeks);

  let promoted = 0;
  for (const week of newerWeeks) {
    const pagesDir = path.join(domainDir, week, 'pages');
    if (!fs.existsSync(pagesDir)) continue;

    for (const file of fs.readdirSync(pagesDir).filter((f) => f.endsWith('.json'))) {
      const pagePath = path.join(pagesDir, file);
      const rec = JSON.parse(fs.readFileSync(pagePath, 'utf8'));
      if (!rec.unchanged || rec.since !== prunedWeek) continue;

      const full = resolveFullRecord(domainDir, prunedWeek, rec.pageId);
      if (!full) continue;

      const rewritten = {
        ...full,
        week: rec.week,
        runId: rec.runId,
        scannedAt: rec.scannedAt,
        status: rec.status,
      };
      fs.writeFileSync(pagePath, JSON.stringify(rewritten));
      promoted++;
    }
  }
  return promoted;
}

function resolveFullRecord(domainDir, week, pageId) {
  const seen = new Set();
  let curWeek = week;
  while (curWeek && !seen.has(curWeek)) {
    seen.add(curWeek);
    const fullPath = path.join(domainDir, curWeek, 'pages', `${pageId}.json`);
    if (!fs.existsSync(fullPath)) return null;
    const rec = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    if (!rec.unchanged) return rec;
    curWeek = rec.since;
  }
  return null;
}

function weekStringWeeksAgo(date, weeks) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - weeks * 7);
  return isoWeekOf(d);
}
