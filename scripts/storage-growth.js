#!/usr/bin/env node
/**
 * CI storage watchdog. Warning thresholds live in config/targets.yml `storage:`.
 * This script prints the same GitHub annotations as the former shell step and
 * writes `kb=<data size>` to GITHUB_OUTPUT. It never deletes anything.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../src/lib/config.js';
import { evaluateStorage } from '../src/lib/storage-guard.js';

function ghSize(repo) {
  return Number(execFileSync('gh', ['api', `repos/${repo}`, '--jq', '.size'], { encoding: 'utf8' }).trim());
}

function readNumber(file) {
  if (!fs.existsSync(file)) return null;
  const value = Number(fs.readFileSync(file, 'utf8').trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

function sevenDayBaseline(file, now = new Date()) {
  if (!fs.existsSync(file)) return null;
  const cutoff = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  let selected = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const [date, value] = line.trim().split(/\s+/);
    if (!date || date > cutoff) continue;
    const kb = Number(value);
    if (Number.isFinite(kb) && kb > 0) selected = kb;
  }
  return selected;
}

const config = loadConfig();
const limits = config.storageLimits;
const codeRepo = process.env.GITHUB_REPOSITORY;
const dataRepo = process.env.DATA_REPO;
if (!codeRepo || !dataRepo) throw new Error('GITHUB_REPOSITORY and DATA_REPO are required');
const dataRoot = process.env.DATA_ROOT ? path.join(process.env.DATA_ROOT, 'data') : path.join(process.cwd(), 'data');
const codeKb = ghSize(codeRepo);
const dataKb = ghSize(dataRepo);
const previousKb = readNumber(path.join(dataRoot, '.repo-size-kb'));
const sevenDayKb = sevenDayBaseline(path.join(dataRoot, '.repo-size-history'));
const result = evaluateStorage({ codeKb, dataKb, previousKb, sevenDayKb, limits });
console.log(`Code repository size: ~${Math.round(codeKb / 1024)} MB`);
console.log(`Data repository size (server-side, full history): ${dataKb} KB (~${Math.round(dataKb / 1024)} MB)`);
if (result.skip) {
  console.log('Size not computed yet by GitHub; skipping growth checks.');
  process.exit(0);
}
for (const warning of result.warnings) console.log(`::warning title=${warning.title}::${warning.message}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `kb=${dataKb}\n`);
