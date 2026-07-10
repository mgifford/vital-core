# Spec: Viewer-side report URL exclusion

**Status**: DRAFT
**Issue**: [#209](https://github.com/mgifford/vital-core/issues/209)

> Hand-authored to mirror the spec-kitty mission format (the `spec-kitty` CLI is
> not available in this environment, same as `report-ia-01ria7`). Implement
> incrementally on branch `report/url-exclusion`, one work package per focused
> commit/PR to `main`.

## Goal

Let a **report viewer** — not just whoever edits `config/targets.yml` — build a
personal list of URLs to exclude from a domain's report, so they can focus on the
pages they are actually responsible for. Government teams routinely own a subset
of a domain: everything under `/medicare/` may belong to another group, and
legacy `.asp`/`.aspx` pages may be out of contract entirely. The scan still
covers every URL (comprehensiveness is preserved); the viewer's exclusion list
only changes **what the report displays**.

The control lives in the browser: the chosen patterns persist in `localStorage`
(no re-entry on the next visit) and can be exported, imported, copied, and shared
so a team can agree on one scope. It appears as a config box on the domain
landing page, directly under the site-inventory line:

> Over the whole history of this site, 28549 unique pages have been scanned…

and reuses the visual/interaction pattern of the existing **"Action queue
decisions:"** / **"Triage decisions:"** boxes (`.triage-io`,
`src/report-html.js:1180`, `:1612`).

This is the **viewer-time** counterpart to two existing exclusion layers:

| Layer | Where | When | Editable by |
|---|---|---|---|
| `url_exclude` (+ `url_exclude_file`, `/regex/`) | crawl/scan | build | config author (#132 / PR #208) |
| `url_exclude_patterns` | report render | build | config author (today) |
| **this mission** | **report display** | **runtime, in browser** | **viewer** |

---

## Decisions (recommended defaults — adjustable before implementation)

These three choices shape the acceptance criteria below. They are set to the
recommended default; flip any here and update the affected criteria before
starting WP work.

- **D-1 — v1 = display-only.** v1 filters the on-page report and persists /
  shares the list. Regenerating filtered **CSV/JSON downloads** client-side is
  deferred to a Phase-2 mission (see _Out of scope_). *(Alt: also filter exports
  in v1.)*
- **D-2 — headline score stays whole-site + labelled.** The letter grade / score
  is **not** recomputed for the filtered subset; the filtered view is labelled so
  the number is not misread. *(Alt: recompute client-side.)*
- **D-3 — viewer list is additive to the config baseline.** The config
  `url_exclude_patterns` remains an always-on baseline; the viewer's patterns add
  to it and the banner shows both sources. *(Alt: viewer list fully independent.)*

---

## Requirements

### Viewer exclusion control

| ID | Type | Requirement |
|---|---|---|
| FR-01 | Functional | A viewer-editable exclusion control renders as a collapsed-by-default box styled with the existing `.triage-io` pattern. On the domain landing page (`renderDomainReport`) it sits **directly under the site-inventory meta line** (`src/report-html.js:2939`); it also appears on the canonical accessibility page (`renderAccessibilityPage`) where findings live. The box holds a multiline pattern input plus **Apply** and **Clear** controls. |
| FR-02 | Functional | Each line is one pattern, matched case-insensitively against the full normalized page URL as a **substring**, or as a **`/regex/`** when slash-wrapped (optional trailing flags) — the same substring-or-`/regex/` convention as scan-side `url_exclude` (PR #208). Blank lines and `#` comments are ignored. |
| FR-03 | Functional | The active list persists in `localStorage['vital-exclude:<domain-key>']` (per-domain, so each site keeps its own contract scope) and is re-read and re-applied on page load with no re-entry. |
| FR-04 | Functional | With a list active, findings whose only affected pages match the patterns are hidden, matching affected-pages are removed from findings that remain, and every **visible count** on the page (pages affected, per-severity tallies, "showing N of M") updates to the filtered view — all client-side. |
| FR-05 | Functional | The viewer list is **additive** to the config `url_exclude_patterns` baseline (D-3). A banner (reusing/echoing `formatExclusionBanner`) names both sources and shows how many pages/findings are currently hidden, with a one-click **reset to view all**. |

### Share & portability

| ID | Type | Requirement |
|---|---|---|
| FR-06 | Functional | The exclusion set supports **Export (.json)**, **Import (.json)**, and **Copy share payload**, reusing the triage IO scaffold (`report-html.js:1180`, `:1687`). Import merges/replaces the current list and re-applies it; export/share carry the domain key so a shared file lands on the right site. |

### Shared matching semantics

| ID | Type | Requirement |
|---|---|---|
| FR-07 | Functional | Server-side `matchesExclusionPattern` / `filterBugsByExclusion` (`report-html.js:33`, `:44`) are extended to honour `/regex/` patterns in addition to substrings, so the config baseline (FR-05) and the viewer list share **one** matching semantics. Substring behaviour is unchanged; an unparseable `/regex/` falls back to a literal substring match (mirrors PR #208's `compilePattern`). |

### Docs

| ID | Type | Requirement |
|---|---|---|
| FR-08 | Functional | `CLAUDE.md` gains a short "Viewer URL exclusion" note distinguishing the three exclusion layers (scan `url_exclude`, report `url_exclude_patterns`, viewer localStorage list); `README.md` / `FEATURES.md` note the viewer control; `config/targets.yml` comments cross-reference it near `url_exclude_patterns`. |

---

## Constraints

| ID | Type | Constraint |
|---|---|---|
| C-01 | Hard | **Progressive enhancement.** With JavaScript off, the report is the full, server-rendered report (the config `url_exclude_patterns` baseline still applied at build). The viewer control, persistence, filtering, and share IO are enhancement-only and must never break the no-JS baseline. |
| C-02 | Hard | **Headline score stays whole-site (D-2).** The accessibility score/grade is not recomputed for the filtered subset; the filtered view is labelled so the whole-site number is not misread as a filtered one. |
| C-03 | Hard | **One canonical location per finding.** Hiding is display filtering only; findings are still rendered in full exactly once (accessible.html). No finding is re-rendered elsewhere to apply exclusion. |
| C-04 | Hard | **Sustainable web output** (charter `sustainable-web-output`): reuse `.triage-io` and existing CSS classes, add no web fonts, keep added CSS/JS within the lean budget, and gate the script so a page with no exclusion capability in play ships nothing extra. Work is done in the browser only because the requirement is inherently per-viewer; nothing is fetched. |
| C-05 | Hard | **No data/API changes.** Viewer exclusions are a pure client concern — never written to `data/`, `state/`, or the static JSON API (which stays keyed on domain/week). No `data/` schema change; deep links and `#fragment` anchors keep working. |
| C-06 | Hard | No new npm runtime dependencies; Node ESM ≥ 20, no build step. |
| C-07 | Hard | **Severity taxonomy unchanged** — internal keys stay `critical/serious/moderate/minor`; only the four display labels appear. |
| C-08 | Hard | **i18n lockstep.** All new visible strings go through `t()`; inline-script message templates are injected per-locale via `JSON.stringify(t('…'))` (the established pattern); `npm run i18n:check` stays green. |

---

## Non-functional requirements

| ID | Type | Requirement |
|---|---|---|
| NFR-01 | Testing | Unit tests cover the regex-aware `matchesExclusionPattern` / `filterBugsByExclusion` (substring kept, `/regex/` added, invalid-regex fallback) and render tests asserting the control + banner emit on the landing and accessibility pages and are inert with an empty list. `tests/e2e.mjs` / `tests/unit/i18n-render.test.js` updated in lockstep with any markup/href change. `npm run test:unit` and `npm run i18n:check` green. |
| NFR-02 | Sustainability | Net added CSS/JS stays within the project's lean budget; the control reuses `.triage-io` classes and the existing IO script pattern; the client filter script is emitted once per page and is a no-op when no list is stored. |

---

## Acceptance criteria

- [ ] A collapsed `.triage-io`-styled exclusion box renders under the
      site-inventory meta line on the domain landing page and on the accessibility
      page, with a pattern input, **Apply**, and **Clear**. *(FR-01)*
- [ ] Patterns match the full URL case-insensitively as substring or `/regex/`;
      `#` comments and blank lines ignored. *(FR-02)*
- [ ] The list persists in `localStorage['vital-exclude:<domain-key>']` and
      re-applies on reload with no re-entry. *(FR-03)*
- [ ] With a list active, matching findings/pages are hidden and all visible
      counts update to the filtered view, client-side. *(FR-04)*
- [ ] The viewer list is additive to the config `url_exclude_patterns` baseline;
      a banner names both sources with a hidden-count and a reset-to-view-all.
      *(FR-05)*
- [ ] Export (.json) / Import (.json) / Copy share payload work, carrying the
      domain key, reusing the triage IO scaffold. *(FR-06)*
- [x] `matchesExclusionPattern` / `filterBugsByExclusion` honour `/regex/` as well
      as substrings; invalid regex falls back to literal substring; existing
      config-baseline behaviour unchanged. *(FR-07 — WP01)*
- [ ] The report is fully usable with JavaScript disabled; the headline score is
      not recomputed for the filtered set and the filtered view is labelled.
      *(C-01, C-02)*
- [ ] Docs updated (CLAUDE.md three-layer note, README/FEATURES, targets.yml
      cross-reference). *(FR-08)*
- [ ] `npm run test:unit`, `npm run i18n:check`, and `npm run check:spec-kitty`
      green; `npm run test:e2e` green (or a full `npm run aggregate` where the
      Playwright binary is unavailable). *(NFR-01)*

---

## Out of scope

- **Filtered CSV/JSON downloads (Phase 2).** Regenerating exports client-side
  from page data via a Blob download so downloads honour the viewer list. The
  current download links point at pre-built static files (`bugs.csv`,
  `data/<key>/domain.json`, …) that client JS cannot rewrite; doing this well is
  its own mission. (Reverse D-1 to pull it into v1.)
- **Recomputing the headline accessibility score** for the filtered subset (D-2).
- **A committed / server-side store** of viewer exclusions — the list stays
  browser-local (like triage decisions).
- **Changing what is crawled or scanned** — that is scan-side `url_exclude`
  (#132 / PR #208). Every URL is still scanned; only the display is scoped.
- **Localizing engine-sourced text** (unchanged from the i18n mission scope).
