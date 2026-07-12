# Implementation Plan: Configurable scan cadence and URL rescan intervals

**Branch**: `claude/vital-core-issue-214-spec-m237h3` | **Date**: 2026-07-12 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `kitty-specs/scan-cadence-config-01KXBWGE/spec.md`

## Summary

Replace the hard-coded once-per-ISO-week URL eligibility rule in
`src/lib/state.js` with elapsed-days-since-`lastScannedAt` math, driven by
two new per-target config fields (`url_rescan_interval_days`,
`priority_url_rescan_interval_days`, both defaulting to 7). Add a third
field, `domain_scan_cadence` (`incremental` default | `daily`), enforced via
a new state field (`lastDomainScanDate`, a UTC `YYYY-MM-DD` string) checked
in `budgetStatus()` — the same function `scripts/list-scan-domains.js`
already calls to decide whether a domain gets a CI matrix job. No state
schema version bump; new fields are additively read with safe fallbacks so
every existing `state/**/crawl.json` file keeps working unmodified.

## Technical Context

**Language/Version**: Node.js ESM, >= 20 (per CLAUDE.md's Stack line), no build step, no bundler.
**Primary Dependencies**: None new. Reuses `node:crypto` (already used for `weeklyRank`) and native `Date`.
**Storage**: Existing per-domain JSON state files at `state/<domainKey>/crawl.json` (`src/lib/state.js`'s `statePath()`), written via the existing atomic `saveState()`. No new storage, no migration.
**Testing**: Node built-in test runner (`node:test`), `tests/unit/**/*.test.js`, run via `npm run test:unit`. New tests inject a fixed "now" parameter rather than depending on wall-clock time (spec.md C-004).
**Target Platform**: Same as today — GitHub Actions CI (`.github/workflows/scan.yml`) and local CLI invocation (`node src/scan.js`).
**Project Type**: Single project (existing CLI/library structure under `src/`).
**Performance Goals**: No regression — `pickBatch`/`budgetStatus` remain O(n) over a domain's page count, same as today; elapsed-day math is a single subtraction per page, no heavier than the current string comparison.
**Constraints**: Must reproduce www.cms.gov's exact current behavior with zero config changes to that target (spec.md C-001). Must not require a state migration (spec.md C-002). `.github/workflows/scan.yml` unchanged except previously-approved improvements (spec.md NFR-004).
**Scale/Scope**: ~11 configured targets in `config/targets.yml` today; state files range from tens to low-thousands of page entries per domain.

## Charter Check

*GATE: checked before design, re-checked after design below.*

- **efficient-recurring-scans** directive: this mission's entire purpose is
  making scan frequency more deliberately configurable per target — directly
  in service of this directive (lets low-value domains be throttled to
  `daily` instead of scanning on every cron firing). PASS.
- **stable-page-identity** directive: no change to how page IDs are derived
  or how records dedupe across weeks — `pageId()`/`writePageRecord()` are
  untouched. PASS.
- **historical-evidence-preservation** directive: no change to `data/`
  (append-only scan history) — this mission only touches `state/` (mutable
  crawl-progress state) and `config/`. PASS.
- No sustainability-gate concern: this is server-side/CI scheduling logic,
  not client-side report output — the `sustainable-web-output` directive
  does not apply here.

*Re-check after Design: unchanged — the concrete design below (new state
field, new config fields, elapsed-day math) doesn't introduce any new
external dependency, client-side code, or per-request cost beyond what the
Charter Check above already covers.*

## Project Structure

### Documentation (this mission)

```
kitty-specs/scan-cadence-config-01KXBWGE/
├── spec.md
├── plan.md              # this file
└── tasks.md             # produced by the tasks phase, not this plan
```

### Source Code (repository root)

```
config/
└── targets.yml           # + defaults.domain_scan_cadence, defaults.url_rescan_interval_days,
                           #   defaults.priority_url_rescan_interval_days (documented, defaulted)

src/
├── lib/
│   ├── config.js          # + t.domainScanCadence, t.urlRescanIntervalDays,
│   │                       #   t.priorityUrlRescanIntervalDays resolution
│   └── state.js            # eligibility rewrite: pickBatch()/budgetStatus() take a `now`
│                            #   reference instead of a `week` string for eligibility;
│                            #   addPage()/state root gain lastDomainScanDate tracking
├── scan.js                 # call-site updates: pass `now` instead of `week` to
│                            #   pickBatch/budgetStatus; stamp lastDomainScanDate on scan start
└── (unchanged) src/lib/week.js  # isoWeek() stays for lastScannedWeek bookkeeping (FR-007)

scripts/
└── list-scan-domains.js    # call-site update: pass `now`; daily-cadence domains that
                             #   already ran today are excluded the same way cap-exhausted
                             #   domains are today

tests/
└── unit/
    └── lib.test.js          # updated pickBatch/budgetStatus/addPage tests (now-based,
                              #   not week-based) + new cadence/interval/compat test blocks
```

**Structure Decision**: No new files, no new top-level directories. This
mission is a targeted rewrite of the eligibility logic inside
`src/lib/state.js` plus new config resolution in `src/lib/config.js`, with
call-site updates in the two places that invoke `pickBatch`/`budgetStatus`
(`src/scan.js`, `scripts/list-scan-domains.js`). All existing tests in
`tests/unit/lib.test.js` are updated in place rather than moved.

## Design

### Config fields (`src/lib/config.js`)

Following the same `{ ...defaults, ...t }` shallow-merge pattern every other
scalar `defaults:`-backed field already uses (`config.js:46`), plus a
validated-enum post-merge step matching the `design_system` precedent
(`config.js:57-63`) for `domain_scan_cadence`:

```js
const CADENCES = new Set(['incremental', 'daily']);
// ...inside the per-target loop, after the existing showLanguageSwitcher/webmcpEnabled lines:
t.domainScanCadence = t.domain_scan_cadence ?? 'incremental';
if (!CADENCES.has(t.domainScanCadence)) {
  throw new Error(`Unsupported domain_scan_cadence "${t.domainScanCadence}" in target ${t.domain}. Supported: incremental, daily.`);
}
t.urlRescanIntervalDays = Number(t.url_rescan_interval_days ?? 7);
t.priorityUrlRescanIntervalDays = Number(t.priority_url_rescan_interval_days ?? 7);
```

`url_rescan_interval_days` / `priority_url_rescan_interval_days` flow through
the existing `{ ...defaults, ...t }` spread automatically (they're plain
scalars, same as `max_pages_per_week`) — the explicit lines above only add
the `Number(...)` coercion (YAML may parse them as numbers already, but this
guards against a quoted string in config) and the default fallback for when
neither `defaults:` nor the target sets them (keeps `config.js` self-
contained rather than relying on the YAML file always declaring the
`defaults:` block).

`config/targets.yml`'s `defaults:` block gains the three documented fields
(`domain_scan_cadence: incremental`, `url_rescan_interval_days: 7`,
`priority_url_rescan_interval_days: 7`) so they're visible/discoverable in
the file even though `config.js` also has code-level fallbacks (belt and
suspenders — matches how `retention_weeks`/`max_pages_per_week` are already
both documented in `defaults:` *and* have inline fallbacks at point of use,
e.g. `src/prune.js:22`).

`www.cms.gov`'s target block is **not** touched — it inherits the new
defaults unchanged (spec.md C-001).

### State shape (`src/lib/state.js`)

One additive field at the state root, alongside `domain`/`seededAt`:

```js
{
  domain: "example.gov",
  seededAt: "2026-06-12T...",
  lastDomainScanDate: null,   // NEW: UTC "YYYY-MM-DD" string, or null
  pages: { ... }               // unchanged shape; lastScannedWeek/lastScannedAt/
                                // failCount/priority all keep their current meaning
}
```

`loadState()`'s fallback object literal (`state.js:32`) gains
`lastDomainScanDate: null` so a pre-existing state file without the field
(read via `JSON.parse` of the file on disk, which won't have the key) simply
gets `undefined` for that property when accessed — treated identically to
`null` by the new cadence check (`!lastDomainScanDate` is truthy for both).
No migration step, no version bump: this is the same additive-field pattern
`priority` used when it was added to page records.

### Eligibility rewrite

`pickBatch(state, week, budget, scannedThisWeekCap)` and
`budgetStatus(state, week, target)` both change their second parameter from
an ISO-week string to a `now` reference (a `Date`, matching how
`src/lib/week.js` already centralizes "what time is it" behind one
overridable function). Per spec.md C-003, this is a single coherent
migration — no old `week`-based signature is left behind.

```js
// src/lib/state.js
function daysSince(isoTimestamp, now) {
  if (!isoTimestamp) return Infinity; // never scanned = always eligible
  return (now.getTime() - new Date(isoTimestamp).getTime()) / 86400000;
}

function isPageEligible(p, now, urlRescanIntervalDays, priorityUrlRescanIntervalDays) {
  if (p.failCount >= 3) return false;
  const interval = p.priority ? priorityUrlRescanIntervalDays : urlRescanIntervalDays;
  return daysSince(p.lastScannedAt, now) >= interval;
}
```

`pickBatch` and `budgetStatus` take `target` (already a parameter of
`budgetStatus`; added to `pickBatch`'s signature) so they can read
`target.urlRescanIntervalDays` / `target.priorityUrlRescanIntervalDays`
directly, rather than the caller pre-computing a single global interval —
this preserves FR-005's requirement that priority and ordinary URLs use
independently configurable intervals within the same batch-selection pass.

`budgetStatus`'s "scanned this week" counter (used only for the human-
readable weekly-cap summary logging, `scan.js:128`) is redefined as
"scanned within the last 7 days" for continuity of that log line's meaning
— not a behavior-affecting change, since the cap itself
(`weeklyCapFor`/`max_pages_per_week`) is untouched (spec.md FR-006).

`weeklyRank`'s per-week shuffle (`state.js:142-145`) keeps using the ISO
week string (via `isoWeek()`) as its salt — NFR-003 only requires
determinism per `(state, now)`, and reusing the existing per-ISO-week salt
naturally satisfies that (same page set on the same day of the same week
sorts identically on replay) without inventing a new "per-day" or
"per-scan-run" salt concept that isn't otherwise needed.

### Domain cadence gate

New exported helper in `state.js`:

```js
export function domainEligibleToday(state, now, cadence) {
  if (cadence !== 'daily') return true; // incremental: no domain-level throttle
  const today = now.toISOString().slice(0, 10); // UTC YYYY-MM-DD
  return state.lastDomainScanDate !== today;
}
```

`budgetStatus()` folds this into its `frontierEmpty`/`remaining` computation
so a `daily`-cadence domain that already ran today reports as having
nothing to do — `scripts/list-scan-domains.js` excludes it from that
night's CI matrix exactly the way a cap-exhausted or frontier-empty domain
is excluded today (spec.md FR-003), with no separate code path needed in
`list-scan-domains.js` itself beyond passing `target.domainScanCadence`
through to `budgetStatus`.

`src/scan.js` stamps `state.lastDomainScanDate = <today's UTC date>` once,
the first time it actually scans at least one page in a run (mirroring how
`lastScannedWeek` is only stamped on pages that were actually scanned, not
speculatively) — a run that finds zero eligible pages and exits early does
not consume the day's `daily` cadence slot.

### `lastScannedWeek` (FR-007)

`scan.js` continues stamping `lastScannedWeek = isoWeek()` on every scan
outcome exactly as today (`isoWeek()`/`src/lib/week.js` is unchanged). This
field becomes write-only from the eligibility engine's perspective — kept
solely for any downstream reporting/diagnostics that already reads it (none
of which are in scope for this mission to audit or change).

## Implementation Concern Map

### IC-01 — Config field resolution

- **Purpose**: Add `domain_scan_cadence`, `url_rescan_interval_days`, `priority_url_rescan_interval_days` to `config/targets.yml` defaults and resolve them onto every target in `src/lib/config.js`.
- **Relevant requirements**: FR-001, FR-002, C-001.
- **Affected surfaces**: `config/targets.yml`, `src/lib/config.js`.
- **Sequencing/depends-on**: none — no dependency on state/scan changes.
- **Risks**: Low. Follows an established, already-tested merge pattern (`design_system` validation, `webmcpEnabled` opt-in flag).

### IC-02 — Elapsed-day eligibility + domain cadence in state.js

- **Purpose**: Replace `lastScannedWeek`-based eligibility with elapsed-days-since-`lastScannedAt` (per URL type) and add the `daily` domain-cadence gate.
- **Relevant requirements**: FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, NFR-003, C-002, C-003, C-004.
- **Affected surfaces**: `src/lib/state.js` (`pickBatch`, `budgetStatus`, `loadState`, new `domainEligibleToday` export).
- **Sequencing/depends-on**: IC-01 (needs the resolved `target.urlRescanIntervalDays` etc. fields to exist).
- **Risks**: Highest-risk concern in this mission — touches the core scheduling algorithm and its extensive existing test coverage. Mitigated by C-004 (fixed "now" injection in tests) and by keeping the candidate-selection *shape* (priority-first, then never-scanned-first, then stable rank) unchanged, only swapping the eligibility predicate itself.

### IC-03 — Call-site migration (scan.js, list-scan-domains.js)

- **Purpose**: Update both callers of `pickBatch`/`budgetStatus` to pass a `now` reference instead of a `week` string, and stamp `lastDomainScanDate` on actual scan completion.
- **Relevant requirements**: FR-003, C-003.
- **Affected surfaces**: `src/scan.js`, `scripts/list-scan-domains.js`.
- **Sequencing/depends-on**: IC-02 (needs the new function signatures to exist).
- **Risks**: Low-medium. `scan.js` is the least-tested file in this list (no dedicated `scan.test.js` per the mission's research), so manual review of the diff against the existing log-line/state-write behavior matters more than automated coverage here.

### IC-04 — Tests

- **Purpose**: Update existing `pickBatch`/`budgetStatus`/`addPage` tests in `tests/unit/lib.test.js` to the new `now`-based signature, and add new tests per spec.md NFR-002.
- **Relevant requirements**: NFR-001, NFR-002, NFR-003.
- **Affected surfaces**: `tests/unit/lib.test.js`.
- **Sequencing/depends-on**: IC-02, IC-03 (needs the final signatures to write against).
- **Risks**: Low — test-only changes, but must be thorough since this is the only executable spec for scheduling behavior (per the mission's research findings).

### IC-05 — Documentation + comment cleanup

- **Purpose**: Document the three new fields in `config/targets.yml`'s per-target options comment block (matching the style of `importance`/`design_system`/`webmcp` docs already there); remove any `DRAFT`/`NOT YET IMPLEMENTED` scaffolding comments once the feature is complete (spec.md Success Criterion 7).
- **Relevant requirements**: Success Criterion 1, Success Criterion 7.
- **Affected surfaces**: `config/targets.yml` (comment block), any doc file referencing the old once-per-week model (grep sweep during implementation — CLAUDE.md's "URL exclusion" table and similar sections don't currently describe cadence, so this is expected to be a small, contained edit).
- **Sequencing/depends-on**: IC-01 through IC-04 (documents the final, implemented behavior — not written against a moving target).
- **Risks**: Low.

## Complexity Tracking

*Fill ONLY if Charter Check has violations that must be justified.*

No charter violations. This mission is server-side scheduling logic with no
client-side/report-output surface, so the sustainability gate does not apply,
and no other charter directive is in tension with the design above.
