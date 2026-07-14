# Spec: Finding Attribution — Schema and Cheap Signals

**Mission**: `finding-attribution-01KXG46S`
**Branch**: `main` (implementation WPs branch off `main` per PR discipline)
**Status**: Specified (awaiting plan)
**Source issue**: none yet — from the "replace Siteimprove with an open
source version" direction; first of a five-mission attribution roadmap

---

## Purpose

The single biggest question a site team asks about any accessibility finding
is *"is this ours to fix?"* — did our own theme/template work cause it, did a
third-party script inject it, or does it ship with the platform (Drupal core,
WordPress core, a contrib module/plugin) or the server stack? Commercial
platforms don't answer this; answering it automatically is the differentiator
that makes vital-core a *replacement* for the Siteimprove platform rather
than a clone of its scanner.

This mission establishes the **attribution taxonomy and schema** and
implements the **cheap, high-coverage signals** that need no new heavy
machinery. Later missions add CSS rule attribution (CDP matched styles), DOM
provenance instrumentation, a comparative blocking-rescan mode, and
fleet-wide platform fingerprints — all of which write into the schema this
mission defines, so the schema must be designed for evidence sources it does
not yet populate.

## Problem Statement

Today the only source attribution is `likely_source` in
`src/lib/bug-report.js`: `template` / `content` / `unknown`, inferred purely
from page spread. It cannot distinguish "our custom theme" from "Drupal
core" from "a chat widget injected this", even though the scan already
collects the raw material to do far better:

- `src/engines/tech.js` (Wappalyzer) knows the CMS, framework, and server
  tech per page, with versions and confidence.
- `src/engines/third-party.js` knows every third-party origin and which of
  them served scripts on each page.
- Every finding instance carries an xpath/selector and HTML snippet.

What is missing is the join: per finding, *where did this element come
from?* The cheapest decisive signal — whether the failing element exists in
the server's original HTML response or only appears in the JS-hydrated DOM —
is currently not captured at all, because the scan never keeps the pre-JS
response body.

## Scope of this mission

1. **Attribution taxonomy and schema** — a per-finding `attribution` object,
   designed to accept evidence from this mission's signals *and* the four
   future missions (each evidence entry names its source and the layer it
   supports).
2. **Server-vs-injected classification** — capture the raw pre-JavaScript
   HTML response during the scan, classify each finding instance's element
   as server-rendered or JS-injected *at scan time*, and store only the
   classification (never the raw HTML) in the committed page record.
3. **Asset-path and namespace classification** — a pure library that maps
   URL paths and class-name namespaces to layers for Drupal, WordPress, and
   the design systems already known to `component-clusters.js` (USWDS,
   CMS Design System).
4. **Roll-up and report surface** — aggregate derives the finding-level
   `attribution` from instance-level evidence; the Accessibility page shows
   an attribution chip with evidence in the drill-down; the next-actions
   queue groups by who can act; the static JSON API carries the new field
   additively.

## Attribution taxonomy

One `layer` value per finding (the finding's *primary* attribution), with
per-instance evidence retained:

| Layer | Meaning | Who acts |
|---|---|---|
| `content` | Authored page content (WYSIWYG/body-field markup) | Content editors |
| `site-custom` | The site's own theme, templates, or first-party JS | The site's dev team |
| `platform` | CMS core or contrib module/plugin markup, or server-tech behavior | Report upstream |
| `third-party` | Injected or hosted by a different registrable domain | Vendor contact / drop it |
| `undetermined` | Evidence insufficient or conflicting | Triage manually |

Rules of honesty (project ethos, same register as `tech-findings.js`):

- Report language is **"evidence points to"** / "associated with", never
  "caused by". (The future blocking-rescan mission may earn causal language;
  nothing in this mission does.)
- `undetermined` is a first-class, respectable answer. Never guess to avoid
  it. Every non-`undetermined` layer must cite at least one concrete
  evidence entry a human can check.

## Functional Requirements

| ID | Requirement | Status |
|---|---|---|
| FR-01 | The scan captures the raw pre-JavaScript HTML response body for each audited page (from the navigation response, bounded — cap at the same 500 KB order used by `tech.js` — and held in memory only for the duration of that page's processing) | |
| FR-02 | Each finding instance (axe, Alfa, deprecated-html) gains a `render_origin: 'server' \| 'js-injected' \| 'unknown'` field, computed at scan time by testing whether the instance's element can be located in the raw HTML. Matching must be conservative: a confident structural match (not raw string equality — dynamic ids/classes and attribute reordering must not defeat it) → `server`; a confident absence of any plausible match → `js-injected`; anything ambiguous → `unknown` | |
| FR-03 | The raw HTML body is **never** written to `data/` or `state/` — only the derived per-instance classification is persisted. (data/ is committed to git; raw bodies would bloat history and, for VA-class targets, could embed tokens — see Security rules) | |
| FR-04 | A new pure library (`src/lib/attribution.js` or similar) classifies (a) asset URL paths and (b) element class-name namespaces into taxonomy layers, with rule tables for at minimum: Drupal (`/core/`, `/modules/contrib/`, `/modules/custom/`, `/themes/contrib/`, `/themes/custom/`, `views-`, `field--`, `block-` class namespaces), WordPress (`/wp-includes/`, `/wp-content/themes/<name>/`, `/wp-content/plugins/<name>/`, `wp-block-` namespaces), and the design-system prefixes already tabled in `component-clusters.js` (`usa-`, `ds-c-`) | |
| FR-05 | Namespace/path signals only support a `platform` classification when the corresponding technology is actually detected on the site by the tech engine (e.g. `views-` classes on a page where Wappalyzer did not detect Drupal must not yield `platform`); absent tech agreement the signal degrades to lower-confidence `undetermined` evidence | |
| FR-06 | Aggregate derives a finding-level `attribution` object — `{ layer, confidence: 'high'\|'medium'\|'low', evidence: [{ signal, detail, supports }] }` — from the per-instance evidence, via pure functions in `src/lib/` (unit-testable with small synthetic inputs, same pattern as `progress.js`) | |
| FR-07 | A finding whose instances are `js-injected` and whose element or creating context matches a third-party origin already inventoried by the third-party engine for that page is attributed `third-party`, with the origin (and Wappalyzer product name where one matches) named in the evidence | |
| FR-08 | Findings on `<iframe>` elements embedding a third-party registrable domain are attributed `third-party` with the frame origin as evidence (note: audit engines do not descend into cross-origin frames, so this covers findings *on* the frame element, e.g. missing titles) | |
| FR-09 | `likely_source` is preserved for backward compatibility and derived from the new attribution (`site-custom`/`platform`/`third-party` → `template`-like spread logic retained as tie-breaker between `content` and `site-custom`); no existing consumer breaks | |
| FR-10 | The Accessibility page shows an attribution chip per finding (layer + confidence) with the evidence list inside the finding's existing drill-down; the next-actions queue (`#h-next-actions`) groups actions under **Fix in your site** / **Report upstream** / **Third-party vendor** / **Review content** / **Undetermined** | |
| FR-11 | The static JSON API includes `attribution` on findings additively; `schema_version` stays `"1"`; the API schema files under `src/api/schema/` are updated and `api-schema-validate` passes | |
| FR-12 | All new user-facing strings go through `t()` and appear in the i18n template (`npm run i18n:extract` / `i18n:check` clean); severity taxonomy and internal layer keys stay English, only display labels localize | |

## Non-Functional Requirements

| ID | Requirement | Status |
|---|---|---|
| NFR-01 | **Sustainability gate:** zero new client-side JavaScript — the chip, evidence list, and next-actions grouping are static HTML rendered at build time. No new web fonts, no external assets; any CSS addition stays within the existing budget in `src/report-html.js` | |
| NFR-02 | Scan-time overhead per page is one `response.text()` read plus in-memory matching; no additional navigation, no re-render, no second audit pass. Committed page-record growth is limited to the small per-instance classification fields | |
| NFR-03 | No new runtime dependency unless vendored first-party and justified in `plan.md` (repo convention; the raw-HTML matcher should prefer string/structural techniques over pulling in a full HTML parser — decision recorded in plan.md either way) | |
| NFR-04 | All attribution derivation lives in pure `src/lib/` functions covered by unit tests with real module APIs and synthetic inputs (no fs/db mocking); `npm run test:unit` stays green; `tests/e2e.mjs` extended for the new report surface | |
| NFR-05 | VA (`hf_only`) handling is untouched: nothing new is persisted that the existing gitignore defenses don't already cover (guaranteed structurally by FR-03) | |

## Out of Scope (later missions in the roadmap)

- CSS rule attribution via CDP `CSS.getMatchedStylesForNode` (mission 2) —
  color-contrast and similar CSS-driven findings will mostly remain
  `undetermined` in this mission unless namespace evidence decides them.
- DOM provenance instrumentation (creator-script stacks via
  `addInitScript`) (mission 3) — without it, `js-injected` findings that
  can't be tied to a third-party origin by markup/URL evidence stay
  `undetermined` rather than being guessed.
- Comparative blocking rescan (mission 4).
- Fleet-wide cross-domain platform fingerprints (mission 5).
- Refining `content` vs `site-custom` inside server-rendered HTML beyond
  the existing page-spread heuristic plus namespace evidence.
- Any change to scoring — attribution never affects the headline score or
  the VITAL default-view/priority tiers.

## Edge cases

**Element present in raw HTML but modified by JS before audit** (e.g. a
class added at runtime): creation is what's classified.
**Acceptance**: `render_origin: 'server'` as long as the element itself is
confidently located in the raw HTML; the JS modification is invisible to
this signal and must not flip it to `js-injected`.

**Fully client-rendered site (SPA)**: everything is `js-injected` by
first-party JS.
**Acceptance**: findings attribute to `site-custom` (the site's own JS),
not `third-party` and not `undetermined`-by-default, when the injecting
context is first-party.

**Raw HTML capture fails** (streamed body, capture error, oversized page):
**Acceptance**: every instance on that page gets `render_origin: 'unknown'`;
the scan neither crashes nor skips the page's audits; the miss is visible in
the scan log.

**Platform-flavored classes on a site where that platform is not detected**
(e.g. copied Drupal markup on a static site):
**Acceptance**: per FR-05, no `platform` attribution; evidence recorded at
low confidence, finding stays `undetermined` absent other signals.

**Conflicting evidence** (e.g. namespace says platform, instance
classification says js-injected from a third-party origin):
**Acceptance**: the finding is `undetermined` with *both* evidence entries
listed — conflict is surfaced, never silently resolved.

**Same rule, mixed origins across instances** (some instances
server-rendered, some injected):
**Acceptance**: finding-level layer reflects the majority only at `low`
confidence, and the evidence list states the split (e.g. "14 of 17 sampled
instances server-rendered").

## Sustainability Acceptance Criterion

This change adds **no client-side JavaScript and no data transfer** to
published reports beyond a few bytes of static HTML per finding (chip +
collapsed evidence list) — all classification happens at scan/build time.
Raw HTML bodies are processed in memory and discarded, so repository size
and Pages payload are unaffected. This satisfies the
`sustainable-web-output` charter directive as a hard gate: if an
implementation choice requires runtime JS to display attribution, the
choice is wrong, not the gate.

## Assumptions

- The navigation response body Playwright exposes is the pre-JS server
  HTML for the final URL after redirects; pages where this doesn't hold
  (e.g. meta-refresh chains) fall into the capture-failure edge case.
- The five-layer taxonomy is stable enough for four future evidence
  sources; if a later mission needs a sixth layer, the `attribution`
  object's shape (evidence entries naming their `signal`) is the
  compatibility surface, not the layer enum.
- `spec-kitty` CLI was unavailable on the authoring machine; this mission
  directory was scaffolded by hand to match the existing layout
  (`meta.json`, `status.events.jsonl` with a `MissionCreated` event,
  `spec.md`). Run `spec-kitty doctor` / `spec-kitty plan --mission
  finding-attribution-01KXG46S` from a machine with the CLI to generate
  `plan.md` and work packages; if the CLI rejects the hand-written event
  log, recreate via `spec-kitty specify finding-attribution` and move this
  spec.md in.
