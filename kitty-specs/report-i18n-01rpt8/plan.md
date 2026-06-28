# Implementation Plan: Report internationalization (i18n)

**Status**: ACCEPTED
**Date**: 2026-06-28
**Spec**: [spec.md](spec.md)

---

## Summary

Seven ordered work packages add a Drupal/gettext-style localization layer to the
static reports. The English source string is the key and the default, so the
English path is byte-identical and any untranslated string falls back to English.
All localization is render-side or client-side progressive enhancement; the
committed `data/` schema and the static JSON API are untouched.

---

## Technical Context

**Language/Version**: Node.js ESM ≥ 20 (full ICU for `Intl`)
**New files**: `src/lib/i18n.js`, `src/locales/{fr,ja,nl}.json`,
`src/locales/template.json` (generated), `src/locales/dynamic-strings.json`,
`scripts/i18n-extract.js`, `tests/unit/i18n.test.js`,
`tests/unit/i18n-render.test.js`, `tests/unit/config.test.js`
**Primary files**: `src/report-html.js`, `src/lib/config.js`, `src/aggregate.js`,
`config/targets.yml`
**Testing**: Node built-in test runner via `npm run test:unit`; drift guard
`npm run i18n:check`
**Constraints**: No new npm deps; no data/ schema change; English path unchanged;
JS is progressive enhancement

---

## Charter Check

- Plain Node.js ESM; no build step or bundler introduced.
- Historical weekly data compatibility preserved (no data/ schema change).
- Reports remain usable as generated static HTML without JS (switcher is links;
  runtime selection and persistence are pure enhancement).
- Focused unit coverage for all new behaviour; a CI drift guard for the template.
- Severity taxonomy and the score algorithm are unchanged (display labels only).

---

## Work Packages

### WP01 — i18n foundation

`src/lib/i18n.js` (`t`, `setLocale`/`getLocale`, `loadCatalog`, `nf`); config
schema (`languages` / `default_language`) parsed + validated in `config.js` and
documented in `targets.yml`; `scripts/i18n-extract.js`; unit tests for
fallback/interpolation and config validation. No visible report change.

**Req refs**: FR-01, FR-02, FR-12, FR-13, FR-15, NFR-01
**Deps**: none
**Owned files**: `src/lib/i18n.js`, `src/lib/config.js`, `config/targets.yml`, `scripts/i18n-extract.js`, `tests/unit/i18n.test.js`, `tests/unit/config.test.js`

---

### WP02 — Wrap high-traffic report chrome

Replace hardcoded English with `t()` across the shared chrome and the
high-traffic pages (dashboard, per-domain Overview, Accessibility, Standards,
Errors, Lighthouse), including the `BUG_FILTER`/`TRIAGE` inline scripts (converted
to functions that receive translated message templates). Dynamic `<html lang>`;
`nf()` for prose counts. English output stays semantically identical.

**Req refs**: FR-03, FR-04, FR-07, C-01, C-02
**Deps**: WP01
**Owned files**: `src/report-html.js`

---

### WP03 — Multi-language output + language switcher

`setReportLanguages()` + `localeSuffix()` drive sibling filenames; subnav and
intra-report nav links carry the active suffix; `languageSwitcher()` renders a
no-JS header switcher; `aggregate.js` loops over each target's languages and the
global languages for the dashboard/url-lookup.

**Req refs**: FR-06, FR-08, C-05
**Deps**: WP02
**Owned files**: `src/report-html.js`, `src/aggregate.js`, `tests/unit/i18n-render.test.js`

---

### WP04 — Catalogs fr/ja/nl

Seed `src/locales/{fr,ja,nl}.json` with human-reviewed translations of the common
UI chrome (French most complete); register indirectly-translated strings in
`src/locales/dynamic-strings.json`; document per-target `languages` examples in
`targets.yml`.

**Req refs**: FR-14, FR-16
**Deps**: WP01, WP02
**Owned files**: `src/locales/fr.json`, `src/locales/ja.json`, `src/locales/nl.json`, `src/locales/dynamic-strings.json`, `src/locales/template.json`, `config/targets.yml`

---

### WP05 — Docs + tooling scripts

Internationalization section in `CLAUDE.md` (model, placeholders, locales,
config, scope, how to add/update a translation); `Languages` section in
`README.md`; `npm run i18n:extract` / `i18n:check` scripts.

**Req refs**: FR-15
**Deps**: WP01
**Owned files**: `CLAUDE.md`, `README.md`, `package.json`

---

### WP06 — Runtime language selection (?lang / localStorage)

`languageRuntime()` pre-paint script (gated on >1 configured language) selects
from `?lang=` or `localStorage['vital-lang']`, redirects to the sibling (default
pages only for a stored pref; `?lang` works anywhere and persists), preserves the
hash, never leaves an explicit `-<loc>.html` URL, and emits `hreflang` alternates.
Switcher clicks persist the choice.

**Req refs**: FR-09, FR-10, FR-11
**Deps**: WP03
**Owned files**: `src/report-html.js`, `tests/unit/i18n-render.test.js`, `CLAUDE.md`

---

### WP07 — Secondary pages + url-lookup coverage

Wrap the remaining secondary-criterion pages (readability, tech, tech-findings,
third-party, images + `ALT_VERDICT_INFO`, archive, Lighthouse medians) and the
url-lookup body; localize `sortableTable` column headers centrally via `t()`;
localize the url-lookup inline-script messages via injected templates. Expand
ja/nl catalogs toward parity with fr.

**Req refs**: FR-03, FR-04, FR-05, FR-14
**Deps**: WP03, WP04
**Owned files**: `src/report-html.js`, `src/locales/dynamic-strings.json`, `src/locales/{fr,ja,nl}.json`, `src/locales/template.json`, `tests/unit/i18n-render.test.js`

---

## Validation Plan

- `npm run test:unit` — must pass after every WP (i18n primitive, config
  validation, catalog-key lint, switcher/suffix + runtime-gating render tests).
- `npm run i18n:check` — template stays current.
- Manual: a full `npm run aggregate` with a `languages: [en, fr]` target over real
  data; confirm `-fr` sibling files, `<html lang>`, in-language subnav, the
  switcher, the runtime redirect script + `hreflang`, and no English→French leak.
- `npm run test:e2e` — pending (Playwright browser binary absent in the sandbox).

## Rollback Plan

Each WP/increment is a focused commit. Revert the commit to roll back that slice.
Removing the `languages` config (back to `[en]`) disables all multi-language
output and JS at runtime without touching the code.
