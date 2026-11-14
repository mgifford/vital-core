# Evidence identity audit (2026-11)

Scope: current `main` after PRs #299–#317. This is the PR 1 record for the
evidence-reliability milestone.

## Identity contracts

| Identifier | Formula / basis | Stability | Purpose |
|---|---|---|---|
| `pattern_id` | `VS-` + hash(engine, rule id) | Stable across domains and weeks; deliberately shared by the fleet analysis | Rule/pattern identity |
| `occurrence_id` | `VO-` + hash(pattern_id, URL, selector, component) | Stable for the same recorded element across weeks and re-aggregation | One element observation |
| `observation_id` | `VOB-` + hash(occurrence_id, page_id, run_id, scanned_at, engine, version, consent state) | Stable for one scan observation; changes on a new run | Provenance of a single occurrence |
| `finding_ref` | `VFR-` + hash(domain key, pattern_id) | Stable for the finding within a domain, independent of samples | Durable link target |
| `instance_id` | `VS-` + hash(pattern_id, **first** instance URL/selector) | **Legacy anchor**; can move when the week's sample changes | Old `#VS-…` links |

`finding_ref` and `observation_id` are additive. `pattern_id` and the legacy
`instance_id` formula are unchanged.

## Confirmed defects and risks

1. **`instance_id` depended on the first captured example.** Adding a page that
   sorts/aggregates earlier can change the `#VS-…` anchor. The frozen formula is
   kept for compatibility; new `finding_ref` is the durable reference, rendered
   as an additional anchor and in the API.
2. **Representative selection used capture order as a tie-breaker.** A new page
   could change which equally complete occurrence was displayed. Selection is
   now deterministic by completeness, URL, selector, component and observation
   id. The selected occurrence still may change if a more complete occurrence is
   added; `representative_occurrence_id` records the choice.
3. **`occurrence_id` includes component attribution.** Re-running with a changed
   component configuration can change the id. Component attribution is part of
   the occurrence key today; document this before changing it. A versioned
   occurrence key would be required.
4. **Historical `#VS-…` links can move** when the first example changes. The new
   `#VFR-…` anchor is stable; a redirect/alias ledger for old VS anchors is not
   implemented. Old links still fail with the browser's missing-anchor behavior.
5. **Retention:** weekly summaries and representative evidence are retained;
   screenshots and page-level detail may be removed only by the verified, explicitly authorized retention command; no automatic pruning exists.
   `evidence_reference` states the retention window and the representative
   observation, but cannot keep a pruned screenshot available.

## Cross-surface agreement

`tests/unit/evidence-surfaces.test.js` builds controlled findings for header,
footer, named navigation, search, a form field, dialog, consent component,
dynamic content, shadow DOM, iframe, document-level evidence and identical
selectors. For each it checks that the accessibility data, sanitized evidence,
Explorer input, reproduction plan, inspection payload, text-fragment link,
manual-review record and screenshot marker use the same occurrence and
observation.

## Retention and historical links

- `summary.json` and weekly findings keep the representative occurrence and the
  capped examples.
- `finding_ref` is content-independent and remains addressable while the weekly
  report exists.
- `observation_id` identifies the run that produced the evidence; it does not
  promise that a screenshot or page record still exists.
- `evidence_reference` in the bug/API carries `page_detail_retention_weeks` and
  an explicit note.

## Remaining work

- Decide whether to version `occurrence_id` without mutable component
  attribution and how to migrate.
- Add a historical `VS-` → `finding_ref` alias ledger for links that predate the
  stable anchor.
- Add more real-browser/manual cases; the controlled suite is synthetic.
