#!/usr/bin/env node
/**
 * Opt-in, archive-verified pruning of source page detail.
 *
 * Dry run is the default. `--execute` plus `--confirm-domain <key>` is required
 * before anything is removed; the command has no workflow integration. It keeps
 * summary.json, ledgers and historical reports and deletes only pages/, runs/
 * and screenshots/ for weeks whose archive has been re-verified.
 *
 * Run the read-only readiness command first:
 *   npm run retention:prune-check -- --domain <key>
 */

import fs from 'node:fs';
import path from 'node:path';
import { DIRS, loadConfig } from '../src/lib/config.js';
import { collectRetentionMetrics } from '../src/lib/retention-metrics.js';
import { planDomain } from '../src/lib/retention-plan.js';
import { readArchiveIndex, withArchiveState } from '../src/lib/retention-archive-index.js';
import { createArchiveBackend } from '../src/lib/retention-archive.js';
import { evaluatePruneReadiness } from '../src/lib/retention-rollout.js';
import { DETAIL_DIRS, promoteStubsForWeek, removeWeekDetail } from '../src/lib/retention-detail.js';

function parse(argv) {
  const out = { execute: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--domain') out.domain = argv[++i];
    else if (arg === '--week') out.week = argv[++i];
    else if (arg === '--config') out.config = argv[++i];
    else if (arg === '--data-root') out.dataRoot = argv[++i];
    else if (arg === '--now') out.now = argv[++i];
    else if (arg === '--execute') out.execute = true;
    else if (arg === '--confirm-domain') out.confirmDomain = argv[++i];
    else if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

const args = parse(process.argv.slice(2));
if (args.help) {
  console.log('Usage: npm run retention:prune -- --domain <key> [--week <ISO>] [--execute --confirm-domain <key>] [--json]');
  console.log('Without --execute this is a dry run. The source summaries are never removed.');
  process.exit(0);
}
if (!args.domain) throw new Error('--domain is required');
if (args.execute && args.confirmDomain !== args.domain) {
  throw new Error('--execute requires --confirm-domain with the exact domain key');
}
const now = args.now ? new Date(`${args.now}T00:00:00Z`) : new Date();
if (Number.isNaN(now.getTime())) throw new Error('Invalid --now date');
const config = loadConfig(args.config ? fs.readFileSync(args.config, 'utf8') : undefined);
const target = config.targets.find((candidate) => candidate.key === args.domain);
if (!target) throw new Error(`Unknown domain: ${args.domain}`);
if (target.hf_only) throw new Error(`refusing to prune hf_only target ${target.key}`);
if (target.retentionPolicy.legacyFieldApplied) throw new Error('legacy retention_weeks policy: explicit policy required before pruning');
if (!target.retentionPolicy.archive.enabled) throw new Error('archiving is disabled for this target');

const dataRoot = path.resolve(args.dataRoot ?? DIRS.data);
const domainDir = path.join(dataRoot, target.key);
const metrics = collectRetentionMetrics(dataRoot, target.key);
const plan = planDomain({ dataRoot, domainKey: target.key, policy: target.retentionPolicy, metrics, now });
const archiveIndex = withArchiveState(readArchiveIndex(domainDir, target.key), now);
const backend = createArchiveBackend(target.retentionPolicy);
const readiness = await evaluatePruneReadiness({ plan, archiveIndex, backend, now });
const candidates = readiness.entries.filter((entry) => entry.ready && (!args.week || entry.week === args.week));
if (args.week && candidates.length === 0) throw new Error(`No verified archive candidate for ${args.week}`);
if (!readiness.ready && !args.week) throw new Error('prune is blocked; run retention:prune-check for details');

const removed = [];
const promoted = [];
const errors = [];
for (const entry of candidates) {
  const weekDir = path.join(domainDir, entry.week);
  if (!args.execute) {
    for (const subdir of DETAIL_DIRS) {
      const full = path.join(weekDir, subdir);
      if (fs.existsSync(full)) removed.push({ week: entry.week, path: full, executed: false });
    }
    continue;
  }
  try {
    const count = promoteStubsForWeek(domainDir, entry.week);
    if (count) promoted.push({ week: entry.week, count });
    for (const full of removeWeekDetail(domainDir, entry.week)) {
      removed.push({ week: entry.week, path: full, executed: true });
    }
  } catch (error) {
    errors.push({ week: entry.week, error: error.message });
  }
}
const result = {
  domain: target.key,
  dryRun: !args.execute,
  weeks: candidates.map((entry) => entry.week),
  removed,
  promoted,
  errors,
  summariesRetained: candidates.every((entry) => fs.existsSync(path.join(domainDir, entry.week, 'summary.json'))),
  destructiveActionsPerformed: args.execute ? removed.length : 0,
};
if (args.json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`${args.execute ? 'PRUNED' : 'DRY RUN'} ${target.key}: ${candidates.length} verified week(s)`);
  for (const item of promoted) console.log(`  promoted ${item.count} dedup stub(s) off ${item.week}`);
  for (const item of removed) console.log(`  ${item.executed ? 'removed' : 'would remove'} ${item.path}`);
  for (const error of errors) console.log(`  ERROR ${error.path}: ${error.error}`);
  console.log('summary.json and historical reports are retained.');
}
if (errors.length) process.exitCode = 1;
