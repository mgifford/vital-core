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
| Deterministic Playwright reproduction | Added (PR 4) | `src/lib/reproduction.js`, `scripts/reproduce.js` |
| Manual validation guidance + record export | Added (PR 5) | `src/lib/manual-validation.js`, Explorer download |
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

### PR 3 — Finding Explorer (implemented, no screenshots yet)

- `explore.html` per domain/week with a complete static index (no JavaScript)
  and a progressive-enhancement layer that fetches the published `bugs.json`.
- Filters: region, component (configured or candidate widget), engine, severity,
  free-text. Detail panel: rule, WCAG, URL, selector, element facts, region path,
  widget, component attribution, evidence completeness, stored examples and
  steps, with a link back to the canonical report anchor.
- Filter logic is `src/lib/finding-filter.js`, unit-tested in Node and reused
  verbatim in the browser via stringification.
- Entry points: subnav item and an "Open in Finding Explorer" link on every
  finding in the Accessibility report.

Still deferred from this PR: screenshots and bounding-box overlays (P1 below),
which stay historical-evidence-only and never a live iframe. Acceptance met for
keyboard/screen-reader usable (native controls, live status, focus move to the
detail heading), core information present with JS off, deep links (`#VS-…`)
preserved, no new framework.

#### Manual/automated testing performed for the Explorer (PR 3)

- Automated: axe-core on `explore.html` reports 0 violations in the e2e (the run
  also fixed a pre-existing `label-content-name-mismatch` on the theme toggle by
  composing its accessible name from the visible "Theme" label).
- Keyboard: a result is focusable and Enter opens the detail panel; focus moves
  to the detail heading; Enter on "Close details" returns to the list. The
  existing no-JavaScript disclosure keyboard test still passes.
- No JavaScript: the static index renders every finding (14 in the fixture) and
  the filter form stays hidden.
- Forced colours: native controls and the detail panel remain visible.
- Zoom/reflow: at 390 CSS px the document has no horizontal overflow; wide
  tables are focusable scroll regions (`role="region"`, `tabindex="0"`).
- **Not performed:** a human screen-reader pass (NVDA/JAWS/VoiceOver), Dragon or
  other assistive-technology testing. None is claimed.

### PR 4 — Deterministic Playwright reproduction (implemented)

- `src/lib/reproduction.js`: `reproductionPlan()` (evidence → replayable plan,
  or `unavailable` with a reason), `executeReproduction()` (one element, one
  axe rule, element-identity check), `playwrightTestFor()` (standalone `.mjs`).
- `src/lib/reproduction-runner.js` runs the same function as the generated
  script, so the CLI and the export cannot diverge; `scripts/reproduce.js`
  (`npm run reproduce`) runs or exports a finding from a published `bugs.json`.
- Explorer detail panel downloads `<VS-id>.spec.mjs` on demand; the API exposes
  `findings[].reproduction` (`not_attempted` / `unavailable`, never a claim that
  a run happened).
- Distinct statuses and exit codes 0–6; no arbitrary page JavaScript; no AI.
- Document-level rules (e.g. `region`, `list`) run document-level axe and then
  check the recorded element by identity, so a rule failing elsewhere is
  `not_reproduced`.

Deferred: declarative interaction sequences (steps are empty; a dialog finding
reports `interaction_state_unavailable` rather than guessing clicks), locator
recovery, and MCP-assisted discovery (P2 below).

### PR 5 — Manual validation and handoff (implemented)

- `src/lib/manual-validation.js`: criterion/rule-specific prompts (max three),
  suggested conditions, and limitations that state automation covers roughly a
  third of barriers and a review is not a conformance claim.
- Rendered on the Accessibility page's finding detail and in `bugs.md`; the
  Explorer adds a "Manual validation" block and downloads a blank
  `<VS-id>.manual-review.json` (`status: not_reviewed`, reviewer/date/
  environment/AT/steps/outcome/notes empty, `not_a_conformance_claim: true`).
- The API exposes `findings[].manual_validation` (status always
  `not_reviewed`); it never publishes or invents a review.
- No storage: the record is generated on demand and shared through the
  reviewer's own process.

Not implemented (deliberately): a guided manual assessment platform, hosted
review storage, GitHub submission, and ARRM task/role mapping. The guided
assessment and ARRM items remain in "Deferred work" below.

## Evidence reliability and reporting integrity (2026-11)

PR 1 delivered the identity audit, additive `finding_ref`/`observation_id`,
deterministic representative selection and cross-surface tests; see
[EVIDENCE-IDENTITY-AUDIT.md](EVIDENCE-IDENTITY-AUDIT.md). PR 2 added real
Chromium/WebKit activation tests, access-block detection and inspection
guidance. PR 3 adds finding-level evidence coverage and component inspection
counts. Remaining PRs cover reporting integrity (associations, scores, ACR,
Lighthouse) and manual-validation/docs.

## 3b. Milestone: evidence integrity and visual inspection (2026-11)

Focused follow-up to the five-PR milestone: make evidence trustworthy before
adding screenshots and richer interaction.

### PR A — Evidence integrity (implemented)

- `src/lib/occurrence.js`: one coherent occurrence per stored example
  (`VO-…` identity from pattern + URL + selector + component). Reports select a
  representative occurrence **as a whole** (complete → partial → unavailable);
  `instance_id`/`pattern_id` keep their frozen formulas.
- Every stored example is enriched, not just the first; each carries its own
  URL, selector, element, semantic context, browser context, `scanned_at`,
  engine version and consent state.
- Ancestry is walked in full (crossing shadow hosts) but only meaningful
  boundaries are serialized, so deep layout wrappers no longer hide `main`.
  `ancestry_complete`/`ancestry_depth` are recorded.
- Reproduction verifies the recorded tag/role/name-attribute identity and axe
  version before claiming a result; new status `element_identity_changed`
  (exit 7). Frame/shadow paths are `unavailable` rather than resolved in the
  wrong document.
- Measured: ~775 B per enriched example (Walsall fixture ~830 B; 4-example
  fixture 3.1 KB). Summary keeps up to 5 coherent instances per rule.

### PR B — Region, widget and component grouping (implemented)

- `summary.widgetGroups` is a new structural dimension (dialog, tablist, …);
  `summary.componentGroups` now contains **only configured shared components**,
  with `verified_findings`, `classification_counts` and `confidence` from the
  shared-component model.
- Two unrelated dialogs share `widget:dialog` and are never one component; a
  widget role never produces an implementation.
- Explorer: separate region / widget / component filters, a widget column in the
  static index, a "By widget type" table, and a component table limited to
  configured components (with verified counts).
- API: `scope_of_analysis.widget_groups`; component groups carry verification
  provenance. Additive v1.
- Tests: unrelated dialogs stay separate; configured component verification
  counts; filter/API/Explorer assertions.

### PR C — Screenshots and visual inspection (implemented)

- Opt-in `screenshots` config (`enabled`, `max_per_run`, `max_height`,
  `max_bytes`, `quality`, `mask_selectors`), validated per target; off by
  default.
- One JPEG per page with findings (never per violation), captured while the page
  is open; full page, or top viewport when taller/wider than the cap or when the
  JPEG exceeds `max_bytes`. Element evidence records `rect_page` and the render
  context records scroll. Measured on fixtures: ~12–22 KB for a short page,
  ~470 KB for a 2,462 px text page at quality 70; the byte budget forces the
  viewport fallback for long pages.
- Images live in `data/<domain>/<week>/screenshots/`; aggregate copies only the
  files referenced by the week's findings into the report directory; pruning
  removes them with page detail.
- Explorer: historical-image panel with a high-contrast marker from
  `rect_page`, "hide annotations", explicit historical label, viewport/outside
  messages, and structured-evidence fallback when there is no reliable
  rectangle or image.
- API: `findings[].screenshot` + `element.rect_page` + context scroll.
- Privacy: opt-in, mask selectors, bounded count/size; images can still contain
  page content, so enabling is a reviewed decision.
- Limitation: a screenshot's `captured_at` is part of the page record, so pages
  with screenshots do not deduplicate to the previous week's unchanged stub.
  Crops, multiple pages per finding and redaction beyond configured masks remain
  deferred.

### PR D — Reproduction/manual refinements (implemented)

- Generated test header now gives copy-paste setup in any directory
  (`npm init -y`, `npm install playwright axe-core`, Chromium install) and
  supports `REPRO_URL`, `REPRO_SELECTOR`, `REPRO_HEADED` and
  `REPRO_TIMEOUT_MS`; the CLI mirrors these as `--url`, `--selector`,
  `--headed` and `--timeout`. Overrides never change recorded identity, and
  invalid URLs/selectors/timeouts fail before a browser opens.
- `timeout_ms` is part of the plan; the runner/generator apply it.
- Manual guidance adds page/language/colour/before-input/error-prevention
  prompts and rule mappings; the review record carries the occurrence id,
  recorded element, stored-example count and screenshot reference, plus
  historical and personal-data notes.
- Docs/API/FEATURES/AGENTS updated; full unit and e2e integration re-run.

**Milestone implementation complete** (PRs #305–#308 open, stacked). The
remaining work is review/merge and fleet adoption, not new scope.

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

### P2 — Live highlight (bookmarklet hardening; packaged extension deferred)

- **Motivation:** static evidence ages; a live check needs the current DOM.
- **Implemented:** `src/lib/live-inspect.js` plus “Highlight on site” links on
  the Accessibility page and Explorer. A one-time bookmarklet reads a compact,
  versioned, origin-scoped selector/rule/WCAG/fix payload from the fragment (or
  a pasted code), reports located/possible/changed/not-found, refuses to
  highlight changed or unsupported contexts, and sends nothing. The full URL is
  not transported; hash-routed pages have a URL-free clipboard fallback.
- **Remaining:** packaged browser extension for reliable execution where CSP
  blocks bookmarklets and for same-origin frames/open shadow roots; automated
  cross-browser and manual assistive-technology testing. PR 3 added shadow-root
  isolation, MutationObserver/ResizeObserver dynamic detection,
  forced-colors/320px checks, collapse/move and cleanup; PR 4 integrated the
  occurrence id, Explorer copy-code action, open install block and e2e checks.
- **Dependencies:** PR 3 deep links, PR 1 selector/context.
- **Acceptance:** minimal permissions; no page data leaves the browser, not even
  to VITAL; explicit "not found"/"ambiguous" states.
- **Exclusions:** not required for any report feature; no cross-origin frame
  automation.
- **Priority:** P2.

### P2 — Local Playwright inspector (implemented)

- `scripts/inspect.js` / `npm run inspect` opens a finding (by bugs file or URL
  + id) or an ad-hoc CSS/XPath target in headed Playwright and injects the same
  highlighter. `--dry-run` is browser-free. No extension or bookmark.
- Remaining: optional MCP-oriented output and a report-side “copy command”
  affordance; no AI-generated steps.

### P2 — Deterministic interaction replay

- **Motivation:** dialog, menu and tab findings currently report
  `interaction_state_unavailable`.
- **Proposed behaviour:** record a declarative, bounded action sequence
  (click/fill/press/wait-for-state) from an allow-list and replay it before
  locating the element.
- **Acceptance:** recorded steps are deterministic, reviewed and bounded; no
  arbitrary page JavaScript; unsupported sequences stay unavailable.
- **Priority:** P2.

### P2 — Computed accessible names

- **Motivation:** evidence records name-bearing attributes, not the computed
  accessible name; reports say so.
- **Proposed behaviour:** compute names only where a reliable browser/API
  result is available, store the source, and never label an attribute as the
  computed name otherwise.
- **Acceptance:** labels distinguish name attribute, hint and computed name;
  tests cover `aria-labelledby`, native labels, contents and hidden references.
- **Priority:** P2.

### P3 — Downstream fleet adoption

- **Motivation:** fleets such as `vital-core-lgd` must adopt the evidence and
  Explorer changes deliberately.
- **Proposed behaviour:** document the upstream merge, data regeneration and
  verification steps (including the Walsall example) without changing fleet
  repositories from vital-core.
- **Acceptance:** a documented, repeatable checklist; no cross-repository
  changes from this milestone.
- **Priority:** P3.

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

### P3 — Cache the Explorer script as a site asset

- **Motivation:** the Explorer inlines ~31 KB of script per week/locale page
  (filters, reproduction and manual-record generators). Weekly archives
  accumulate it.
- **Proposed behaviour:** emit one `explorer.js` under `docs/`, pass per-page
  data (bugs JSON name, report href, labels) through data attributes, and
  reference the shared file so browsers cache it.
- **Dependencies:** PR 3/4/5 script modules.
- **Acceptance:** identical behaviour; one cached file; Explorer page weight
  drops by roughly the script size; no inline data beyond small attributes.
- **Exclusions:** no build step and no bundler; the asset is written by
  `writeAsset()` like `style.css`.
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
- No screenshots and no XPath yet. Reproduction is available for axe findings
  with element evidence; Alfa findings are explicitly unavailable. The Explorer
  states when a download is unavailable rather than leaving a blank area.
- No interaction steps are recorded yet, so a finding that needs a dialog or
  menu opened first is reported as `interaction_state_unavailable`.
- Reproduction outcomes are not yet stored back into the reports (`verified_at`
  is null); running a test is a local/CI action.
- Every stored example is enriched (up to 3/page/rule), so page records grow
  roughly 3× versus first-only evidence (~775 B per example); summary records
  keep up to five coherent occurrences per rule.
- Reproduction identity checks cover tag, explicit role and direct
  name-attribute values; computed role/name changes and cross-frame/shadow
  replay remain unavailable.
- Manual review records are generated on demand and are not stored by VITAL;
  no review status is persisted, and a recorded review is never converted into
  a conformance claim.
- A guided manual assessment workflow, hosted/GitHub review submission and
  ARRM task/role mapping remain deferred (P2 below).
- The Explorer's detail panel is a view over the same sanitized findings; the
  canonical full finding remains on the Accessibility page.
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
