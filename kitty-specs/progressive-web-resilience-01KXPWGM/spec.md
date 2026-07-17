# Spec: Progressive Web Resilience section

**Status**: DRAFT
**Origin**: [issue #145](https://github.com/mgifford/vital-core/issues/145)

## Problem

`src/engines/standards.js` already detects a handful of PWA-adjacent signals
(`pwa-https`, `pwa-manifest`, `pwa-service-worker`, `pwa-theme-color`,
`pwa-apple-touch-icon`), but every one of them is a bare presence/boolean
check mixed into the same flat `checks` array as social/metadata checks:

- **Manifest**: only `link[rel="manifest"]` presence is checked
  (`standards.js:45,78,114`). The manifest JSON itself is never fetched or
  parsed, so `start_url`, `display`, `scope`, `icons` (incl. maskable),
  `theme_color`, and `background_color` are invisible to the report.
- **Service worker**: only a boolean "is one registered"
  (`navigator.serviceWorker.getRegistration()`, `standards.js:49-57,115`).
  Active/controlling state and navigation-handling behavior are not detected.
- **Offline resilience, installability, content resilience (read-later /
  form-progress preservation), and network resilience** (cache strategy,
  versioning, retry behavior) are not detected at all.
- There is no dedicated "Progressive Web Resilience" section — the 5 PWA
  checks render inline in the same list as `schema-gov`, `canonical`,
  `open-graph`, etc., with no evidence, example URL, or explanation per check
  (issue's requested reporting model: Pass/Fail/N/A + evidence + example URL
  + why-it-matters).

This is exactly the shallow detection issue #145 says to go beyond: *"Rather
than simply detecting its presence, report useful manifest characteristics."*

## Goal

Add a distinct Progressive Web Resilience section to the "Findable?" page's
Web standards & metadata report (`standardsSection()` in
`src/report-html.js`, `findable.html`, `#h-standards`) that reports
actionable capability evidence (not another aggregate score), reusing
existing scan infrastructure and avoiding duplication with
Accessibility/Lighthouse (title, lang, viewport, WCAG failures, HTML
validation stay where they are).

**Correction to issue #145's framing**: the issue's own comment links to a
`standards.html` URL from an earlier report layout; the current report
renames that page `findable.html` under the "Findable?" outcome group
(`SUBNAV_GROUPS`, `src/report-html.js:341`), and PWA checks already render
there (`pwaChecks` filter, `src/report-html.js:2513-2528`) — not on a
separate "Standards & Security" page (that name does not exist in the
current IA; "Trustworthy?" holds `security`/`third-party`/`errors`
instead). This mission targets the actual current page.

## Requirements

| ID | Type | Requirement |
|---|---|---|
| FR-001 | Functional | Fetch and parse the web app manifest (via the `manifestHref` already resolved in `standards.js`) and report `start_url`, `display`, `scope`, `theme_color`, `background_color`, icon list, and whether any icon declares `"purpose": "maskable"`. Handle fetch failure / invalid JSON as a distinct "manifest present but unreadable" state, not a silent pass or crash. |
| FR-002 | Functional | Expand service-worker detection beyond `getRegistration()` boolean: report registered / active / controlling-this-page, and (best-effort, e.g. inspecting the registration's `scope` and any detectable `fetch` handling) navigation handling. Where a signal can't be determined from Playwright, report it as "Not applicable" / "Undetermined" rather than a false negative. |
| FR-003 | Functional | Add offline-resilience checks where practical from the existing Playwright page context: offline fallback page / cached navigation response (e.g. via cache-storage inspection or a controlled offline navigation attempt), reporting Pass/Fail/N/A. |
| FR-004 | Functional | Add installability signal reporting (manifest + service-worker + HTTPS combined, per browser install criteria) without attempting to reconstruct Lighthouse's retired PWA score. |
| FR-005 | Functional | Add network-resilience signals where detectable (Cache Storage API usage/versioning, presence of a fetch/retry pattern) as Pass/Fail/N/A with evidence. |
| FR-006 | Functional | Restructure the report output so Progressive Web Resilience checks are grouped in their own named section (JSON: a distinct `pwa` or `resilience` key; HTML: a distinct subsection in the Standards & Security page), separate from the existing flat `checks` list, each item carrying `{ id, label, pass (Pass/Fail/N/A), evidence, exampleUrl, why }`. |
| FR-007 | Functional | Existing `pwa-*` checks (`pwa-https`, `pwa-manifest`, `pwa-service-worker`, `pwa-theme-color`, `pwa-apple-touch-icon`) are migrated into the new section rather than duplicated; no check exists in both the flat list and the new section. |
| FR-008 | Functional | Results flow through the existing JSON and CSV reporting pipeline (`src/lib/csv.js`, `docs/api/v1/...`) per the issue's acceptance criteria — new fields, not a parallel export path. |
| C-01 | Constraint | Do not duplicate checks owned by Accessibility or Lighthouse: `<title>`, `lang`, viewport, HTML validation, WCAG failures stay out of this section. |
| C-02 | Constraint | No new aggregate/compliance score is introduced for Progressive Web Resilience — evidence-based reporting only, consistent with the rest of `standards.js`. |
| NFR-01 | Non-functional | All unit tests pass (`npm run test:unit`); new synthetic-page tests cover manifest parsing (valid, missing, malformed) and the section-grouping shape, per existing `tests/unit/` conventions (no mocking of fs/DB). |
| NFR-02 | Non-functional | Sustainability gate: no new client-side JS or web fonts introduced; manifest fetch and service-worker inspection happen server-side during the scan (Playwright), not shipped as browser-side report JS. |

## Acceptance criteria

- [x] The "Findable?" page's Web standards & metadata report
      (`findable.html`, `#h-standards`) shows a distinct "Progressive Web
      Resilience" section, not checks mixed into the existing flat list.
- [x] Manifest checks report `start_url`, `display`, `scope`, `theme_color`,
      `background_color`, icons, and maskable-icon presence — not just
      manifest-link presence.
- [x] Service worker checks report registered/active/controlling state
      distinctly (no longer a single boolean).
- [x] At least one offline-resilience and one network-resilience check is
      implemented and reports Pass/Fail/N/A with evidence.
- [x] Installability is reported as a derived signal, with no new aggregate
      PWA score introduced.
- [x] Every check in the new section carries evidence and a brief
      explanation of why it matters; example URL is included where
      applicable.
- [x] No check present in this section duplicates an Accessibility or
      Lighthouse check (title, lang, viewport, WCAG, HTML validation).
- [x] New fields are present in the static JSON API and CSV export.
- [x] `npm run test:unit` passes with new coverage for manifest parsing and
      section grouping.

## Out of scope

- Recreating Lighthouse's retired PWA score or any single aggregate score
  for this section.
- Content resilience features requiring cross-page-flow analysis (read-later,
  form-progress preservation) — flagged in the issue as valuable but requires
  multi-step user-flow simulation beyond this mission's single-page-evaluate
  model; may become a follow-up mission if research shows a practical
  single-pass detection method.
- Changing how Lighthouse or Accessibility engines report their own checks.

## Open questions (resolve in plan.md)

- Can offline-fallback/cached-navigation detection be done reliably within
  the existing per-page Playwright scan (e.g. `page.context().setOffline(true)`
  then re-navigate) without materially slowing the crawl, or does it need to
  be sampled/opt-in?
- Where should manifest fetch happen — inside `runStandards(page)`'s
  `page.evaluate` (same-origin fetch) or via a follow-up Playwright request
  outside the page context? Affects error handling for cross-origin manifests.
- Does "network resilience" detection (cache versioning, retry behavior)
  require inspecting service-worker source, and if so, is static analysis of
  the SW script in scope, or only runtime-observable signals (Cache Storage
  contents)?
