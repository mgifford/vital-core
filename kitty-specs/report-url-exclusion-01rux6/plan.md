# Implementation Plan: Viewer-side report URL exclusion

**Status**: DRAFT
**Date**: 2026-07-10
**Spec**: [spec.md](spec.md)

---

## Summary

Five ordered work packages add a **viewer-editable, browser-persisted** URL
exclusion list to the static per-domain reports, reusing two patterns that
already exist: the report-side exclusion **filter** (`matchesExclusionPattern` /
`filterBugsByExclusion` / `formatExclusionBanner`, `src/report-html.js:33-80`)
and the client-side **export/import/share** scaffold from triage (`.triage-io`,
the IO script at `report-html.js:1180`, `:1687`). The new work is (a) teaching
the filter `/regex/` in addition to substrings so config baseline and viewer list
share semantics, and (b) a small progressive-enhancement layer that reads a
`localStorage` pattern list, hides matching findings/pages in the DOM, and
updates the visible counts — all with the report staying fully functional when
JavaScript is off.

No server, no build step, no `data/` or JSON-API change: viewer exclusions live
only in the browser.

---

## Technical Context

**Language/Version**: Node.js ESM ≥ 20, no build step, no bundler
**Primary files**: `src/report-html.js`,
`tests/unit/report-html.test.js`, `tests/unit/url-exclusion.test.js`,
`tests/unit/i18n-render.test.js`, `tests/e2e.mjs`
**Reuse (do not rebuild)**:
- `matchesExclusionPattern` / `filterBugsByExclusion` / `formatExclusionBanner`
  (`report-html.js:33-80`) — the report-side filter; extend to `/regex/`.
- `compilePattern` semantics from PR #208 (`src/lib/urls.js`) — mirror the
  substring-or-`/regex/` + invalid-regex-fallback rule (a browser-safe copy; the
  Node helper imports `fs`/config and can't run client-side).
- `.triage-io` box + Export/Import/Copy IO script (`report-html.js:1180`,
  `:1687`) and the triage localStorage conventions (`vital-triage:*`) — the model
  for `vital-exclude:<domain-key>`.
- The pre-paint/localStorage script conventions (`themeScript`, `triageScript`,
  `languageRuntime`) for a gated, no-op-when-empty enhancement script.
**Constraints**: no new npm deps; no data/API change; JS is progressive
enhancement; sustainable-web-output gate; i18n via `t()` + `JSON.stringify(t())`.

---

## Charter Check

- Plain Node.js ESM; no build step or bundler introduced.
- `historical-evidence-preservation` / `weekly-accessibility-tracking`: nothing
  in `data/` changes; every URL is still scanned. The viewer list only scopes the
  **display**, so comprehensiveness and week-over-week comparability are intact.
- `stable-page-identity`: no page renames, no URL changes, `#fragment` anchors
  and the JSON API untouched (C-05).
- `accessible-reporting`: the report works with JS off (C-01); the control is a
  labelled, keyboard-usable form; the banner uses `role="status"`.
- `sustainable-web-output`: reuse `.triage-io` CSS and the existing IO script
  pattern; the filter script is gated and a no-op when no list is stored; no web
  fonts, minimal added bytes (C-04, NFR-02).

---

## Work Packages

### WP01 — Regex-aware exclusion filter (shared semantics)

Extend `matchesExclusionPattern` to treat a slash-wrapped pattern as a
case-insensitive-by-default `/regex/` (honouring trailing flags), else keep the
current case-insensitive substring; an unparseable regex falls back to a literal
substring (mirror PR #208 `compilePattern`). `filterBugsByExclusion` and
`formatExclusionBanner` inherit this unchanged. This makes the config
`url_exclude_patterns` baseline and the viewer list one semantics, and lets
`/medicare/` and `/\.aspx$/i`-style patterns both work. Additive; unit-tested.

**Req refs**: FR-07, NFR-01
**Deps**: none
**Owned files**: `src/report-html.js`, `tests/unit/url-exclusion.test.js`

---

### WP02 — Viewer exclusion control on the canonical accessibility page

Render the collapsed `.triage-io`-styled box on `renderAccessibilityPage`
(findings' one canonical home). A client PE script reads
`localStorage['vital-exclude:<domain-key>']`, compiles the patterns (browser copy
of the WP01 rule), hides finding blocks whose remaining affected pages are all
excluded, trims affected-page lists, and updates the visible per-finding and
per-severity counts + a "showing N of M" line. **Apply** re-reads the textarea
and persists; **Clear** empties the list. Additive to the server-applied config
baseline; banner (echoing `formatExclusionBanner`) names both sources, shows the
hidden count, and offers reset-to-view-all. No-JS: box hidden, full report shown.

**Req refs**: FR-01, FR-02, FR-03, FR-04, FR-05, C-01, C-02, C-03, C-04, C-07, C-08
**Deps**: WP01
**Owned files**: `src/report-html.js`, `tests/unit/report-html.test.js`

---

### WP03 — Landing-page placement + cross-page shared state

Surface the same control on `renderDomainReport`, positioned directly under the
site-inventory meta line (`report-html.js:2939`). It shares the same
`vital-exclude:<domain-key>` store, so a list set on either page applies on both.
On the landing page the filter updates the visible delta/inventory counts it can
derive client-side and shows the banner + hidden count; the headline score stays
whole-site and is labelled as such (C-02). Factor the box + script into one
helper used by both WP02 and WP03 to avoid divergence.

**Req refs**: FR-01, FR-03, FR-04, FR-05, C-01, C-02, C-04
**Deps**: WP02
**Owned files**: `src/report-html.js`, `tests/unit/report-html.test.js`

---

### WP04 — Export / import / share of the exclusion set

Add **Export (.json)**, **Import (.json)**, and **Copy share payload** to the box,
reusing the triage IO script (`report-html.js:1687`). Payload shape:
`{ type: "vital-exclude", domain: "<domain-key>", patterns: [...] }`. Import
validates the shape, merges/replaces, persists, and re-applies without reload;
export/copy stamp the domain key so a shared list lands on the right site. Status
line uses `aria-live` like the triage IO status.

**Req refs**: FR-06, C-04, C-08, NFR-02
**Deps**: WP02
**Owned files**: `src/report-html.js`, `tests/unit/report-html.test.js`

---

### WP05 — Docs

Add a "Viewer URL exclusion" note to `CLAUDE.md` contrasting the three exclusion
layers (scan `url_exclude` → crawl; report `url_exclude_patterns` → build render;
viewer localStorage list → runtime display); note the control in `README.md` /
`FEATURES.md`; cross-reference it from the `url_exclude_patterns` comment block in
`config/targets.yml`.

**Req refs**: FR-08
**Deps**: WP02, WP03, WP04
**Owned files**: `CLAUDE.md`, `README.md`, `FEATURES.md`, `config/targets.yml`

---

## Validation Plan

- `npm run test:unit` — green after every WP (regex-aware filter cases; render
  assertions that the box + banner emit and are inert when empty).
- `npm run i18n:check` — template current after any new `t()` strings.
- `npm run check:spec-kitty` — charter governance green.
- `npm run test:e2e` — updated markup/nav assertions pass (Playwright binary
  permitting; else a full `npm run aggregate` over real data).
- Manual: set a list (e.g. `/medicare/`, `/\.aspx$/i`), confirm findings/counts
  filter and persist across reload and across the landing/accessibility pages;
  export → clear → import round-trips; disable JS and confirm the full report
  renders with the box gone and the config baseline still applied.

## Rollback Plan

Each WP is a focused commit/PR. Revert the commit to roll back that slice. WP01 is
additive to an existing filter; WP02–WP04 are additive enhancement layers — none
change page URLs, `data/`, or the JSON API, so a revert can never break links or
historical data.
