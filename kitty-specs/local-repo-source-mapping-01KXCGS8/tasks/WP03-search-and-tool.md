---
work_package_id: WP03
title: Bounded search + the tool
dependencies:
- WP01
- WP02
requirement_refs:
- FR-001
- FR-006
- FR-007
- FR-008
- FR-009
- NFR-001
- NFR-002
- NFR-003
tracker_refs: []
planning_base_branch: claude/vital-core-issue-214-spec-m237h3
merge_target_branch: claude/vital-core-issue-214-spec-m237h3
branch_strategy: Planning artifacts for this mission were generated on claude/vital-core-issue-214-spec-m237h3. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/vital-core-issue-214-spec-m237h3 unless the human explicitly redirects the landing branch.
subtasks:
- T008
- T009
- T010
- T011
agent: ''
shell_pid: 0
history: []
authoritative_surface: mcp/local/search.js
create_intent:
- mcp/local/search.js
- mcp/local/default-ignore.js
- mcp/tools/find-probable-sources.js
execution_mode: code_change
owned_files:
- mcp/local/search.js
- mcp/local/default-ignore.js
- mcp/tools/find-probable-sources.js
- mcp/server.js
tags: []
---

## ⚡ Do This First: Load Agent Profile

Before reading anything else in this prompt, load the assigned agent profile
(see this WP's frontmatter `agent_profile`/`role` if set) via the
`ad-hoc-profile-load` skill/command. If no profile is assigned, proceed as a
general implementer.

## Objective

Implement the bounded filesystem search (`mcp/local/search.js`), the
default-ignore list (`mcp/local/default-ignore.js`), and the
`vital_find_probable_sources` tool itself (`mcp/tools/find-probable-sources.js`),
then register it in `mcp/server.js`. This WP wires together WP01's
resolved config fields and WP02's boundary/signal modules into the actual
user-facing feature.

Read `kitty-specs/local-repo-source-mapping-01KXCGS8/spec.md` (FR-001,
FR-006 through FR-009, NFR-001 through NFR-003) and `plan.md`'s "Design →
Bounded search" and "Design → The tool" subsections before starting.

## Context: what WP01 and WP02 produced (read their actual merged diffs, not just this summary)

From WP01, `resolveVitalConfig()` now returns (in addition to the
existing `apiBase`/`domain`/`host`/`warnings`): `readRepository`
(boolean), `repositoryPath` (absolute string or `null`),
`ignorePatterns` (array). Available on `ctx.config` at tool-call time
(same as every existing field).

From WP02:
- `mcp/security/path-allowlist.js` exports `assertPathWithinRoot(targetPath, allowedRoot)` — throws if `targetPath`'s realpath is outside `allowedRoot`'s realpath; returns the resolved (symlink-following) real path on success.
- `mcp/local/signals.js` exports `extractSignals(finding)` — pure function, returns `[{ type, value }, ...]` with types `css_class`, `css_id`, `data_attr`, `asset_url`, `text`.

From the existing phase-1 tools, `mcp/tools/get-finding-context.js`'s
handler shows how a finding is fetched by id:

```js
const week = args.week ?? (await resolveLatestWeek(ctx));
const doc = await ctx.apiClient.getFindings(ctx.config.domain, week);
const finding = (doc.findings ?? []).find((f) => f.finding_id === args.finding_id);
```

Reuse this exact fetch pattern (via `resolveLatestWeek` from
`mcp/tools/shared.js` and `ctx.apiClient`) — do not duplicate or
reimplement finding lookup; import and call the same helper, or if you
judge it cleaner, extract the fetch-by-id logic itself into
`mcp/tools/shared.js` as a small reusable function
(`fetchFindingById(ctx, findingId, week)`) that both
`get-finding-context.js` and `find-probable-sources.js` call — your
choice, but do not have two independent copies of this lookup logic.

## Subtasks

### T008: `mcp/local/default-ignore.js`.

**Files**: `mcp/local/default-ignore.js` (new file)

```js
// Directories never searched, regardless of local.ignore_patterns config
// (that config adds to this list, never replaces it) — spec.md FR-009.
export const DEFAULT_IGNORE_DIRS = ['node_modules', '.git', '.svn', 'vendor', 'dist', 'build'];

// File extensions skipped without reading content (binary/asset files —
// never the source of a project's own markup) — spec.md FR-009.
export const DEFAULT_IGNORE_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.zip', '.tar', '.gz', '.pdf',
  '.mp4', '.mp3', '.webm',
];

export function isIgnoredDir(dirName, extraPatterns = []) {
  return DEFAULT_IGNORE_DIRS.includes(dirName) || extraPatterns.includes(dirName);
}

export function isIgnoredFile(fileName) {
  const ext = fileName.slice(fileName.lastIndexOf('.'));
  return DEFAULT_IGNORE_EXTENSIONS.includes(ext.toLowerCase());
}
```

Reconsider whether `dist`/`build` belong in the *directory-name* ignore
list vs. `.git`/`node_modules`/`vendor` (which are unambiguous) — a
project's dist/build output might occasionally be relevant to search
depending on repo conventions, but per spec.md's default-conservative
posture (skip build artifacts by default, since they're rarely hand-
edited source), keeping them in the default list is the right call;
`local.ignore_patterns` lets a user narrow further if needed, but there
is currently no config field to *widen* past the DEFAULT_IGNORE_DIRS list
if a user actually wants `node_modules` searched — that's fine and
matches spec.md's scope (FR-009 doesn't ask for an override of the hard
defaults, only additions via `local.ignore_patterns`).

### T009: `searchForSignals()` in `mcp/local/search.js`.

**Files**: `mcp/local/search.js` (new file)

```js
import fs from 'node:fs';
import path from 'node:path';
import { assertPathWithinRoot } from '../security/path-allowlist.js';
import { isIgnoredDir, isIgnoredFile, DEFAULT_IGNORE_DIRS } from './default-ignore.js';

const DEFAULT_MAX_FILES = 5000;
const DEFAULT_MAX_FILE_SIZE_BYTES = 1_000_000; // 1 MB
const DEFAULT_RESULT_CAP = 20;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tierFor(distinctTypeCount) {
  if (distinctTypeCount >= 3) return 'high';
  if (distinctTypeCount === 2) return 'medium';
  return 'low'; // distinctTypeCount === 1 (0 means the file wasn't a candidate at all)
}

export function searchForSignals(repositoryRoot, signals, options = {}) {
  const {
    maxFiles = DEFAULT_MAX_FILES,
    maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE_BYTES,
    ignorePatterns = [],
    resultCap = DEFAULT_RESULT_CAP,
  } = options;

  if (signals.length === 0) return [];

  // Precompute a regex per signal for literal matching (escaped — never
  // interpreted as a user-controlled regex, spec.md NFR-04).
  const compiledSignals = signals.map((s) => ({ ...s, re: new RegExp(escapeRegex(s.value)) }));

  const results = []; // { relPath, matchedSignals: [...], types: Set }
  let filesVisited = 0;
  const stack = [repositoryRoot];

  while (stack.length > 0 && filesVisited < maxFiles) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir — skip, don't crash the whole search
    }
    for (const entry of entries) {
      if (filesVisited >= maxFiles) break;
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (isIgnoredDir(entry.name, ignorePatterns)) continue;
        // Boundary check on every directory descended into — cheap
        // relative to the cost of a full walk, and closes any gap where
        // a directory-level symlink could otherwise be traversed before
        // a file-level check catches it.
        try {
          assertPathWithinRoot(entryPath, repositoryRoot);
        } catch {
          continue; // outside the root (e.g. symlink escape) — skip silently, do not throw and abort the whole search
        }
        stack.push(entryPath);
        continue;
      }

      if (!entry.isFile()) continue; // skip other types (sockets, devices, etc.)
      if (isIgnoredFile(entry.name)) continue;

      filesVisited++;

      let resolvedPath;
      try {
        resolvedPath = assertPathWithinRoot(entryPath, repositoryRoot);
      } catch {
        continue; // symlink escape at the file level — skip
      }

      let stat;
      try {
        stat = fs.statSync(resolvedPath);
      } catch {
        continue;
      }
      if (stat.size > maxFileSizeBytes) continue;

      let content;
      try {
        content = fs.readFileSync(resolvedPath, 'utf8');
      } catch {
        continue; // e.g. genuinely binary despite extension check, or a permissions error
      }

      const matchedTypes = new Set();
      const matchedSignals = [];
      for (const sig of compiledSignals) {
        if (sig.re.test(content)) {
          matchedTypes.add(sig.type);
          matchedSignals.push({ type: sig.type, value: sig.value });
        }
      }
      if (matchedSignals.length > 0) {
        results.push({
          path: path.relative(repositoryRoot, resolvedPath),
          confidence: tierFor(matchedTypes.size),
          matched_signals: matchedSignals,
          _distinctTypeCount: matchedTypes.size, // sort key only, stripped before return
        });
      }
    }
  }

  const TIER_RANK = { high: 0, medium: 1, low: 2 };
  results.sort((a, b) => {
    const t = TIER_RANK[a.confidence] - TIER_RANK[b.confidence];
    if (t !== 0) return t;
    return b._distinctTypeCount - a._distinctTypeCount;
  });

  return results.slice(0, resultCap).map(({ _distinctTypeCount, ...r }) => r);
}
```

Notes:
- `path` in returned results is **relative to `repositoryRoot`**
  (`path.relative(...)`), never the absolute filesystem path — this is
  FR-006's requirement, avoiding leaking host filesystem layout beyond
  what the user already configured.
- The confidence-tier thresholds (`>=3` distinct types → `high`, `2` →
  `medium`, `1` → `low`) are this plan's chosen values (plan.md's Design
  section flags these as a plan-level decision, not spec-fixed). If
  WP04's testing against spec.md Scenario 1 (a single distinctive class
  match should be at least `medium`, ideally `high`) or Scenario 3 (one
  common class alone should be `low`, never higher) reveals these
  thresholds don't produce the right qualitative outcome, adjust the
  thresholds here — the *qualitative* requirement (NFR-002) is binding,
  the specific numbers are not.
- `filesVisited` counts every file examined (matched or not) toward
  `maxFiles`, satisfying FR-008's "bounded regardless of match count"
  requirement — an unbounded walk with zero matches would otherwise still
  be a resource-exhaustion vector.
- Directory-traversal order uses a stack (DFS), not `fs.readdirSync(dir,
  { recursive: true })`'s built-in recursion, specifically so the
  per-directory `assertPathWithinRoot` symlink check can run *before*
  descending into a subdirectory, not after a recursive call has already
  read it.

### T010: `vital_find_probable_sources` tool.

**Files**: `mcp/tools/find-probable-sources.js` (new file)

```js
import { resolveLatestWeek } from './shared.js';
import { extractSignals } from '../local/signals.js';
import { searchForSignals } from '../local/search.js';

export const findProbableSourcesTool = {
  name: 'vital_find_probable_sources',
  description:
    'Search the local repository checkout for files that probably produced a finding\'s rendered output. ' +
    'Returns ranked candidates with a confidence tier (high/medium/low) and the specific matched signals — ' +
    'this is a probabilistic estimate, NOT certain attribution; multiple candidates or low confidence are ' +
    'normal and expected, verify manually before assuming a result is correct. ' +
    'Requires "permissions.read_repository: true" and "local.repository_path" in .vital.yml; ' +
    'returns a permission-disabled refusal otherwise.',
  inputSchema: {
    type: 'object',
    properties: {
      finding_id: {
        type: 'string',
        description: 'The VS-<hash> finding identifier, as returned by vital_list_findings.',
      },
      week: {
        type: 'string',
        description: "ISO week (YYYY-Www). Defaults to the domain's latest available week.",
      },
    },
    required: ['finding_id'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    if (!args?.finding_id || typeof args.finding_id !== 'string') {
      throw new Error('vital_find_probable_sources requires a "finding_id" string.');
    }
    if (!ctx.config.readRepository) {
      return {
        found: false,
        reason: 'permission_disabled',
        message: 'Local repository search is disabled. Set "permissions.read_repository: true" and "local.repository_path" in .vital.yml to enable vital_find_probable_sources.',
      };
    }

    const week = args.week ?? (await resolveLatestWeek(ctx));
    const doc = await ctx.apiClient.getFindings(ctx.config.domain, week);
    const finding = (doc.findings ?? []).find((f) => f.finding_id === args.finding_id);
    if (!finding) {
      return {
        found: false,
        reason: 'finding_not_found',
        finding_id: args.finding_id,
        week,
        message: `No finding "${args.finding_id}" in week ${week} for domain "${ctx.config.domain}".`,
      };
    }

    const signals = extractSignals(finding);
    const candidates = searchForSignals(ctx.config.repositoryPath, signals, {
      ignorePatterns: ctx.config.ignorePatterns,
    });

    return {
      found: true,
      finding_id: args.finding_id,
      week,
      signal_count: signals.length,
      candidate_count: candidates.length,
      candidates,
    };
  },
};
```

Compare this against `mcp/tools/get-finding-context.js`'s existing
handler shape before finalizing — the finding-fetch block above is
intentionally near-identical to that file's logic; if you chose to
extract a shared `fetchFindingById` helper in `mcp/tools/shared.js` per
this WP's Context section, use it here instead of inlining the fetch a
second time.

### T011: Register the tool.

**Files**: `mcp/server.js`

```js
import { findProbableSourcesTool } from './tools/find-probable-sources.js';
// ...
export const TOOLS = [getProjectContextTool, listFindingsTool, getFindingContextTool, findProbableSourcesTool];
```

No other change to `server.js` — `callTool`'s existing generic
try/catch + `isError` handling already covers any thrown error from this
tool's handler or from `assertPathWithinRoot` bubbling up unexpectedly.

**Validation**: `node -e "import('./mcp/server.js').then(m => console.log(m.TOOLS.map(t => t.name)))"`
lists all four tools including `vital_find_probable_sources`.

## Definition of Done

- [ ] `searchForSignals()` respects `maxFiles`/`maxFileSizeBytes` bounds, skips `DEFAULT_IGNORE_DIRS` and binary extensions, honors `ignorePatterns`.
- [ ] Every file read goes through `assertPathWithinRoot` before its content is read (no bypass path).
- [ ] Confidence tiers are computed from distinct signal *types* matched, not raw match count.
- [ ] Results are capped at `resultCap` (default 20) and sorted by tier then distinct-type count.
- [ ] `vital_find_probable_sources` returns a clean `permission_disabled` refusal when `ctx.config.readRepository` is `false` — no filesystem access attempted in that path.
- [ ] The tool is registered in `mcp/server.js`'s `TOOLS` array.
- [ ] `npm run check:spec-kitty` passes. (Full `npm run test:unit` is WP04's gate — this WP's own manual/smoke validation is sufficient here, since WP04 owns the dedicated `search.test.js`/`find-probable-sources.test.js` files, but do not leave anything in a state that fails to *load*/parse.)

## Risks

- **The permission-refusal path (T010) must short-circuit before any
  filesystem call** — if `ctx.config.readRepository` is checked *after*
  any part of the search logic runs, that's a bug even if the end result
  looks the same for a disabled config, because it means the "off by
  default" guarantee (C-001) isn't structurally enforced, just
  incidentally true today.
- Confidence-tier threshold tuning (the `>=3`/`2`/`1` cutoffs) is a
  judgment call — don't treat the numbers in T009's code as sacred;
  WP04's tests against the spec's actual scenarios are the real
  acceptance bar, and this WP's implementer should feel free to adjust
  the thresholds if WP04 (or manual testing during this WP) shows they
  produce an unintuitive result.
- The stack-based walk in `searchForSignals` must not be replaced with
  `fs.readdirSync(dir, { recursive: true })` — that Node API doesn't give
  you a hook to check each directory's boundary *before* recursing into
  it, which would reopen the symlink-escape gap WP02 closed.

## Reviewer Guidance

Confirm: (1) `ctx.config.readRepository === false` genuinely short-
circuits before touching `fs` at all; (2) every `fs.readFileSync` call
site in `search.js` is preceded by `assertPathWithinRoot`; (3) the
`maxFiles` bound counts all visited files, not just matched ones; (4)
result `path` values are relative to `repositoryRoot`, never absolute;
(5) the tool is registered and callable end-to-end (a quick `node -e`
smoke check, not just a code read).
