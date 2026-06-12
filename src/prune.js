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
  const cutoff = weekStringWeeksAgo(now, target.retention_weeks ?? 8);

  for (const week of fs.readdirSync(domainDir).filter((w) => /^\d{4}-W\d{2}$/.test(w))) {
    if (compareWeeks(week, cutoff) >= 0) continue;
    const summary = path.join(domainDir, week, 'summary.json');
    if (!fs.existsSync(summary)) {
      console.log(`skip ${target.key}/${week}: no summary.json yet (run aggregate first)`);
      continue;
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

function weekStringWeeksAgo(date, weeks) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - weeks * 7);
  return isoWeekOf(d);
}
