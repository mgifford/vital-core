# Spec: Report information architecture — progressive disclosure

**Status**: ACCEPTED

> Hand-authored to mirror the spec-kitty mission format (the `spec-kitty` CLI is
> not available in the implementing environment). Implemented incrementally on
> branch `ia/progressive-disclosure`, each work package a focused commit/PR to
> `main`.

## Goal

Reorganize vital-core's static per-domain reports around the **visitor's
questions** and around **week-over-week progress**, instead of around the
scanner's engine list. Today the report nav (`SUBNAV_ITEMS`,
`src/report-html.js:263-275`) is 11 engine tabs shown all at once, with no sense
of momentum. Restructure into three layers for three audiences / time budgets:

- **Layer 1 — "How are we doing?"** (manager, ~10 s): the domain landing page —
  score + trend, three deltas (new / fixed / regressed this week), one "biggest
  available win" callout; detail demoted below the fold.
- **Layer 2 — "What do I do next?"** (developer/designer, ~2 min): the existing
  next-actions queue with triage (Accessibility page, `#h-next-actions`).
- **Layer 3 — "Show me the evidence"** (auditor): the engine pages, regrouped by
  outcome question (Accessible? · Fast? · Findable? · Trustworthy? ·
  Sustainable?) and reached as drill-downs from findings, plus CSV/API.

Encode: deltas everywhere (number + ▲/▼ + sparkline); progress artifacts
(fixed-this-week, severity burndown, triage completion, streak badges); collapsed
-by-default with visible counts; inverted pyramid; one canonical location per
finding. No server, no build step; usable without JavaScript.

---

## Requirements

### Reusable stat component

| ID | Type | Requirement |
|---|---|---|
| FR-01 | Functional | `statTile(label, value, { deltaN, deltaOpts, spark })` in `src/report-html.js` composes the existing `delta()` and `sparkline()` into one `<dl class="ledger">`-compatible cell so every headline number carries the same "number + ▲/▼ + trend" treatment. The label is localized via `t()`; `value` is preformatted by the caller. Reuses existing `.ledger`/`.delta`/`.spark` CSS (no new styles). |

### Layer-1 domain landing page

| ID | Type | Requirement |
|---|---|---|
| FR-02 | Functional | `renderDomainReport` leads with the conclusion: score + grade + band + `trajectory(series, 4)` word/arrow (reusing the existing scorecard), before any detail. |
| FR-03 | Functional | Three week-over-week deltas — **new / fixed / regressed** this week — are surfaced near the top as `statTile`s. `new` = `diff.*.appeared` ∪ ledger `firstSeen === currentWeek`; `fixed` = finding-level list where ledger `lastSeen < currentWeek`; `regressed` = findings whose ledger `_weeks` has a gap (resolved then returned). |
| FR-04 | Functional | A single "biggest available win" callout surfaces the top-ranked finding (`rankBugs(bugs, 1)`), linking to that finding's one canonical location. |
| FR-05 | Functional | The detailed sections ("This week at a glance", "Trends over time", "Changes since @week") are collapsed by default in native `<details>` with a visible count in the summary (e.g. "14 moderate findings ▸"); all current content stays reachable. The page has one primary action. |

### Progress panel

| ID | Type | Requirement |
|---|---|---|
| FR-06 | Functional | A "Fixed this week" panel lists the findings resolved this week (the finding-level list from FR-03), not just rule ids. |
| FR-07 | Functional | A severity **burndown** chart plots per-week Critical/Serious/Moderate/Minor open-finding counts across `series` (severity buckets computed per week, not only for the latest week). |
| FR-08 | Functional | Triage completion ("X of N triaged") is filled by a client-side progressive-enhancement script reading the visitor's `localStorage` triage decisions; it is blank/absent with JavaScript off. |
| FR-09 | Functional | Streak badges derived from the burndown series (e.g. "0 criticals for N weeks"). |

### Outcome nav + URL preservation

| ID | Type | Requirement |
|---|---|---|
| FR-10 | Functional | The per-domain subnav is regrouped under outcome-question headings — **Accessible? · Fast? · Findable? · Trustworthy? · Sustainable?** — with engine pages mapped many-to-one onto them; the empty-state/no-404 invariant (`emptyCriterionPage`) is preserved. |
| FR-11 | Functional | Pages are renamed to outcome-aligned slugs per a fixed old→new map (see plan.md); `page`/`active`/output-filename stay consistent so language switching resolves. |
| FR-12 | Functional | A redirect-stub emitter writes a small stub at every **old** filename: `<link rel="canonical">` + `<meta http-equiv="refresh">` + a hash-preserving `location.replace(dest + location.hash)`, for the default and every `-<loc>` sibling, wired into the `aggregate.js` write loop. |

### Docs

| ID | Type | Requirement |
|---|---|---|
| FR-13 | Functional | `CLAUDE.md` gains an Information-Architecture section (three layers, outcome nav, redirect-stub rule, progress artifacts); `README.md` notes the landing-page/outcome structure. |

---

## Constraints

| ID | Type | Constraint |
|---|---|---|
| C-01 | Hard | **No deep link breaks.** Every pre-existing report URL keeps working, including `#VS-<hash>` finding anchors and `#h-<id>` section anchors — via a redirect stub when a file is renamed, and the stub **preserves the URL fragment**. |
| C-02 | Hard | **One canonical location per finding.** A finding is rendered in full in exactly one place; other pages link to it rather than re-rendering it with different framing. |
| C-03 | Hard | **JS is progressive enhancement.** The landing page, nav, and collapsed detail work with JavaScript off (native `<details>`, plain links); triage completion and any interactivity are enhancement only. |
| C-04 | Hard | **Sustainable web output** (charter `sustainable-web-output`): no web fonts, reuse existing CSS classes and the SVG+ParaCharts chart pattern, prefer build-time computation, and keep added CSS/JS within the project's lean budget. |
| C-05 | Hard | **i18n lockstep.** New pages and stubs keep the `page` basename equal to the emitted filename; localized `-<loc>` siblings, the language switcher, and the `?lang`/`hreflang` runtime keep working (`aggregate.js:312-346`). |
| C-06 | Hard | **Severity taxonomy unchanged** — internal keys stay `critical/serious/moderate/minor`; only the four display labels appear (Critical/Serious/Moderate/Minor). |
| C-07 | Hard | No new npm runtime dependencies; no `data/` schema change; the static JSON API (keyed on domain/week, not page filenames) is unaffected. |

---

## Non-functional requirements

| ID | Type | Requirement |
|---|---|---|
| NFR-01 | Testing | Unit tests cover `statTile`, the new finding-level fixed/regressed pure functions and the per-week severity burndown (in `src/lib/`), and redirect-stub emission (old URL → correct dest, fragment preserved). `tests/e2e.mjs` (`SUBPAGES`, identical-nav assertion, href checks) and `tests/unit/i18n-render.test.js` hrefs are updated in lockstep with any nav/file change. |
| NFR-02 | Sustainability | Net added CSS/JS stays within the project's lean budget; charts reuse the existing accessible SVG + data-table + ParaCharts pattern; redirect stubs are minimal; non-default-language stubs follow the existing latest-week-only policy so output isn't multiplied. |

---

## Acceptance criteria

- [x] `statTile` composes delta+sparkline into a ledger cell; label localized, value preformatted; covered by unit tests. *(WP01 — done)*
- [x] The landing page leads with score + trajectory, then three deltas (new/fixed/regressed), then a single biggest-win callout; detail is collapsed by default with visible counts.
- [x] "New/fixed/regressed" are computed from the diff + findings ledger by unit-tested pure functions.
- [x] The progress panel shows fixed-this-week, a severity burndown across weeks, a client-side triage-completion count (blank with JS off), and streak badges.
- [x] The subnav is grouped by outcome question; every old page URL still resolves (renamed pages redirect via a stub that preserves the `#fragment`), verified for the default and a non-default locale.
- [x] One canonical location per finding; severity taxonomy and the JSON API are unchanged.
- [x] Pages, nav, and collapsed detail work with JavaScript disabled.
- [x] `npm run test:unit` and `npm run test:e2e` green; `npm run i18n:check` and `npm run check:spec-kitty` green.

---

## Out of scope

- Splitting a single engine page into multiple outcome pages (e.g. separating
  SEO/metadata from security within Standards) — the first pass groups whole
  pages under outcome headings.
- A committed/server-side triage store (triage stays browser-local; the
  completion count is client-side only).
- Changing the scoring algorithm, severity taxonomy, or the `data/` schema.
- Localizing engine-sourced text (unchanged from the i18n mission scope).
