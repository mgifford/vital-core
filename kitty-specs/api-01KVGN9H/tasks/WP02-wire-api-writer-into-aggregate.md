---
work_package_id: WP02
title: Wire api-writer into aggregate.js
dependencies:
- WP01
requirement_refs:
- FR-04
- FR-08
- C-01
- C-02
- C-04
planning_base_branch: public-interest-checks
merge_target_branch: public-interest-checks
branch_strategy: Planning artifacts for this feature were generated on public-interest-checks. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into public-interest-checks unless the human explicitly redirects the landing branch.
subtasks:
- T007
- T008
- T009
history: []
authoritative_surface: src/
execution_mode: code_change
owned_files:
- src/aggregate.js
tags: []
---

# WP02: Wire api-writer into aggregate.js

**Implement with**: `spec-kitty agent action implement WP02 --agent claude --mission api-01KVGN9H`

**Requires WP01** to be merged first (`src/lib/api-writer.js` and its tests must exist).

Integrate `writeApiFiles` into the existing aggregate run. The aggregate loop already builds the data needed — this WP threads it through to the new API writer with minimal changes to `src/aggregate.js`.

---

### T007: Import api-writer and accumulate per-domain data during the aggregate loop

**Purpose**: Thread API data collection through the existing domain loop without restructuring it.

**Context**: Read `src/aggregate.js` before making changes. Key variables in the domain loop (around line 95–280):
- `target` — domain config entry with `target.domain` and `target.key`
- `bugs` — array of bug reports computed per domain
- `series` / `diffs` — weekly summary series already assembled
- `ledger` — findings ledger object
- `invSummary` — inventory summary (may be `null` if no inventory data)
- `latest` — the most recent summary object (`series[series.length - 1]`)

**Steps**:
1. At the top of `src/aggregate.js`, add the import alongside existing lib imports:
   ```js
   import { buildIndexEntry, buildSnapshot, buildWeekFindings, writeApiFiles } from './lib/api-writer.js';
   ```
2. Before the domain loop begins, initialize three accumulator arrays:
   ```js
   const apiIndexEntries = [];
   const apiSnapshots = [];
   const apiWeekFindings = [];
   ```
3. Inside the per-domain loop, after `bugs` and `series` are computed and before the HTML render call, append to accumulators:
   ```js
   const latestSummary = series[series.length - 1];
   apiIndexEntries.push(buildIndexEntry(target, latestSummary, bugs));
   apiSnapshots.push({ key: target.key, data: buildSnapshot(target, series, diffs, ledger, invSummary ?? null, bugs) });
   ```
4. Do **not** call `buildWeekFindings` inside the per-domain loop — that happens in T008 where the per-week data is available.

**Files**: `src/aggregate.js`
**Validation**: `npm run test:unit` continues to pass; no syntax errors

---

### T008: Collect per-week findings and wire `writeApiFiles` call at end of aggregate

**Purpose**: Build per-week findings objects and emit all API files once after the domain loop.

**Context**: In `src/aggregate.js`, look for where weekly data is iterated. The existing `weekly.json` write (around line 290) shows the pattern — each week's `bugs` / `summary` is available there.

**Steps**:
1. Inside the per-week loop (where weekly JSON is already written), collect findings:
   ```js
   apiWeekFindings.push({
     key: target.key,
     week: summary.week,
     data: buildWeekFindings(target, summary, bugs),
   });
   ```
   Place this immediately after the existing weekly data is computed, before any file writes. Only collect weeks that have `bugs` — skip if `bugs` is empty or undefined.

2. After the domain loop ends and all existing files are written (after `renderIndex` or equivalent), add:
   ```js
   writeApiFiles(DIRS.docs, apiIndexEntries, apiSnapshots, apiWeekFindings);
   ```
   Where `DIRS.docs` is the existing docs directory path constant (verify the exact name in aggregate.js — it may be `DIRS.docs`, `DOCS_DIR`, or similar).

3. Do not alter any existing logic — only append the accumulator pushes and the single `writeApiFiles` call.

**Files**: `src/aggregate.js`
**Validation**: No existing output changed; new `docs/api/v1/` files appear when aggregate runs locally

---

### T009: Run unit tests and verify the wiring compiles cleanly

**Purpose**: Confirm the import and accumulator wiring doesn't break existing functionality.

**Steps**:
1. Run `npm run test:unit` — all 91 original tests plus the new api-writer tests must pass.
2. Verify no import errors:
   ```bash
   node --input-type=module <<'EOF'
   import './src/aggregate.js';
   EOF
   ```
   Expect no thrown errors (the file uses top-level await — it will actually run aggregate; pipe to `/dev/null` or use `--dry-run` if available, otherwise just confirm it exits 0 or fails only on missing data).
3. If a dry-run or local data is available, run `npm run aggregate` and confirm:
   - `docs/api/v1/index.json` exists and contains `{ schema_version: "1", domains: [...] }`
   - `docs/api/v1/<domain-key>/snapshot.json` exists for at least one domain
   - `docs/api/v1/<domain-key>/<week>/findings.json` exists for at least one domain/week
4. If no local data is available, skip the live aggregate run and note it in the commit message.

**Files**: none (validation only)
**Validation**: `npm run test:unit` passes; import check exits without error
