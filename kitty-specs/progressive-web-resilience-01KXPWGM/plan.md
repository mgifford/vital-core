# Implementation Plan: Progressive Web Resilience section

**Branch**: `main` | **Date**: 2026-07-17 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `kitty-specs/progressive-web-resilience-01KXPWGM/spec.md`

## Summary

Add a distinct Progressive Web Resilience section to `runStandards()` in
`src/engines/standards.js` that reports manifest characteristics, expanded
service-worker state, offline-fallback and network-resilience signals, and
installability, each as evidence-backed Pass/Fail/N/A checks — migrating the
existing `pwa-*` boolean checks into the new section rather than duplicating
them. Offline/network checks that require a separate navigation run once per
origin (mirroring `runSecurity`'s existing origin-level pattern), not per
page, per research.md D-03/D-04.

## Technical Context

**Language/Version**: Node.js ESM >=20
**Primary Dependencies**: Playwright (already a dependency; no new packages) — manifest fetch uses in-page `fetch()`, service-worker/cache inspection uses existing `page.evaluate` and a new isolated `browser.newContext()` for the offline check
**Storage**: No persistent storage changes; results flow through the existing per-week findings/report JSON and `docs/api/v1/` static API
**Testing**: Node built-in test runner via `npm run test:unit`; synthetic-page fixtures for manifest parsing (valid/missing/malformed) and section-grouping shape, no mocking of fs/DB per repo convention
**Target Platform**: Server-side scan pipeline (`npm run scan`) — no client-side JS added (NFR-02, sustainability gate)
**Project Type**: Single project (existing vital-core structure, no new top-level directories)
**Performance Goals**: Offline-resilience check adds at most one extra context + navigation per origin (not per page); must not materially increase per-domain scan duration beyond existing per-origin checks (`security`, `public-interest`)
**Constraints**: No new aggregate/compliance score (spec.md C-02); no duplication of Accessibility/Lighthouse checks (spec.md C-01)
**Scale/Scope**: Applies to every domain in `config/targets.yml`; new checks run at the existing `standards` sampling rate for page-scoped checks, and at an origin-scoped cadence (TBD gating, see Open Questions) for offline/network checks

## Charter Check

- Preserves plain Node.js ESM with no build step and no new dependencies.
- No client-side JS or web-font budget growth (sustainability gate, NFR-02).
- Static JSON API and CSV export are extended, not replaced (existing `src/lib/api-writer.js` / `src/lib/csv.js` contracts preserved — FR-008).
- Existing `pwa-*` check ids are relocated, not deleted, avoiding an unannounced breaking change to `findings.json` consumers that may reference them (verify during WP03 — see Complexity Tracking).
- Unit-test coverage required for all new detection logic (NFR-01).

## Project Structure

### Documentation (this mission)

```
kitty-specs/progressive-web-resilience-01KXPWGM/
├── plan.md              # This file
├── research.md          # Phase 0 output (decisions D-01..D-06)
├── data-model.md         # Phase 1 output (ResilienceCheck, ManifestSummary, ServiceWorkerSummary)
└── tasks/                # Phase 2 output (spec-kitty tasks command)
```

### Source Code (repository root)

```
src/
├── engines/
│   └── standards.js       # Extended: manifest fetch/parse, SW state, resilience section assembly
├── scan.js                # Extended: origin-level memoized offline/network check invocation (mirrors runSecurity/runPublicInterest pattern)
├── lib/
│   └── csv.js              # Extended: CSV columns for new resilience section fields
└── report-html.js         # Extended: dedicated Progressive Web Resilience subsection render

tests/
└── unit/
    └── standards.test.js   # New/extended: manifest parsing, SW state, section-grouping shape (exact filename TBD at tasks phase — follow existing tests/unit/ naming)
```

**Structure Decision**: Single project, no new directories. All engine logic
stays in `src/engines/standards.js` (existing owner of PWA detection per
`src/engines/lighthouse.js`'s comment that Lighthouse 12+ dropped the PWA
category). Origin-level check orchestration extends the existing
`scan.js` per-origin memoization block alongside `runSecurity`/`runPublicInterest`.

## Complexity Tracking

*Fill ONLY if Charter Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Relocating `pwa-*` check ids out of the flat `checks` array (FR-007) | Issue #145 explicitly asks for a distinct section, not inline mixing | Leaving them in place would duplicate them once new resilience checks exist, contradicting FR-007's no-duplication requirement — but any external consumer keyed on `checks[].id === 'pwa-manifest'` etc. breaks. Mitigation: confirm during WP03 whether `docs/api/v1/` or CSV downstream consumers exist beyond this repo's own report renderer before removing the old ids outright; if unclear, keep a compatibility re-export note in the PR description rather than silently breaking external consumers. |

## Implementation Concern Map

> Implementation concerns are NOT work packages. `/spec-kitty.tasks` will
> translate these into executable WPs — one concern may become multiple WPs.

### IC-01 — Manifest fetch and parsing

- **Purpose**: Fetch and parse the web app manifest JSON to report `start_url`, `display`, `scope`, `theme_color`, `background_color`, icons, and maskable-icon presence instead of bare link presence.
- **Relevant requirements**: FR-001
- **Affected surfaces**: `src/engines/standards.js` (`page.evaluate` block, per research.md D-01)
- **Sequencing/depends-on**: none
- **Risks**: Cross-origin manifests fail same-origin `fetch()` — must surface as "manifest present but unreadable," not crash or silently pass (FR-001 explicit requirement).

### IC-02 — Expanded service-worker state

- **Purpose**: Report registered/active/installing/waiting/controlling states instead of a single boolean.
- **Relevant requirements**: FR-002
- **Affected surfaces**: `src/engines/standards.js` (`page.evaluate` block, per research.md D-02)
- **Sequencing/depends-on**: none — independent of IC-01, can be implemented in the same WP since both touch the same `page.evaluate` block
- **Risks**: "Navigation handling" (whether SW intercepts navigation requests) is not reliably observable without a real offline navigation — deferred to IC-03, not faked here.

### IC-03 — Origin-level offline-resilience and network-resilience checks

- **Purpose**: Detect offline fallback / cached navigation and Cache Storage usage as Pass/Fail/N/A signals, run once per origin via a dedicated isolated context (research.md D-03, D-04, D-05).
- **Relevant requirements**: FR-003, FR-005
- **Affected surfaces**: `src/scan.js` (new origin-level memoized check, mirroring `runSecurity`/`runPublicInterest` at `scan.js:307-314`), `src/engines/standards.js` (or a new small helper module if the isolated-context logic doesn't fit `standards.js`'s page-context style — decide during WP implementation)
- **Sequencing/depends-on**: none functionally, but should land after IC-01/IC-02 land the section-shape scaffolding (IC-05) so its output has somewhere to go
- **Risks**: Must not touch the shared crawl `context` (research.md D-04) — isolate in its own `browser.newContext()`. Adds real navigation cost per origin; needs a sampling/gating decision (see Open Questions) before enabling by default at fleet scale.

### IC-04 — Installability signal

- **Purpose**: Derive an installability signal from manifest + service-worker + HTTPS combination (FR-004), without reconstructing Lighthouse's retired PWA score.
- **Relevant requirements**: FR-004, C-02
- **Affected surfaces**: `src/engines/standards.js` (pure derivation from IC-01/IC-02/existing HTTPS check output — no new page interaction)
- **Sequencing/depends-on**: IC-01, IC-02 (needs their output fields)
- **Risks**: Must stay a per-capability signal, not collapse into a single score (C-02) — keep it as one more `ResilienceCheck` entry, not a separate number.

### IC-05 — Section restructuring, report rendering, and export pipeline

- **Purpose**: Introduce the `resilience` top-level key (research.md D-06), migrate existing `pwa-*` checks into it, render a distinct Progressive Web Resilience subsection in the Standards & Security HTML report, and extend CSV/JSON API export.
- **Relevant requirements**: FR-006, FR-007, FR-008
- **Affected surfaces**: `src/engines/standards.js` (return shape), `src/report-html.js` (new subsection render), `src/lib/csv.js` (new columns), `src/lib/api-writer.js` if the static JSON API needs explicit field wiring beyond passthrough
- **Sequencing/depends-on**: IC-01, IC-02, IC-03, IC-04 (needs their check outputs to render/export)
- **Risks**: `pageHref`/subnav conventions (per CLAUDE.md) must be followed if the subsection needs its own anchor; this mission does not rename any page file, so `PAGE_REDIRECTS` should not need touching — confirm during implementation.

## Open questions carried from research.md

- Exact key name (`resilience` vs `pwa` vs `progressiveWebResilience`) — decide during IC-05 implementation, not a blocking design question.
- Whether the offline-resilience per-origin check needs a new `config/targets.yml` sampling-rate gate (like `lighthouse`) given its added per-origin navigation cost — resolve during IC-03 implementation; default recommendation is to gate it the same way `lighthouse` is gated (sampling rate > 0 enables it) rather than always-on.
- Exact CSV column names for new fields — enumerate against `src/lib/csv.js`'s `bugsCsvTable()` conventions during IC-05 implementation.
