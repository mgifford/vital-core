# Spec: Cross-domain pattern discovery

**Status**: DRAFT

> Source: [GitHub issue #221](https://github.com/mgifford/vital-core/issues/221)
> "Finding patterns between sites." Spec authored from the issue body; scoped
> down to the smallest correct slice per the issue's own "Future Enhancements"
> deferral (DOM/visual clustering, AI-assisted grouping are explicitly out of
> scope for this mission).

## Goal

Answer *"what should we fix first to improve the most sites?"* instead of only
*"where are the errors?"* by surfacing accessibility findings that recur across
multiple independently-scanned domains — the strongest signal of a shared CMS
template, design-system component, or widget bug rather than a one-off content
issue.

vital-core already computes a stable `pattern_id` per finding
(`hash(engine, ruleId)` in `buildBugReports`, [src/lib/bug-report.js:49](../../src/lib/bug-report.js#L49))
— identical across domains for the same underlying rule — but nothing today
rolls it up **across** domains. It is only used within one domain's
week-over-week ledger for first/last-seen tracking (`aggregate.js:210`,
`api-writer.js:123`).

The fleet dashboard (`renderDashboard` in `src/report-html.js`) already has
three precedents for exactly this shape of cross-domain rollup, all following
the same merge → filter(`sites >= 2`) → rank → render pattern:

- `fleetWorstOffenders` ([src/lib/priority.js:40](../../src/lib/priority.js#L40)) — highest-impact single findings, `#h-worst`
- `mergeFleet` / `rankFleetAssociations` ([src/lib/tech-findings.js:123](../../src/lib/tech-findings.js#L123)) — tech↔finding associations ranked by `lift × sites`, `#h-techfindings`
- Inline Lighthouse recommendation merge ([src/report-html.js:3956](../../src/report-html.js#L3956)), `#h-lhfleet`

This mission adds a fourth section, **"Recurring patterns across domains"**
(`#h-patterns`), built the same way but keyed by `pattern_id`.

---

## Requirements

### Fleet pattern aggregation

| ID | Type | Requirement |
|---|---|---|
| FR-001 | Functional | A new pure function `mergeFleetPatterns(perDomain)` in `src/lib/priority.js` (or a new `src/lib/patterns.js` if that reads cleaner) takes `[{ target, bugs }]` — the same shape `fleetWorstOffenders` already takes — and groups bugs by `pattern_id` across all domains, producing one entry per pattern with: `pattern_id`, a representative `rule_label`/`wcag_sc`/`severity` (from the first bug seen), `sites` (count of distinct domains carrying this pattern), `domains` (list of `{domain, key}` for linking), `pages` (sum of `frequency.pages_affected` across domains), and `technologies` (distinct `tech` values seen alongside this pattern per domain, when available). |
| FR-002 | Functional | A ranking function `rankFleetPatterns(merged, { minSites = 2, limit = 25 })` filters to patterns present on `>= minSites` distinct domains (a single-site finding is not a cross-site pattern) and ranks by a **fix-leverage score**, not raw instance count: `score = sites × severityWeight × pages` (reuse the existing `SEVERITY_WEIGHT` table in `priority.js`), mirroring the existing `score = lift × sites` convention in `rankFleetAssociations`. |
| FR-003 | Functional | `renderDashboard` computes `active.map(d => ({ target: d.target, bugs: d.series[...].bugs ?? [] }))` (same source `fleetWorstOffenders` already consumes) and renders a new section `#h-patterns`, "Recurring patterns across domains," positioned alongside the existing `#h-worst`/`#h-techfindings`/`#h-lhfleet` sections. Table columns: Pattern (rule label, linking to one representative domain's finding), Sites, Pages, Severity, Likely source (template vs. content — reuse the existing `likely_source` field already computed per bug in `bug-report.js`). |
| FR-004 | Functional | The subnav entry / heading is added to the same outcome group these other fleet sections already live under; no new top-level nav item. |
| FR-005 | Functional | Section is omitted entirely (no empty table) when fewer than 2 active domains report data, or no pattern meets `minSites`, matching the existing `techFindingsSection`/`lighthouseFleetSection` empty-state convention (`''` when nothing qualifies). |

---

## Constraints

| ID | Type | Constraint |
|---|---|---|
| C-001 | Hard | **No new grouping signal beyond `pattern_id` in this mission.** DOM similarity, HTML fingerprinting, CSS selector clustering, and AI-assisted grouping are explicitly deferred per the issue's own "Future Enhancements" section — do not attempt them here. |
| C-002 | Hard | **Reuse, don't fork, the existing fleet-merge shape.** New code follows the `merge → filter(minSites) → rank(score) → render` pattern already established by `mergeFleet`/`rankFleetAssociations`; do not introduce a parallel aggregation framework. |
| C-003 | Hard | Ranking must reflect **fix leverage** (sites × severity × pages), not raw finding count — this is the issue's explicit complaint about the current "Worst offenders" view (single-domain impact only). |
| C-004 | Hard | Sustainability gate: no new client-side JS, no new web fonts; table follows the existing `.sortable` table CSS already used by `#h-techfindings`/`#h-lhfleet` (no new CSS budget). |
| C-005 | Hard | Severity taxonomy unchanged — internal keys stay `critical/serious/moderate/minor`; only display labels localize via `t()`. |
| C-006 | Hard | No `data/` schema changes; this reads existing per-domain `bugs[]` (already written by `buildBugReports`), no new scan-time computation. |

---

## Non-functional requirements

| ID | Type | Requirement |
|---|---|---|
| NFR-001 | Testing | Unit tests for `mergeFleetPatterns` and `rankFleetPatterns` in `tests/unit/` covering: pattern seen on 1 domain is excluded at `minSites=2`; pattern seen on N domains aggregates `sites`/`pages` correctly; ranking order matches the documented score formula; empty input returns `[]`. |
| NFR-002 | Testing | `tests/e2e.mjs` updated if the dashboard gains a new anchor/section that assertions should cover (matching how `h-worst`/`h-techfindings`/`h-lhfleet` are already asserted, if they are). |
| NFR-003 | i18n | New heading/column strings go through `t()` and are added to `src/locales/dynamic-strings.json` if referenced indirectly; `npm run i18n:check` stays green. |

---

## Acceptance criteria

- [ ] `mergeFleetPatterns` groups bugs by `pattern_id` across all active domains, tracking sites, pages, severity, and representative metadata.
- [ ] `rankFleetPatterns` filters to `sites >= minSites` (default 2) and ranks by `sites × severityWeight × pages`, not raw count.
- [ ] Dashboard renders a new "Recurring patterns across domains" (`#h-patterns`) section using the same table/empty-state conventions as `#h-worst`/`#h-techfindings`/`#h-lhfleet`, linking each pattern to a representative finding.
- [ ] Section is omitted (not an empty table) when there's nothing to show.
- [ ] Unit tests cover the merge/rank functions per NFR-001; `npm run test:unit` green.
- [ ] `npm run i18n:check` and `npm run check:spec-kitty` green.
- [ ] No `data/` schema change; no new runtime dependency; no new client-side JS.

---

## Out of scope

- **CSV/API export of the ranked fleet-pattern list** (downloadable export
  following the existing `filePrefix`/CSV convention in `src/lib/csv.js`) —
  a natural follow-up once the fleet-pattern table itself proves useful, but
  deliberately excluded from this mission's single WP so the slice stays
  minimal. Candidate for a future WP/mission once FR-001–005 are in
  production and a reviewer asks for it.
- DOM similarity, HTML fingerprinting, CSS selector clustering, visual
  similarity, or AI-assisted grouping of related findings (issue's own
  "Future Enhancements" — future mission).
- Per-pattern drill-down page (list of every affected domain/page with
  screenshots) — this mission surfaces the fleet-level table only; deep-linking
  to "representative examples" reuses existing per-domain finding anchors
  rather than building new drill-down UI.
- Changing `pattern_id` computation itself (`hash(engine, ruleId)` stays as-is).
- Root-cause classification beyond the existing `likely_source: template|content`
  heuristic already computed per bug.
