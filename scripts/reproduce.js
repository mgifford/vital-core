#!/usr/bin/env node
/**
 * Reproduce one accessibility finding from a published bugs.json.
 *
 *   node scripts/reproduce.js --bugs <bugs.json> --id VS-1a2b3c4d           # run it
 *   node scripts/reproduce.js --bugs <bugs.json> --id VS-1a2b3c4d --plan    # print the plan
 *   node scripts/reproduce.js --bugs <bugs.json> --id VS-1a2b3c4d --out test.mjs
 *
 * `--id` matches the finding's instance_id (the `#VS-…` anchor) or its
 * pattern_id. Exit codes follow the generated test: 0 reproduced, 1 not
 * reproduced, 2 locator not found, 3 ambiguous locator, 4 page/interaction
 * unavailable, 5 rule or engine changed, 6 inconclusive/unavailable.
 *
 * Running needs Playwright Chromium (`npx playwright install chromium`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { reproductionPlan, playwrightTestFor, REPRODUCTION_EXIT_CODES } from '../src/lib/reproduction.js';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const token = process.argv[i];
  if (!token.startsWith('--')) continue;
  const key = token.slice(2);
  const next = process.argv[i + 1];
  args[key] = next && !next.startsWith('--') ? (i++, next) : true;
}

if (!args.bugs || !args.id) {
  console.error('Usage: node scripts/reproduce.js --bugs <bugs.json> --id <VS-id|pattern-id> [--plan|--out <file>]');
  process.exit(2);
}

const doc = JSON.parse(fs.readFileSync(path.resolve(args.bugs), 'utf8'));
const reports = Array.isArray(doc) ? doc : doc.reports ?? doc.findings ?? [];
const bug = reports.find((report) => report.instance_id === args.id || report.pattern_id === args.id);
if (!bug) {
  console.error(`No finding ${args.id} in ${args.bugs}`);
  process.exit(2);
}

const plan = reproductionPlan(bug);
if (args.plan) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(plan.status === 'unavailable' ? REPRODUCTION_EXIT_CODES.unavailable : 0);
}
if (plan.status === 'unavailable') {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(REPRODUCTION_EXIT_CODES.unavailable);
}
if (args.out) {
  const target = path.resolve(String(args.out));
  fs.writeFileSync(target, playwrightTestFor(plan));
  console.log(JSON.stringify({ status: 'test_generated', file: target, finding: plan.instance_id }, null, 2));
  process.exit(0);
}

const { runReproduction } = await import('../src/lib/reproduction-runner.js');
const result = await runReproduction(plan);
console.log(JSON.stringify(result, null, 2));
process.exit(REPRODUCTION_EXIT_CODES[result.status] ?? 6);
