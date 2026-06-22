#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const failureBuckets = new Map();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function exists(relPath) {
  return existsSync(path.join(repoRoot, relPath));
}

function fail(message) {
  failures.push(message);
}

function failGrouped(key, message) {
  const bucket = failureBuckets.get(key) ?? { message, count: 0, examples: [] };
  bucket.count++;
  failureBuckets.set(key, bucket);
}

function gitTrackedEntries(pathspecs) {
  try {
    const output = execFileSync('git', ['ls-files', '-s', '--', ...pathspecs], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const tabIndex = line.indexOf('\t');
        const meta = line.slice(0, tabIndex).split(/\s+/);
        return { mode: meta[0], relPath: line.slice(tabIndex + 1) };
      });
  } catch (error) {
    fail(`Unable to inspect tracked files with git ls-files: ${error.message}`);
    return [];
  }
}

function assertNoMachineBoundArtifacts() {
  const trackedEntries = gitTrackedEntries([
    '.agents',
    '.github/workflows',
    '.githooks',
    '.kittify',
    'kitty-specs',
    'AGENTS.md',
    'CLAUDE.md',
    'package.json',
    'package-lock.json',
    'scripts/check-spec-kitty-governance.js',
  ]);

  for (const entry of trackedEntries) {
    if (entry.mode === '120000') {
      const target = readlinkSync(path.join(repoRoot, entry.relPath));
      if (path.isAbsolute(target)) {
        failGrouped('machine-local-symlinks', `${entry.relPath}: symlink target is machine-local (${target})`);
      }
    }
  }

  const machinePathPatterns = [
    /\/Users\/[^\s"'`)]+/,
    /\/home\/[^\s"'`)]+/,
    /[A-Za-z]:\\Users\\[^\s"'`)]+/,
    /Documents\/Codex\//,
    /Library\/Python\/.*site-packages/,
    /\.local\/pipx\/venvs\//,
  ];

  const textFilePattern = /\.(?:cjs|csv|gitignore|json|jsonl|js|md|mjs|sh|txt|ya?ml)$/;

  for (const entry of trackedEntries) {
    if (entry.mode === '120000' || !textFilePattern.test(entry.relPath)) {
      continue;
    }

    const text = read(entry.relPath);
    for (const pattern of machinePathPatterns) {
      if (pattern.test(text)) {
        const lineNumber = text.split('\n').findIndex((line) => pattern.test(line)) + 1;
        failGrouped(`machine-path:${entry.relPath}`, `${entry.relPath}:${lineNumber}: remove machine-local absolute path`);
      }
    }
  }
}

function checkRequiredFiles() {
  const requiredFiles = [
    '.kittify/charter/directives.yaml',
    '.kittify/charter/governance.yaml',
    '.github/workflows/spec-kitty-governance.yml',
    'kitty-specs/AGENT_SURFACES.md',
    'kitty-specs/OPERATING_NOTES.md',
  ];

  for (const relPath of requiredFiles) {
    if (!exists(relPath)) {
      fail(`${relPath}: missing required Spec Kitty governance artifact`);
    }
  }

  if (exists('.kittify/charter/interview/answers.yaml')) {
    const text = read('.kittify/charter/interview/answers.yaml');
    if (!text.includes('selected_directives:') || text.includes('selected_directives: []')) {
      fail('.kittify/charter/interview/answers.yaml: selected_directives is empty');
    }
  }

  if (exists('kitty-specs/AGENT_SURFACES.md') && !read('kitty-specs/AGENT_SURFACES.md').includes('spec-kitty agent config sync --create-missing')) {
    fail('kitty-specs/AGENT_SURFACES.md: missing fresh-machine agent sync bootstrap command');
  }

  if (exists('kitty-specs/OPERATING_NOTES.md') && !read('kitty-specs/OPERATING_NOTES.md').includes('npm run check:spec-kitty')) {
    fail('kitty-specs/OPERATING_NOTES.md: missing validation command reference');
  }
}

assertNoMachineBoundArtifacts();
checkRequiredFiles();

for (const bucket of failureBuckets.values()) {
  if (bucket.count === 1) {
    fail(bucket.message);
    continue;
  }
  const examples = bucket.message;
  const grouped = bucket.message.startsWith('.agents/skills/')
    ? `Tracked symlinks point at machine-local paths (${bucket.count} files). Example: ${examples}`
    : `${bucket.message} (${bucket.count} occurrences)`;
  fail(grouped);
}

if (failures.length > 0) {
  console.error('Spec Kitty governance check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Spec Kitty governance check passed.');