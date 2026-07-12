---
work_package_id: WP03
title: Call-site migration (scan.js, list-scan-domains.js)
dependencies:
- WP02
requirement_refs:
- C-003
- FR-003
tracker_refs: []
planning_base_branch: claude/vital-core-issue-214-spec-m237h3
merge_target_branch: claude/vital-core-issue-214-spec-m237h3
branch_strategy: Planning artifacts for this mission were generated on claude/vital-core-issue-214-spec-m237h3. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/vital-core-issue-214-spec-m237h3 unless the human explicitly redirects the landing branch.
subtasks:
- T009
- T010
- T011
agent: ''
shell_pid: 0
history: []
authoritative_surface: src/
create_intent: []
execution_mode: code_change
owned_files:
- src/scan.js
- scripts/list-scan-domains.js
tags: []
---

## ⚡ Do This First: Load Agent Profile

Before reading anything else in this prompt, load the assigned agent profile
(see this WP's frontmatter `agent_profile`/`role` if set) via the
`ad-hoc-profile-load` skill/command. If no profile is assigned, proceed as a
general implementer.

## Objective

Update the two callers of `pickBatch`/`budgetStatus` — `src/scan.js` and
`scripts/list-scan-domains.js` — to the new `now`/`target`-based signatures
WP02 produced, and stamp `state.lastDomainScanDate` when a scan run actually
scans at least one page. **This WP also fixes a pre-existing gap this
mission's research surfaced**: three of `scan.js`'s five `lastScannedWeek`
write sites do not also write `lastScannedAt` — under the new elapsed-day
eligibility rule (WP02), that gap would make those pages permanently
eligible for immediate retry, which is a regression from today's "don't
retry this week" intent. Fixing this is in scope for this WP (see T009).

## Context

Read `kitty-specs/scan-cadence-config-01KXBWGE/plan.md`'s "Design → Domain
cadence gate" subsection before starting. WP02 (a prerequisite for this WP)
changed these exported signatures in `src/lib/state.js`:

- `pickBatch(state, now, budget, scannedThisWeekCap, target)` — was `pickBatch(state, week, budget, scannedThisWeekCap)`
- `budgetStatus(state, now, target)` — was `budgetStatus(state, week, target)`
- New: `domainEligibleToday(state, now, cadence)` (exported, but `budgetStatus` already calls it internally — you generally don't need to call it directly)
- New state field: `state.lastDomainScanDate` (UTC `YYYY-MM-DD` string or `null`)

Read WP02's actual diff to `src/lib/state.js` before starting this WP — the
prompt above describes the intended shape, but the merged code is the
source of truth for exact behavior.

## Current call sites (read before editing)

`src/scan.js`:
- Line 8: `import { loadState, saveState, addPage, pickBatch, weeklyCapFor } from './lib/state.js';` — note `budgetStatus` is **not currently imported here** (it's only used by `scripts/list-scan-domains.js` today); you do not need to add a `budgetStatus` call to `scan.js` for this WP.
- Line 9: `import { isoWeek } from './lib/week.js';`
- Line 56: `const week = isoWeek();`
- Line 126-127: `const weeklyCap = weeklyCapFor(target); const { batch, scannedThisWeek } = pickBatch(state, week, budget, weeklyCap);`
- Lines 197, 207, 233, 390, 402: `state.pages[item.id].lastScannedWeek = week;` — five distinct write sites across different scan-outcome branches (url-filtered skip, robots-disallowed skip, non-HTML head-check, successful scan, download-caught-as-error).
- Lines 234, 391: `state.pages[item.id].lastScannedAt = ...` — only **two** of the five `lastScannedWeek` sites also set `lastScannedAt` (the non-HTML head-check branch at 234, and the successful-scan branch at 391). The url-filtered (197), robots-disallowed (207), and download-error (402) branches do **not** set `lastScannedAt`.

`scripts/list-scan-domains.js` (full file, ~34 lines):
```js
import { loadConfig } from '../src/lib/config.js';
import { loadState, budgetStatus } from '../src/lib/state.js';
import { isoWeek } from '../src/lib/week.js';

const week = isoWeek();
const targets = loadConfig().targets.filter((t) => !t.hf_only);

for (const t of targets) {
  const state = loadState(t.key, t.domain);
  const { cap, scannedThisWeek, remaining, frontierEmpty } = budgetStatus(state, week, t);
  // ... skip/include logic based on remaining/frontierEmpty
}
```

## Subtasks

### T009: Update `src/scan.js`'s `pickBatch` call and fix the `lastScannedAt` gap.

**Files**: `src/scan.js`

1. Replace `const week = isoWeek();` (line 56) with `const now = new Date();`
   (keep a `const week = isoWeek(now);` line too if `week` is still used
   elsewhere in the file for logging/labeling purposes — grep for other
   uses of the `week` variable before removing it; it is very likely still
   needed for the `lastScannedWeek` writes (T008 in WP02 confirmed those
   stay unchanged) and for `shouldRun(engine, item.id, week, rates[engine])`
   at line ~219, which is unrelated to this mission's scope and must not
   be touched).

2. Update the `pickBatch` call (line 127) to the new signature:
   ```js
   const { batch, scannedThisWeek } = pickBatch(state, now, budget, weeklyCap, target);
   ```

3. **Fix the `lastScannedAt` gap**: at each of the three write sites that
   currently set `lastScannedWeek` without also setting `lastScannedAt`
   (lines 197, 207, 402 in the pre-WP02/WP03 file — re-locate them in your
   working copy since line numbers may have shifted slightly after WP02's
   changes to `state.js`, which is a different file, so `scan.js`'s line
   numbers are unaffected by WP02 but double-check against your checkout),
   add a matching `state.pages[item.id].lastScannedAt = new Date().toISOString();`
   line immediately alongside the existing `lastScannedWeek` write. This
   ensures url-filtered, robots-disallowed, and download-caught-as-error
   pages correctly become interval-ineligible for their configured rescan
   window, matching today's "don't retry this week" intent under the new
   elapsed-day model. Without this fix, those three page outcomes would be
   picked again on the very next run once WP02's eligibility rule ships —
   a real behavior regression, not a preservation of current behavior.

4. Stamp `state.lastDomainScanDate` once, the first time the run actually
   scans at least one page — i.e. inside the loop, on the first successful
   iteration through the `for (const item of batch)` loop that reaches a
   real scan outcome (not the pre-loop setup). The simplest correct
   placement: initialize `let scannedAnyPage = false;` before the loop,
   set `scannedAnyPage = true;` right after entering the loop body (or at
   the first outcome branch), and after the loop, if `scannedAnyPage` is
   true, set `state.lastDomainScanDate = now.toISOString().slice(0, 10);`
   before the final `saveState(...)` call. A run that finds zero eligible
   pages (`batch.length === 0`) must **not** stamp `lastDomainScanDate` —
   it hasn't consumed the day's `daily`-cadence slot per plan.md's Design
   section ("a run that finds zero eligible pages and exits early does not
   consume the day's daily cadence slot").

**Validation**: `node src/scan.js --domain <test-target>` (or the project's
existing test/smoke-test invocation) runs without throwing; a state file
written after a run that scanned at least one page has
`lastDomainScanDate` set to today's UTC date; a run with an empty batch
leaves `lastDomainScanDate` unchanged from before the run.

### T010: (folded into T009 above — see the `lastDomainScanDate` stamping logic)

This subtask is intentionally merged into T009's implementation steps
above rather than kept separate, since the stamping logic is tightly
coupled to the scan loop's control flow and splitting it into a separate
pass would require re-deriving "did this run scan anything" after the
fact. Mark T010 done alongside T009 in `spec-kitty agent tasks
mark-status`.

### T011: Update `scripts/list-scan-domains.js`.

**Files**: `scripts/list-scan-domains.js`

Replace:
```js
const week = isoWeek();
```
with:
```js
const now = new Date();
```
(remove the now-unused `isoWeek` import if nothing else in this small file
needs it — check the full file; per the excerpt above, `week` is currently
only used for the `budgetStatus` call, so the import can be dropped
entirely).

Update the `budgetStatus` call:
```js
const { cap, scannedThisWeek, remaining, frontierEmpty } = budgetStatus(state, now, t);
```

No other change is needed in this file — `budgetStatus`'s return shape
(`{ cap, scannedThisWeek, remaining, frontierEmpty }`) is unchanged; WP02
already folded the `daily`-cadence check into `frontierEmpty`, so a
`daily`-cadence domain that already ran today is excluded from the CI
matrix by this script's existing `frontierEmpty` skip logic with zero
structural change here (satisfies spec.md FR-003's requirement that this
reuses the existing decision point).

**Validation**: `node scripts/list-scan-domains.js` (with `GITHUB_OUTPUT`
set to a scratch file, matching how CI invokes it) runs without throwing
and produces the same domain list as before this WP, for state files/
targets that haven't opted into `daily` cadence or shortened intervals.

## Definition of Done

- [ ] `src/scan.js` calls `pickBatch(state, now, budget, weeklyCap, target)` with the new signature.
- [ ] All five `lastScannedWeek` write sites in `src/scan.js` now also write `lastScannedAt` (three previously did not — fixed by this WP).
- [ ] `state.lastDomainScanDate` is stamped to today's UTC date only when at least one page was actually scanned this run.
- [ ] `scripts/list-scan-domains.js` calls `budgetStatus(state, now, t)` with the new signature; unused `isoWeek` import removed if applicable.
- [ ] `.github/workflows/scan.yml` is **not** touched by this WP (per spec.md NFR-004 — this WP only changes the two `.js` files it owns).
- [ ] `npm run check:spec-kitty` passes.
- [ ] Manual smoke test: a scan run against a small test target completes and produces a state file with correctly-populated `lastScannedAt` on every scanned/skipped page outcome, and `lastDomainScanDate` set appropriately.

## Risks

- **The `lastScannedAt` gap fix (T009.3) is a deliberate, in-scope
  behavior correction**, not scope creep — without it, WP02's elapsed-day
  rule would silently regress url-filtered/robots-disallowed/download-error
  pages to "always eligible," which contradicts spec.md's compatibility
  requirement ("Preserve all existing functionality"). Flag this fix
  clearly in your commit message/PR description so reviewers don't mistake
  it for an unrelated change.
- **`week` variable removal**: do not remove `const week = isoWeek(now)`
  if anything else in `scan.js` still reads it (e.g. `shouldRun(engine,
  item.id, week, rates[engine])`, the `lastScannedWeek` writes themselves,
  or `writePageRecord`'s week-labeling). Only replace the *eligibility*
  use (the `pickBatch` call), not every use of `week` in the file.
- **`.github/workflows/scan.yml` must stay untouched** per spec.md
  NFR-004 — this WP's file-ownership is scoped to exactly `src/scan.js`
  and `scripts/list-scan-domains.js`; do not edit the workflow file even
  if you notice something that looks related.

## Reviewer Guidance

Confirm: (1) `pickBatch`/`budgetStatus` call sites match WP02's actual
final signatures exactly; (2) every `lastScannedWeek` write site in
`scan.js` has a matching `lastScannedAt` write (grep both fields' write
counts and confirm they're equal); (3) `lastDomainScanDate` is only
stamped on a run that scanned $\geq 1$ page, never on an empty-batch run;
(4) `.github/workflows/scan.yml` has zero diff from this WP.
