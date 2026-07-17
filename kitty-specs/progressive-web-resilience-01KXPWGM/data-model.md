# Data Model: Progressive Web Resilience section

**Mission**: progressive-web-resilience-01KXPWGM
**Date**: 2026-07-17

---

## Entities

### `ResilienceCheck` (new)

One row per capability check in the new section. Shape mirrors the existing
`checks` entries (`{ id, label, pass, detail }` in `standards.js:86`) but
extends `pass` to a tri-state and adds evidence/URL/explanation fields per
spec.md FR-006's reporting model.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable kebab-case id, e.g. `manifest-start-url`, `sw-controlling`, `offline-fallback`. Follows existing `pwa-*` / `open-graph` id convention. |
| `label` | string | Human-readable check name, shown in report and CSV header. |
| `status` | `'pass' \| 'fail' \| 'n/a'` | Tri-state, replacing the current boolean `pass`. `n/a` covers "undetectable" (e.g. navigation handling that can't be confirmed without triggering a live offline nav). |
| `evidence` | string | Concrete observed value — e.g. manifest's `display: "standalone"`, or cache name `v3-shell`. Empty string when status is `n/a`. |
| `exampleUrl` | string \| null | The page/origin URL the evidence was captured from, where applicable. |
| `why` | string | One-sentence explanation of why this capability matters (static per-`id`, not computed per-scan — same string every time a given `id` appears, sourced from a lookup table alongside the check definitions). |

### `ManifestSummary` (new)

Parsed manifest fields, attached once per origin (manifest is origin-scoped,
not page-scoped).

| Field | Type | Notes |
|---|---|---|
| `startUrl` | string \| null | `start_url` from manifest JSON. |
| `display` | string \| null | `display` mode (`standalone`, `browser`, etc). |
| `scope` | string \| null | `scope` from manifest JSON. |
| `themeColor` | string \| null | Manifest-level `theme_color` (distinct from the existing page-level `<meta name="theme-color">` check, which stays as-is). |
| `backgroundColor` | string \| null | `background_color`. |
| `icons` | array of `{ src, sizes, type, purpose }` | Raw icon list from manifest. |
| `hasMaskableIcon` | boolean | Derived: any icon's `purpose` includes `"maskable"`. |
| `parseError` | string \| null | Set when manifest fetch/parse fails; distinguishes "present but unreadable" from "absent" (FR-001). |

### `ServiceWorkerSummary` (new)

Extends the current single boolean (`standards.js:51-57,81`).

| Field | Type | Notes |
|---|---|---|
| `registered` | boolean | Existing signal, renamed from `hasServiceWorker` for clarity within the new summary object (or kept as alias — finalize in plan.md). |
| `active` | boolean | `registration.active != null`. |
| `installing` | boolean | `registration.installing != null`. |
| `waiting` | boolean | `registration.waiting != null`. |
| `controllingThisPage` | boolean | `navigator.serviceWorker.controller != null`. |

### `resilience` (new top-level key on `runStandards()` return value)

| Field | Type | Notes |
|---|---|---|
| `checks` | array of `ResilienceCheck` | Includes migrated `pwa-*` checks (D-06) plus new manifest/SW/offline/network/installability checks. |
| `manifest` | `ManifestSummary \| null` | Null when no manifest link is declared. |
| `serviceWorker` | `ServiceWorkerSummary` | Always present (all fields `false` when unsupported/absent). |

---

## Relationships

- `resilience` is a sibling of the existing `checks`, `social`, `og` keys on
  the object `runStandards()` returns (`standards.js:120-127`) — additive,
  no existing field renamed or removed except the `pwa-*` entries relocating
  out of `checks` (FR-007).
- `ResilienceCheck.id` values feed the CSV export the same way existing
  `checks[].id` values do today — one column/row per check id, per
  `src/lib/csv.js` conventions (exact shape TBD in plan.md).
- `ManifestSummary` and `ServiceWorkerSummary` are per-origin data computed
  during a single page visit (the same page `runStandards(page)` already
  runs against) — no new per-origin memoization needed for these two,
  unlike the offline/network checks (see research.md D-03/D-04, which *do*
  need origin-level memoization since they require a separate navigation).

## Non-goals for this data model

- No new aggregate score field (spec.md C-02) — no `resilienceScore` or
  similar is added anywhere in this shape.
- No historical/trend fields added here — trend tracking (new/fixed/regressed)
  for resilience checks, if wanted later, would reuse the existing
  `src/lib/progress.js` findings-ledger machinery, not a bespoke mechanism;
  out of scope for this mission (spec.md doesn't request it).
