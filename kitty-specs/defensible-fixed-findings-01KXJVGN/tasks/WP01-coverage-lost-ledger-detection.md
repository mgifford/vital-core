---
work_package_id: WP01
title: Coverage-lost ledger detection
dependencies: []
requirement_refs:
- FR-001
- FR-003
- C-01
tracker_refs: []
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this mission were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T001
- T002
- T003
agent: claude
history: []
agent_profile: node-norris
authoritative_surface: src/lib/
create_intent: []
execution_mode: code_change
model: ''
owned_files:
- src/lib/findings.js
- src/aggregate.js
- tests/unit/findings.test.js
role: implementer
tags: []
---

# WP01: Coverage-lost ledger detection

## ⚡ Do This First: Load Agent Profile

Use the `/ad-hoc-profile-load` skill to load the agent profile specified in the frontmatter, and behave according to its guidance before parsing the rest of this prompt.

- **Profile**: `node-norris`
- **Role**: `implementer`
- **Agent/tool**: `claude`

If no profile is specified, run `spec-kitty agent profile list` and select the best match for this work package's task_type and authoritative_surface.

---

## Objective

Add a symmetric `_coverageLost` flag to the findings ledger (`src/lib/findings.js`, `updateFindings()`) so that a finding disappearing because its previously-affected pages were never re-crawled this week is never indistinguishable, at the data layer, from a confirmed fix. This mirrors the existing `_coverageNew` mechanism but for the opposite failure mode.

## Context

Issue #222: the Layer-1 landing page's "Fixed this week" claim
(`weekDeltas()` in `src/lib/progress.js`, fed by this ledger) currently means
only "this `pattern_id` was present last week and is absent from this week's
scan." That is not the same claim as "this was fixed" — the crawl frontier
(`src/lib/state.js`, weekly page caps, per-engine sampling) does not
guarantee every previously-affected page is re-checked every week. A finding
can go quiet because its pages fell out of this week's sample, not because
the site got fixed.

`updateFindings()` already solves the mirror-image problem: `_coverageNew`
(mission `coverage-expansion-01KVJ3X2`) stops sampling expansion from faking
a "new" finding, by checking whether a brand-new finding's `affected_pages`
overlap with `prevCoveredUrls` (pages known to have been crawled by any
engine the previous week). There is no symmetric flag for a finding that
*disappears* — this WP adds one: `_coverageLost: true`, set on a ledger
entry when the finding stops appearing in this week's reports **and** none
of its previously-recorded affected pages were confirmed covered this week
either.

This flag is pure ledger metadata — it does not change what counts as
"fixed" in any report. That reclassification (splitting `weekDeltas()`'s
`fixed` bucket into confirmed vs. coverage-lost) is IC-02 / **WP02**, which
depends on this WP's `_coverageLost` flag existing on ledger entries before
it can classify against it.

Key design decision from `plan.md` (IC-01): mirror the existing
`_coverageNew` pattern symmetrically — same options-bag shape
(`{ prevCoveredUrls }` today; this WP adds a same-week-covered equivalent),
same fallback contract (omitting coverage data reproduces original behavior
exactly, per spec.md **C-01**), same per-finding evaluation granularity
(`pattern_id`, not per-page — spec.md C-02, out of scope for this WP to
change).

## Subtask T001: Confirm/extend covered-pages availability at the `updateFindings()` call site

**Purpose**: `updateFindings()` is called from exactly one place —
`src/aggregate.js:190`, inside the `for (let i = 0; i < series.length; i++)`
loop (starts line 162). Today it only builds `prevCoveredUrls` (previous
week's covered pages, lines 175-186) to feed `_coverageNew`. The symmetric
coverage-lost check needs the **current** week's covered pages instead
(to check whether a disappearing finding's old pages were re-covered *this*
week). Confirm that data is available at the same point in the loop, in the
same shape, without restructuring the pipeline.

**Steps**:
1. Read `src/aggregate.js` lines 140-239 (already
   read during planning — re-read to confirm nothing has drifted before
   editing).
2. Note that `summary` (== `series[i]`, the **current** week) has the exact
   same shape as `prev` (== `series[i-1]`, previously used to build
   `prevCoveredUrls`): both carry `axe?.rules`, `alfa?.rules` (each rule has
   `affectedPages[].url`), and `pagesWithAxeList` / `pagesWithAlfaList`.
   This means the current week's covered-pages set can be built with the
   **same logic** already at lines 175-186, just reading from `summary`
   instead of `prev`.
3. Confirm this requires no new data capture earlier in the pipeline — the
   fields already exist on every `summary` object by the time the loop body
   runs (they're populated by `summarizeRecords()` before `series` is built).
   This resolves the IC-01 risk noted in `plan.md`: coverage-set data is
   already available in the same shape, no broader pipeline change needed.
4. Decide the naming/shape for the new set so it reads clearly alongside
   the existing `prevCoveredUrls` — e.g. `thisWeekCoveredUrls`, built the
   same way, right after the existing `prevCoveredUrls` block (do not
   replace or restructure the existing block; add alongside it).
5. Confirm `affected_pages` (the per-finding URL list needed to test overlap
   against covered pages) is available on report objects at this call site:
   it's set in `src/lib/bug-report.js:113`
   (`affected_pages: (rule.affectedPages ?? []).slice(0, 25).map((p) => p.url)`,
   capped at 25 URLs) and flows into `bugs` (built by `buildBugReports` at
   line 165), which is what's passed as `reports` into `updateFindings`.
   Note this cap (25) differs from the 5000-URL cap used to build
   `prevCoveredUrls`/`thisWeekCoveredUrls` from `rule.affectedPages` directly
   — acceptable for this WP since both existing `_coverageNew` and the new
   `_coverageLost` check only need "at least one page overlaps," not an
   exhaustive comparison.
6. Note (do not act on in this WP): the ledger itself never persists a
   finding's `affected_pages` URL list — only `lastPagesAffected` (a count,
   `src/lib/findings.js` lines 85/100). T002 must capture the URL list
   **at disappearance time** using the last week's `reports` that included
   it, not by reading it back off the ledger (which doesn't have it). See
   T002 step 2 for how this is threaded through without a ledger schema
   change.

**Files**:
- No file edits in this subtask — investigation and confirmation only.
  (If drift is found from what plan.md/spec.md assumed, note it in the PR
  description rather than silently changing scope.)

**Validation**:
- Re-read `src/aggregate.js:140-239` and confirm in your own words (as a
  code comment added in T002, not here) that `summary.axe?.rules`,
  `summary.alfa?.rules`, `summary.pagesWithAxeList`, and
  `summary.pagesWithAlfaList` are populated for the current week by the time
  line 190 executes. No test needed for this subtask — it is groundwork for
  T002.

## Subtask T002: Implement `_coverageLost` detection in `updateFindings()`

**Purpose**: When a finding that was present last week does not appear in
this week's `reports`, and none of its previously-recorded affected pages
were confirmed covered this week, mark the ledger entry `_coverageLost: true`
instead of silently leaving it unflagged. Must preserve C-01 exactly:
omitting coverage data reproduces original behavior with no forced
`findings.json` migration.

**Steps**:
1. In `src/lib/findings.js`, extend the
   `updateFindings(ledger, week, reports, { prevCoveredUrls } = {})` options
   bag with a new optional parameter, e.g. `thisWeekCoveredUrls` (a `Set<string>`
   of page URLs covered by any engine **this** week — same shape as
   `prevCoveredUrls`, just for the current week instead of the previous one).
   Keep `prevCoveredUrls` untouched; this is additive.
2. Because the ledger does not persist a finding's affected-page URL list
   (only `lastPagesAffected`, a count), and `updateFindings()` only has
   `reports` for the **current** week (the disappearing finding, by
   definition, has no entry in `reports` this week), the check cannot be
   done retroactively from `reports` alone. Add a small persisted field to
   the ledger entry to carry this forward: `lastAffectedPages` — the
   `affected_pages` array (capped, same list already on the report object)
   recorded alongside `lastPagesAffected` every time a finding is
   seen/updated (in both the "new finding" branch, ~line 75-87, and the
   "existing finding" update branch, ~line 88-104, wherever
   `lastPagesAffected` is set from `r.frequency.pages_affected`, also set
   `lastAffectedPages: r.affected_pages ?? []`). This is the smallest
   change that lets a *future* week detect disappearance against
   *this* week's recorded page list — it is new ledger data, but adding an
   optional field does not break existing loaders (`loadFindings()` just
   does `JSON.parse`; missing keys are `undefined`, handled by `?? []`
   fallbacks), so it does not conflict with C-01's "no forced migration"
   requirement (old ledger entries without `lastAffectedPages` simply treat
   it as `[]` and skip the coverage-lost check for them, same effect as
   omitting the option entirely).
3. Add a new pass in `updateFindings()`, after the existing `for (const r of
   reports)` loop (which only touches findings present in `reports`), that
   walks `ledger.findings` looking for entries that:
   - were present last week (`existing.lastSeen === week` was NOT just set
     this iteration — i.e., the finding's `pattern_id` did not appear in
     `reports` this week at all), and
   - whose `lastSeen` is the **immediately preceding** week relative to
     `week` (use the existing `compareWeek()` helper or the ledger's own
     week-ordering — do not assume a fixed week-string format beyond what
     `compareWeek()` already handles).
   For each such entry, when `thisWeekCoveredUrls` is provided: compute
   whether **none** of `existing.lastAffectedPages ?? []` are present in
   `thisWeekCoveredUrls`. If `lastAffectedPages` is empty/absent, or
   `thisWeekCoveredUrls` is not provided (`== null`), do **not** set the
   flag (mirrors `_coverageNew`'s own guard at line 71-73 and preserves
   C-01: omitting the new option is a no-op, identical to today's
   behavior). If pages exist and none overlap, set
   `existing._coverageLost = true` on the ledger entry. If any page does
   overlap (confirmed re-covered, genuinely fixed), do **not** set the flag
   — and if it was previously set from an earlier week's evaluation, leave
   prior-week flags alone (this pass only evaluates the current transition).
4. Clear semantics on reappearance: if a finding flagged `_coverageLost`
   later reappears in `reports` (handled by the existing loop), it re-enters
   the normal "existing finding" update branch, which does not currently
   clear `_coverageLost`. Add a `delete existing._coverageLost;` at the top
   of the "existing finding" branch (mirrors how `_coverageNew` is cleared
   at line 96, but unconditionally here since any reappearance supersedes a
   stale coverage-lost flag from a prior disappearance).
5. Update the JSDoc comment block above `updateFindings()` (lines 44-61) to
   document the new `thisWeekCoveredUrls` option and `_coverageLost` flag,
   following the same style as the existing `prevCoveredUrls`/`_coverageNew`
   paragraph — state explicitly that omitting `thisWeekCoveredUrls`
   reproduces original behavior exactly.
6. Update the top-of-file ledger shape comment (lines 16-27) to mention the
   new optional `lastAffectedPages` and `_coverageLost` fields.
7. In `src/aggregate.js`, add the
   `thisWeekCoveredUrls` construction alongside the existing
   `prevCoveredUrls` block (lines 175-186) — same logic, reading from
   `summary` instead of `prev` — and pass it into the `updateFindings()` call
   at line 190: `updateFindings(ledger, summary.week, bugs, {
   prevCoveredUrls, thisWeekCoveredUrls })`.

**Files**:
- `src/lib/findings.js` — modify `updateFindings()` (~30-40 new lines: new
  pass over `ledger.findings`, new `lastAffectedPages` field writes, cleared
  `_coverageLost` on reappearance) and update two comment blocks.
- `src/aggregate.js` — add ~12 lines building `thisWeekCoveredUrls` (mirror
  of the existing `prevCoveredUrls` block) and extend the `updateFindings()`
  call with the new option.

**Validation**:
- `npm run test:unit` passes (full suite — this touches a shared module used
  by `aggregate.js` and `progress.js` callers).
- Manually trace one synthetic example: a finding present in week W1 with
  `affected_pages: ['/a', '/b']`, absent in W2's `reports`, with
  `thisWeekCoveredUrls` for W2 containing neither `/a` nor `/b` → ledger
  entry should end up with `_coverageLost: true` and unchanged `lastSeen`
  (still W1, since it's not in this week's reports — do not advance
  `lastSeen` for a coverage-lost finding, only flag it).

## Subtask T003: Unit tests for `_coverageLost` in `tests/unit/findings.test.js`

**Purpose**: Cover the new flag's happy path, the negative case (genuine
fix), and the C-01 regression guard, following this file's existing
no-mocking, synthetic-fixture convention (see the `_coverageNew` test block,
lines 44-89, as the template to mirror).

**Steps**:
1. In `tests/unit/findings.test.js`, add a new
   test section below the existing `_coverageNew` block, with a comment
   header following the same style (`// Issue #222: coverage-lost
   detection`).
2. **Test (a) — flagged when pages not re-covered**: build a ledger, call
   `updateFindings(ledger, '2026-W24', [reportWithPages])` where
   `reportWithPages.affected_pages = ['https://example.gov/p1',
   'https://example.gov/p2']`. Then call `updateFindings(ledger, '2026-W25',
   [], { thisWeekCoveredUrls: new Set(['https://example.gov/other']) })` (the
   finding is absent from W25's reports, and neither `/p1` nor `/p2` is in
   the covered set). Assert `ledger.findings['<id>']._coverageLost === true`
   and `lastSeen` is still `'2026-W24'`.
3. **Test (b) — NOT flagged when pages were re-covered (real fix)**: same
   setup, but call the W25 update with `thisWeekCoveredUrls: new
   Set(['https://example.gov/p1'])` (one of the finding's old pages WAS
   covered, found clean, hence genuinely fixed). Assert
   `ledger.findings['<id>']._coverageLost` is `undefined`.
4. **Test (c) — C-01 regression guard**: call the same disappearance
   sequence but omit `thisWeekCoveredUrls` entirely (i.e., call
   `updateFindings(ledger, '2026-W25', [])` with no options object, or
   `{ prevCoveredUrls }` only, matching how existing callers behave before
   this WP). Assert `ledger.findings['<id>']._coverageLost` is `undefined` —
   omitting the new coverage data must reproduce the exact original
   behavior (finding just sits at `lastSeen: 'W24'` unflagged, as it does
   today).
5. Optional but recommended — a fourth test mirroring T002 step 4: flag a
   finding `_coverageLost` in one week, then have it reappear in the
   following week's `reports`; assert the flag is cleared
   (`_coverageLost === undefined`) and normal `lastSeen`/`weeksSeen`
   tracking resumes.
6. Run `npm run test:unit` and confirm all existing tests (including the
   `_coverageNew` block) still pass unchanged — this WP must not alter
   `_coverageNew` behavior.

**Files**:
- `tests/unit/findings.test.js` — add ~50-70 lines: 3-4 new `test(...)`
  blocks plus one shared synthetic report fixture with `affected_pages` (can
  reuse `BASE_REPORT` at the top of the file if its `pattern_id`/shape fits,
  or define a small local fixture matching the existing style — no fs
  mocking, no database, per project convention and per `plan.md`'s Testing
  section).

**Validation**:
- `npm run test:unit` — all tests pass, including new ones.
- Confirm no test mocks `fs` or hits the real filesystem for `data/` — all
  ledger objects are in-memory literals, matching every existing test in
  this file.

## Definition of Done

- [ ] T001: Confirmed `summary`/`prev` symmetry in `src/aggregate.js` gives
      current-week covered-pages data in the same shape as
      `prevCoveredUrls`, with no pipeline restructuring required.
- [ ] T002: `updateFindings()` in `src/lib/findings.js` accepts an optional
      `thisWeekCoveredUrls` parameter and sets `_coverageLost: true` on a
      ledger entry when a finding disappears this week and none of its
      recorded `lastAffectedPages` overlap the current week's covered set.
- [ ] T002: New `lastAffectedPages` field is recorded on every
      seen/updated ledger entry (new-finding and existing-finding branches).
- [ ] T002: `_coverageLost` is cleared if/when a flagged finding reappears
      in a later week's reports.
- [ ] T002: `src/aggregate.js` builds `thisWeekCoveredUrls` from `summary`
      (mirroring the existing `prevCoveredUrls` block built from `prev`) and
      threads it into the `updateFindings()` call at line 190.
- [ ] T002: JSDoc comments in `src/lib/findings.js` updated for the new
      option, flag, and ledger field.
- [ ] T003: New unit tests cover flagged, not-flagged (real fix), and
      C-01 omission-reproduces-original-behavior cases.
- [ ] `npm run test:unit` passes in full, including all pre-existing
      `_coverageNew` tests unchanged.
- [ ] No `findings.json` migration is forced — omitting
      `thisWeekCoveredUrls` (or any coverage option) reproduces prior
      output exactly for domains/engines that don't supply it.
- [ ] No changes made to `src/lib/progress.js`, `src/report-html.js`, or
      `src/lib/api-writer.js` — those are WP02/WP03's surfaces, not this
      WP's `owned_files`.

## Risks

- **IC-01 risk (plan.md)**: per-engine coverage-set data might not be
  available at the `updateFindings()` call site in the shape this WP needs.
  T001's investigation found `summary` (current week) already carries the
  same fields used to build `prevCoveredUrls` from `prev` (previous week),
  so this risk is largely resolved — but if the actual `series` objects at
  implementation time differ from what was read during planning (e.g.
  `pagesWithAxeList`/`pagesWithAlfaList` pruned for older or unusually
  large weeks), the coverage-lost check may silently under-fire (never set
  `_coverageLost` when it should) rather than over-fire — confirm this
  fail-safe direction is preserved if the data shape doesn't match exactly.
- **Ledger schema growth**: adding `lastAffectedPages` grows
  `data/<domain>/findings.json` size (one URL array per finding, capped at
  25 per `bug-report.js`). This is committed data — check it doesn't
  meaningfully bloat the ledger for large domains before finalizing (no
  explicit size budget was set in spec.md, but keep it in mind against the
  project's general sustainability gate).
- **Week-adjacency assumption**: the "was present last week" check needs a
  correct definition of "immediately preceding week" using `compareWeek()`
  or ledger week ordering — get this wrong and the coverage-lost pass could
  either fire on multi-week-old absences (over-broad) or never fire
  (under-broad). Favor the narrower, already-established definition
  `weekDeltas()` uses (`f.lastSeen === prevWeek`) for consistency with how
  WP02 will consume this flag.

## Reviewer Guidance

- **Symmetry with `_coverageNew`**: the new code path should read as an
  obvious mirror image of the existing `_coverageNew` logic — same options-
  bag pattern, same "only flag when we can positively confirm the negative
  case" caution (never flag `_coverageLost` on missing/ambiguous data).
- **C-01 regression safety is the highest-priority review item**: run
  (or ask the implementer to show) a before/after diff of ledger output for
  a call to `updateFindings()` with no coverage options at all — it must be
  byte-identical to current behavior. The new T003 "omission" test is the
  automated proof; a reviewer should also sanity-check it isn't
  accidentally weakened (e.g. asserting only "no throw" instead of asserting
  `_coverageLost` is actually `undefined`).
- **No fs mocking in tests**: confirm `tests/unit/findings.test.js` additions
  use only in-memory ledger/report object literals, consistent with every
  existing test in that file and with `plan.md`'s Testing section — flag any
  use of `fs`, temp files, or `data/` paths in review.
- **Scope containment**: this WP must not touch `src/lib/progress.js`,
  `src/report-html.js`, or `src/lib/api-writer.js` — those are WP02/WP03.
  If the implementer finds they "need" to touch those files to make this WP
  useful, that's a signal to stop and flag it rather than silently
  expanding scope, since `_coverageLost` is deliberately just ledger
  metadata in this WP; nothing downstream reads it yet.
- **`lastAffectedPages` cap consistency**: confirm the field stores whatever
  `r.affected_pages` already contains (capped at 25 by `bug-report.js`) and
  does not attempt to reconcile that with the larger 5000-URL cap used for
  `prevCoveredUrls`/`thisWeekCoveredUrls` — that mismatch is pre-existing and
  out of scope to fix here.

**Implementation command**: `spec-kitty agent action implement WP01 --agent <name>`
