# Implementation Plan: Report information architecture — progressive disclosure

**Status**: IN PROGRESS
**Date**: 2026-07-07
**Spec**: [spec.md](spec.md)

---

## Summary

Five ordered work packages restructure the static per-domain reports into a
three-layer, outcome-oriented information architecture that foregrounds
week-over-week progress. The heavy lifting is **reorganization** — most of the
data (per-week `series`, week-over-week `diffs`, `trajectory`, `scoreFor`, the
findings ledger with `firstSeen`/`lastSeen`/`weeksSeen`) and rendering helpers
(`delta`, `sparkline`, `severityTrendChart`, `changeList`, `rankBugs`) already
exist. New computation is limited to per-week severity buckets and finding-level
fixed/regressed derivations. The English path and the static JSON API are
otherwise preserved; renamed pages keep old URLs alive via redirect stubs.

---

## Technical Context

**Language/Version**: Node.js ESM ≥ 20, no build step, no bundler
**Primary files**: `src/report-html.js`, `src/aggregate.js`, `src/lib/findings.js`,
`src/lib/score.js`, `tests/unit/report-html.test.js`, `tests/e2e.mjs`,
`tests/unit/i18n-render.test.js`
**New files**: `src/lib/progress.js` (per-week severity buckets + fixed/regressed
derivations; unit-tested), `tests/unit/progress.test.js`
**Reuse (do not rebuild)**: `statTile` (WP01), `delta()`/`sparkline()`,
`trajectory(series, 4)` + `scoreFor()` (`src/lib/score.js`),
`severityTrendChart(series)`, `changeList()`, `fixFirstSection()`/`rankBugs()`,
`heading()`, the findings ledger (`src/lib/findings.js`), and the `severityCounts`
logic in `src/lib/api-writer.js` (lift to `src/lib/progress.js`).
**Constraints**: no new npm deps; no `data/` schema change; deep links preserved
via redirect stubs; JS is progressive enhancement; sustainable-web-output gate.

---

## Charter Check

- Plain Node.js ESM; no build step or bundler introduced.
- `weekly-accessibility-tracking` / `historical-evidence-preservation`: the
  restructure makes week-over-week change the headline; no data pruned or
  reshaped.
- `stable-page-identity`: renamed pages keep old URLs via hash-preserving
  redirect stubs (C-01); the JSON API is unchanged.
- `accessible-reporting`: landing page, nav, and collapsed detail work without
  JS (native `<details>`, plain links); charts keep the SVG + data-table
  fallback.
- `sustainable-web-output`: reuse existing CSS/chart patterns, minimal added
  bytes, redirect stubs tiny, non-default-language stubs follow the latest-week
  -only policy (NFR-02).

---

## Work Packages

### WP01 — Reusable stat component (`statTile`)

Compose `delta()` + `sparkline()` into a single `<dl class="ledger">` cell so any
headline number can carry its change and trend consistently. Additive; not yet
wired into any page (WP02 is the first consumer). Unit-tested.

**Req refs**: FR-01, NFR-01
**Deps**: none
**Owned files**: `src/report-html.js`, `tests/unit/report-html.test.js`

---

### WP02 — Layer-1 domain landing page

Restructure `renderDomainReport` into the manager view (inverted pyramid): score
+ grade + band + trajectory hero; three `statTile` deltas (new/fixed/regressed);
one "biggest available win" callout (`rankBugs(bugs, 1)`) linking to the
finding's canonical location; the existing "at a glance", "trends", and "changes
since" sections demoted into collapsed `<details>` with visible counts. The
finding-level new/fixed/regressed derivations live as pure functions in
`src/lib/progress.js` (or `findings.js`) and are unit-tested; aggregate passes
them in (or the render computes from `series` + ledger already in scope).

**Req refs**: FR-02, FR-03, FR-04, FR-05, C-02, C-03, C-06
**Deps**: WP01
**Owned files**: `src/report-html.js`, `src/lib/progress.js`, `src/aggregate.js`, `tests/unit/report-html.test.js`, `tests/unit/progress.test.js`

---

### WP03 — Progress panel

Add the progress section to the landing page: a "Fixed this week" finding list;
a severity **burndown** chart (`severityBurndown(series, perWeekBugs)` in
`src/lib/progress.js`, reusing the `severityCounts` logic lifted from
`api-writer.js`, rendered via the existing accessible SVG + data-table pattern);
a client-side triage-completion count (`X of N triaged`, mirroring
`triageScript()`, blank with JS off); and streak badges from the burndown.

**Req refs**: FR-06, FR-07, FR-08, FR-09, C-03, C-04, NFR-02
**Deps**: WP02
**Owned files**: `src/report-html.js`, `src/lib/progress.js`, `tests/unit/progress.test.js`

---

### WP04 — Outcome nav regroup + redirect stubs

Regroup the subnav under outcome-question headings (Accessible? · Fast? ·
Findable? · Trustworthy? · Sustainable?); rename pages to outcome-aligned slugs
per the map below; add a redirect-stub emitter and wire it into the
`aggregate.js:312-346` write loop for both the default and `-<loc>` siblings.
Update `SUBNAV_ITEMS`/`subnav()`, `tests/e2e.mjs` (`SUBPAGES`, identical-nav
assertion, href checks) and `tests/unit/i18n-render.test.js` hrefs. Add a
stub-emission unit test (old URL → correct dest, `#fragment` preserved).

**Proposed old → new slug map** (whole-page grouping; finalize during WP04):

| Outcome | Page(s) | New slug |
|---|---|---|
| — (landing) | `index.html` | `index.html` (unchanged) |
| Accessible? | `accessibility.html` | `accessible.html` |
| Fast? | `lighthouse.html` | `fast.html` |
| Findable? | `readability.html` | `findable.html` |
| Findable? | `standards.html` | `standards.html` (SEO/metadata + security; keep or split later) |
| Trustworthy? | `third-party.html` | `third-parties.html` |
| Trustworthy? | `errors.html` | `errors.html` |
| Sustainable? | `tech.html` | `tech.html` |
| Sustainable? | `tech-findings.html` | `tech-findings.html` |
| (evidence) | `images.html` | `images.html` |
| (evidence) | `archive.html` | `archive.html` |

Redirect stub at each renamed old filename:
`<!doctype html><meta charset=utf-8><link rel=canonical href="<dest>">`
`<meta http-equiv=refresh content="0;url=<dest>">`
`<script>location.replace(${JSON.stringify(dest)} + location.hash)</script>`
(mirrors `languageRuntime`'s hash-preserving `location.replace`, `report-html.js:164`).

**Req refs**: FR-10, FR-11, FR-12, C-01, C-05, NFR-01
**Deps**: WP02
**Owned files**: `src/report-html.js`, `src/aggregate.js`, `tests/e2e.mjs`, `tests/unit/i18n-render.test.js`, `tests/unit/report-html.test.js`

---

### WP05 — Docs

Add an Information-Architecture section to `CLAUDE.md` (three layers, outcome nav,
the redirect-stub rule and old→new map, the progress artifacts) and a short note
to `README.md` about the landing-page/outcome structure.

**Req refs**: FR-13
**Deps**: WP02, WP03, WP04
**Owned files**: `CLAUDE.md`, `README.md`

---

## Validation Plan

- `npm run test:unit` — must pass after every WP (statTile, progress pure
  functions, redirect-stub emission, updated overview assertions).
- `npm run test:e2e` — updated `SUBPAGES`/nav assertions pass (Playwright binary
  permitting; otherwise a full `npm run aggregate` over real data).
- `npm run i18n:check` — template current after any new `t()` strings.
- `npm run check:spec-kitty` — charter governance green.
- Manual: open an old-filename URL with a `#VS-…` fragment and confirm it lands
  on the renamed page at the correct anchor, in the default and a non-default
  locale; eyeball the landing hero + three deltas + callout + progress panel;
  confirm the page is usable with JS disabled.

## Rollback Plan

Each WP is a focused commit/PR. Revert the commit to roll back that slice. WP04
is the only URL-affecting change; its redirect stubs make the rename reversible
without breaking links even mid-migration.
