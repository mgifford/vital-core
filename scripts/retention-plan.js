#!/usr/bin/env node
/**
 * Read-only retention planning.
 *
 * Usage: npm run retention:plan -- [--domain <key>] [--data-root <path>] [--config <targets.yml>] [--now YYYY-MM-DD] [--json]
 *
 * Prints the policy, observed throughput, storage warnings and per-week action
 * for each target. It does not archive, upload, move or delete anything.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DIRS, loadConfig } from '../src/lib/config.js';
import { collectRetentionMetrics } from '../src/lib/retention-metrics.js';
import { planDomain, planSummary } from '../src/lib/retention-plan.js';
import { storageWarnings } from '../src/lib/retention-policy.js';

function argsFrom(argv) {
  const out = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') out.json = true;
    else if (arg === '--domain') out.domain = argv[++i];
    else if (arg === '--data-root') out.dataRoot = argv[++i];
    else if (arg === '--config') out.config = argv[++i];
    else if (arg === '--now') out.now = argv[++i];
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function directorySizeKb(dir) {
  let bytes = 0;
  if (!fs.existsSync(dir)) return 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        try { bytes += fs.statSync(full).size; } catch { /* unreadable: omit */ }
      }
    }
  }
  return Math.round(bytes / 1024);
}

function nowFrom(value) {
  if (!value) return new Date();
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid --now date: ${value}`);
  return date;
}

function humanReport(results) {
  const lines = [
    'VITAL Core retention plan (read-only)',
    `Generated: ${results.generatedAt}`,
    'No archive was created and no data was moved or deleted.',
    '',
  ];
  for (const result of results.domains) {
    const p = result.plan;
    const m = result.metrics;
    lines.push(`${result.domain} — profile ${p.policyProfile} (${p.policySource}), live ${p.live.weeks} week(s) ${p.live.method}`);
    lines.push(`  known URLs: ${m.knownUrls ?? 'unknown'} (${m.knownBasis}); observed: ${m.distinctUrlsPerWeek ?? 'unknown'} distinct successful/week (${m.distinctBasis}, ${m.confidence} confidence)`);
    lines.push(`  data: ~${Math.round(result.storage.sizeKb / 1024)} MB (${result.storage.source})${result.storage.warnings.length ? `; warnings: ${result.storage.warnings.map((warning) => warning.code).join(', ')}` : ''}`);
    if (!p.entries.length) {
      lines.push('  no ISO-week data found');
    } else {
      for (const entry of p.entries) {
        lines.push(`  ${entry.week} age ${entry.ageWeeks}w · ${entry.detailDirs.join(',') || 'summary only'} · ${entry.action} — ${entry.reason}`);
      }
    }
    lines.push(`  ${JSON.stringify(planSummary(p).actions)}; destructive actions: 0`);
    lines.push('');
  }
  lines.push('This plan is advisory. Legacy retention_weeks and archive-disabled policies require explicit operator approval before any deletion.');
  return lines.join('\n');
}

function main() {
  const args = argsFrom(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: npm run retention:plan -- [--domain <key>] [--data-root <path>] [--config <targets.yml>] [--now YYYY-MM-DD] [--json]');
    return;
  }
  const config = loadConfig(args.config ? fs.readFileSync(args.config, 'utf8') : undefined);
  const dataRoot = path.resolve(args.dataRoot ?? DIRS.data);
  const now = nowFrom(args.now);
  const targets = args.domain ? config.targets.filter((target) => target.key === args.domain) : config.targets;
  if (args.domain && targets.length === 0) throw new Error(`Unknown domain: ${args.domain}`);

  const domains = [];
  for (const target of targets) {
    const metrics = collectRetentionMetrics(dataRoot, target.key);
    const plan = planDomain({ dataRoot, domainKey: target.key, policy: target.retentionPolicy, metrics, now });
    const recorded = path.join(dataRoot, '.repo-size-kb');
    const sizeKb = fs.existsSync(recorded)
      ? Number(fs.readFileSync(recorded, 'utf8').trim())
      : directorySizeKb(path.join(dataRoot, target.key));
    domains.push({
      domain: target.domain,
      key: target.key,
      metrics,
      plan,
      storage: {
        sizeKb,
        source: fs.existsSync(recorded) ? '.repo-size-kb (full data repository)' : 'working-tree domain directory',
        warnings: storageWarnings(target.retentionPolicy.storage ?? {}, sizeKb),
      },
    });
  }

  const output = {
    generatedAt: now.toISOString(),
    dataRoot,
    destructiveActionsPerformed: 0,
    domains,
  };
  if (args.json) console.log(JSON.stringify(output, null, 2));
  else console.log(humanReport(output));
}

try {
  main();
} catch (error) {
  console.error(`retention:plan: ${error.message}`);
  process.exitCode = 1;
}
