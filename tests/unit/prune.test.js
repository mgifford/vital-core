import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { isoWeekOf } from '../../src/lib/week.js';

/**
 * prune.js does irreversible fs.rmSync of page data, so its guards matter:
 *   - delete pages/ and runs/ only for weeks older than retention_weeks;
 *   - NEVER delete a week within the retention window;
 *   - NEVER delete a week that has no committed summary.json (history
 *     would be lost), and never delete the summary.json itself.
 *
 * It's a top-level script that reads config + DIRS relative to its own
 * location, so we run it in a sandbox: a copy of src/ plus a temp
 * config/ and data/ tree, then assert what survived.
 */

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

// REPO may be a git worktree without its own node_modules (Node finds the
// parent checkout's copy by walking up). Resolve the node_modules that
// actually serves src/ so the sandbox symlink never dangles.
const NODE_MODULES = (() => {
  const yamlPath = createRequire(path.join(REPO, 'src', 'lib', 'config.js')).resolve('yaml');
  const marker = `${path.sep}node_modules${path.sep}`;
  return yamlPath.slice(0, yamlPath.lastIndexOf(marker) + marker.length - 1);
})();

function weeksAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n * 7);
  return isoWeekOf(d);
}

function writeWeek(dataDir, key, week, { summary = true } = {}) {
  const base = path.join(dataDir, key, week);
  fs.mkdirSync(path.join(base, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(base, 'runs'), { recursive: true });
  fs.writeFileSync(path.join(base, 'pages', 'p1.json'), '{}');
  fs.writeFileSync(path.join(base, 'runs', 'r1.json'), '{}');
  if (summary) fs.writeFileSync(path.join(base, 'summary.json'), JSON.stringify({ week }));
}

function writePage(dataDir, key, week, id, record) {
  const pagesDir = path.join(dataDir, key, week, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(path.join(pagesDir, `${id}.json`), JSON.stringify(record));
}

const exists = (...p) => fs.existsSync(path.join(...p));

test('prune: removes old page detail only when a summary exists, keeps recent and summaries', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-prune-'));
  try {
    // Sandbox: copy src/, symlink node_modules (so imports resolve without
    // a slow copy), write a minimal config and a data tree.
    fs.cpSync(path.join(REPO, 'src'), path.join(sandbox, 'src'), { recursive: true });
    fs.symlinkSync(NODE_MODULES, path.join(sandbox, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(sandbox, 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(sandbox, 'config', 'targets.yml'),
      `defaults:\n  retention_weeks: 8\ntargets:\n  - domain: example.gov\n`
    );
    const dataDir = path.join(sandbox, 'data');
    const key = 'example.gov';

    const oldWeek = weeksAgo(10);      // past retention, has summary -> pruned
    const oldNoSummary = weeksAgo(11); // past retention, NO summary -> kept (history)
    const recentWeek = weeksAgo(2);    // within retention -> kept entirely

    writeWeek(dataDir, key, oldWeek, { summary: true });
    writeWeek(dataDir, key, oldNoSummary, { summary: false });
    writeWeek(dataDir, key, recentWeek, { summary: true });

    execFileSync('node', ['src/prune.js'], { cwd: sandbox, stdio: 'pipe' });

    // Old week with summary: page/run detail gone, summary kept.
    assert.equal(exists(dataDir, key, oldWeek, 'pages'), false, 'old pages/ pruned');
    assert.equal(exists(dataDir, key, oldWeek, 'runs'), false, 'old runs/ pruned');
    assert.equal(exists(dataDir, key, oldWeek, 'summary.json'), true, 'old summary kept (history survives)');

    // Old week WITHOUT summary: nothing deleted (would lose history).
    assert.equal(exists(dataDir, key, oldNoSummary, 'pages'), true, 'old-but-unsummarized pages kept');
    assert.equal(exists(dataDir, key, oldNoSummary, 'runs'), true, 'old-but-unsummarized runs kept');

    // Recent week: untouched.
    assert.equal(exists(dataDir, key, recentWeek, 'pages'), true, 'recent pages kept');
    assert.equal(exists(dataDir, key, recentWeek, 'runs'), true, 'recent runs kept');
    assert.equal(exists(dataDir, key, recentWeek, 'summary.json'), true, 'recent summary kept');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('prune: respects a per-target retention_weeks override', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-prune-'));
  try {
    fs.cpSync(path.join(REPO, 'src'), path.join(sandbox, 'src'), { recursive: true });
    fs.symlinkSync(NODE_MODULES, path.join(sandbox, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(sandbox, 'config'), { recursive: true });
    // Tight 2-week retention for this target.
    fs.writeFileSync(
      path.join(sandbox, 'config', 'targets.yml'),
      `defaults:\n  retention_weeks: 8\ntargets:\n  - domain: example.gov\n    retention_weeks: 2\n`
    );
    const dataDir = path.join(sandbox, 'data');
    const key = 'example.gov';

    const week5 = weeksAgo(5); // older than 2 weeks -> pruned under the override
    const week1 = weeksAgo(1); // within 2 weeks -> kept
    writeWeek(dataDir, key, week5, { summary: true });
    writeWeek(dataDir, key, week1, { summary: true });

    execFileSync('node', ['src/prune.js'], { cwd: sandbox, stdio: 'pipe' });

    assert.equal(exists(dataDir, key, week5, 'pages'), false, '5-week-old pruned under 2-week retention');
    assert.equal(exists(dataDir, key, week1, 'pages'), true, '1-week-old kept under 2-week retention');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('prune: promotes retained stubs that point to a week being pruned', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-prune-'));
  try {
    fs.cpSync(path.join(REPO, 'src'), path.join(sandbox, 'src'), { recursive: true });
    fs.symlinkSync(NODE_MODULES, path.join(sandbox, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(sandbox, 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(sandbox, 'config', 'targets.yml'),
      `defaults:\n  retention_weeks: 3\ntargets:\n  - domain: example.gov\n`
    );

    const dataDir = path.join(sandbox, 'data');
    const key = 'example.gov';
    const prunedWeek = weeksAgo(4);   // older than retention, will be pruned
    const retainedWeek = weeksAgo(3); // at boundary, retained

    writeWeek(dataDir, key, prunedWeek, { summary: true });
    writeWeek(dataDir, key, retainedWeek, { summary: true });

    writePage(dataDir, key, prunedWeek, 'p1', {
      pageId: 'p1',
      url: 'https://example.gov/a',
      week: prunedWeek,
      runId: 'run-pruned',
      scannedAt: '2026-01-01T00:00:00.000Z',
      status: 200,
      axe: { violationCount: 1, violations: { 'image-alt': { count: 1 } } }
    });

    writePage(dataDir, key, retainedWeek, 'p1', {
      pageId: 'p1',
      url: 'https://example.gov/a',
      week: retainedWeek,
      runId: 'run-retained',
      scannedAt: '2026-01-08T00:00:00.000Z',
      status: 200,
      unchanged: true,
      since: prunedWeek,
    });

    execFileSync('node', ['src/prune.js'], { cwd: sandbox, stdio: 'pipe' });

    assert.equal(exists(dataDir, key, prunedWeek, 'pages'), false, 'pruned week pages removed');
    const retained = JSON.parse(fs.readFileSync(path.join(dataDir, key, retainedWeek, 'pages', 'p1.json'), 'utf8'));
    assert.equal(retained.unchanged, undefined, 'retained stub promoted to full record');
    assert.equal(retained.since, undefined, 'promoted record no longer points to pruned week');
    assert.equal(retained.axe.violationCount, 1, 'promoted record keeps full finding data');
    assert.equal(retained.week, retainedWeek, 'promoted record keeps retained week attribution');
    assert.equal(retained.runId, 'run-retained', 'promoted record keeps retained run attribution');
    assert.equal(retained.scannedAt, '2026-01-08T00:00:00.000Z', 'promoted record keeps retained timestamp');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
