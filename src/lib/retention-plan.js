/**
 * Read-only retention planner.
 *
 * It classifies each ISO week's live detail; it never creates an archive,
 * uploads one, moves a file or deletes anything. The action vocabulary is
 * deliberately conservative: legacy `retention_weeks` and archive-disabled
 * policies require explicit operator approval rather than implying that a
 * dry-run authorizes pruning.
 */

import fs from 'node:fs';
import path from 'node:path';
import { calculateLiveWeeks } from './retention-policy.js';
import { ageInWeeks } from './retention-week.js';

function directoryBytes(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        try { total += fs.statSync(full).size; } catch { /* unreadable: omit */ }
      }
    }
  }
  return total;
}

function countStubs(pagesDir) {
  if (!fs.existsSync(pagesDir)) return 0;
  let stubs = 0;
  for (const file of fs.readdirSync(pagesDir).filter((name) => name.endsWith('.json'))) {
    try {
      if (JSON.parse(fs.readFileSync(path.join(pagesDir, file), 'utf8')).unchanged) stubs++;
    } catch { /* unreadable record is not counted as a stub */ }
  }
  return stubs;
}

export function planDomain({ dataRoot, domainKey, policy, metrics = {}, now = new Date() }) {
  if (!/^[a-zA-Z0-9._-]+$/.test(domainKey) || domainKey === '.' || domainKey === '..') throw new Error('unsafe domainKey');
  const dir = path.join(dataRoot, domainKey);
  const live = calculateLiveWeeks(policy, metrics);
  const weeks = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => /^\d{4}-W\d{2}$/.test(name)).sort()
    : [];
  const entries = [];
  for (const week of weeks) {
    const weekDir = path.join(dir, week);
    const summaryPresent = fs.existsSync(path.join(weekDir, 'summary.json'));
    const details = ['pages', 'runs', 'screenshots'].filter((sub) => fs.existsSync(path.join(weekDir, sub)));
    const ageWeeks = ageInWeeks(week, now);
    const bytes = directoryBytes(weekDir);
    const dedupStubs = countStubs(path.join(weekDir, 'pages'));
    let action = 'keep_live';
    let reason = 'inside the live retention window';
    if (ageWeeks >= live.weeks) {
      if (!summaryPresent) {
        action = 'blocked';
        reason = 'summary.json is missing; pruning is blocked';
      } else if (details.length === 0) {
        action = 'already_pruned';
        reason = 'no live page/run/screenshot detail remains';
      } else if (policy.legacyFieldApplied) {
        action = 'legacy_prune_requires_authorization';
        reason = 'legacy retention_weeks policy; destructive pruning requires explicit operator approval';
      } else if (!policy.archive.enabled) {
        action = 'requires_explicit_discard_approval';
        reason = 'archiving is disabled; no automated deletion is authorized';
      } else {
        action = 'archive_candidate';
        reason = 'archive must be created, uploaded and verified before deletion';
      }
    }
    entries.push({
      domainKey,
      week,
      ageWeeks,
      summaryPresent,
      detailDirs: details,
      bytes,
      dedupStubs,
      action,
      reason,
    });
  }
  return {
    domainKey,
    policyProfile: policy.profile,
    policySource: policy.legacyFieldApplied ? 'retention_weeks' : 'retention',
    live,
    generatedAt: now.toISOString(),
    entries,
    destructiveActionsPerformed: 0,
    notes: 'Planning only. No archive was created, no file was moved and no data was deleted.',
  };
}

export function planSummary(plan) {
  const counts = {};
  for (const entry of plan.entries) counts[entry.action] = (counts[entry.action] ?? 0) + 1;
  return {
    domainKey: plan.domainKey,
    weeks: plan.entries.length,
    liveWeeks: plan.live.weeks,
    liveMethod: plan.live.method,
    actions: counts,
    archiveCandidates: plan.entries.filter((entry) => entry.action === 'archive_candidate').map((entry) => entry.week),
    blocked: plan.entries.filter((entry) => entry.action === 'blocked').map((entry) => entry.week),
    destructiveActionsPerformed: 0,
  };
}
