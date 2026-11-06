# Finding evidence, inspection and reproduction — roadmap

Status: living document. Implementation lands in incremental PRs against `main`.
This file is the plan of record and the discoverable list of deferred work, so a
later developer or coding agent does not have to reconstruct the reasoning from
PR comments.

Scope of this programme: turn an accessibility finding in a static VITAL report
into inspectable, component-aware, reproducible evidence, and connect it to
manual validation. It does **not** add AI diagnosis, AI remediation, a database,
a build step, or a required browser extension. See "Explicit exclusions".

## 1. Architecture assessment (what already exists)

| Capability | Status | Module |
| --- | --- | --- |
| Component signatures (`class`, `id`, `attribute`, selector ancestry, DOM ancestry, script origin) | Existing, opt-in | `src/lib/shared-components.js`, `config/targets.yml` |
| DOM-ancestry attribution of axe examples | Existing | `src/engines/component-observation.js` (`annotateComponentExamples`) |
| Component observation + consent state | Existing, opt-in | `src/engines/component-observation.js`, `src/engines/consent-action.js` |
| Page families, component clusters, scope reporting | Existing | `src/lib/page-families.js`, `src/lib/component-clusters.js`, `src/lib/finding-reporting.js` |
| Finding identity (`pattern_id` / `instance_id`), fingerprints, ACT correlation | Existing, frozen contracts | `src/lib/bug-report.js`, `src/lib/fingerprint-core.js`, `src/lib/finding-correlation.js` |
| Bounded example evidence (3 per page per rule, 5 per rule) | Existing | `src/engines/axe.js`, `src/aggregate.js` |
| Public sanitization of evidence | Existing | `src/lib/finding-reporting.js` |
| **Semantic region / landmark / widget context** | **Added (PR 1)** | `src/lib/semantic-context.js` |
| **Structured element identity + render context** | **Added (PR 1)** | `src/lib/element-evidence.js` |
| Screenshots / bounding-box overlays | Not built | — |
| Deterministic Playwright reproduction | Not built | — (issue: PR 4) |
| Manual validation records | Not built | — (issue: PR 5) |
| ARRM task/role mapping | Deferred | — |

There is one component-classification system (`shared-components.js`). This
programme extends it; it does not add a second one.

## 2. Data flow (collect once, use many times)

```
scan (Playwright)
  → axe-core (runAxe)
  → attachElementEvidence  ← element identity + ancestry + render context
  → per-page JSON  axe.violations[rule].examples[]  (capped 3/page/rule)
  → aggregate  addInstances → summary.axe.rules[rule].instances (capped 5/rule)
  → buildBugReports  examples / element / semantic_context / evidence
  → sanitizeBugEvidence (API + Markdown) / report HTML / CSV / future exports
```

Nothing in the report path rescans a page. Reproduction (PR 4) is the one place a
second navigation is explicitly expected, and it is user-requested per finding.

## 3. PR plan

### PR 1 — Canonical element and semantic evidence (PR #299)

- `src/lib/semantic-context.js`: pure landmark/widget classification over a
  serialized ancestor chain.
- `src/lib/element-evidence.js`: in-page collector (CSP-safe stringified
  evaluation), bounded element record, `condenseInstance`, public sanitizer.
- `axe.js`: additive `target_path` for frame/shadow paths, `examples_truncated`.
- `alfa.js`: explicit `element_evidence: { status: 'unavailable', reason }`.
- `scan.js`: collect evidence once, after the audit; failure never fails a page.
- `aggregate.js` / `bug-report.js` / `finding-reporting.js`: carry the bounded
  evidence to reports, Markdown and the JSON API; `selector` added alongside the
  legacy `xpath` name.
- Tests: `semantic-context.test.js`, `element-evidence.test.js`, additive cases
  in `finding-reporting.test.js`.

Acceptance: existing scans/report formats/history unchanged; known fixture
elements get correct regions; unknown stays explicitly unknown; evidence
bounded and sanitized; the Walsall consent fixture still exercises both engines.

### PR 2 — Region and component grouping (implemented)

- `src/lib/region-groups.js`: pure grouping by nearest landmark region
  (`unclassified` explicit; findings without evidence counted separately) and
  by configured component / candidate widget, with type vs implementation split
  and `ownership_established: false`.
- `summarizeRecords` computes `summary.regions` / `summary.componentGroups`
  once; the Accessibility page renders a "Findings by page region" table;
  `regions.csv` is written; `scope_of_analysis.regions` / `component_groups`
  and per-finding `reporting.region` are posted to the v1 API.
- `shared-components.js` now carries `component_type`, `implementation`,
  `attribution` and `ownership_established`.

Acceptance: findings group by region and component; multiple instances do not
become multiple fixes; similar HTML never implies shared ownership; existing
`component_scope` output remains valid.

### PR 3 — Finding Explorer and visual evidence

A static, no-JS-first page (or accessible panel) reachable from `#VS-…` finding
anchors, reading prebuilt JSON. Region/component/rule/WCAG filters, element
inspection, evidence completeness, screenshot + overlay where captured.
Screenshots are historical evidence, labelled as such, and never a live iframe.

Acceptance: keyboard and screen-reader usable; core information present with JS
off; deep links preserved; no new framework.

### PR 4 — Deterministic Playwright reproduction

A generator that emits a plain Playwright test from structured evidence
(allow-listed actions only, no arbitrary JS), verifies locator cardinality and
the specific rule, and reports distinct outcomes (`reproduced`, `not_reproduced`,
`locator_not_found`, `ambiguous_locator`, `rule_changed`, `inconclusive`, …).
Playwright MCP is optional discovery aid only, never a runtime dependency.

Acceptance: fixture defect reproduces; stale/ambiguous locators are explicit
failures, not false success; scheduled scans never auto-run reproductions.

### PR 5 — Manual validation and handoff

Per-finding "Manual validation" guidance, downloadable review record, explicit
statuses, documentation, and the final deferral list. A checkbox is never
evidence; no wording implies conformance.

Acceptance: automated vs manual records stay separate; no "verified"/"compliant"
claims; all deferred items discoverable here.

## 4. Deferred work

Each item lists: motivation, proposed behaviour, dependencies, acceptance
criteria, explicit exclusions, references, priority.

### P1 — Complete semantic attribution

- **Motivation:** PR 1 only enriches axe examples; Alfa targets are serialized
  node descriptions and frame/shadow paths are skipped, so some findings have
  element identity `unavailable`.
- **Proposed behaviour:** associate Alfa outcomes with DOM nodes only when the
  existing observation-pairing evidence supports it; resolve frame/shadow paths
  with an explicit path array and per-boundary locator; record why association
  failed when it does.
- **Dependencies:** PR 1 schema; Alfa target serialization stability.
- **Acceptance:** a fixture Alfa-only finding can name a selector when evidence
  is sufficient; frame/shadow fixture resolves with an explicit path; ambiguous
  cases stay `unavailable`; regression fixtures for each.
- **Exclusions:** no selector invention, no nearest-lookalike matching, no
  merging axe and Alfa findings.
- **References:** https://github.com/Siteimprove/alfa,
  https://playwright.dev/docs/locators#locate-in-shadow-dom
- **Priority:** P1.

### P1 — Expand visual inspection

- **Motivation:** text/region evidence is necessary but users still ask "where
  is this on the page?".
- **Proposed behaviour:** one bounded screenshot per page that has a captured
  element (not per violation), element rect overlay from PR 1, element crop,
  and an explicit nonvisual representation for findings with no rectangle
  (ARIA relationships, names, hidden elements).
- **Dependencies:** PR 1 rect/context; PR 3 UI.
- **Acceptance:** overlay never obscures the element; screenshots labelled as
  historical scan evidence with timestamp/viewport; no screenshot for findings
  without a reliable rectangle; storage measured and documented.
- **Exclusions:** no live iframe embedding, no per-violation screenshots, no
  video/full-DOM capture.
- **References:** https://github.com/microsoft/accessibility-insights-web,
  https://wave.webaim.org/
- **Priority:** P1.

### P1 — Improve reproduction reliability

- **Motivation:** a generated test that cannot be replayed is worse than none.
- **Proposed behaviour:** declarative interaction steps (navigate, click, fill,
  select, check, press, focus, wait-for-state), rule-version recording, locator
  recovery proposals that require review, changed-page detection, structured
  outcome records.
- **Dependencies:** PR 4.
- **Acceptance:** every outcome status is distinguishable in tests; regenerating
  a test for a changed page says so; no fixed sleeps where a ready condition
  exists.
- **Exclusions:** no arbitrary JS execution from page/report data; no auto-merge
  of recovered locators.
- **References:** https://playwright.dev/docs/accessibility-testing
- **Priority:** P1.

### P2 — Playwright MCP-assisted investigation

- **Motivation:** some elements only appear after interaction that automation
  cannot infer.
- **Proposed behaviour:** optional MCP session to discover a candidate action
  sequence, exported for human review as structured steps, then converted to a
  deterministic test.
- **Dependencies:** PR 4 action schema.
- **Acceptance:** MCP is never required; discovered actions are reviewed before
  use; no AI diagnosis or remediation; exported script carries provenance.
- **Exclusions:** no MCP per finding in scheduled scans; no production-content
  mutation without safeguards.
- **References:** https://playwright.dev/docs/getting-started-mcp
- **Priority:** P2.

### P2 — Manual assessment workflow

- **Motivation:** automated checks find roughly a third of barriers.
- **Proposed behaviour:** guided checklists per rule/region, structured review
  records (reviewer, date, environment, AT, steps, outcome, evidence), coverage
  tracking, export; optional GitHub issue/PR submission later.
- **Dependencies:** PR 5.
- **Acceptance:** records are clearly separate from scan results; no completion
  claim implies conformance; exports are deterministic and public-safe.
- **Exclusions:** no central user database; no "verified/compliant" claims.
- **References:** https://github.com/microsoft/accessibility-insights-web
- **Priority:** P2.

### P2 — ARRM task and role mapping

- **Motivation:** organisations need to route findings to the right role.
- **Proposed behaviour:** versioned candidate ARRM task mappings per finding,
  candidate roles per task, provenance and review status, local overrides.
- **Dependencies:** stable finding identity (existing), reviewed source data.
- **Acceptance:** mappings are labelled candidate; multiple roles allowed;
  provenance recorded; no automatic assignment.
- **Exclusions:** ARRM is not a conformance standard; no definitive owner is
  inferred from an axe rule.
- **References:** https://www.w3.org/WAI/planning/arrm/tasks/,
  https://www.w3.org/WAI/planning/arrm/roles/
- **Priority:** P2.

### P2 — Browser extension for live highlighting

- **Motivation:** static evidence ages; a live check needs the current DOM.
- **Proposed behaviour:** open a finding URL, resolve the recorded selector,
  highlight matches, show rule/region/component context, handle same-origin
  frames and shadow roots.
- **Dependencies:** PR 3 deep links, PR 1 selector/context.
- **Acceptance:** minimal permissions; no page data leaves the browser, not even
  to VITAL; explicit "not found"/"ambiguous" states.
- **Exclusions:** not required for any report feature; no cross-origin frame
  automation.
- **Priority:** P2.

### P3 — Design-system integration

- **Motivation:** component ownership is strongest when a design system declares
  it.
- **Proposed behaviour:** consume component manifests (USWDS, Drupal, LocalGov
  Drupal and others) as additional signatures; keep core free of CMS-specific
  logic; link verified shared findings to upstream projects only when ownership
  is established.
- **Dependencies:** PR 2.
- **Acceptance:** manifests are data, validated like `component_signatures`;
  absence of a manifest changes nothing.
- **Exclusions:** no hardcoded Drupal/Drupal-core assumptions in core.
- **Priority:** P3.

### P3 — Issue tracker integration

- **Motivation:** teams need a reviewed path from finding to ticket.
- **Proposed behaviour:** generate a GitHub issue template with component
  metadata, page samples, reproduction steps and the original finding link.
- **Dependencies:** PR 4.
- **Acceptance:** generation is explicit; nothing is created automatically; one
  finding is not silently one ticket.
- **Exclusions:** no automatic assignment or issue creation.
- **Priority:** P3.

### P3 — Historical component trends

- **Motivation:** the programme exists to track improvement over weeks.
- **Proposed behaviour:** track component/region findings across weeks on stable
  cohorts; separate resolved defects from sampling changes; flag recurring
  regressions.
- **Dependencies:** PR 2, findings ledger.
- **Acceptance:** sampling changes are reported as coverage, not fixes; cohort
  comparisons documented.
- **Exclusions:** no causal claims from association alone.
- **Priority:** P3.

## 5. Known limitations (as of PR 1)

- Only axe examples get structured element evidence; Alfa is explicitly
  `unavailable`.
- Only the **first** stored example per rule is enriched (later examples keep
  their selector and snippet). Measured on the Walsall consent fixture: ~786
  bytes per enriched rule, ~3.9 KB added to a 5-rule page record. Revisit if
  page records grow past the retention budget.
- Explicit `role` attributes are recorded; the computed accessibility role is
  not, because that needs the browser accessibility tree.
- Accessible names come from name-bearing attributes only; text content is never
  collected for the failing element.
- An axe frame/shadow path is not resolved; the example is marked unavailable.
- No screenshots, no XPath, no reproduction scripts yet.
- `evidence` counts describe stored examples, not every instance.
- Region/component grouping is sample-based: pages and instances are summed
  across findings, not distinct counts; `ownership_established` is always false.
- A widget role (`widget:dialog`) is a candidate attribution only. Only a
  configured `component_signatures` id yields an `implementation`.

## 6. Explicit exclusions

No AI diagnosis or AI remediation. No automatic responsibility assignment. No
database or persistent server. No new frontend framework or build step. No
unbounded screenshots or DOM captures. No claim of WCAG conformance from
automated results. No claim of manual testing without recorded evidence. No
sharing of site data with third-party AI services.
