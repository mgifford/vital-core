#!/usr/bin/env node
/**
 * Read-only prune-readiness check. It never deletes; use its report to decide
 * whether an operator should authorize a separate prune run.
 *
 * Usage: npm run retention:prune-check -- --domain www.cms.gov [--json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { DIRS, loadConfig } from '../src/lib/config.js';
import { collectRetentionMetrics } from '../src/lib/retention-metrics.js';
import { planDomain } from '../src/lib/retention-plan.js';
import { readArchiveIndex, withArchiveState } from '../src/lib/retention-archive-index.js';
import { createArchiveBackend } from '../src/lib/retention-archive.js';
import { evaluatePruneReadiness } from '../src/lib/retention-rollout.js';

function parse(argv) {
  const out = { json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--domain') out.domain = argv[++i];
    else if (argv[i] === '--config') out.config = argv[++i];
    else if (argv[i] === '--data-root') out.dataRoot = argv[++i];
    else if (argv[i] === '--now') out.now = argv[++i];
    else if (argv[i] === '--json') out.json = true;
    else if (argv[i] === '--help' || argv[i] === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return out;
}

const args = parse(process.argv.slice(2));
if (args.help) {
  console.log('Usage: npm run retention:prune-check -- --domain <key> [--json] [--data-root path] [--config file] [--now YYYY-MM-DD]');
  process.exit(0);
}
if (!args.domain) throw new Error('--domain is required');
const now = args.now ? new Date(`${args.now}T00:00:00Z`) : new Date();
if (Number.isNaN(now.getTime())) throw new Error('Invalid --now date');
const config = loadConfig(args.config ? fs.readFileSync(args.config, 'utf8') : undefined);
const target = config.targets.find((candidate) => candidate.key === args.domain);
if (!target) throw new Error(`Unknown domain: ${args.domain}`);
const dataRoot = path.resolve(args.dataRoot ?? DIRS.data);
const domainDir = path.join(dataRoot, target.key);
const metrics = collectRetentionMetrics(dataRoot, target.key);
const plan = planDomain({ dataRoot, domainKey: target.key, policy: target.retentionPolicy, metrics, now });
const archiveIndex = withArchiveState(readArchiveIndex(domainDir, target.key), now);
let backend = null;
try {
  if (target.retentionPolicy.archive.enabled) backend = createArchiveBackend(target.retentionPolicy);
} catch (error) {
  backend = null;
  console.warn(`Archive backend unavailable for object verification: ${error.message}`);
}
const readiness = await evaluatePruneReadiness({ plan, archiveIndex, backend, now, verifyObject: true });
if (args.json) console.log(JSON.stringify(readiness, null, 2));
else {
  console.log(`Prune readiness for ${target.domain}: ${readiness.ready ? 'READY (operator approval still required)' : 'BLOCKED'}`);
  for (const entry of readiness.entries) console.log(`  ${entry.week}: ${entry.status} — ${entry.reason}`);
  console.log('No files were deleted. This check does not authorize a prune.');
}
process.exitCode = readiness.ready ? 0 : 1;
