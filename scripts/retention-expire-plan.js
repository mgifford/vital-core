#!/usr/bin/env node
/**
 * Read-only archive-expiry plan. It never deletes storage objects.
 *
 * Usage: npm run retention:expire-plan -- --domain <key> [--json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { DIRS, loadConfig } from '../src/lib/config.js';
import { readArchiveIndex, archiveExpiryPlan } from '../src/lib/retention-archive-index.js';

const args = process.argv.slice(2);
const get = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
if (args.includes('--help')) {
  console.log('Usage: npm run retention:expire-plan -- --domain <key> [--json] [--now YYYY-MM-DD]');
  process.exit(0);
}
const domain = get('--domain');
if (!domain) {
  console.error('retention:expire-plan: --domain is required');
  process.exit(1);
}
const now = get('--now') ? new Date(`${get('--now')}T00:00:00Z`) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error('retention:expire-plan: invalid --now date');
  process.exit(1);
}
const config = loadConfig();
const target = config.targets.find((candidate) => candidate.key === domain);
if (!target) {
  console.error(`retention:expire-plan: unknown domain ${domain}`);
  process.exit(1);
}
const index = readArchiveIndex(path.join(DIRS.data, target.key), target.key);
const plan = archiveExpiryPlan(index, now);
if (args.includes('--json')) console.log(JSON.stringify(plan, null, 2));
else {
  console.log(`Archive expiry plan for ${target.key}: no objects will be deleted`);
  for (const entry of plan.archives) console.log(`  ${entry.week}: ${entry.state} (expires ${entry.expires_at ?? 'never'})`);
  console.log(`Counts: ${JSON.stringify(plan.counts)}; destructive actions: 0`);
}
