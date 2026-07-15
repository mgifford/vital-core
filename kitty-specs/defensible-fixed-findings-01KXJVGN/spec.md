# Spec: Defensible "fixed" findings

**Status**: DRAFT
**Origin**: [issue #222](https://github.com/mgifford/vital-core/issues/222)

## Problem

The Layer-1 landing page's "Fixed this week" list (`progressSection()` in
`src/report-html.js`, fed by `weekDeltas()` in `src/lib/progress.js`) currently
means only: *this `pattern_id` (one axe/Alfa rule, aggregated across every page
it hit) was present in last week's scan and is absent from this week's scan.*

That is not the same claim as "this was fixed," because:

1. **No re-crawl guarantee.** The crawl frontier (`src/lib/state.js`,
   `src/scan.js`) does not re-scan the same URL set every week — priority URLs,
   weekly page caps (`max_pages_per_week`), and per-engine sampling rates
   (`config/targets.yml` `sampling:`) mean a rule can go quiet because its
   pages fell out of this week's sample, not because the site changed.
2. **Rule-level, not instance-level.** A `pattern_id` is
   `hash(engine, ruleId)` (`src/lib/bug-report.js`); "fixed" doesn't confirm
   every previously-affected page was re-checked and found clean.
3. **No coverage-lost signal.** `updateFindings()` already has a
   `_coverageNew` flag (added in mission `coverage-expansion-01KVJ3X2`) to stop
   sampling expansion from faking a "new" finding. There is no symmetric flag
   for the opposite failure mode: a finding disappearing because its pages
   dropped out of coverage, faking a "fixed" finding.
4. **No evidence trail in the report.** `progressSection()`
   (`src/report-html.js:775-778`) renders each fixed item as plain text
   (severity + summary) with no `pattern_id`, no link to the affected pages,
   nothing a reader can click to verify. Contrast with the live accessibility
   page, which links every finding via `pageHref('accessibility', instance_id)`.

## Goal

Make "fixed" a claim VITAL can defend: distinguish *confirmed remediated* from
*dropped out of this week's sample*, and give every "fixed" (and "new") item a
visible evidence trail back to the pattern/pages that justify the label.

## Requirements

| ID | Type | Requirement |
|---|---|---|
| FR-001 | Functional | `updateFindings()` (or a new helper in `src/lib/findings.js`) detects when a finding disappears (`lastSeen === prevWeek`, absent this week) **and** none of its previously-recorded `affected_pages` were actually crawled this week (per-engine coverage set, same shape as existing `prevCoveredUrls`). Mark it `_coverageLost: true` in the ledger instead of / alongside dropping it. |
| FR-002 | Functional | `weekDeltas()` in `src/lib/progress.js` splits its `fixed` bucket: findings that disappeared **with** confirmed re-coverage of their prior pages are `fixed` (defensible); findings that disappeared **without** re-coverage are reported separately (e.g. `fixed_unconfirmed` or folded into a distinct "dropped from sample" bucket) — never silently counted as a confirmed fix. |
| FR-003 | Functional | Require **N consecutive confirmed-clean re-scans** (configurable, default 1 for pages re-covered, i.e. no artificial delay beyond what coverage already gives — see open question below) of a finding's prior pages before crediting it as fixed, if the team wants stronger confidence than a single clean re-scan. *(Resolve as an open question during planning — may be FR-003 or may be deferred.)* |
| FR-004 | Functional | `progressSection()` renders each "Fixed this week" (and ideally "New"/"Regressed") entry with its `pattern_id`, and links to the affected pages (reuse `affected_pages` already carried on the ledger/report data) so a reader can click through to evidence, mirroring how live findings link via `pageHref('accessibility', instance_id)`. |
| FR-005 | Functional | The static JSON API (`src/lib/api-writer.js`, `docs/api/v1/.../findings.json`) exposes the coverage-confirmation status (`confirmed` vs `coverage_lost`) per finding so external consumers get the same honesty signal, not just the HTML report. |
| C-01 | Constraint | Omitting per-engine coverage data reproduces original behavior exactly (same fallback contract as existing `prevCoveredUrls` / `_coverageNew` — no forced `findings.json` migration for domains/engines that don't supply it). |
| C-02 | Constraint | No change to the rule-level `pattern_id` granularity in this mission — instance-level (per-page) fix tracking is out of scope (see below). |
| NFR-01 | Non-functional | All unit tests pass (`npm run test:unit`), including new tests for the coverage-lost path using synthetic ledgers/coverage sets (no mocking of fs — follow existing `tests/unit/` conventions). |
| NFR-02 | Non-functional | No new client-side JS budget growth beyond what's already used for progress/triage; evidence links are plain anchors, not fetched client-side. |

## Acceptance criteria

- [ ] A finding whose affected pages were **not** re-crawled this week is never
      labeled "Fixed" without qualification — it is visibly distinguished
      (e.g. "dropped from this week's sample" vs "Fixed").
- [ ] A finding whose affected pages **were** re-crawled and came back clean is
      labeled "Fixed" and links to the pattern id and (a sample of) the pages
      that were re-verified clean.
- [ ] The public HTML report's "Fixed this week" list shows a `VS-xxxxxxxx`
      pattern id (or equivalent) and a working link per item, not plain text.
- [ ] `findings.json` / the static API surfaces the same confirmed vs.
      coverage-lost distinction machine-readably.
- [ ] Existing committed `findings.json` files load without migration.
- [ ] `npm run test:unit` passes with new coverage for the coverage-lost
      classification and the report evidence links.
- [ ] Issue #222 can be answered concretely from the shipped report: a reader
      can see *why* something is marked fixed and click through to the pages
      that prove it.

## Out of scope

- Instance-level (per-page-per-finding) fix tracking — this mission stays at
  the existing `pattern_id` (rule) granularity; only adds a coverage-confirmed
  vs. coverage-lost distinction at that granularity.
- Changing crawl prioritization/frontier logic to force revisits (beyond
  reading existing per-engine coverage sets already computed for
  `_coverageNew`) — if re-crawl guarantees turn out to require frontier changes,
  that becomes a follow-up mission.
- Changing `consensus.js` deduplication.
- Migrating existing `findings.json` files.

## Open questions (resolve in plan.md)

- Where does per-engine "pages actually covered this week" data already live
  (used for `_coverageNew`) and can it be reused as-is for the symmetric
  coverage-lost check, or does it need to be captured earlier in the pipeline?
- Is a single clean re-scan sufficient to credit "fixed," or does the team want
  a configurable confirmation window (FR-003)? Default to simplest (single
  confirmed re-scan) unless research shows single-scan noise is a real problem.
