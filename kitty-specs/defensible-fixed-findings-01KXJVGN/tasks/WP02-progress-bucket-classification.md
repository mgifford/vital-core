---
work_package_id: WP02
title: Progress bucket classification
dependencies:
- WP01
requirement_refs:
- FR-002
tracker_refs: []
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this mission were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T004
- T005
agent: claude
history: []
agent_profile: node-norris
authoritative_surface: src/lib/progress.js
create_intent: []
execution_mode: code_change
model: ''
owned_files:
- src/lib/progress.js
- tests/unit/progress.test.js
role: implementer
tags: []
---

# WP02: Progress bucket classification

## ⚡ Do This First: Load Agent Profile

Use the `/ad-hoc-profile-load` skill to load the agent profile specified in the frontmatter, and behave according to its guidance before parsing the rest of this prompt.

- **Profile**: `node-norris`
- **Role**: `implementer`
- **Agent/tool**: `claude`

If no profile is specified, run `spec-kitty agent profile list` and select the best match for this work package's task_type and authoritative_surface.

---

## Objective

Split `weekDeltas()`'s `fixed` bucket in `src/lib/progress.js` into
confirmed-fixed vs. coverage-lost/unconfirmed, using the `_coverageLost` flag
WP01 adds to ledger findings in `src/lib/findings.js`. Do this additively —
the existing `{ new, fixed, regressed }` return shape and its counts must
keep meaning what they meant before, so callers in `src/aggregate.js` and
`src/report-html.js` are not broken by this change.

## Context

Issue #222 (see `spec.md`) is that "Fixed this week" on the Layer-1 landing
page currently means only "this pattern_id was absent from this week's scan"
— it does not confirm the previously-affected pages were actually re-crawled
and found clean. A finding can look "fixed" purely because its pages fell out
of this week's crawl sample (weekly page caps, sampling rates, priority
changes), not because anyone remediated anything. That is not a defensible
claim, and FR-002 requires `weekDeltas()` to stop conflating the two.

**Depends on WP01**: WP01 modifies `updateFindings()` in `src/lib/findings.js`
to set `_coverageLost: true` on a ledger finding when it disappears
(`lastSeen === prevWeek`, absent this week) **and** none of its previously
recorded `affected_pages` were actually re-crawled this week (per-engine
coverage set, same shape as the existing `prevCoveredUrls` mechanism that
already backs `_coverageNew`). By the time this WP runs, every ledger finding
that qualifies has that flag available to read. This WP does not compute
`_coverageLost` — it only reads it.

**What depends on this WP**: WP03 (report and API evidence surfacing, IC-03)
reads the classified buckets this WP produces to render evidence links on the
landing page and expose the confirmed/coverage-lost distinction through the
static JSON API. WP03 cannot start until the bucket shape here is final.

**Key design decision**: extend the existing `{ new, fixed, regressed }`
object shape **additively**. Add a new bucket — call it `fixedUnconfirmed`
(read as: "disappeared, but not confirmed remediated") — rather than
replacing or repurposing `fixed`. A finding classified as coverage-lost is
removed from `fixed` and placed only in `fixedUnconfirmed`; it is never
counted in both. This means:

- `d.fixed` continues to mean exactly what every existing caller already
  assumes it means (confirmed-fixed), just narrower than before for domains
  where `_coverageLost` starts firing — this is the intended behavior change
  per FR-002, not a bug.
- Existing callers (`src/aggregate.js:201`, `src/report-html.js:759` /
  `:3514`) that read `progress.fixed` / `d.fixed.length` keep compiling and
  running with no code changes required in this WP. They will simply see
  smaller (more honest) `fixed` counts for domains that hit the coverage-lost
  path — WP03 is where the new bucket gets surfaced in the UI/API.
- Do **not** rename `fixed` or delete it. Do **not** merge coverage-lost
  findings silently back into `fixed`.

Findings without a `_coverageLost` flag (the common case — includes the
common case where WP01 doesn't detect a match, and all pre-existing ledger
data written before WP01 shipped, per spec.md C-01) must classify exactly as
before: present-last-week-absent-this-week and no flag → `fixed`. This is the
backward-compatibility guarantee C-01 depends on.

### Subtask T004: Split `fixed` into confirmed vs. coverage-lost in `src/lib/progress.js`

**Purpose**: Make `weekDeltas()` (and its dependents `weekDeltaCounts()` and
`deltaSeries()`) check the `_coverageLost` flag when a finding disappears, so
a coverage-dropout is never silently reported as a confirmed fix.

**Steps**:

1. Open `src/lib/progress.js`.
2. In `weekDeltas(ledger, currentWeek, prevWeek)`, change the initial
   accumulator from `{ new: [], fixed: [], regressed: [] }` to
   `{ new: [], fixed: [], regressed: [], fixedUnconfirmed: [] }`.
3. In the branch that currently does:
   ```js
   } else if (prevWeek && f.lastSeen === prevWeek) {
     out.fixed.push({ id, ...f });
   }
   ```
   split it on `f._coverageLost`:
   ```js
   } else if (prevWeek && f.lastSeen === prevWeek) {
     if (f._coverageLost) out.fixedUnconfirmed.push({ id, ...f });
     else out.fixed.push({ id, ...f });
   }
   ```
   A finding lands in exactly one of `fixed` / `fixedUnconfirmed`, never both,
   and never neither (every disappearance is still classified).
4. Update the function's doc comment (the block above `weekDeltas`, currently
   describing `new` / `fixed` / `regressed`) to describe the new
   `fixedUnconfirmed` bucket: present last week, absent this week, but
   `_coverageLost` was set by `updateFindings()` because none of its prior
   pages were re-crawled this week — i.e. "disappeared from the sample," not
   confirmed remediated.
5. Update `weekDeltaCounts()` to include the new bucket's length in its
   returned object: `{ new, fixed, regressed, fixedUnconfirmed }` (append,
   don't reorder the existing three keys — some callers may rely on key
   presence via destructuring but none currently rely on key order in JS
   objects, so this is safe either way; keep existing three first for
   readability/diff minimalism).
6. Update `deltaSeries()` for the same distinction so the per-week momentum
   series is consistent with the point-in-time buckets. Currently:
   ```js
   else if (!here && prev && seenIn(f, prev)) row.fixed += 1;
   ```
   `deltaSeries` reconstructs history from `_weeks` membership rather than
   `lastSeen`/`_coverageLost` directly (it has no per-past-week
   `_coverageLost` history — only the finding's *current*, final-ledger-state
   `_coverageLost` flag is available, which reflects the flag as of the most
   recent week it disappeared). Add a `fixedUnconfirmed: 0` field to each
   row's initial object, and split the increment:
   ```js
   else if (!here && prev && seenIn(f, prev)) {
     if (f._coverageLost) row.fixedUnconfirmed += 1;
     else row.fixed += 1;
   }
   ```
   Document in the function's doc comment that `_coverageLost` reflects the
   finding's current flag state (set on its most recent disappearance), so
   historical weeks where the same finding disappeared and later reappeared
   will use the flag's present value, not a per-week-accurate snapshot — this
   is an acceptable simplification because the ledger does not retain
   per-week coverage-lost history, only the current flag (call this out
   explicitly as a known limitation in the comment, do not silently accept
   it without documenting it).
7. Do not touch `severityBurndown()` or `streaks()` — they operate on
   presence/severity, not fixed/new/regressed classification, and are out of
   scope for FR-002.
8. Do not modify `src/aggregate.js` or `src/report-html.js` in this WP — they
   are owned by WP03 (IC-03). Confirm after your change that both files still
   run unmodified against the new return shape (they read only `.fixed`,
   `.new`, `.regressed`, `.deltaSeries`, `.burndown`, `.streaks` — none of
   which you removed or renamed).

**Files**://
- `src/lib/progress.js` — modify `weekDeltas()`, `weekDeltaCounts()`,
  `deltaSeries()`, and their doc comments. Expect roughly +15 to +25 lines
  net (mostly comment updates plus a few conditional branches).

**Validation**:
- `npm run test:unit` passes, including the new tests from T005.
- Manually trace: a ledger finding with `_coverageLost: true` and
  `lastSeen === prevWeek`, absent this week, must appear in
  `d.fixedUnconfirmed` and NOT in `d.fixed`.
- Manually trace: a ledger finding with no `_coverageLost` flag (undefined or
  false) and `lastSeen === prevWeek`, absent this week, must appear in
  `d.fixed` exactly as before this change — grep the existing test fixture
  `FIXED` entry in `tests/unit/progress.test.js` (no `_coverageLost` key) and
  confirm it still lands in `fixed`, not `fixedUnconfirmed`.

### Subtask T005: Unit tests for the confirmed/unconfirmed split

**Purpose**: Prove the new classification is correct and that it does not
regress the existing new/fixed/regressed behavior other callers depend on.

**Steps**:

1. Open `tests/unit/progress.test.js`.
2. Add a synthetic ledger finding with `_coverageLost: true` — e.g. extend the
   existing `ledger()` helper (or add a second helper /
   inline object, matching the file's existing style of one helper function
   at the top) with an entry like:
   ```js
   FIXED_UNCONFIRMED: { severity: 'Moderate', firstSeen: '2026-W19', lastSeen: '2026-W23', _weeks: ['2026-W19', '2026-W20', '2026-W21', '2026-W22', '2026-W23'], weeksSeen: 5, _coverageLost: true },
   ```
   Reuse the existing `2026-W24` / `2026-W23` current/prev week pairing used
   by the rest of the file's tests for consistency, unless a new
   isolated fixture better suits a specific case — prefer minimal new
   fixtures over rewriting the shared one, to avoid disturbing the other
   assertions in `'weekDeltas classifies new / fixed / regressed against the
   previous week'` and `'weekDeltaCounts returns the three bucket sizes'`. If
   adding to the shared `ledger()` would change those counts, add a
   standalone test-local ledger instead.
3. Add a test: a finding with `_coverageLost: true` and
   `lastSeen === prevWeek`, absent current week, appears in
   `d.fixedUnconfirmed` and is absent from `d.fixed`. Assert both directions
   (`assert.deepEqual(d.fixedUnconfirmed.map(x => x.id), [...])` AND that
   `d.fixed` does not contain that id).
4. Add a test: a finding with no `_coverageLost` flag (or `_coverageLost:
   false`) and the same disappearance pattern still lands in `d.fixed`, not
   `d.fixedUnconfirmed` — this is the no-regression case for FR-002 /
   spec.md C-01. The existing `FIXED` entry in the shared `ledger()` fixture
   already covers this implicitly; add an explicit assertion that
   `d.fixedUnconfirmed` is empty for that ledger, or write it as its own
   focused test if you introduced a standalone fixture in step 2.
5. Update (or add a new) `weekDeltaCounts` test asserting the returned object
   includes the correct `fixedUnconfirmed` count alongside unchanged
   `new`/`fixed`/`regressed` counts, e.g.
   `assert.deepEqual(weekDeltaCounts(...), { new: N, fixed: M, regressed: R, fixedUnconfirmed: U })`.
6. Add a `deltaSeries` test covering a finding that disappears with
   `_coverageLost: true` — assert the week row's `fixedUnconfirmed` increments
   and `fixed` does not, mirroring the existing `deltaSeries` test's
   structure (`assert.deepEqual(s[i], { week, new, fixed, regressed,
   fixedUnconfirmed })`) — you will need to add `fixedUnconfirmed: 0`/count to
   every existing `deltaSeries` row assertion in this file since the object
   shape grew a key; update those existing assertions rather than leaving
   them to fail on an extra key mismatch.
7. Run through every pre-existing test in the file (`weekDeltas classifies...`,
   `weekDeltaCounts returns...`, `coverage-expansion findings are not counted
   as new`, `first recorded week...`, `empty / missing ledger...`,
   `severityBurndown...` x2, `streaks...` x2, `deltaSeries...` x2) and update
   any `assert.deepEqual` that checks a full `weekDeltas`/`weekDeltaCounts`/
   `deltaSeries` return object, since those objects now carry an additional
   `fixedUnconfirmed` key that must be included in the expected value or the
   equality check will fail. Tests that only check `.new`/`.fixed`/`.regressed`
   array contents (not full-object equality) need no change.
8. Do not touch the `severityBurndown` or `streaks` tests — those functions
   are unmodified by T004.

**Files**:
- `tests/unit/progress.test.js` — add 3-5 new test cases and update
  existing full-object `assert.deepEqual` calls affected by the new
  `fixedUnconfirmed` key. Expect roughly +30 to +50 lines net.

**Validation**:
- `npm run test:unit` — all tests in `tests/unit/progress.test.js` pass,
  including the pre-existing ones (no false failures from the added key).
- Confirm no other test file in `tests/unit/` imports or asserts against
  `weekDeltas`/`weekDeltaCounts`/`deltaSeries` return shapes (grep
  `tests/unit/` for these three names) — if any do, they must also be
  updated in this same subtask so the whole suite is green.

## Definition of Done

- [ ] `weekDeltas()` in `src/lib/progress.js` returns a `fixedUnconfirmed`
      array alongside the existing `new`/`fixed`/`regressed` arrays.
- [ ] A ledger finding with `_coverageLost: true` classifies into
      `fixedUnconfirmed`, never into `fixed`.
- [ ] A ledger finding without `_coverageLost` (undefined/false) classifies
      into `fixed` exactly as before this change (no regression).
- [ ] `weekDeltaCounts()` returns the new `fixedUnconfirmed` count alongside
      unchanged `new`/`fixed`/`regressed` counts.
- [ ] `deltaSeries()` rows carry a `fixedUnconfirmed` count per week,
      split from `fixed` using the same `_coverageLost` check, with the
      per-week-history caveat documented in the function's comment.
- [ ] `severityBurndown()` and `streaks()` are untouched.
- [ ] `src/aggregate.js` and `src/report-html.js` are not modified in this WP
      and continue to run correctly against the new return shape (they read
      only pre-existing keys).
- [ ] Unit tests in `tests/unit/progress.test.js` cover: coverage-lost →
      `fixedUnconfirmed`; no-flag → `fixed` (no regression); `weekDeltaCounts`
      reflects the split; all pre-existing tests still pass, updated for the
      new key where they assert full-object equality.
- [ ] `npm run test:unit` passes with no failures.

## Risks

- **Contract risk (plan.md IC-02)**: existing callers of `weekDeltaCounts()`
  and `weekDeltas()` in `src/aggregate.js` (`progress = weekDeltas(...)`,
  `progress.deltaSeries = deltaSeries(...)`) and `src/report-html.js`
  (`progress?.fixed`, `prog.fixed.length`, `prog.new.length`,
  `prog.regressed.length`) expect the current shape. This WP must extend
  that shape additively (new key only) and must not rename, remove, or
  change the meaning of `new`, `regressed`, or the array-vs-count semantics
  of `fixed`. Verify by re-reading both call sites after the change and
  confirming no key they read was renamed or removed.
- **Silent regression risk**: if the `_coverageLost` check is inverted or
  misplaced, a coverage-dropout finding could still land in `fixed` (defeats
  FR-002's entire purpose) or, conversely, every disappearance could get
  misclassified as `fixedUnconfirmed` even without the flag (breaks the
  common case and confuses the whole "fixed" metric for existing users). The
  no-regression test in T005 (step 4) is the guard against the latter; the
  coverage-lost test (step 3) guards the former.
- **`deltaSeries` history limitation**: because the ledger stores only the
  finding's current `_coverageLost` flag (not a per-week history of it), a
  finding that disappeared with coverage-lost in one week, reappeared, then
  disappeared again with confirmed coverage in a later week, will have its
  earlier `deltaSeries` row's fixed/fixedUnconfirmed split determined by the
  *current* flag value, not the value at that historical week. This is a
  known, documented limitation inherited from the ledger's shape (out of
  scope to fix here — flag as a comment, not a blocker).

## Reviewer Guidance

- Check the new bucket name (`fixedUnconfirmed`) reads clearly as a handoff
  point for WP03's report/API rendering — WP03 will need to label this
  user-facing (e.g. "dropped from this week's sample" per spec.md's
  acceptance criteria), so the internal key name should be unambiguous to
  the next implementer even if the final UI copy differs.
- Verify the split is genuinely additive: diff `src/lib/progress.js` and
  confirm no existing line computing `fixed`, `new`, or `regressed` was
  altered in a way that changes their historical meaning — only the `fixed`
  push site (and its `deltaSeries` twin) should gain a conditional branch.
- Confirm `src/aggregate.js` and `src/report-html.js` are untouched in this
  WP's diff (they are WP03's surface, not WP02's).
- Confirm new tests are synthetic ledger objects only — no fs mocking, no
  reads from `data/`, per project convention (CLAUDE.md Testing section,
  spec.md NFR-01).
- Confirm every pre-existing test in `tests/unit/progress.test.js` still
  passes unmodified in intent (only full-object equality assertions should
  need a key added, never a value changed).

**Implementation command**: `spec-kitty agent action implement WP02 --agent <name>`
