#!/usr/bin/env node
// Moves per-domain crawl state between state/<key>/crawl.json and the
// `scan-state` GitHub Release, so CI keeps crawl progress without
// committing it to git. Needs the gh CLI with GH_TOKEN (and GH_REPO outside
// a checkout).
//
//   download <domain>          restore one domain; missing asset = seed fresh
//   download-all               restore every non-hf_only target
//   upload <domain>            gzip and upload one domain (--clobber)
//   bootstrap <ref> [domain…]  upload state/<key>/crawl.json as committed at
//                              <ref> (one-time migration out of git)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';
import { loadConfig, getTarget, DIRS } from '../src/lib/config.js';
import { STATE_RELEASE_TAG, stateAssetName, assertReleasable, isNotFound } from '../src/lib/state-release.js';

function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 30 });
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? String(r.error ?? '') };
}

function statePath(key) {
  return path.join(DIRS.state, key, 'crawl.json');
}

function download(target) {
  assertReleasable(target);
  const name = stateAssetName(target.key);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
  const r = gh(['release', 'download', STATE_RELEASE_TAG, '--pattern', name, '--dir', tmp]);
  if (!r.ok) {
    if (isNotFound(r.stderr)) {
      console.log(`${target.domain}: no ${name} in release ${STATE_RELEASE_TAG}; scan will seed fresh`);
      return;
    }
    throw new Error(`${target.domain}: download failed: ${r.stderr.trim()}`);
  }
  const json = zlib.gunzipSync(fs.readFileSync(path.join(tmp, name)));
  JSON.parse(json);
  const dest = statePath(target.key);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, json);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${target.domain}: restored ${name} (${json.length} bytes) → ${dest}`);
}

function ensureRelease() {
  if (gh(['release', 'view', STATE_RELEASE_TAG, '--json', 'tagName']).ok) return;
  const r = gh(['release', 'create', STATE_RELEASE_TAG, '--prerelease',
    '--title', 'Crawl state (rolling)',
    '--notes', 'Per-domain crawl frontier for scan.yml, overwritten every scan. Disposable: a missing asset makes that domain reseed from its sitemap. Not a software release.']);
  // A parallel matrix job may have created it first.
  if (!r.ok && !gh(['release', 'view', STATE_RELEASE_TAG, '--json', 'tagName']).ok) {
    throw new Error(`could not create release ${STATE_RELEASE_TAG}: ${r.stderr.trim()}`);
  }
}

function uploadBuffer(target, json) {
  assertReleasable(target);
  JSON.parse(json);
  const name = stateAssetName(target.key);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
  const file = path.join(tmp, name);
  fs.writeFileSync(file, zlib.gzipSync(json, { level: 9 }));
  ensureRelease();
  const r = gh(['release', 'upload', STATE_RELEASE_TAG, file, '--clobber']);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!r.ok) throw new Error(`${target.domain}: upload failed: ${r.stderr.trim()}`);
  console.log(`${target.domain}: uploaded ${name} (${json.length} bytes uncompressed)`);
}

function upload(target) {
  const p = statePath(target.key);
  if (!fs.existsSync(p)) {
    console.log(`${target.domain}: no ${p}; nothing to upload`);
    return;
  }
  uploadBuffer(target, fs.readFileSync(p));
}

function bootstrap(ref, targets) {
  for (const t of targets) {
    let json;
    try {
      json = execFileSync('git', ['show', `${ref}:state/${t.key}/crawl.json`], { maxBuffer: 1 << 30 });
    } catch {
      console.log(`${t.domain}: no state/${t.key}/crawl.json at ${ref}; skipped`);
      continue;
    }
    uploadBuffer(t, json);
  }
}

const config = loadConfig();
const releasable = config.targets.filter((t) => !t.hf_only);
const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd === 'download' && args[0]) download(getTarget(config, args[0]));
  else if (cmd === 'download-all') releasable.forEach(download);
  else if (cmd === 'upload' && args[0]) upload(getTarget(config, args[0]));
  else if (cmd === 'bootstrap' && args[0]) {
    bootstrap(args[0], args.length > 1 ? args.slice(1).map((d) => getTarget(config, d)) : releasable);
  } else {
    console.error('usage: state-release.js download <domain> | download-all | upload <domain> | bootstrap <ref> [domain…]');
    process.exit(2);
  }
} catch (err) {
  console.error(`::error::${err.message}`);
  process.exit(1);
}
