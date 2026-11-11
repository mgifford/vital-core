#!/usr/bin/env node
/**
 * Create and verify one week's evidence archive.
 *
 * Usage:
 *   npm run retention:archive -- --domain www.cms.gov --week 2026-W44
 *   npm run retention:archive -- --domain www.cms.gov --all-candidates --write
 *
 * Dry run is the default. `--write` publishes to the configured local or
 * S3-compatible backend and verifies the round trip. This command never prunes
 * source data.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DIRS, loadConfig, resolveTargetQuery } from '../src/lib/config.js';
import { planDomain } from '../src/lib/retention-plan.js';
import { collectRetentionMetrics } from '../src/lib/retention-metrics.js';
import { recordVerifiedArchive } from '../src/lib/retention-archive-index.js';
import {
  archiveWeek,
  assertArchivableTarget,
  buildArchive,
  createArchiveBackend,
} from '../src/lib/retention-archive.js';

function parse(argv) {
  const out = { write: false, json: false, allCandidates: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--domain') out.domain = argv[++i];
    else if (arg === '--week') out.week = argv[++i];
    else if (arg === '--all-candidates') out.allCandidates = true;
    else if (arg === '--write') out.write = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--config') out.config = argv[++i];
    else if (arg === '--data-root') out.dataRoot = argv[++i];
    else if (arg === '--archive-dir') out.archiveDir = argv[++i];
    else if (arg === '--now') out.now = argv[++i];
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function parseNow(value) {
  if (!value) return new Date();
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function human(result) {
  const lines = [];
  for (const archive of result.archives) {
    lines.push(`${archive.domain} ${archive.week}`);
    lines.push(`  status: ${archive.status}; source files: ${archive.manifest.files.length}; ZIP: ${Math.round(archive.zipBytes / 1024)} KB`);
    lines.push(`  archive id: ${archive.archiveId}`);
    lines.push(`  ZIP sha256: ${archive.zipSha256}`);
    if (archive.status !== 'complete') lines.push(`  unresolved: ${archive.unresolvedStubs.map((stub) => stub.path).join(', ')}`);
    if (result.dryRun) lines.push('  dry run: not uploaded');
    else lines.push(`  verified and published: ${archive.key}`);
  }
  if (result.errors.length) lines.push(`Errors: ${result.errors.join('; ')}`);
  lines.push('No source data was deleted or moved.');
  return lines.join('\n');
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: npm run retention:archive -- --domain <key> (--week <ISO> | --all-candidates) [--write] [--json] [--config file] [--data-root path] [--archive-dir path] [--now YYYY-MM-DD]');
    return;
  }
  if (!args.domain) throw new Error('--domain is required');
  if (!args.week && !args.allCandidates) throw new Error('provide --week or --all-candidates');
  if (args.week && args.allCandidates) throw new Error('use either --week or --all-candidates');

  const config = loadConfig(args.config ? fs.readFileSync(args.config, 'utf8') : undefined);
  const target = resolveTargetQuery(config, args.domain);
  assertArchivableTarget(target);
  if (!target.retentionPolicy.archive.enabled) {
    throw new Error(`archiving is disabled for ${target.key}; update its retention policy explicitly`);
  }

  const dataRoot = path.resolve(args.dataRoot ?? DIRS.data);
  const domainDir = path.join(dataRoot, target.key);
  const now = parseNow(args.now);
  const metrics = collectRetentionMetrics(dataRoot, target.key);
  const plan = planDomain({ dataRoot, domainKey: target.key, policy: target.retentionPolicy, metrics, now });
  const weeks = args.week
    ? [args.week]
    : plan.entries.filter((entry) => entry.action === 'archive_candidate').map((entry) => entry.week);
  if (!weeks.length) throw new Error(`no archive candidates for ${target.key}`);

  const backend = args.write
    ? createArchiveBackend(
        {
          ...target.retentionPolicy,
          archive: {
            ...target.retentionPolicy.archive,
            ...(args.archiveDir && target.retentionPolicy.archive.backend === 'local' ? { path: args.archiveDir } : {}),
          },
        },
      )
    : null;

  const archives = [];
  const errors = [];
  for (const week of weeks) {
    try {
      if (args.write) {
        const archived = await archiveWeek({ target, domainDir, week, policy: target.retentionPolicy, backend });
        const baseUrl = target.retentionPolicy.archive.public_base_url;
        recordVerifiedArchive(domainDir, {
          domain: target.key,
          week,
          key: archived.key,
          backend: target.retentionPolicy.archive.backend,
          archiveId: archived.archiveId,
          zipSha256: archived.zipSha256,
          bytes: archived.zip.length,
          retentionMonths: target.retentionPolicy.archive.retention_months,
          publicUrl: baseUrl ? `${baseUrl.replace(/\/+$/, '')}/${archived.key}` : null,
        });
        archives.push({
          domain: target.domain,
          week,
          status: archived.status,
          archiveId: archived.archiveId,
          zipSha256: archived.zipSha256,
          zipBytes: archived.zip.length,
          key: archived.key,
          manifest: archived.manifest,
          unresolvedStubs: archived.unresolvedStubs,
        });
        if (archived.status !== 'complete') errors.push(`${week}: archive is incomplete`);
      } else {
        const built = buildArchive({ domainDir, domainKey: target.key, week, policy: target.retentionPolicy });
        archives.push({
          domain: target.domain,
          week,
          status: built.status,
          archiveId: built.archiveId,
          zipSha256: built.zipSha256,
          zipBytes: built.zip.length,
          key: null,
          manifest: built.manifest,
          unresolvedStubs: built.unresolvedStubs,
        });
      }
    } catch (error) {
      errors.push(`${week}: ${error.message}`);
    }
  }

  const result = { dryRun: !args.write, archives, errors };
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(human(result));
  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`retention:archive: ${error.message}`);
  process.exitCode = 1;
});
