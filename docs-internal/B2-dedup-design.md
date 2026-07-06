# B2 design: deduplicate unchanged page records

Status: partially implemented. Baseline stub dedup + read-path resolution are in
`src/scan.js`, `src/lib/page-records.js`, and `src/aggregate.js`; prune-boundary
hardening and dedicated regression tests are still pending. Companion to the
retention work in `ARCHITECTURE.md` ("Retention contract") and
`docs-internal/ROADMAP-2026-07.md`.

## Problem

`data/<domain>/<week>/pages/<pageId>.json` stores one full record per
scanned page per week. Within `retention_weeks` (currently 3), most pages
don't change week-to-week — same findings, same resources, same tech
stack — so consecutive weeks largely duplicate each other's bytes.

## Constraint: every current reader expects a full record, every week

Confirmed by reading the actual call sites (not assumed):

- `aggregate.js:summarizeWeek` — reads every `pages/*.json` in the week
  dir and calls `summarizeRecords()` on the full set. No partial-record
  path exists.
- `aggregate.js:summarizeWindow` — the 7-day trailing-window view reads
  every page record in every retained week and filters by `scannedAt`.
  A stub with no `scannedAt`-bearing content would silently drop out of
  this window.
- `aggregate.js` inventory update loop (`updateInventory`, called once
  per week directly from `pages/*.json`, **before** `prune.js` runs) —
  this is what makes the longitudinal record durable: `inventory.json`
  is a committed ledger of "last-known status per URL," independent of
  whether the source week's `pages/` directory still exists. This
  already solves "summaries must still count the page" for *pruned*
  weeks — the same mechanism should be reused for *deduplicated* weeks.

Conclusion: a dedup stub cannot be a passive marker resolved only by
downstream report code. It must be resolvable by every one of the three
loops above, or those loops need to resolve it transparently (read the
stub, follow the pointer, treat it as if the full record were inline).
The simplest design pushes resolution into one place.

## Proposed design

1. **Fingerprint reuse.** Reuse the existing `sha8(...)` pattern from
   `src/lib/ai-findings.js` (already used for cross-week finding
   identity) to fingerprint a page record's *content*, excluding
   inherently-volatile fields: `scannedAt`, `runId`. Everything else
   (`status`, `depth`, `axe`, `alfa`, `resources`, `images`, `tech`,
   `standards`, `thirdParty`, `sustainability`, `plainLanguage`, ...)
   feeds the hash.

2. **Write path (`scan.js`).** When writing a page record, compute its
   fingerprint and compare to the fingerprint stored in `inventory.json`
   for that URL (already tracks `lastWeek`, extend with
   `lastFingerprint` and `lastFullRecordWeek`). If unchanged:
   - Still write a **small stub**, not skip the file entirely (a
     missing file is indistinguishable from "not scanned this week" —
     that ambiguity is precisely what the codebase currently avoids by
     always writing something per attempted page; see `pagesAttempted`
     vs `pagesSucceeded` tally).
   - Stub shape: `{ pageId, url, week, runId, scannedAt, status,
     unchanged: true, since: <week of last full record>, fingerprint }`.
     No `axe`/`alfa`/etc. bodies.
   - `scannedAt`/`runId`/`status` stay live even for stubs (cheap,
     already-collected fields), so `summarizeWindow`'s date filtering
     and pagesAttempted/Succeeded tallies keep working unmodified.

3. **Read path (single resolver function).** Add
   `resolvePageRecord(domainKey, week, stubOrRecord)` in a shared module
   (e.g. `src/lib/page-records.js`). If `unchanged !== true`, return as
   -is. Otherwise, look up `since` and read the full record from that
   earlier week's `pages/<pageId>.json` (or, if that week itself has
   been fully pruned by `retention_weeks`, from `inventory.json`'s
   last-known-good scored fields — the same fallback the codebase
   already relies on for pruned weeks). Splice in the stub's own
   `week`/`runId`/`scannedAt`/`status` so the returned record is
   attributed to the correct week for trend purposes.

   Call this resolver from the three read sites in `aggregate.js`
   listed above, replacing the current
   `JSON.parse(fs.readFileSync(...))` calls. This is the only code
   change needed in `aggregate.js` — `summarizeRecords`,
   `updateInventory`, and the window filter all keep operating on full
   records as today.

4. **Interaction with `retention_weeks`.** A stub's `since` pointer can
   itself go stale once that source week is pruned. Two options:
   - (preferred) On prune, if a week being deleted is the `since` target
     for any newer stub, promote the *next* newest full record to be
     the new anchor by rewriting that one stub back to a full record
     before deleting. Keeps the invariant "at least one full record
     exists for any run of identical stubs" without chasing pointers
     across prune runs.
   - (simpler, more conservative) Don't dedupe across a prune boundary:
     only stub against the *immediately preceding* week, and always
     keep the oldest week in the retention window as a full record.
     Bounds the win (skips at most `retention_weeks - 1` full writes
     per unchanged page) but needs no prune.js changes at all.

   Recommend starting with the conservative option — smaller diff,
   no changes to `prune.js`, and the bulk of the storage win (most
   savings come from not re-writing full `axe`/`alfa` payloads every
   week) is already captured.

5. **Fingerprint scope note.** `resources`/`images` arrays may contain
   incidental ordering differences from crawl non-determinism even when
   semantically unchanged. Sort arrays (or hash a canonicalized/sorted
   form) before fingerprinting to avoid false "changed" churn — mirrors
   how `fragmentFingerprint` already normalizes volatile HTML attributes
   before hashing.

## What this buys

Storage reduction scales with how static a site's pages are week to
week — likely large, since most government content pages don't change
their accessibility/sustainability profile week over week. Exact win is
unmeasured; suggest instrumenting stub-hit-rate in the first
implementation before deciding whether to pursue the more aggressive
multi-week promotion scheme in step 4.

## What NOT to change

- `findings.json`/`resources.json`/etc. ledgers are unaffected — they're
  built from `bugs` derived from resolved (full) records, same as today.
- `inventory.json` schema only grows by two optional fields
  (`lastFingerprint`, `lastFullRecordWeek`); existing consumers ignore
  unknown fields already (plain JSON objects, no strict schema
  validation found in `src/lib/inventory.js`).
- No change to `prune.js` under the conservative (5, simpler) option.

## Open questions for the owner

- Is the storage win worth the added indirection (stub resolution layer)
  given `retention_weeks` is already down to 3? The pruning already caps
  worst-case growth; B2 only helps *within* the 3-week window.
- Should stub-hit-rate be surfaced anywhere (e.g. a line in the daily
  repo-size gate job) to make the tradeoff visible over time?
