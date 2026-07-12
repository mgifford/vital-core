# Spec: Configurable scan cadence and URL rescan intervals

**Mission**: `scan-cadence-config-01KXBWGE`
**Branch**: `claude/vital-core-issue-214-spec-m237h3`
**Status**: Draft

---

## Purpose

The scanner currently enforces exactly one scheduling rule everywhere: a page
is eligible for rescan only if it has not already been scanned in the current
ISO week (`state.js`'s `p.lastScannedWeek !== week` filter), and a domain has
no cadence control beyond "run whenever the nightly workflow's cron fires and
there's budget left." This is too coarse for a fleet of targets with very
different value/traffic profiles: some domains warrant same-day rescans of
their top pages, others don't need to be touched more than once a week, and
some pages (a homepage) are worth re-checking far more often than a
long-tail archive page discovered by crawl.

This mission makes both dimensions configurable per target, with defaults
that reproduce today's exact behavior for every target that doesn't opt in.

## Problem Statement

Two coarse, hard-coded assumptions live in the scheduler today:

1. **Domain-level**: nothing throttles a domain's own scan frequency beyond
   the CI cron schedule and weekly page budget — there is no way to say "only
   run this domain's scan once per day" independent of how often the cron
   fires.
2. **URL-level**: every page (priority or not) uses the same eligibility
   rule — "not yet scanned this ISO week" — with no way to make a domain's
   important pages rescan more or less often than its long-tail pages, and no
   way to express an interval that isn't aligned to week boundaries.

## Scope of this mission

Add three new per-target config fields (with global defaults in
`config/targets.yml`'s `defaults:` block), and change the URL-eligibility
math in `src/lib/state.js` from an ISO-week-string comparison to an
elapsed-days-since-last-scan comparison, sourced from the `lastScannedAt`
timestamp that already exists in state (no state schema changes, no
migration). Add a domain-level "has this domain already run today (UTC)"
check for the new `daily` cadence option, consulted by the same code path
`scripts/list-scan-domains.js` already uses to decide whether a domain gets a
CI matrix job.

This mission does **not** change:
- The weekly page budget (`max_pages_per_week`) or importance scaling
  (`weeklyCapFor`).
- Priority-first ordering in the scan queue.
- `.github/workflows/scan.yml`'s cron schedule, `workflow_dispatch` inputs,
  or job structure.
- The on-disk state file schema (existing fields keep their current meaning
  and are still written; no new state file version, no migration script).
- Retry/fail-count handling (`failCount < 3`).

## Functional Requirements

| ID | Requirement | Status |
|---|---|---|
| FR-001 | `config/targets.yml`'s `defaults:` block supports `domain_scan_cadence` (`incremental` \| `daily`, default `incremental`), `url_rescan_interval_days` (positive integer, default `7`), and `priority_url_rescan_interval_days` (positive integer, default `7`). All three are resolved onto every target in `src/lib/config.js`, per-target values overriding the global default (same merge pattern as every other `defaults:`-backed field). | Proposed |
| FR-002 | `domain_scan_cadence: incremental` (the default) preserves exactly today's behavior: a domain may be scanned multiple times per UTC day, limited only by eligible URLs and the weekly budget. `www.cms.gov` is not given an explicit `domain_scan_cadence` and therefore continues on `incremental`. | Proposed |
| FR-003 | `domain_scan_cadence: daily` makes a domain ineligible for a scan run if it has already completed a scan run earlier the same UTC day; the domain becomes eligible again at UTC midnight. This check happens at the same decision point `scripts/list-scan-domains.js` already uses (`budgetStatus`/domain-selection), so a `daily`-cadence domain that already ran today is excluded from that night's CI matrix the same way a cap-exhausted or frontier-empty domain is today. | Proposed |
| FR-004 | Ordinary (non-priority) URL eligibility is `lastScannedAt == null OR (now − lastScannedAt) >= url_rescan_interval_days`, replacing the `lastScannedWeek !== week` filter. `lastScannedAt` is the field `src/lib/state.js`'s `addPage`/scan-recording logic already populates; no new state fields are required for this rule. | Proposed |
| FR-005 | Priority URL eligibility uses the same elapsed-time formula but with `priority_url_rescan_interval_days` in place of `url_rescan_interval_days`. Priority URLs remain sorted before non-priority URLs in `pickBatch`'s candidate ordering, unchanged from today. | Proposed |
| FR-006 | The weekly page budget (`weeklyCapFor`, `max_pages_per_week`, importance scaling) continues to gate how many pages a single run/week may scan, applied on top of (not instead of) the new elapsed-day eligibility filter — a page can be interval-eligible and still not scanned this run if the budget is exhausted. | Proposed |
| FR-007 | `lastScannedWeek` continues to be written on every scan outcome exactly as today (for any downstream code, reporting, or diagnostics that reads it), but it is no longer read for eligibility decisions anywhere in `pickBatch` or `budgetStatus`. | Proposed |
| FR-008 | Existing state files (with `lastScannedWeek`/`lastScannedAt` values from before this mission) work unmodified under the new eligibility rule — no migration script, no state version bump, no required one-time rewrite. | Proposed |

## Non-Functional Requirements

| ID | Requirement | Status |
|---|---|---|
| NFR-001 | All currently-passing tests in `tests/unit/lib.test.js` covering `pickBatch`, `budgetStatus`, `weeklyCapFor`, and `addPage` continue to pass, updated only where they assert the literal `lastScannedWeek !== week` mechanism rather than the eligibility *outcome* (e.g. "a just-scanned page is not immediately eligible again" must still hold; the test's method of asserting it may need to change from setting `lastScannedWeek` to setting `lastScannedAt`). | Proposed |
| NFR-002 | New unit tests cover: resolved defaults when a target sets none of the three new fields; per-target override of each of the three fields independently; elapsed-day URL eligibility at the boundary (interval−1 day: ineligible; interval day: eligible) using `lastScannedAt`; `daily` domain cadence blocking a same-UTC-day rescan and allowing one the next UTC day; `incremental` domain cadence behaving identically to today (multiple eligible runs same day); and a state file with only legacy fields populated (`lastScannedWeek` set, `lastScannedAt` present per the existing schema) working correctly under the new rule. | Proposed |
| NFR-003 | Ordering of `pickBatch`'s candidate list stays deterministic per `(state, "now" input)` for replay/testing purposes, consistent with today's per-week `weeklyRank` determinism — the elapsed-time model must not introduce nondeterminism into otherwise-identical inputs. | Proposed |
| NFR-004 | `.github/workflows/scan.yml` is unchanged by this mission except for previously-approved, unrelated workflow improvements — no new inputs, no new jobs, no schedule changes. | Proposed |

## Constraints

| ID | Constraint | Status |
|---|---|---|
| C-001 | `www.cms.gov`'s target entry in `config/targets.yml` is not given an explicit `domain_scan_cadence`, `url_rescan_interval_days`, or `priority_url_rescan_interval_days` override — it inherits the global defaults, which reproduce its current behavior exactly (incremental cadence; effectively unthrottled rescan within the existing weekly-cap/ISO-week-equivalent cadence, since default `url_rescan_interval_days: 7` approximates "about once a week" the same as the old rule for a domain scanned roughly weekly). | Accepted |
| C-002 | No new state schema version or migration path — every field this mission reads from state (`lastScannedAt`, `priority`, `failCount`) already exists in every state file written by the current code. | Accepted |
| C-003 | `pickBatch`'s and `budgetStatus`'s exported signatures may change (e.g. to accept a "now" reference instead of/alongside a `week` string) but must remain callable from `src/scan.js` and `scripts/list-scan-domains.js` with a coherent, single migration of all call sites in this mission — no dual old/new API left behind. | Accepted |
| C-004 | Time-dependent tests must inject a fixed "now" (mirroring the existing `VITAL_WEEK` override pattern in `src/lib/week.js`) rather than depending on wall-clock time, so the new tests are deterministic and not flaky around day/week boundaries. | Accepted |

## Out of Scope

- Any change to `max_pages_per_week`, importance scaling, or the weekly
  budget formula.
- Any change to the CI workflow's cron schedule, concurrency groups, or
  `workflow_dispatch` inputs.
- A UI or dashboard for visualizing cadence/interval configuration.
- Cadence options beyond `incremental` and `daily` (e.g. `hourly`,
  `weekly`, custom cron-like expressions) — not requested, not implemented.
- Retroactively rewriting `lastScannedWeek` semantics for historical
  reporting; the field's existing meaning and consumers are untouched.

---

## User Scenarios & Testing

### Scenario 1: A target with no overrides behaves exactly as before
An operator runs the nightly scan for `www.cms.gov`, which sets none of the
three new fields.
**Acceptance**: The domain is eligible to run as many times as the cron
schedule invokes it in a day (incremental), and its pages become eligible
for rescan again roughly a week after their last scan (default 7-day
interval) — functionally indistinguishable from today's ISO-week rule for a
domain scanned on a roughly-weekly cadence.

### Scenario 2: A low-value domain opts into daily cadence
An operator sets `domain_scan_cadence: daily` on a target that currently
gets scanned by every cron firing in a night.
**Acceptance**: Once that domain completes a scan run on a given UTC day,
subsequent cron firings the same day skip it (it does not appear in that
night's remaining CI matrix runs); it becomes eligible again after UTC
midnight.

### Scenario 3: A target shortens its priority-page rescan interval
An operator sets `priority_url_rescan_interval_days: 1` on a target whose
priority URLs (top-task pages) should be checked daily, while its ordinary
pages keep the default 7-day interval.
**Acceptance**: A priority page scanned earlier today is ineligible again
until roughly 24 hours have elapsed; an ordinary page scanned the same day
remains ineligible for roughly 7 days. Priority pages still sort before
ordinary pages in the scan queue whenever both are eligible.

### Scenario 4: Existing state file, no config change
An operator runs a scan against a state file created before this mission
shipped, for a target that has not been given any new config fields.
**Acceptance**: The scan behaves the same as Scenario 1 — the pre-existing
`lastScannedAt` values in the state file are read correctly by the new
elapsed-day rule with no error, no migration step, and no change to page
ordering for pages with identical eligibility.

### Scenario 5: Boundary of the rescan interval
A page was last scanned exactly `url_rescan_interval_days` ago (to the
day).
**Acceptance**: The page is eligible for rescan (interval is inclusive of
the boundary day, i.e. `>=`, not `>`).

---

## Success Criteria

1. `config/targets.yml` documents and (optionally) demonstrates the three
   new fields; `www.cms.gov` is unmodified and continues on incremental
   cadence with default intervals.
2. `src/lib/state.js` eligibility (`pickBatch`, `budgetStatus`) is driven by
   elapsed days since `lastScannedAt`, not ISO-week string comparison, for
   ordinary and priority URLs independently.
3. A `daily` domain cadence is enforced at the same point
   `scripts/list-scan-domains.js` currently gates on weekly budget/frontier
   state.
4. `npm run test:unit` passes, including new tests enumerated in NFR-002.
5. No state migration is required; every currently-committed state file
   under `state/` continues to work.
6. `.github/workflows/scan.yml` has no changes beyond previously-approved,
   unrelated improvements.
7. Every `DRAFT`/`NOT YET IMPLEMENTED` comment introduced or existing for
   this feature is removed once the feature is complete — no dangling
   scaffolding comments left in shipped code.

## Key Entities

| Entity | Description |
|---|---|
| `domain_scan_cadence` | Per-target config field, `incremental` (default) or `daily`, controlling whether a domain may run more than once per UTC day. |
| `url_rescan_interval_days` | Per-target config field (default 7), minimum elapsed days before an ordinary URL is eligible for rescan. |
| `priority_url_rescan_interval_days` | Per-target config field (default 7), minimum elapsed days before a priority (top-task) URL is eligible for rescan. |
| `lastScannedAt` | Existing per-page state field (ISO timestamp); becomes the source of truth for rescan eligibility instead of `lastScannedWeek`. |

## Assumptions

- "Once per UTC day" for `daily` cadence is determined by comparing UTC
  calendar dates (`YYYY-MM-DD`), the same boundary convention `isoWeek()`
  already uses for week boundaries, not a rolling 24-hour window — this
  matches the plain-language spec text ("scheduled scans run at most once
  per UTC day") and keeps the semantics simple and testable.
- `url_rescan_interval_days` and `priority_url_rescan_interval_days` are
  measured in elapsed calendar days from `lastScannedAt` to "now", using
  `>=` (inclusive) at the boundary, matching Scenario 5.
- A page that has never been scanned (`lastScannedAt === null`) is always
  eligible, regardless of interval configuration — unchanged from today's
  `lastScannedWeek === null` treatment.
- Domain-level cadence state (whether a domain already ran today) is
  tracked in the domain's own state file, since state is already
  domain-scoped and this avoids introducing a new state store.
- `pickBatch`/`budgetStatus` will take a "now" timestamp/date parameter
  (replacing or alongside the `week` parameter) — the exact signature is a
  `plan.md` decision, constrained by C-003 (single coherent migration, no
  dual API).
