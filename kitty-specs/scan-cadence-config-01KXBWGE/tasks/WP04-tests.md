---
work_package_id: WP04
title: Tests
dependencies:
- WP02
- WP03
requirement_refs:
- NFR-001
- NFR-002
- NFR-003
tracker_refs: []
planning_base_branch: claude/vital-core-issue-214-spec-m237h3
merge_target_branch: claude/vital-core-issue-214-spec-m237h3
branch_strategy: Planning artifacts for this mission were generated on claude/vital-core-issue-214-spec-m237h3. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/vital-core-issue-214-spec-m237h3 unless the human explicitly redirects the landing branch.
subtasks:
- T012
- T013
- T014
- T015
agent: ''
shell_pid: 0
history: []
authoritative_surface: tests/unit/lib.test.js
create_intent: []
execution_mode: code_change
owned_files:
- tests/unit/lib.test.js
tags: []
---

## ⚡ Do This First: Load Agent Profile

Before reading anything else in this prompt, load the assigned agent profile
(see this WP's frontmatter `agent_profile`/`role` if set) via the
`ad-hoc-profile-load` skill/command. If no profile is assigned, proceed as a
general implementer.

## Objective

Update the existing `pickBatch`/`budgetStatus`/`addPage` tests in
`tests/unit/lib.test.js` to WP02's new `now`-based signatures (preserving
every currently-asserted *outcome*), and add new tests covering config
defaults/overrides, elapsed-day eligibility boundaries, domain cadence, and
backward compatibility with legacy state shapes, per spec.md NFR-001 and
NFR-002.

**Read `kitty-specs/scan-cadence-config-01KXBWGE/spec.md`'s NFR-001,
NFR-002, and NFR-003 in full before starting** — they enumerate exactly
which scenarios must be covered.

## Context: exact tests to update (read before editing)

`tests/unit/lib.test.js` currently has these `pickBatch`/`budgetStatus`/
`addPage` tests (line numbers as of this WP's authoring — re-verify against
your checkout, since WP01–WP03 don't touch this file but line numbers can
still drift from unrelated concurrent work):

- Line 137-158: `'pickBatch: never-scanned first, weekly cap respected, no rescan same week'`
- Line 160-174: `'pickBatch: priority URLs scanned first, no rescan within a week'`
- Line 176-188: `'pickBatch: non-priority order is stable per week but varies across weeks'`
- Line 190-205: `'pickBatch: failed pages can retry in-week until fail threshold'`
- Line 207-213: `'weeklyCapFor: importance scales max_pages_per_week around 3 as neutral'` — **this test does not call `pickBatch`/`budgetStatus` and needs no change.**
- Line 215-245: `'budgetStatus: cap reached vs frontier empty vs runnable'`
- Line 247-254: `'addPage: priority promotes an existing page without duplicating'` — **this test does not call `pickBatch`/`budgetStatus` and needs no change.**

All of these currently call `pickBatch(state, '2026-W24', ...)` or
`budgetStatus(state, '2026-W24', target)`, and set eligibility via
`state.pages.X.lastScannedWeek = '2026-W24'`. Per WP02's rewrite, they must
instead pass a fixed `Date` and set `lastScannedAt` (an ISO timestamp), not
`lastScannedWeek`, to control eligibility.

## Subtasks

### T012: Update the five existing `pickBatch`/`budgetStatus` tests to the new signature.

**Files**: `tests/unit/lib.test.js`

For each of the four `pickBatch` tests and the one `budgetStatus` test
listed above, apply this transformation pattern:

1. Add a fixed reference date near the top of the test (or as a shared
   `const NOW = new Date('2026-06-12T00:00:00Z');` near the top of the file
   if multiple tests can share it — `2026-06-12` falls in ISO week
   `2026-W24`, matching the existing tests' week string, so behavior stays
   directly comparable).

2. Replace `state.pages.X.lastScannedWeek = '2026-W24'` with
   `state.pages.X.lastScannedAt = NOW.toISOString();` (a page "scanned this
   week" becomes a page "scanned at the reference `now`" — eligible again
   only after its configured interval elapses, default 7 days, so it
   remains excluded from a batch computed at the same `NOW`).

3. Replace `pickBatch(state, '2026-W24', budget, cap)` with
   `pickBatch(state, NOW, budget, cap, target)`, where `target` is a plain
   object with at minimum `{ urlRescanIntervalDays: 7,
   priorityUrlRescanIntervalDays: 7 }` (or omit the fields entirely and
   rely on WP02's `?? 7` defensive defaults — either is acceptable; using
   the defaults is slightly more realistic to how `budgetStatus`'s
   existing test already passes a bare `{ max_pages_per_week, importance
   }` object).

4. Replace `budgetStatus(state, '2026-W24', target)` with
   `budgetStatus(state, NOW, target)`.

5. For the "different week" comparison in the stable-ordering test (line
   176-188, `w25 = pickBatch(state, '2026-W25', ...)`), replace with a
   second fixed date roughly a week later, e.g.
   `const NOW_NEXT_WEEK = new Date('2026-06-19T00:00:00Z');` (which falls
   in ISO week `2026-W25`) — this preserves the test's intent (different
   week → different random spread) since `weeklyRank`'s salt is still
   derived from `isoWeek(now)` internally.

6. **Every currently-asserted outcome must still hold** — do not weaken
   any assertion. Specifically re-verify after your edit: (a) a page
   scanned at `NOW` is excluded from a batch computed at the same `NOW`;
   (b) never-scanned pages sort before previously-scanned pages; (c) the
   weekly cap still correctly limits batch size; (d) `failCount >= 3`
   pages are still excluded; (e) priority pages still sort first; (f) same
   `(state, NOW)` produces identical order on repeat calls, and a
   different `now` (different ISO week) produces a different order over
   the same page set.

**Validation**: all five updated tests pass with `node --test
tests/unit/lib.test.js` (or `npm run test:unit` for the full suite), with
zero weakening of what each test asserts.

### T013: Add config default/override resolution tests.

**Files**: `tests/unit/lib.test.js` (or `tests/unit/config.test.js` if you
judge that file to be the more appropriate home — check which file already
covers `loadConfig()`'s target-resolution behavior; if `config.test.js`
exists and covers similar ground for other fields like `showLanguageSwitcher`/
`webmcpEnabled`, put these tests there instead for consistency, and note the
file-location deviation from this WP's `owned_files` in your commit message
so the reviewer isn't surprised). Per spec.md NFR-002, cover:

- A target with none of the three new fields set resolves
  `domainScanCadence: 'incremental'`, `urlRescanIntervalDays: 7`,
  `priorityUrlRescanIntervalDays: 7`.
- A target that sets `domain_scan_cadence: 'daily'` resolves
  `domainScanCadence: 'daily'`, independent of the other two fields'
  values.
- A target that sets `url_rescan_interval_days: 3` resolves
  `urlRescanIntervalDays: 3` while `priorityUrlRescanIntervalDays` stays at
  the default `7` (independence of the two interval fields).
- A target that sets `priority_url_rescan_interval_days: 1` resolves
  `priorityUrlRescanIntervalDays: 1` while `urlRescanIntervalDays` stays at
  the default `7`.
- An invalid `domain_scan_cadence` value (e.g. `'weekly'`) throws an error
  naming the target and the supported values (per WP01's validation).

Construct these tests using a synthetic config object passed through
whatever mechanism `loadConfig()`/`config.test.js` already uses for
target-resolution tests (check the existing test file for the pattern —
likely a small in-memory YAML string or a mocked `fs.readFileSync`; do not
invent a new fixture mechanism if one already exists).

**Validation**: each scenario above has a corresponding passing assertion;
running with an invalid `domain_scan_cadence` throws (use
`assert.throws(...)`, mirroring the existing `design_system` validation
test if one exists).

### T014: Add elapsed-day eligibility, cadence, and priority/ordinary independence tests.

**Files**: `tests/unit/lib.test.js`. Per spec.md NFR-002 and Scenario 5,
cover:

- **Boundary — ineligible one day short**: a page with `lastScannedAt` set
  to `interval - 1` days before `now` is excluded from `pickBatch`'s batch
  (using a target with a short interval, e.g. `urlRescanIntervalDays: 3`,
  makes the test's date math easy to read).
- **Boundary — eligible exactly at the interval**: a page with
  `lastScannedAt` set to exactly `interval` days before `now` is included
  in the batch (spec.md Scenario 5's inclusive `>=` boundary).
- **`daily` domain cadence blocks a same-UTC-day rerun**: a state object
  with `lastDomainScanDate` equal to `now`'s UTC date, and
  `target.domainScanCadence = 'daily'`, produces `budgetStatus(...).
  frontierEmpty === true` even when individual pages are otherwise
  interval-eligible.
- **`daily` domain cadence allows the next UTC day**: the same setup but
  with `lastDomainScanDate` equal to the day *before* `now`'s UTC date
  produces `frontierEmpty` reflecting only page-level eligibility (i.e.
  `false` if a page is otherwise eligible) — the domain throttle lifts at
  UTC midnight.
- **`incremental` domain cadence never throttles**: the same
  `lastDomainScanDate === today` setup but with `target.domainScanCadence
  = 'incremental'` (or omitted, defaulting to incremental) produces
  `frontierEmpty` reflecting only page-level eligibility — multiple runs
  the same day remain unthrottled, matching today's behavior (spec.md
  Scenario 1).
- **Priority vs ordinary interval independence**: a state with one
  priority page and one ordinary page, both scanned at the same `now`,
  with `target.priorityUrlRescanIntervalDays = 1` and
  `target.urlRescanIntervalDays = 7` — after advancing the test's
  reference `now` by 1 day (but less than 7), only the priority page is
  eligible; after advancing by 7+ days, both are eligible. This directly
  covers spec.md Scenario 3.
- **`domainEligibleToday()` direct unit coverage**: a small set of direct
  calls to the exported `domainEligibleToday(state, now, cadence)`
  covering the four cases already implied above (incremental always true;
  daily + no prior date true; daily + same UTC date false; daily +
  different UTC date true) — cheaper and more precise than only testing
  through `budgetStatus`.

**Validation**: each bullet above has at least one passing assertion; use
fixed `Date` objects throughout (no `new Date()` with no argument, no
wall-clock dependency), per spec.md C-004.

### T015: Add a backward-compatibility test using a legacy-shaped state object.

**Files**: `tests/unit/lib.test.js`. Per spec.md Scenario 4 and C-002,
construct a state object shaped exactly like a pre-mission state file
would be — i.e. **omit** the `lastDomainScanDate` key entirely from the
state root (do not set it to `null` explicitly; a real legacy file
literally lacks the key after `JSON.parse`), with pages carrying only the
pre-existing fields (`lastScannedWeek`, `lastScannedAt`, `failCount`,
`priority`). Confirm:

- `pickBatch`/`budgetStatus` run without throwing against this
  legacy-shaped object.
- Eligibility is computed correctly from `lastScannedAt` alone (the
  legacy object's `lastScannedWeek` values, if present, are ignored by
  the new eligibility logic — that field is now write-only per FR-007).
- `domainEligibleToday`/the `daily`-cadence path treats the missing
  `lastDomainScanDate` key identically to an explicit `null` (i.e. the
  domain is eligible — `daily` cadence's first-ever run is never
  incorrectly throttled just because the field was never present).

**Validation**: this test passes against a state object with the
`lastDomainScanDate` key genuinely absent (verify with
`assert.ok(!('lastDomainScanDate' in legacyState))` at the top of the test,
so a future refactor can't accidentally make the fixture non-representative
of a real legacy file).

## Definition of Done

- [ ] All five pre-existing `pickBatch`/`budgetStatus` tests pass with the new `now`-based signature, with zero weakened assertions.
- [ ] New tests cover every bullet in T013 (config resolution) and T014 (eligibility/cadence/priority independence).
- [ ] T015's backward-compatibility test passes against a state object with a genuinely absent `lastDomainScanDate` key.
- [ ] `npm run test:unit` passes in full (this WP is the first point in the mission where the full suite is expected to go green again, since WP02/WP03 leave the existing tests broken by the signature change until this WP updates them).
- [ ] `npm run check:spec-kitty` passes.

## Risks

- **Test count regression risk**: it's easy to accidentally delete
  coverage while "updating" a test's signature — diff carefully against
  the original test bodies quoted in this prompt's Context section to
  confirm every original assertion is still present (possibly reworded to
  use `lastScannedAt` instead of `lastScannedWeek`, but not silently
  dropped).
- **Date math off-by-one errors** are easy to introduce in T014's
  boundary tests — double check `interval - 1` vs `interval` day
  calculations use exact day-length arithmetic (`86400000` ms), not
  calendar-month-aware date libraries that could round differently.

## Reviewer Guidance

Confirm: (1) no existing test's asserted *behavior* changed, only its
mechanism (`lastScannedWeek` → `lastScannedAt`, week string → `Date`); (2)
the boundary test genuinely tests `interval - 1` (ineligible) directly
against `interval` (eligible), not some looser approximation; (3) the
legacy-compatibility test's fixture genuinely omits the key rather than
setting it to `null`/`undefined` explicitly (these are subtly different in
JS — `'key' in obj` vs `obj.key === undefined`); (4) `npm run test:unit`'s
full output shows the same or higher total test count as before this
mission, never lower.
