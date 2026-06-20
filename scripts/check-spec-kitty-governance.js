#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
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

function exists(relPath) {
  return existsSync(path.join(repoRoot, relPath));
}

function fail(message) {
  failures.push(message);
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

function parseJson(relPath) {
  try {
    return JSON.parse(read(relPath));
  } catch (error) {
    fail(`${relPath}: invalid JSON: ${error.message}`);
    return {};
  }
}

function parseYaml(relPath) {
  try {
    return YAML.parse(read(relPath)) ?? {};
  } catch (error) {
    fail(`${relPath}: invalid YAML: ${error.message}`);
    return {};
  }
}

function lineNumberFor(text, pattern) {
  const lines = text.split('\n');
  const index = lines.findIndex((line) => pattern.test(line));
  return index === -1 ? null : index + 1;
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
      fail(`${entry.relPath}: tracked symlinks are not portable across fresh checkouts`);
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
      const line = lineNumberFor(text, pattern);
      if (line !== null) {
        fail(`${entry.relPath}:${line}: remove machine-local absolute path`);
      }
    }
  }
}

function refsFromSpec(specText) {
  return new Set([...specText.matchAll(/\b(?:FR|NFR|C)-\d+\b/g)].map((match) => match[0]));
}

function validateMissionBundle(missionDir) {
  const relDir = `kitty-specs/${missionDir}`;
  const wpsPath = `${relDir}/wps.yaml`;
  if (!exists(wpsPath)) {
    return;
  }

  for (const required of ['acceptance-matrix.json', 'meta.json', 'plan.md', 'spec.md', 'tasks.md']) {
    if (!exists(`${relDir}/${required}`)) {
      fail(`${relDir}: mission with wps.yaml is missing ${required}`);
    }
  }

  const wps = parseYaml(wpsPath);
  const workPackages = wps.work_packages ?? [];
  if (!Array.isArray(workPackages) || workPackages.length === 0) {
    fail(`${wpsPath}: work_packages must be a non-empty array`);
    return;
  }

  const meta = exists(`${relDir}/meta.json`) ? parseJson(`${relDir}/meta.json`) : {};
  if (meta.slug !== missionDir || meta.mission_slug !== missionDir) {
    fail(`${relDir}/meta.json: slug and mission_slug must match directory name`);
  }

  const specText = exists(`${relDir}/spec.md`) ? read(`${relDir}/spec.md`) : '';
  const specRefs = refsFromSpec(specText);
  const tasksText = exists(`${relDir}/tasks.md`) ? read(`${relDir}/tasks.md`) : '';
  const seenWpIds = new Set();
  const referencedPrompts = new Set();
  const wpRequirementRefs = new Set();

  for (const wp of workPackages) {
    if (!wp.id || seenWpIds.has(wp.id)) {
      fail(`${wpsPath}: work package ids must be present and unique`);
      continue;
    }
    seenWpIds.add(wp.id);

    if (!wp.title) {
      fail(`${wpsPath}: ${wp.id} is missing title`);
    }

    for (const dependency of wp.dependencies ?? []) {
      if (!workPackages.some((candidate) => candidate.id === dependency)) {
        fail(`${wpsPath}: ${wp.id} depends on unknown ${dependency}`);
      }
    }

    for (const ref of wp.requirement_refs ?? []) {
      wpRequirementRefs.add(ref);
      if (!specRefs.has(ref)) {
        fail(`${wpsPath}: ${wp.id} references ${ref}, but spec.md does not define it`);
      }
    }

    if (!wp.prompt_file) {
      fail(`${wpsPath}: ${wp.id} is missing prompt_file`);
    } else {
      referencedPrompts.add(wp.prompt_file);
      if (!exists(`${relDir}/${wp.prompt_file}`)) {
        fail(`${wpsPath}: ${wp.id} prompt_file ${wp.prompt_file} does not exist`);
      }
      if (!tasksText.includes(`Work Package ${wp.id}: ${wp.title}`)) {
        fail(`${relDir}/tasks.md: missing generated row for ${wp.id}`);
      }
      if (!tasksText.includes(wp.prompt_file)) {
        fail(`${relDir}/tasks.md: missing prompt reference for ${wp.id}`);
      }
    }
  }

  const extraPromptFiles = exists(`${relDir}/tasks`)
    ? readdirSync(path.join(repoRoot, relDir, 'tasks'))
        .filter((file) => /^WP.*\.md$/.test(file))
        .map((file) => `tasks/${file}`)
        .filter((file) => !referencedPrompts.has(file))
    : [];
  for (const promptFile of extraPromptFiles) {
    fail(`${relDir}/${promptFile}: prompt file is not referenced by wps.yaml`);
  }

  if (exists(`${relDir}/acceptance-matrix.json`)) {
    const matrix = parseJson(`${relDir}/acceptance-matrix.json`);
    if (matrix.mission_slug !== missionDir) {
      fail(`${relDir}/acceptance-matrix.json: mission_slug must match directory name`);
    }
    const criteria = matrix.criteria ?? [];
    if (!Array.isArray(criteria) || criteria.length === 0) {
      fail(`${relDir}/acceptance-matrix.json: criteria must be a non-empty array`);
    }
    for (const criterion of criteria) {
      if (!criterion.criterion_id) {
        fail(`${relDir}/acceptance-matrix.json: every criterion needs criterion_id`);
        continue;
      }
      if (!specRefs.has(criterion.criterion_id)) {
        fail(`${relDir}/acceptance-matrix.json: ${criterion.criterion_id} is not defined in spec.md`);
      }
      if (!wpRequirementRefs.has(criterion.criterion_id)) {
        fail(`${relDir}/acceptance-matrix.json: ${criterion.criterion_id} is not covered by wps.yaml`);
      }
      if (criterion.pass_fail !== 'pass') {
        fail(`${relDir}/acceptance-matrix.json: ${criterion.criterion_id} is not marked pass`);
      }
    }
  }
}

assertNoMachineBoundArtifacts();

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

if (!exists('.github/workflows/spec-kitty-governance.yml')) {
  fail('.github/workflows/spec-kitty-governance.yml: missing CI gate for npm run check:spec-kitty');
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

for (const name of readdirSync(path.join(repoRoot, 'kitty-specs'))) {
  if (statSync(path.join(repoRoot, 'kitty-specs', name)).isDirectory()) {
    validateMissionBundle(name);
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
