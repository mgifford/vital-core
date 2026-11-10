import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveRetention,
  resolveTargetRetention,
  calculateLiveWeeks,
  storageWarnings,
} from '../../src/lib/retention-policy.js';
import { isoWeekMonday, isoWeeksInYear, ageInWeeks } from '../../src/lib/retention-week.js';
import { planDomain, planSummary } from '../../src/lib/retention-plan.js';
import { collectRetentionMetrics } from '../../src/lib/retention-metrics.js';

test('ISO week resolution covers year boundaries and 53-week years', () => {
  assert.equal(isoWeekMonday('2026-W01').toISOString().slice(0, 10), '2025-12-29');
  assert.equal(isoWeekMonday('2020-W53').toISOString().slice(0, 10), '2020-12-28');
  assert.equal(isoWeekMonday('2026-W53').toISOString().slice(0, 10), '2026-12-28');
  assert.equal(isoWeeksInYear(2025), 52);
  assert.equal(isoWeeksInYear(2026), 53);
  assert.throws(() => isoWeekMonday('2025-W53'));
  assert.throws(() => isoWeekMonday('2026-W54'));
  assert.throws(() => isoWeekMonday('not-a-week'));
  assert.equal(ageInWeeks('2026-W46', new Date('2026-11-10T00:00:00Z')), 0);
});

test('policy profiles resolve with documented precedence and defaults', () => {
  const balanced = resolveRetention();
  assert.equal(balanced.profile, 'balanced');
  assert.equal(balanced.live.minimum_weeks, 4);
  assert.equal(balanced.live.maximum_weeks, 16);
  assert.equal(calculateLiveWeeks(balanced, { knownUrls: 10000, distinctUrlsPerWeek: 1000 }).weeks, 13);
  assert.equal(calculateLiveWeeks(balanced, { knownUrls: 100000, distinctUrlsPerWeek: 100 }).weeks, 16);
  assert.equal(calculateLiveWeeks(balanced, {}).method, 'insufficient-evidence');
  assert.equal(calculateLiveWeeks(resolveRetention({}, { profile: 'research', live: { mode: 'fixed', weeks: 40 } })).weeks, 40);
  assert.equal(resolveRetention({}, {}, 2).legacyFieldApplied, true);
  assert.throws(() => resolveRetention({ live: { minimum_weeks: 18, maximum_weeks: 4 } }));
  assert.throws(() => resolveRetention({ unexpected: true }));
  assert.throws(() => resolveRetention({ archive: { enabled: true, retention_months: 0 } }));
});

test('explicit retention wins over legacy weeks and reports the conflict', () => {
  const legacy = resolveTargetRetention({ legacyWeeks: 2 });
  assert.equal(legacy.source, 'retention_weeks');
  assert.equal(legacy.policy.live.weeks, 2);
  assert.equal(legacy.policy.archive.enabled, false);

  const explicit = resolveTargetRetention({
    legacyWeeks: 2,
    targetRetention: { profile: 'research', live: { mode: 'fixed', weeks: 8 } },
  });
  assert.equal(explicit.source, 'retention');
  assert.equal(explicit.policy.live.weeks, 8);
  assert.match(explicit.warnings.join(' '), /superseded/);

  const fallback = resolveTargetRetention({});
  assert.equal(fallback.source, 'balanced-default');
  assert.equal(fallback.policy.profile, 'balanced');
});

test('storage warnings are advisory and never imply deletion', () => {
  const warnings = storageWarnings({ warning_mb: 1300, critical_mb: 1600 }, 1435663);
  assert.ok(warnings.some((warning) => warning.code === 'size_warning'));
  assert.ok(!warnings.some((warning) => warning.code === 'size_critical'), 'the current data repo is over the warning, not the critical, threshold');
  assert.ok(storageWarnings({ warning_mb: 1300, critical_mb: 1600 }, 1700000).some((warning) => warning.code === 'size_critical'));
  assert.deepEqual(storageWarnings({}, null), [{ code: 'size_unavailable' }]);
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-retention-'));
  const domain = 'example.gov';
  const write = (week, { summary = true, pages = true, runs = false, stubs = 0 } = {}) => {
    const dir = path.join(root, domain, week);
    fs.mkdirSync(dir, { recursive: true });
    if (summary) fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ week, pagesScanned: 4 }));
    if (pages) {
      fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
      for (let i = 0; i < 4; i++) {
        fs.writeFileSync(path.join(dir, 'pages', `${i}.json`), JSON.stringify({
          pageId: `p${i}`, url: `https://example.gov/${i}`, status: 200, unchanged: i < stubs,
        }));
      }
    }
    if (runs) fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
  };
  write('2026-W42', { summary: false });
  write('2026-W43', { pages: false });
  write('2026-W44', { stubs: 1 });
  write('2026-W45');
  write('2026-W46', { pages: false });
  return { root, domain, write };
}

test('the planner is non-destructive, blocks missing summaries and never authorizes legacy deletion', () => {
  const f = fixture();
  try {
    const legacy = resolveTargetRetention({ legacyWeeks: 2 }).policy;
    const plan = planDomain({ dataRoot: f.root, domainKey: f.domain, policy: legacy, now: new Date('2026-11-10T00:00:00Z') });
    const byWeek = Object.fromEntries(plan.entries.map((entry) => [entry.week, entry]));
    assert.equal(byWeek['2026-W42'].action, 'blocked');
    assert.equal(byWeek['2026-W43'].action, 'already_pruned');
    assert.equal(byWeek['2026-W44'].action, 'legacy_prune_requires_authorization');
    assert.equal(byWeek['2026-W45'].action, 'keep_live');
    assert.equal(byWeek['2026-W46'].action, 'keep_live');
    assert.equal(byWeek['2026-W44'].dedupStubs, 1);
    assert.equal(plan.destructiveActionsPerformed, 0);
    assert.ok(fs.existsSync(path.join(f.root, f.domain, '2026-W44', 'pages', '0.json')), 'planning did not remove a page');
    assert.equal(planSummary(plan).destructiveActionsPerformed, 0);

    const archivePolicy = resolveRetention({ archive: { enabled: true, retention_months: 12, verify_before_prune: true } });
    const archivePlan = planDomain({ dataRoot: f.root, domainKey: f.domain, policy: archivePolicy, now: new Date('2026-12-01T00:00:00Z') });
    assert.equal(archivePlan.entries.find((entry) => entry.week === '2026-W44').action, 'archive_candidate');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('metrics use distinct successful page records and fall back to summaries', () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, f.domain, 'inventory.json'), JSON.stringify({
      pages: { 'https://example.gov/1': {} }, fixed: {}, cleanCount: 10,
    }));
    // Remove page detail from W45 so the fallback path is exercised.
    fs.rmSync(path.join(f.root, f.domain, '2026-W45', 'pages'), { recursive: true, force: true });
    const metrics = collectRetentionMetrics(f.root, f.domain);
    assert.equal(metrics.knownUrls, 11);
    assert.equal(metrics.knownBasis, 'inventory-approximate');
    assert.equal(metrics.distinctBasis, 'page-records-median');
    assert.ok(metrics.perWeek.some((entry) => entry.basis === 'summary-fallback'));
    assert.equal(metrics.perWeek.find((entry) => entry.week === '2026-W44').dedupStubs, 1);
    assert.ok(metrics.confidence === 'high' || metrics.confidence === 'medium');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
