# VITAL static JSON API (v1)

VITAL publishes a stable, read-only JSON API alongside the HTML reports so
developers, dashboards, CI pipelines, and local tools can consume scan findings
without scraping HTML or coupling to the internal `data/` layout.

The API is **static files only** — no server, no database, no authentication.
It is generated during the normal `npm run aggregate` build and deployed with
the GitHub Pages artifact. Consuming it is a plain HTTP `GET`.

All paths below are relative to the API root: `https://<pages-host>/api/v1/`.

---

## Versioning

Every resource carries a top-level `schema_version` (currently `"1"`). Within a
version, fields may be **added**; consumers must ignore unknown fields. A
**breaking** change (removing or repurposing a field) ships under a new path
(`/api/v2/`), and `/api/v1/` is kept until consumers migrate. `schema_version`
is the API contract version — it is **not** the npm package version.

JSON Schemas for each resource are published under
[`/api/v1/schema/`](#schemas) and can be used to validate responses in CI.

---

## Resources

| Path | Description |
|---|---|
| `/api/v1/index.json` | All published domains — latest week, severity counts, links |
| `/api/v1/<domain-key>/snapshot.json` | Full domain history — summary, findings ledger, weekly series, tech associations |
| `/api/v1/<domain-key>/<week>/findings.json` | Per-week normalized accessibility findings with trend status |
| `/api/v1/schema/*.schema.json` | JSON Schemas for the resources above |

`<domain-key>` is the stable `key` from `config/targets.yml` (e.g. `www.cms.gov`).
`<week>` is an ISO year-week (e.g. `2026-W25`).

### `index.json`

```json
{
  "schema_version": "1",
  "domains": [
    {
      "domain": "www.cms.gov",
      "key": "www.cms.gov",
      "latest_week": "2026-W25",
      "pages_scanned": 421,
      "top_actions_count": 8,
      "critical_count": 2,
      "serious_count": 37,
      "snapshot_url": "/api/v1/www.cms.gov/snapshot.json",
      "findings_url": "/api/v1/www.cms.gov/2026-W25/findings.json"
    }
  ]
}
```

### `findings.json`

Each finding is a **normalized** public model — not a raw axe-core or Alfa
object. Severity uses the axe-core taxonomy verbatim (`Critical`, `Serious`,
`Moderate`, `Minor`). `trend_status` is one of `new`, `persistent`,
`improving`, `worsening`. `axe-core` and `alfa` are preserved as distinct
engines.

```json
{
  "schema_version": "1",
  "domain": "www.cms.gov",
  "week": "2026-W25",
  "generated_at": "2026-07-11T02:14:40.411Z",
  "pages_scanned": 421,
  "top_actions": { "...": "component-cluster next-actions queue, or null" },
  "findings": [
    {
      "finding_id": "VS-1a2b3c",
      "rule_id": "color-contrast",
      "rule_label": "Elements must meet minimum contrast",
      "engine": "axe-core",
      "severity": "Serious",
      "wcag_sc": "1.4.3",
      "wcag_level": "AA",
      "pages_affected": 18,
      "trend_status": "persistent",
      "first_seen": "2026-W22",
      "last_seen": "2026-W25",
      "weeks_seen": 4
    }
  ]
}
```

### `snapshot.json`

### Evidence Reporting (Additive v1 Fields)

Weekly findings include an optional `reporting` object and `instance_id`. Existing
`finding_id`, severity, page totals and history fields retain their meanings.
The engine observations are not merged or rewritten.

- `act_rules` lists every checked-in ACT mapping and its Approved, Proposed or
  Unknown publication status. An empty list means no checked-in mapping, not
  that a rule is unrelated. Document-level `reporting.act_mapping` identifies
  the mapping generation date and source implementation reports.
- `duplicate_status` distinguishes `confirmed_duplicate`, `possible_duplicate`,
  `related` and `not_confirmed`. `correlations` retains observation indices,
  same-element/component evidence and completeness flags. A sampled match does
  not establish a duplicate of the entire aggregated finding.
- `remediation_group_id` groups only complete confirmed duplicates. Summary
  `engine_finding_count` retains all engine findings; `remediation_group_count`
  counts groups once. Neither is a number of fixes. `remediation_task_count`
  is null, and `ownership` is `not_established`.
- `engine_severity` is the supplied engine impact, or null when absent.
  The existing `severity` remains the reporting label. `remediation_priority`
  contains a separate ranking score and conformance/display tiers, not impact.
- `distinct_urls` gives an exact distinct count over available stored evidence,
  a reported page count, completeness, and a sample of at most 25 URLs.
  Query variants stay distinct; similar DOM structure does not change identity.
  URL redaction may make distinct stored URLs look identical in the public sample.
- `representative_evidence` contains at most three sanitized examples. HTML is
  inert text for consumers to escape, never to inject as markup. Text and form
  values, event handlers, arbitrary data attributes and executable elements are
  omitted. Supported structural/ARIA attributes remain for diagnosis. Unsafe
  selectors are omitted. Raw scanner observations remain unchanged internally.

The snapshot also includes document-level reporting counts. Legacy top-action
`findings` and `estimated_fix_impact` fields remain for compatibility; they are
observation-based heuristics, not verified task counts or causal ownership.
Queue items now explicitly say `counting_basis: engine_observations_not_tasks`
and `remediation_task_count: null`. No API version bump or data migration occurs.

### Element and semantic evidence (additive v1 fields)

Captured once at scan time, while the page is already open, and carried by the
same capped examples every consumer reads. Additive: existing fields keep their
meaning and `schema_version` stays `"1"`.

- `findings[].selector` is the sanitized CSS selector of the primary stored
  example (or null). Internally the older `xpath` name still holds the same
  value for compatibility; for Alfa it is a node description, not a selector.
- `findings[].element` is the element identity for the primary stored example,
  or null. When the scanner could not locate the node, it is
  `{ "available": false, "reason": "not-found" | "invalid-selector" |
  "alfa-target-is-a-serialized-node-description-not-a-selector" | … }`.
  When present: `available`, `selector`, `selector_matches` (how many nodes the
  selector matched when captured), `tag`, `role` (the **explicit** role
  attribute only — the computed accessibility role is not recorded), `name` and
  `name_source` (only name-bearing attributes: `aria-label`, `alt`, `title`,
  `placeholder`, or `aria-labelledby` with `labelledby_ids`), `shadow`,
  `iframe`, `visible`, `rect`. Element ids and the raw ancestry are withheld
  from the public API.
- `findings[].semantic_context` is derived from the serialized ancestor chain:
  `nearest_region`, `region_ancestry`, `widget`, `widget_ancestry`, `path`,
  `in_dialog`, `unnamed_landmarks`, `unclassified`. Landmark and widget roles are
  classified separately. A `<header>`/`<footer>` scoped to
  `article/aside/main/nav/section` is not `banner`/`contentinfo`; an
  unnamed `<section>`/`<form>` (or `role="region"`/`role="form"`) is recorded as
  unnamed, never as a landmark; when no landmark exists the element is
  `unclassified` rather than assigned an invented region.
- `findings[].evidence` states completeness: `instances_total`,
  `examples_captured`, `example_limit` (5), `examples_truncated`,
  `element_identity` (`captured`/`unavailable`/`not-captured`) and
  `semantic_context`. Stored examples are a capped sample, not every instance.
- `findings[].reporting.representative_evidence[]` also carries `element` and
  `semantic_context` for the **first** sanitized example (at most three examples
  are stored; only the first is enriched, to bound the weekly summary that is
  kept forever).
- The render context is recorded once per week on the summary, not repeated per
  finding: viewport, device scale factor, colour scheme, forced colours, reduced
  motion, document language, user agent, and the final URL reduced to origin +
  path (query strings are dropped because this block is published). No
  screenshot is captured yet, so `screenshot_captured` is `false`. The summary
  also carries `axe.element_evidence` (null, or
  `{ "status": "unavailable", "pages_failed": n }` when collection failed on
  some pages) and `alfa.element_evidence` (always unavailable).

Not available by design: computed accessibility roles, element text, XPath,
screenshots, and element evidence for Alfa findings (Alfa reports serialized
node descriptions, so no selector is invented).

### Shared-component scope and page families (additive v1 fields)

Both are opt-in per target (`component_signatures`, `page_families` in
`config/targets.yml`). Without them none of these fields appear, except that
`reporting.component_scope` is `null`.

- `findings[].reporting.component_scope`: how the stored failing-element
  examples relate to a configured component. `classification` is
  `shared_component`, `mixed`, `candidate_shared_component`, `not_attributed`
  or `undetermined`. `verified` is true only when at least `min_signals`
  distinct signal types agree (`class`, `id`, `attribute`, `ancestry` of the
  selector, and the component's `script_origin` seen on the site), including one
  about the element itself. One CSS prefix alone is a candidate, never
  verified. Counts say `basis: "stored_examples"`: the scanner keeps a few
  examples per rule and page, so this is sample-based, not every instance.
- `scope_of_analysis.shared_components`: per-component confidence, signals
  observed and finding counts. `scope_of_analysis.page_families`: URL counts,
  declared implementation counts (`implementation_basis: "configured_route"`),
  state-parameter counts and distinct variant-value counts. No URLs or selectors
  appear in either block. Only the values of the parameters a target lists in
  `state_params` are shown (at most 20 per parameter); `variant_params` are
  counted, never listed.
- `scope_of_analysis.shared_components.components[].observation` (null when never
  observed): a best-effort count, taken read-only before the audits, of pages
  where the component was present, visible and shown as a dialog, with up to 8
  visible button labels. Page records carry `componentObservation`, and run
  logs carry `browser` (user agent and viewport). The scanner never clicks or
  removes anything. What a component shows can vary by visitor and location, so
  these counts describe only the scanner's view and are not comparable between
  sites.
- `findings[].reporting.page_family` (null when none applies): the declared page
  family the finding's URLs fall in, with `urls_in_family`, `urls_observed`,
  `all_urls_in_family` and `implementation_count` (basis `configured_route`).
- `signals` in `component_scope` may include `dom_ancestry`: the scanner found a
  configured signature on the failing element or a real DOM ancestor, recorded
  at scan time as `component` on axe examples in page records. Only axe examples
  with a plain CSS selector can be resolved this way; Alfa examples cannot.
- Weekly summaries carry `componentClusters.top_action_ids_outside_components`,
  the ids of the highest-ranked clusters that are not verified shared-component
  findings.
- `scope_of_analysis.shared_components.consent_handling` (only when a target sets
  `consent_handling`): `{ choice, pages_by_state }`. When enabled, the scanner
  clicks the site's own configured consent button once per run (default
  `reject`; only the CSS selectors the site owner lists are ever clicked, nothing
  is guessed, no cookie is written directly and no element is removed). Page
  records carry `consent.state`: `dialog_open_then_clicked` (the page was audited
  with the dialog open, then the button was clicked), `dialog_open` (open, not
  clicked), `after_decision` (the dialog had been dismissed earlier in the run)
  or `no_dialog`. Run logs carry `consent: { choice, attempts, clicked_on }`.
  Dialog findings are therefore recorded on the first page of each run, so
  enabling it lowers dialog counts and starts a new baseline for trends.
- Grouping never merges findings, changes `pattern_id`/`instance_id`, or alters
  scores. Page-family counts do not change page identity: every query variant is
  still its own URL.

### Region and component grouping (additive v1 fields)

Both groupings are built from the bounded stored examples (PR 1 evidence), so
they are sample-based and never a fix count. They appear only when a week has
findings.

- `scope_of_analysis.regions`: `{ basis: "stored_examples", findings_total,
  findings_with_region, findings_unclassified, findings_without_evidence,
  regions: [...] }`. Each region has `key`, `role`, `name`, `label`,
  `unclassified`, `findings`, `pages_affected_sum`, `instances_total`,
  `stored_instances` (examples that carried this region), `engines`,
  `components` (configured ids with finding counts) and
  `representative` (at most three redacted URLs + sanitized selectors).
  Landmark roles and names distinguish regions (`main`, `navigation "Primary"`);
  an element with evidence but no landmark is its own `unclassified` entry; a
  finding with no captured evidence is counted in `findings_without_evidence`,
  never folded into unclassified. `pages_affected_sum` and `instances_total`
  are sums across findings, not distinct counts.
- `scope_of_analysis.component_groups`: `{ basis, findings_total, attributed,
  unattributed, ownership_basis, groups: [...] }`. A group has `key`, `type`,
  `label`, `attribution` (`configured` | `candidate`), `implementation`
  (a configured signature id, or null), `ownership_established` (always false),
  `instance_identity` (`page_url_and_selector_of_stored_examples`), `findings`,
  `instances_total`, `stored_instances`, `pages_affected_sum`, `regions` and
  `representative`. A configured component wins over a widget role; a widget
  role (e.g. `widget:dialog`) is only a candidate attribution and never implies
  a shared implementation. Verification of a configured component remains in
  `scope_of_analysis.shared_components`; grouping never upgrades a candidate.
- `findings[].reporting.region` is the finding's `nearest_region` (or null),
  with `region_unclassified` (true when evidence exists but no landmark was
  found, null when evidence is unavailable) and `region_evidence`
  (`captured` | `unavailable`).
- `findings[].reporting.component_scope` now also carries `component_type`,
  `implementation`, `attribution` and `ownership_established` alongside the
  existing classification. Identity is split on purpose: a type is not an
  implementation, and grouping is not ownership.
- Per-week CSV: `<domain>_<DDMONYYYY>_regions.csv` (one row per region:
  findings, summed pages/instances, components, representative URLs).

### Reproduction state (additive v1 fields)

`findings[].reproduction` says whether the stored evidence can be replayed, not
whether a run happened. The API never runs anything.

- `status: "not_attempted"` — the evidence is sufficient. The object carries
  `locator` (`{ strategy: "css", value }`), `rule` (`{ engine, id, impact }`),
  `context` (recorded viewport/colour scheme/forced colours/reduced motion/
  locale), `interaction_required`, `steps` (empty until interaction sequences
  are recorded) and `verified_at: null`.
- `status: "unavailable"` — with `reason`: `element-evidence-unavailable`,
  `element-not-found-at-scan`, `selector-not-replayable`,
  `url-redacted-for-publication`, or
  `only-axe-core-findings-can-be-replayed`. No selector is guessed.
- The runnable test is generated on demand by the Finding Explorer or
  `scripts/reproduce.js` from the same plan; its outcomes use the statuses in
  `src/lib/reproduction.js` (`reproduced`, `not_reproduced`,
  `locator_not_found`, `ambiguous_locator`, `interaction_state_unavailable`,
  `page_unavailable`, `rule_or_engine_changed`, `inconclusive`).

### Manual validation (additive v1 fields)

`findings[].manual_validation` carries finding-specific guidance, never a
completion claim:

- `status` is always `"not_reviewed"`.
- `prompts` (at most three) are chosen from the WCAG success criterion or the
  rule, with a generic fallback.
- `environment_note` says which conditions may apply (not every item applies to
  every finding).
- `limitations` states that automated tools find roughly a third of barriers and
  that recording a review does not establish conformance.

The structured review record is generated and downloaded client-side by the
Finding Explorer (`<VS-id>.manual-review.json`); it is not published by the API
and never sets a reviewer, date, outcome or status.

### Snapshot Contents

Full per-domain history: a `summary` block (severity counts + pages scanned),
the `findings` ledger keyed by `finding_id`, `tech_findings`, `top_actions`,
and a `weekly.series` of per-week summaries with `weekly.diffs`. Use it to build
trends or to diff week-over-week (e.g. fail CI when `summary.critical_count`
rises).

The series records **what failed each week, as numbers**: every failing rule
with its count, pages and impact; failing standards, resilience and security
checks (with `checksPassing` counting the rest); error pages by status. It
leaves out what passed and the evidence repeated every week: the pages each
rule or cluster was found on, the full cluster and resource lists, and broken
links. That evidence is in `<week>/findings.json` and the week's report and
CSVs.

---

## Schemas

Published under `/api/v1/schema/`:

- `index.schema.json`
- `snapshot.schema.json`
- `findings.schema.json`

They are JSON Schema **draft-07**. Generated resources are validated against
them in the test suite (`tests/unit/api-schema.test.js`), so the published files
always conform.

---

## Retention

The API reflects the project's retention model: `snapshot.json` keeps the
weekly **failure trend** for a domain, but detailed per-page records are pruned
over time. Historical weeks therefore expose summary metrics and findings, not
resurrected page-level detail. Page-level evidence resources are not part of v1.

---

## Privacy and redaction

The API is public, so URLs it emits are sanitized (issue #136):

- **Scan-time exclusions** (`url_exclude`): excluded pages are never fetched, so
  they never enter the API.
- **Report exclusions** (`url_exclude_patterns`): the API applies the same
  baseline the HTML report does, so a page hidden from the report is also absent
  from the API (finding counts are recomputed on the remaining pages).
- **Fragment stripping**: any `#fragment` is removed from emitted URLs.
- **Query redaction**: the value of any sensitive query parameter (token, key,
  secret, session, auth, password, email, apikey, signature, code, jwt, bearer,
  nonce, state, otp, and similar families, plus a per-target `api_redact_params`
  denylist) is replaced with `[REDACTED]`. Harmless params (e.g. `page`, `sort`)
  are preserved.

Engine-sourced rule descriptions and technology names remain in English by
design; the API does not localize.

---

## Partial and missing data

- **Missing resources** return an HTTP `404` from the static host — there is no
  in-band error body.
- Zero, empty array, and absent are **not** interchangeable: a `0` count means
  "measured zero", an omitted optional field means "not available".
- Incomplete scans are represented explicitly in the summary data rather than
  presented as clean results; a scanner failure is never reported as a confirmed
  site failure.

---

## Examples

Fetch the domain list:

```bash
curl https://<pages-host>/api/v1/index.json
```

Fetch one domain's latest findings:

```bash
curl https://<pages-host>/api/v1/www.cms.gov/2026-W25/findings.json
```

Load a domain summary from JavaScript:

```js
async function loadDomainSummary(domainKey) {
  const response = await fetch(
    `/api/v1/${encodeURIComponent(domainKey)}/snapshot.json`
  );
  if (!response.ok) {
    throw new Error(`Unable to load domain snapshot: ${response.status}`);
  }
  return response.json();
}
```

---

## Known limitations

- Read-only. There are no write, query, or filter endpoints — consumers fetch a
  whole resource and filter client-side.
- No `rules.json` catalogue and no per-page evidence resources in v1.
- `generated_at` timestamps change every build; treat them as provenance, not
  as part of a finding's identity.
- The API is UI-chrome-free structured data; it is not a substitute for the
  human-readable HTML reports.

## Consuming this API from a coding agent

[`MCP.md`](MCP.md) documents a local, read-only [Model Context
Protocol](https://modelcontextprotocol.io/) server (`mcp/`) that wraps this
API for MCP-compatible coding clients (Claude Code, GitHub Copilot, etc.) —
tools to list and inspect findings without a client having to know this
document's endpoint shapes directly. It runs locally, on demand, and only
ever talks to the single Vital Core instance configured in `.vital.yml`.
