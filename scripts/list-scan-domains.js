#!/usr/bin/env node
// Used by the scan.yml matrix job to decide which domains still have scan
// budget left this week, so the nightly run doesn't spawn a job (checkout +
// npm ci + Chromium install) for a domain that would immediately exit with
// "nothing to do". Writes `domains=<json array>` to $GITHUB_OUTPUT directly
// (rather than via shell redirection) so the ::notice:: lines explaining
// skipped domains can go to plain stdout without corrupting the output file.
//
// Single-domain workflow_dispatch runs bypass this filter entirely (the
// caller already validated the domain and wants it to run regardless of
// cap), so this only ever narrows the scheduled all-domains run.
import fs from 'node:fs';
import { loadConfig } from '../src/lib/config.js';
import { loadState, budgetStatus } from '../src/lib/state.js';
import { isoWeek } from '../src/lib/week.js';

const week = isoWeek();
const targets = loadConfig().targets.filter((t) => !t.hf_only);

const runnable = [];
for (const t of targets) {
  const state = loadState(t.key, t.domain);
  const { cap, scannedThisWeek, remaining, frontierEmpty } = budgetStatus(state, week, t);
  if (remaining === 0) {
    console.log(`::notice::${t.domain}: skipped — ${scannedThisWeek}/${cap} cap reached`);
  } else if (frontierEmpty) {
    console.log(`::notice::${t.domain}: skipped — frontier empty (no scannable pages)`);
  } else {
    runnable.push(t.domain);
  }
}

console.log(`Runnable: ${runnable.length}/${targets.length} domains`);
fs.appendFileSync(process.env.GITHUB_OUTPUT, 'domains=' + JSON.stringify(runnable) + '\n');
