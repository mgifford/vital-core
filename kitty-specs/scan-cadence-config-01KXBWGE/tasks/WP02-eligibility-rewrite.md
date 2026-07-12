---
work_package_id: WP02
title: Elapsed-day eligibility + domain cadence in state.js
dependencies:
- WP01
requirement_refs:
- C-002
- C-003
- C-004
- FR-003
- FR-004
- FR-005
- FR-006
- FR-007
- FR-008
- NFR-003
tracker_refs: []
planning_base_branch: claude/vital-core-issue-214-spec-m237h3
merge_target_branch: claude/vital-core-issue-214-spec-m237h3
branch_strategy: Planning artifacts for this mission were generated on claude/vital-core-issue-214-spec-m237h3. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/vital-core-issue-214-spec-m237h3 unless the human explicitly redirects the landing branch.
subtasks:
- T004
- T005
- T006
- T007
- T008
agent: ''
shell_pid: 0
history: []
authoritative_surface: src/lib/state.js
create_intent: []
execution_mode: code_change
owned_files:
- src/lib/state.js
tags: []
---

## ⚡ Do This First: Load Agent Profile

Before reading anything else in this prompt, load the assigned agent profile
(see this WP's frontmatter `agent_profile`/`role` if set) via the
`ad-hoc-profile-load` skill/command. If no profile is assigned, proceed as a
general implementer.

## Objective

Replace `src/lib/state.js`'s hard-coded "not scanned this ISO week"
eligibility rule with elapsed-days-since-`lastScannedAt` math (independently
configurable for priority vs ordinary URLs), and add a domain-level `daily`
cadence gate. This is the highest-risk work package in the mission — it
rewrites the core scheduling algorithm and its extensive existing test
coverage (owned by WP04, but you must not break the *outcomes* those tests
assert, only their mechanism).

**Read `kitty-specs/scan-cadence-config-01KXBWGE/spec.md` in full before
starting** — in particular FR-003 through FR-008, NFR-003, and Constraints
C-002 through C-004. Also read `plan.md`'s "State shape", "Eligibility
rewrite", and "Domain cadence gate" Design subsections — they specify the
exact function signatures and field names this WP must produce.

## Context: current code (read before editing)

`src/lib/state.js`'s current shape (read the whole file first — it is only
~146 lines):

```js
export function loadState(domainKey, domain) {
  const p = statePath(domainKey);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  return { domain, seededAt: null, pages: {} };
}

export function addPage(state, id, url, depth, { priority = false } = {}) {
  // ...
  state.pages[id] = {
    url, discoveredAt: new Date().toISOString(), depth, priority,
    lastScannedWeek: null, lastScannedAt: null, lastStatus: null, failCount: 0,
  };
  // ...
}

export function weeklyCapFor(target) { /* unchanged by this WP */ }

export function budgetStatus(state, week, target) {
  const cap = weeklyCapFor(target);
  const entries = Object.entries(state.pages);
  const scannedThisWeek = entries.filter(([, p]) => p.lastScannedWeek === week).length;
  const remaining = Math.max(0, cap - scannedThisWeek);
  const frontierEmpty = !entries.some(([, p]) => p.lastScannedWeek !== week && p.failCount < 3);
  return { cap, scannedThisWeek, remaining, frontierEmpty };
}

export function pickBatch(state, week, budget, scannedThisWeekCap) {
  const entries = Object.entries(state.pages);
  const scannedThisWeek = entries.filter(([, p]) => p.lastScannedWeek === week).length;
  const remainingWeekly = Math.max(0, scannedThisWeekCap - scannedThisWeek);
  const n = Math.min(budget, remainingWeekly);
  if (n === 0) return { batch: [], scannedThisWeek };
  const candidates = entries
    .filter(([, p]) => p.lastScannedWeek !== week && p.failCount < 3)
    .map(([id, p]) => ({ id, p, rank: weeklyRank(id, week) }))
    .sort((a, b) => { /* priority first, then never-scanned first, then rank */ })
    .slice(0, n)
    .map(({ id, p }) => ({ id, url: p.url, depth: p.depth, priority: !!p.priority }));
  return { batch: candidates, scannedThisWeek };
}

function weeklyRank(pageId, week) {
  const hex = crypto.createHash('sha256').update(`${pageId}|${week}`).digest('hex').slice(0, 13);
  return parseInt(hex, 16) / 2 ** 52;
}
```

## Subtasks

### T004: Add elapsed-time helpers.

**Files**: `src/lib/state.js`

Add two module-private helper functions near the top of the file (after
imports, before `statePath`):

```js
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

`daysSince` returning `Infinity` for a `null`/missing `lastScannedAt` means
`isPageEligible` is trivially `true` for never-scanned pages regardless of
interval — this reproduces today's `p.lastScannedWeek === null` treatment
(spec.md Assumptions).

**Defensive default for `target` objects without resolved cadence fields**:
`pickBatch`/`budgetStatus` must not assume every caller's `target` argument
went through `loadConfig()` — the existing test suite
(`tests/unit/lib.test.js`) constructs raw `target` object literals directly
(e.g. `{ max_pages_per_week: 3, importance: 3 }`, with no
`urlRescanIntervalDays`/`priorityUrlRescanIntervalDays`/`domainScanCadence`
keys at all). When you wire `target.urlRescanIntervalDays` etc. into
`isPageEligible`'s call sites in T005/T006, default missing values to the
same constants WP01 uses (`7` for both interval fields, `'incremental'` for
cadence) directly at the read site, e.g.:
`target.urlRescanIntervalDays ?? 7`. This keeps `state.js` correct even
when called with a minimal/legacy-shaped `target`, and keeps WP04's test
updates simpler (they don't have to add the three new fields to every
existing `target` fixture, only the new tests that specifically exercise
cadence/interval behavior need to set them).

**Validation**: pure functions, no I/O — straightforward to unit test in
isolation (WP04 will do so), but write them so they're easy to test (no
hidden state, `now` always passed in explicitly per C-004).

### T005: Rewrite `pickBatch()`.

**Files**: `src/lib/state.js`

Change the signature from `pickBatch(state, week, budget, scannedThisWeekCap)`
to `pickBatch(state, now, budget, scannedThisWeekCap, target)`. Replace the
eligibility filter and the "scanned this week" counter:

```js
export function pickBatch(state, now, budget, scannedThisWeekCap, target) {
  const entries = Object.entries(state.pages);
  // "Recently scanned" for the cap-tracking counter/log line now means
  // "within the last 7 days" (a rolling window), not "this ISO week" —
  // continuity of meaning for the human-readable summary log
  // (src/scan.js's "N scanned in <week>" line), not a behavior change to
  // the cap itself (weeklyCapFor/max_pages_per_week are untouched).
  const scannedThisWeek = entries.filter(([, p]) => daysSince(p.lastScannedAt, now) < 7).length;
  const remainingWeekly = Math.max(0, scannedThisWeekCap - scannedThisWeek);
  const n = Math.min(budget, remainingWeekly);
  if (n === 0) return { batch: [], scannedThisWeek };

  const candidates = entries
    .filter(([, p]) => isPageEligible(p, now, target.urlRescanIntervalDays ?? 7, target.priorityUrlRescanIntervalDays ?? 7))
    .map(([id, p]) => ({ id, p, rank: weeklyRank(id, isoWeek(now)) }))
    .sort((a, b) => {
      const ap = a.p.priority ? 0 : 1;
      const bp = b.p.priority ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const an = a.p.lastScannedAt === null ? 0 : 1;
      const bn = b.p.lastScannedAt === null ? 0 : 1;
      if (an !== bn) return an - bn;
      return a.rank - b.rank;
    })
    .slice(0, n)
    .map(({ id, p }) => ({ id, url: p.url, depth: p.depth, priority: !!p.priority }));

  return { batch: candidates, scannedThisWeek };
}
```

Notes:
- `weeklyRank`'s per-week shuffle salt stays keyed on the ISO week string
  (via `isoWeek(now)` — `src/lib/week.js`'s `isoWeek(date = new Date())`
  already accepts an optional `Date` parameter, so `import { isoWeek } from
  './week.js'` and call `isoWeek(now)` directly; no change needed to
  `week.js` itself). This satisfies NFR-003 (determinism per `(state, now)`)
  by reusing the existing per-week salt — same page set on the same
  calendar week sorts identically on replay. Note `isoWeek()` also honors
  `process.env.VITAL_WEEK` when set (existing test-determinism escape
  hatch) — that behavior is unaffected by passing an explicit `now`.
- The "never-scanned first" tiebreak now checks `lastScannedAt === null`
  instead of `lastScannedWeek === null` — same semantic, different field.
- Update the function's doc comment (currently describing "ISO week"
  eligibility) to describe the new elapsed-day model. Do not leave stale
  prose describing the old mechanism.

**Validation**: `pickBatch`'s *candidate ordering behavior* (priority
first, then never-scanned first, then stable rank) is unchanged in shape —
only the eligibility predicate and the rank's week-derivation source
changed.

### T006: Rewrite `budgetStatus()`.

**Files**: `src/lib/state.js`

Change the signature from `budgetStatus(state, week, target)` to
`budgetStatus(state, now, target)`:

```js
export function budgetStatus(state, now, target) {
  const cap = weeklyCapFor(target);
  const entries = Object.entries(state.pages);
  const scannedThisWeek = entries.filter(([, p]) => daysSince(p.lastScannedAt, now) < 7).length;
  const remaining = Math.max(0, cap - scannedThisWeek);
  const pageFrontierEmpty = !entries.some(([, p]) => isPageEligible(p, now, target.urlRescanIntervalDays ?? 7, target.priorityUrlRescanIntervalDays ?? 7));
  const domainThrottled = !domainEligibleToday(state, now, target.domainScanCadence ?? 'incremental');
  const frontierEmpty = pageFrontierEmpty || domainThrottled;
  return { cap, scannedThisWeek, remaining, frontierEmpty };
}
```

Folding `domainThrottled` into `frontierEmpty` (rather than adding a new
return field) means `scripts/list-scan-domains.js` (WP03) needs **no**
structural change to how it interprets `budgetStatus`'s return shape — a
`daily`-cadence domain that already ran today is treated exactly like a
domain with an empty page frontier, satisfying FR-003's requirement that
this reuses the existing skip-a-domain decision point.

**Validation**: for a `daily`-cadence domain with `state.lastDomainScanDate`
equal to today's UTC date, `frontierEmpty` is `true` even if individual
pages are still interval-eligible. For an `incremental`-cadence domain (or
any domain on a day other than `lastDomainScanDate`), `frontierEmpty`
reflects only page-level eligibility, same as today.

### T007: Add `lastDomainScanDate` state field + `domainEligibleToday()`.

**Files**: `src/lib/state.js`

Update `loadState()`'s fallback object literal to include the new field:

```js
export function loadState(domainKey, domain) {
  const p = statePath(domainKey);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  return { domain, seededAt: null, lastDomainScanDate: null, pages: {} };
}
```

Note: for an **existing** state file on disk that predates this field,
`JSON.parse` will simply not have the `lastDomainScanDate` key —
`state.lastDomainScanDate` will be `undefined` at runtime for those files.
This must be treated identically to `null` (falsy) everywhere it's read —
do not add a `.hasOwnProperty` check or throw; `undefined` and `null` both
mean "never recorded a domain-scan date," which is correct backward-
compatible behavior per C-002 (no migration required).

Add the new exported helper (place it near `weeklyCapFor`/`budgetStatus`,
with a doc comment explaining its purpose per spec.md FR-003):

```js
/**
 * Whether a domain with `daily` cadence may run again today. Always true
 * for `incremental` cadence (no domain-level throttle). "Today" is a UTC
 * calendar date comparison (YYYY-MM-DD), not a rolling 24-hour window.
 */
export function domainEligibleToday(state, now, cadence) {
  if (cadence !== 'daily') return true;
  const today = now.toISOString().slice(0, 10);
  return state.lastDomainScanDate !== today;
}
```

This function is also used directly inside `budgetStatus` (T006) — it does
not need to be called separately by `scan.js`/`list-scan-domains.js`
(WP03), since `budgetStatus` already folds it in. It is exported primarily
so WP04's tests can exercise it directly and precisely, and so
`src/scan.js` (WP03) can use it if a direct check is more convenient than
re-deriving from `budgetStatus`'s `frontierEmpty` — use your judgment in
WP03, but do not duplicate the date-comparison logic there; call this
function.

**Validation**: a domain with `cadence: 'incremental'` is always eligible
regardless of `lastDomainScanDate`. A domain with `cadence: 'daily'` and
`lastDomainScanDate === null` is eligible. A domain with `cadence: 'daily'`
and `lastDomainScanDate` equal to today's UTC date is ineligible. A domain
with `cadence: 'daily'` and `lastDomainScanDate` equal to yesterday's UTC
date is eligible.

### T008: Confirm `lastScannedWeek` write-path is unchanged.

**Files**: none in `state.js` (verification-only subtask; the actual write
happens in `src/scan.js`, out of scope for this WP — WP03 owns that file)

This WP must not touch how `lastScannedWeek` is written — only how it is
(no longer) read for eligibility. Confirm by inspection that nothing in
your `state.js` changes removes or alters the `lastScannedWeek` field's
presence in `addPage()`'s initial page-record shape (`lastScannedWeek: null`
stays in `addPage`). `src/scan.js`'s writes to `lastScannedWeek` on scan
outcomes are WP03's concern, not this WP's — do not preemptively edit
`scan.js` here.

**Validation**: `addPage()` in your final diff still initializes
`lastScannedWeek: null` on new page records, unchanged from today.

## Definition of Done

- [ ] `pickBatch(state, now, budget, scannedThisWeekCap, target)` uses elapsed-day eligibility (priority vs ordinary interval independently), keeps priority-first/never-scanned-first/stable-rank ordering.
- [ ] `budgetStatus(state, now, target)` uses elapsed-day eligibility and folds in `domainEligibleToday` for `daily` cadence.
- [ ] `loadState()`'s fallback shape includes `lastDomainScanDate: null`; reading it from a state file missing the key is treated as `null`/falsy.
- [ ] `domainEligibleToday(state, now, cadence)` is exported and correctly UTC-date-gated.
- [ ] `addPage()` still writes `lastScannedWeek: null` on new records (T008 — no regression).
- [ ] Doc comments on `pickBatch`/`budgetStatus` describe the new elapsed-day model, not the old ISO-week model.
- [ ] `npm run check:spec-kitty` passes. (Full `npm run test:unit` will not pass yet — WP04 owns updating the existing tests to the new signatures; that is expected and fine to leave for WP04, but do not leave `state.js` in a state that fails to *load*/parse.)

## Risks

**This is the highest-risk WP in the mission.** It rewrites the core
scheduling algorithm. Specific risks to watch for:
- **Signature drift**: `pickBatch`/`budgetStatus` gain a new `target`/`now`
  parameter — every existing caller (`src/scan.js`,
  `scripts/list-scan-domains.js`) will be broken until WP03 updates them.
  This is expected and correct per spec.md C-003 (single coherent
  migration) — do not attempt to keep a backward-compatible dual signature.
- **`isoWeek()` usage**: `isoWeek(now)` is safe to call directly —
  `src/lib/week.js` already supports an optional `Date` parameter. Do not
  duplicate ISO-week calculation logic inside `state.js`.
- **Off-by-one on the interval boundary**: spec.md Scenario 5 requires
  `>=` (inclusive) — a page scanned exactly `N` days ago is eligible at
  interval `N`, not just at `N+1`. Double-check `daysSince(...) >= interval`
  uses `>=`, not `>`.

## Reviewer Guidance

Confirm: (1) the eligibility predicate genuinely uses `lastScannedAt` and
the correct interval per `p.priority`, not `lastScannedWeek` anywhere; (2)
`budgetStatus`'s `frontierEmpty` correctly reflects `daily`-cadence
throttling without requiring `list-scan-domains.js` (not yet updated in
this WP) to change its interpretation of the return shape; (3)
`lastDomainScanDate` absent-vs-null are treated identically; (4) the
priority-first/never-scanned-first/rank sort order in `pickBatch` is
untouched in shape, only its inputs changed.
