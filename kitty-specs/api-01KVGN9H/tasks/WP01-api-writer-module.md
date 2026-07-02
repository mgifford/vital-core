---
work_package_id: WP01
title: api-writer module + unit tests
dependencies: []
requirement_refs:
- FR-01
- FR-02
- FR-03
- FR-05
- FR-06
- FR-07
- FR-08
- FR-09
- NFR-01
- NFR-02
- NFR-04
planning_base_branch: public-interest-checks
merge_target_branch: public-interest-checks
branch_strategy: Planning artifacts for this feature were generated on public-interest-checks. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into public-interest-checks unless the human explicitly redirects the landing branch.
subtasks:
- T001
- T002
- T003
- T004
- T005
- T006
history: []
authoritative_surface: src/lib/
execution_mode: code_change
owned_files:
- src/lib/api-writer.js
- tests/unit/api-writer.test.js
tags: []
---

# WP01: api-writer module + unit tests

**Implement with**: `spec-kitty agent action implement WP01 --agent claude --mission api-01KVGN9H`

Create `src/lib/api-writer.js` — a self-contained module that builds and writes the three static JSON API response shapes. No consumers are wired in this WP. No new npm dependencies.

---

### T001: Create `src/lib/api-writer.js` with constants and helpers

**Purpose**: Establish the module with the schema version constant and shared internal helpers.

**Steps**:
1. Create `src/lib/api-writer.js` as a pure ESM module.
2. Define at the top:
   ```js
   export const SCHEMA_VERSION = '1';
   ```
3. Write an internal `severityCounts(bugs)` helper:
   - Accepts an array of bug report objects (each has a `.severity` field: `'Critical'`, `'Serious'`, `'Moderate'`, `'Minor'`)
   - Returns `{ critical_count, serious_count, moderate_count, minor_count, total_findings }`
   - Uses plain iteration, no reduce — keep it readable
4. No exports beyond `SCHEMA_VERSION` yet (helpers are module-private).

**Files**: `src/lib/api-writer.js` (new)
**Validation**: Module imports without error; `severityCounts` returns correct counts for a synthetic array

---

### T002: Implement `buildIndexEntry(target, latestSummary, bugs)`

**Purpose**: Build the single IndexEntry object for one domain used in `index.json`.

**Steps**:
1. Export `function buildIndexEntry(target, latestSummary, bugs)`:
   - `target` — config entry (`target.domain`, `target.key`)
   - `latestSummary` — the most recent week's summary object (`summary.week`, `summary.pagesScanned`)
   - `bugs` — array of bug reports for the latest week
2. Return shape:
   ```js
   {
     domain: target.domain,
     key: target.key,
     latest_week: latestSummary.week,
     pages_scanned: latestSummary.pagesScanned ?? 0,
     critical_count: /* from severityCounts */,
     serious_count:  /* from severityCounts */,
     snapshot_url: `/api/v1/${target.key}/snapshot.json`,
     findings_url: `/api/v1/${target.key}/${latestSummary.week}/findings.json`,
   }
   ```
3. All fields must be present even when counts are 0.

**Files**: `src/lib/api-writer.js`
**Validation**: Returns correct counts and URL strings for synthetic input

---

### T003: Implement `buildSnapshot(target, series, diffs, ledger, invSummary, latestBugs)`

**Purpose**: Build the DomainSnapshot object written to `<domain>/snapshot.json`.

**Steps**:
1. Export `function buildSnapshot(target, series, diffs, ledger, invSummary, latestBugs)`:
   - `series` — array of weekly summaries in order
   - `diffs` — week-over-week diff map (already computed in aggregate)
   - `ledger` — findings ledger (`ledger.findings`)
   - `invSummary` — inventory summary (`{ totalKnownPages, pagesWithKnownIssues }`)
   - `latestBugs` — bugs for the most recent week
2. `const latest = series[series.length - 1]`
3. Return shape:
   ```js
   {
     schema_version: SCHEMA_VERSION,
     domain: target.domain,
     key: target.key,
     generated_at: new Date().toISOString(),
     latest_week: latest.week,
     summary: severityCounts(latestBugs),  // includes pages_scanned
     inventory: invSummary ?? null,
     findings: ledger.findings ?? {},
     tech_findings: latest.techFindings?.associations ?? null,
     weekly: { series, diffs },
   }
   ```
4. Add `pages_scanned: latest.pagesScanned ?? 0` into the `summary` block alongside the severity counts.
5. Do **not** include the per-URL `pages` inventory array — it can be very large. Use `invSummary.totalKnownPages` instead.

**Files**: `src/lib/api-writer.js`
**Validation**: Returns object with `schema_version: '1'` and correct `summary` block

---

### T004: Implement `buildWeekFindings(target, summary, bugs)`

**Purpose**: Build the WeeklyFindings object written to `<domain>/<week>/findings.json`.

**Steps**:
1. Export `function buildWeekFindings(target, summary, bugs)`:
2. Return shape:
   ```js
   {
     schema_version: SCHEMA_VERSION,
     domain: target.domain,
     week: summary.week,
     generated_at: new Date().toISOString(),
     pages_scanned: summary.pagesScanned ?? 0,
     findings: bugs.map(b => ({
       finding_id:    b.pattern_id,
       rule_id:       b.rule_id,
       rule_label:    b.rule_label,
       engine:        b.engine_key,
       severity:      b.severity,
       wcag_sc:       b.wcag_sc ?? null,
       wcag_level:    b.wcag_level ?? null,
       pages_affected: b.frequency.pages_affected,
       trend_status:  deriveTrend(b),
       first_seen:    b.first_seen ?? null,
       last_seen:     b.last_seen ?? null,
       weeks_seen:    b.weeks_seen ?? 1,
     })),
   }
   ```
3. Write a module-private `deriveTrend(bug)` helper that returns `'worsening'` if `b.weeks_seen > 1 && b.frequency.pages_affected > (b.prev_pages ?? 0)`, `'improving'` if fewer pages than before, `'persistent'` if stable across weeks, and `'new'` if `b.weeks_seen <= 1` or `b.first_seen === summary.week`. Use the existing `b.first_seen` / `b.weeks_seen` fields annotated by the findings ledger in `aggregate.js`.

**Files**: `src/lib/api-writer.js`
**Validation**: Each FindingEntry has all required fields; `trend_status` is one of the four valid values

---

### T005: Implement `writeApiFiles(docsDir, indexEntries, snapshots, weekFindings)`

**Purpose**: Orchestrate writing all three API file families to disk.

**Steps**:
1. Export `function writeApiFiles(docsDir, indexEntries, snapshots, weekFindings)`:
   - `docsDir` — absolute path to `docs/` directory (from `DIRS.docs` in aggregate.js)
   - `indexEntries` — array of IndexEntry objects (one per domain)
   - `snapshots` — array of `{ key, data }` objects (one per domain)
   - `weekFindings` — array of `{ key, week, data }` objects (one per domain/week)
2. Implementation:
   ```js
   import fs from 'node:fs';
   import path from 'node:path';

   const apiBase = path.join(docsDir, 'api', 'v1');

   // index.json
   fs.mkdirSync(apiBase, { recursive: true });
   fs.writeFileSync(
     path.join(apiBase, 'index.json'),
     JSON.stringify({ schema_version: SCHEMA_VERSION, domains: indexEntries }, null, 1)
   );

   // per-domain snapshot.json
   for (const { key, data } of snapshots) {
     const dir = path.join(apiBase, key);
     fs.mkdirSync(dir, { recursive: true });
     fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(data, null, 1));
   }

   // per-domain/week findings.json
   for (const { key, week, data } of weekFindings) {
     const dir = path.join(apiBase, key, week);
     fs.mkdirSync(dir, { recursive: true });
     fs.writeFileSync(path.join(dir, 'findings.json'), JSON.stringify(data, null, 1));
   }
   ```
3. Pretty-print all files (`null, 1` indent) per FR-09.

**Files**: `src/lib/api-writer.js`
**Validation**: After calling with a temp dir and synthetic data, all three file paths exist and contain valid JSON

---

### T006: Write unit tests in `tests/unit/api-writer.test.js`

**Purpose**: Verify all exported functions produce correct output shapes without a real aggregate run.

**Steps**:
1. Create `tests/unit/api-writer.test.js` using Node's built-in test runner.
2. Define minimal synthetic fixtures:
   - `FAKE_TARGET = { domain: 'example.gov', key: 'example.gov' }`
   - `FAKE_SUMMARY = { week: '2026-W25', pagesScanned: 100 }`
   - `FAKE_BUG` — one bug with severity `'Serious'`, `pages_affected: 10`, `weeks_seen: 2`, etc.
3. Tests to write (use `node:test` + `node:assert/strict`):
   - `buildIndexEntry` returns correct domain, counts, and URL paths
   - `buildIndexEntry` returns zero counts when bugs array is empty
   - `buildSnapshot` includes `schema_version: '1'`
   - `buildSnapshot` `summary` block has `critical_count`, `serious_count`, `pages_scanned`
   - `buildSnapshot` omits `pages` array (assert `'pages' in result === false`)
   - `buildWeekFindings` maps each bug to a FindingEntry with all required fields
   - `buildWeekFindings` `trend_status` is one of `['new','persistent','worsening','improving']`
   - `writeApiFiles` creates `index.json`, `snapshot.json`, and `findings.json` in a temp dir
     - Use `fs.mkdtempSync` for isolation; clean up in `after()`
     - Parse each file and assert `schema_version === '1'`
4. Run `npm run test:unit` — all existing 91 tests plus new api-writer tests must pass.

**Files**: `tests/unit/api-writer.test.js` (new)
**Validation**: `npm run test:unit` shows all tests pass; no tests skipped
