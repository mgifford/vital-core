#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

const expectedDirectives = [
  ['DIR-001', 'Keep specification, plan, tasks, implementation, and review artifacts consistent.'],
  ['DIR-002', 'Run npm run test:unit before merge, and run npm run test:e2e for scanner or aggregation pipeline changes.'],
  ['DIR-003', 'Never commit .env files, authentication tokens, secrets, local data paths, or Hugging Face state paths.'],
  ['DIR-004', 'Severity labels must use axe taxonomy: Critical / Serious / Moderate / Minor.'],
  ['DIR-005', 'Engine modules go in `src/engines/`; wire new engines into `src/scan.js`, `src/aggregate.js`, and target sampling config.'],
  ['DIR-006', 'Report UI CSS changes go in `src/report-html.js` (the CSS string constant), never generated files under `docs/`.'],
  ['DIR-007', 'Default reports show Critical/Serious WCAG A and AA findings plus Moderate/Minor findings affecting 10 or more pages; Best Practice findings stay hidden until Show everything is selected.'],
];

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function fail(message) {
  failures.push(message);
}

function walkFiles(relDir) {
  const absDir = path.join(repoRoot, relDir);
  const files = [];
  for (const name of readdirSync(absDir)) {
    const absPath = path.join(absDir, name);
    const relPath = path.relative(repoRoot, absPath);
    if (statSync(absPath).isDirectory()) {
      files.push(...walkFiles(relPath));
    } else {
      files.push(relPath);
    }
  }
  return files;
}

function parseFrontmatter(markdown, relPath) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    fail(`${relPath}: missing YAML frontmatter`);
    return {};
  }
  try {
    return YAML.parse(match[1]) ?? {};
  } catch (error) {
    fail(`${relPath}: invalid YAML frontmatter: ${error.message}`);
    return {};
  }
}

const directives = YAML.parse(read('.kittify/charter/directives.yaml'))?.directives ?? [];
const governance = YAML.parse(read('.kittify/charter/governance.yaml')) ?? {};
const interview = YAML.parse(read('.kittify/charter/interview/answers.yaml')) ?? {};
const descriptions = new Map(directives.map((directive) => [directive.id, directive.description]));
const selected = new Set(governance.doctrine?.selected_directives ?? []);
const interviewSelected = new Set(interview.selected_directives ?? []);

for (const [id, description] of expectedDirectives) {
  if (descriptions.get(id) !== description) {
    fail(`Missing or changed project directive ${id}`);
  }
  if (!selected.has(id)) {
    fail(`Governance does not select project directive ${id}`);
  }
  if (!interviewSelected.has(id)) {
    fail(`Charter interview source does not select project directive ${id}`);
  }
}

const docsToCheck = [
  'AGENTS.md',
  'CLAUDE.md',
  'kitty-specs/AGENT_SURFACES.md',
  'kitty-specs/OPERATING_NOTES.md',
  '.kittify/memory/templates/POWERSHELL_SYNTAX.md',
];

for (const relPath of docsToCheck) {
  if (existsSync(path.join(repoRoot, relPath)) && read(relPath).includes('spec-kitty agent workflow')) {
    fail(`${relPath}: stale "spec-kitty agent workflow" command`);
  }
}

if (!read('kitty-specs/AGENT_SURFACES.md').includes('spec-kitty agent config sync --create-missing')) {
  fail('kitty-specs/AGENT_SURFACES.md: missing fresh-machine agent sync bootstrap command');
}

for (const relPath of walkFiles('kitty-specs').filter((file) => /\/tasks\/WP.*\.md$/.test(file))) {
  const text = read(relPath);
  const isReconstructed = text.includes('Reconstructed shipped work package') || text.includes('- reconstructed\n- shipped');
  if (!isReconstructed) {
    continue;
  }
  const frontmatter = parseFrontmatter(text, relPath);
  if (frontmatter.execution_mode !== 'planning_artifact') {
    fail(`${relPath}: reconstructed WP must use execution_mode: planning_artifact`);
  }
  if (frontmatter.scope !== 'codebase-wide') {
    fail(`${relPath}: reconstructed WP must use scope: codebase-wide`);
  }
  if (!Array.isArray(frontmatter.owned_files) || frontmatter.owned_files.length === 0) {
    fail(`${relPath}: reconstructed WP must preserve historical owned_files`);
  }
  if (frontmatter.owned_files.some((file) => file.startsWith('kitty-specs/'))) {
    fail(`${relPath}: reconstructed WP owned_files must not point at kitty-specs paths`);
  }
  if (!text.includes('## Historical Implementation Files')) {
    fail(`${relPath}: reconstructed WP must preserve a Historical Implementation Files section`);
  }
  if (text.includes('**Implement with**')) {
    fail(`${relPath}: reconstructed WP must not include an active Implement with command`);
  }
  if (!text.includes('Archive-only')) {
    fail(`${relPath}: reconstructed WP must start with an Archive-only warning`);
  }
}

if (failures.length > 0) {
  console.error('Spec Kitty governance check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Spec Kitty governance check passed.');
