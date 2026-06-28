# Spec: Report internationalization (i18n)

**Status**: ACCEPTED

> Hand-authored to mirror the spec-kitty mission format (the `spec-kitty` CLI was
> not available in the implementing environment). Implemented and verified on
> branch `claude/scanner-aggregator-wishlist-01rjts` (PR #171), which it shares
> with the `scanner-aggregator-wishlist` mission.

## Goal

Let vital-core publish its static HTML accessibility/sustainability reports in
more than one language (e.g. English/French for Canada, English/Japanese for
Japan, English/Dutch for the Netherlands), using a Drupal/gettext-style `t()`
where the **English source string is the key and the default**.

The English path must be unaffected (English-as-key, English fallback for any
missing translation), the change must require no server and no build step, and
every page must remain usable without JavaScript.

---

## Requirements

### `t()` primitive and fallback

| ID | Type | Requirement |
|---|---|---|
| FR-01 | Functional | `src/lib/i18n.js` exposes `t(source, args)`, `setLocale()`, `getLocale()`, `setReportLanguages()` and locale-aware `nf()`. `t()` returns the English source verbatim when no catalog entry exists; a missing **or empty** translation falls back to English. English has no catalog file. |
| FR-02 | Functional | `@token` placeholders interpolate after lookup (e.g. `t('Showing @count of @total issue type(s).', { '@count': n, '@total': m })`), in both server-rendered strings and inline-`<script>` message templates. |

### UI-chrome coverage

| ID | Type | Requirement |
|---|---|---|
| FR-03 | Functional | Every UI-chrome string in `src/report-html.js` renders via `t()`: nav, headings, labels, buttons, empty states, filter/triage/resource/alt-verdict/severity-display labels, table headers, sustainability headline, theme toggle, dashboard chrome, and the secondary-criterion pages (readability, tech, tech-findings, third-party, images, archive, lighthouse, url-lookup). |
| FR-04 | Functional | Inline `<script>` blocks (`BUG_FILTER`, `TRIAGE`, url-lookup) receive translated message *templates* injected server-side via `JSON.stringify(t('…'))`; the client only substitutes `@token` values. |
| FR-05 | Functional | Sortable-table column headers localize at a single site (`sortableTable` runs `c.label` through `t()`); technical acronyms (FCP, LCP, CLS, TBT, SEO) pass through unchanged. |

### Per-language output and switcher

| ID | Type | Requirement |
|---|---|---|
| FR-06 | Functional | The `default_language` owns the canonical (unsuffixed) report paths; every other language is written as `<page>-<loc>.html`. Page depth is unchanged, so relative asset/link math is untouched. |
| FR-07 | Functional | `<html lang>` reflects the rendered locale; prose counts/numbers use `Intl` (`nf()`) for that locale. |
| FR-08 | Functional | A header language switcher (`languageSwitcher()`) cross-links the current page to its sibling in each configured language (endonyms + `hreflang`), as pure links that work with JavaScript disabled. Subnav and intra-report nav links carry the active locale's suffix so navigation stays in-language. |

### Runtime language selection

| ID | Type | Requirement |
|---|---|---|
| FR-09 | Functional | A pre-paint script (`languageRuntime()`) selects the language from `?lang=<loc>` (works from any page, persisted to `localStorage['vital-lang']`) or, on the default-language pages only, from a stored preference, and redirects to the sibling file (preserving `location.hash`). |
| FR-10 | Functional | An explicitly-shared `<page>-<loc>.html` URL is never redirected away from. Clicking the switcher persists the chosen language. `<link rel="alternate" hreflang>` (+ `x-default`) tags are emitted for SEO. |
| FR-11 | Functional | The switcher, runtime script, and `hreflang` tags are emitted **only when more than one language is configured**; a single-language build ships none of them. |

### Config

| ID | Type | Requirement |
|---|---|---|
| FR-12 | Functional | `config/targets.yml` accepts global `languages` / `default_language`, overridable per target (e.g. Canada `languages: [en, fr]`). |
| FR-13 | Functional | `src/lib/config.js` validates each locale against the supported set, de-duplicates, and ensures `default_language ∈ languages`; resolved values are exposed on every target. |

### Catalogs and tooling

| ID | Type | Requirement |
|---|---|---|
| FR-14 | Functional | Human-reviewed catalogs live in `src/locales/<locale>.json` as flat `{ "English source": "translation" }`. Supported locales: `en` (implicit), `fr`, `ja`, `nl`. Partial catalogs are safe. |
| FR-15 | Functional | `scripts/i18n-extract.js` emits `src/locales/template.json` (sorted translator checklist) from `t('…')` call sites plus the `src/locales/dynamic-strings.json` registry (strings translated indirectly via `t(variable)` / label tables). `npm run i18n:check` fails on a stale template. |
| FR-16 | Functional | A unit test asserts every key in each catalog exists in the template (catches stale/typo'd keys); missing-in-catalog is allowed (English fallback). |

---

## Constraints

| ID | Type | Constraint |
|---|---|---|
| C-01 | Hard | English-as-key: no `en.json`. With only `en` configured the generated HTML is unchanged and existing URLs are preserved. |
| C-02 | Hard | Internal severity keys stay `critical/serious/moderate/minor`; only the *display* labels localize (severity taxonomy unchanged). |
| C-03 | Hard | Scope is UI chrome only. Engine-sourced text — axe-core/Alfa/WCAG rule descriptions, technology names, domain names — stays English. |
| C-04 | Hard | No new npm runtime dependencies (Node ≥20 ICU provides `Intl`). |
| C-05 | Hard | All localization is static or progressive enhancement: no server, no build step; with JS off, pages render and the switcher links still navigate. |

---

## Non-functional requirements

| ID | Type | Requirement |
|---|---|---|
| NFR-01 | Testing | Unit tests cover: `t()` fallback + `@token` interpolation, locale-aware `nf()`, config language resolution/validation, the catalog-key lint, and the switcher/suffix + runtime-gating render behaviour. |

---

## Acceptance criteria

- [x] `t(source, args)` returns the English source when untranslated, the translation when present; empty/missing falls back to English.
- [x] `@token` placeholders interpolate in server strings and inline-script templates.
- [x] Every UI-chrome string in `report-html.js` renders via `t()` (incl. secondary pages and inline scripts).
- [x] With only `en` configured, output is unchanged and existing URLs preserved.
- [x] `<html lang>` reflects the locale; counts use `Intl` for that locale.
- [x] `languages: [en, fr]` produces canonical English pages + `-fr` siblings, cross-linked by a header switcher that works with JS disabled.
- [x] `?lang=` / `localStorage['vital-lang']` select the language at runtime, gated on >1 configured language; explicit `-<loc>.html` URLs are never redirected away from.
- [x] Severity keys remain `critical/serious/moderate/minor`; only display labels localize.
- [x] Engine-sourced text (WCAG/rule descriptions, tech, domains) stays English.
- [x] Catalog-key lint passes; `npm run test:unit` and `npm run i18n:check` green.
- [ ] `npm run test:e2e` — not run in the implementing sandbox (Playwright `chrome-headless-shell` binary absent; pre-existing environment limitation unrelated to i18n). Verified instead by a full `npm run aggregate` build with `languages: [en, fr]` over real data.

---

## Out of scope

- Translating axe-core/Alfa/WCAG rule descriptions and other engine-sourced text.
- Translating accessibility *guidance* documents (a possible future mission).
- Right-to-left layout (fr/ja/nl are all LTR).
- Localizing the static JSON API (it stays English/machine-readable).
