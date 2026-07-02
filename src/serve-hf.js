#!/usr/bin/env node
//
// Hugging Face Docker Space entrypoint: a self-contained "crawl AND serve"
// supervisor. It does two jobs in one long-lived process:
//
//   1. serves the built static site (docs/) over HTTP on $PORT (HF sets 7860)
//   2. on an internal schedule, scans this profile's targets and rebuilds the
//      site — the cron HF Spaces don't provide natively
//
// This is the standalone-appliance deployment. Unlike GitHub Actions (where
// data is committed to the repo), here the crawl history must live on a
// PERSISTENT volume or it is lost on every container restart. Point
// VITAL_DATA_ROOT at the mounted disk/bucket (e.g. /data); state/, data/, and
// docs/ resolve under it (see src/lib/config.js).
//
// CAVEAT — the internal cron only runs while the container is awake. On a
// Space configured to sleep after inactivity, setInterval() is frozen while
// asleep, so a "daily" scan only fires if the Space is awake at the tick. A
// sleeping Space wakes on an incoming HTTP request — so reliable daily scans
// need either an external daily ping (uptime monitor / cron-job.org hitting
// the URL) or a no-sleep Space. The scan-on-boot below means a wake-from-sleep
// that finds a stale site will refresh it.
//
// Env:
//   PORT             HTTP port (HF sets 7860; default 7860)
//   VITAL_PROFILE    which profile to scan + build (e.g. va). Required here.
//   VITAL_DATA_ROOT  persistent volume mount (e.g. /data). Strongly advised.
//   SCAN_INTERVAL_MS gap between scan cycles (default 24h)
//   SCAN_ON_START    'false' to skip the initial scan (default: scan on boot
//                    only if no site has been built yet)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig, loadProfile, applyProfile, DIRS } from './lib/config.js';

const PORT = Number(process.env.PORT) || 7860;
const PROFILE = process.env.VITAL_PROFILE;
const INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS) || 24 * 60 * 60 * 1000;

if (!PROFILE) {
  console.error('VITAL_PROFILE is required for the HF appliance (e.g. VITAL_PROFILE=va).');
  process.exit(1);
}

const profile = applyProfile(loadConfig(), loadProfile(PROFILE)).profile;
const targets = applyProfile(loadConfig(), loadProfile(PROFILE)).targets;

// ---- static file server (docs/) -------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  // Resolve the request path under docs/, guarding against path traversal.
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let rel = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(DIRS.docs, rel);
  if (!file.startsWith(DIRS.docs)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, 'index.html');
  }
  if (!fs.existsSync(file)) {
    // While the very first scan is still running there is no site yet.
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<h1>Building…</h1><p>The first scan is running. Reload shortly.</p>');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => console.log(`[serve] listening on :${PORT}, profile "${profile.name}"`));

// ---- scan + rebuild loop ---------------------------------------------------

function run(cmd, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
    });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))
    );
  });
}

let scanning = false;
async function scanCycle() {
  if (scanning) {
    console.log('[scan] previous cycle still running; skipping this tick');
    return;
  }
  scanning = true;
  const started = Date.now();
  try {
    for (const t of targets) {
      console.log(`[scan] ${t.domain}`);
      try {
        await run('node', ['src/scan.js', '--domain', t.domain]);
      } catch (e) {
        // One bad target shouldn't abort the whole cycle (e.g. a WAF block).
        console.error(`[scan] ${t.domain} failed: ${e.message}`);
      }
    }
    console.log('[build] aggregating');
    await run('node', ['src/aggregate.js'], { VITAL_PROFILE: PROFILE });
    console.log(`[cycle] done in ${Math.round((Date.now() - started) / 1000)}s`);
  } finally {
    scanning = false;
  }
}

// Boot scan policy. On a sleeping Space the container wakes on an HTTP visit,
// so "scan when the built site is stale" is what actually delivers daily
// scans: a once-a-day visitor wakes the Space, finds yesterday's site, and
// triggers a fresh cycle. We scan on boot when there's no site yet OR the
// existing site is older than the interval. SCAN_ON_START=false forces skip;
// SCAN_ON_START=true forces a scan regardless of freshness.
const indexPath = path.join(DIRS.docs, 'index.html');
const siteAgeMs = fs.existsSync(indexPath) ? Date.now() - fs.statSync(indexPath).mtimeMs : Infinity;
const forced = process.env.SCAN_ON_START === 'true';
const skipped = process.env.SCAN_ON_START === 'false';
const scanOnStart = !skipped && (forced || siteAgeMs > INTERVAL_MS);
if (scanOnStart) {
  console.log(`[boot] site age ${Number.isFinite(siteAgeMs) ? Math.round(siteAgeMs / 3600000) + 'h' : 'none'} — scanning`);
  scanCycle();
} else {
  console.log('[boot] recent site present — serving, next scan on interval');
}
setInterval(scanCycle, INTERVAL_MS);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[serve] ${sig} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
