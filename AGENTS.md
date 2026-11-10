# AGENTS Guide for Vital Core

This file defines how AI coding agents should work in this repository.

## Mission

Build and maintain a government web quality scanner that produces
high-confidence, accessible, and actionable findings, **tuned
specifically for tracking continuous improvement, weekly trends, and
historical remediation** across US government sites.

## Operating Priorities

1. **Continuous Accessibility Tracking**: Prioritize week-over-week trends, progress, and regression tracking over isolated, single-run reports (WCAG 2.0 AA for federal, WCAG 2.1 AA for state/local).
2. **Reliable, Deterministic Data**: Outputs must generate stable identifiers (page identity, rule ids) so findings can be deduplicated and compared cleanly across weekly scan boundaries.
3. **Historical Evidence**: Preserve historical data integrity to prove when issues were introduced and resolved. Weekly summaries are kept forever; page-level detail is pruned after `retention_weeks`.
4. **Actionable Remediation**: Provide practical developer guidance that helps teams clear their weekly backlog.
5. **Efficient Scanning**: Optimize scanning of high-value pages to support recurring, automated weekly schedules without bloated resource consumption.
6. **Honest Evidence**: Never present a heuristic, a capped sample, an unavailable value, an unrun reproduction, or an unrecorded manual review as a verified fact.

## Core Architectural Rule

Follow the architecture documented in [ARCHITECTURE.md](ARCHITECTURE.md).

In particular:

* Collect once, use many times.
* Every quality signal has exactly one canonical producer.
* Reuse existing evidence before introducing new scans.
* Reports, APIs, AI summaries, exports, and dashboards consume shared evidence rather than generating it.

## How a Scan Works

```bash
node src/scan.js --domain example.gov [--budget 50] [--base-url http://localhost:8080]
```

There is **no `engines` config list**. Every engine is gated by its weekly
sampling rate in `config/targets.yml` (`sampling:`), and a few engines are
config-driven instead of sampled (see the table). Each engine writes a compact,
comparison-friendly record onto the per-page JSON.

### Scan engine inventory

| Engine file | Tool | What it produces | Gate |
|-------------|------|------------------|------|
| `src/engines/axe.js` | **axe-core** (injected into the page) | WCAG 2.x / Section 508 violations, reduced to rule ids, counts and pages affected (full node lists are not stored). | `sampling.axe` (100) |
| `src/engines/alfa.js` | **Siteimprove Alfa** (`@siteimprove/alfa-*`) | Independent ACT-rules audit; Alfa is the open source core of Siteimprove's commercial checker. | `sampling.alfa` (50) |
| `src/engines/plain-language.js` | text analysis (in-page) | Readability (Flesch / Flesch-Kincaid), sentence/passive-voice heuristics, unexplained acronyms, spelling against the target's `spelling_locale` dictionary (`src/lib/spell.js`; en-US default, en-GB, en-CA, en-AU). `scored: false` when there is too little prose. | `sampling.plain-language` (50) |
| `src/engines/deprecated-html.js` | DOM query (in-page) | Obsolete/legacy HTML (`<font>`, `<center>`, `<marquee>`, presentational attrs). The worked example for a rate-controlled scanner. | `sampling.deprecated-html` (10) |
| `src/engines/resources.js` | DOM inventory | PDFs, Office documents, iframes and embedded media a page links to or embeds (URLs and types; the files are not fetched). | `sampling.resources` (100) |
| `src/engines/images.js` | DOM eval + response interceptor | Per-page image inventory: src, alt text, dimensions, loading/decoding, byte size, decorative/missing-alt flags, and an alt-text verdict from `src/lib/alt-text.js`. Capped at 500 images/page; the aggregate deduplicates by src. | `sampling.images` (100) |
| `src/engines/standards.js` | DOM/metadata checks | schema.org, canonical, hreflang, title, description, charset, lang, viewport, Open Graph, Twitter cards, social presence. | `sampling.standards` (50) |
| `src/engines/security.js` | HTTP header + domain checks | Per origin: HTTPS, HSTS, CSP, X-Content-Type-Options, clickjacking protection, security.txt, government TLD, www resolution. | `sampling.security` (10) |
| `src/engines/public-interest.js` | HTTP checks | Per origin: accessibility statement, carbon.txt, Green Web Foundation, sitemaps. | `sampling.public-interest` (10) |
| `src/engines/offline-resilience.js` | own browser context | Offline fallback, service worker and Cache Storage evidence. Opt-in cost. | `sampling.offline-resilience` (0) |
| `src/engines/sustainability.js` | **co2.js** (`@tgwf/co2`, SWD v4) | Page weight (decoded body bytes) and estimated emissions/energy. | `sampling.sustainability` (10) |
| `src/engines/lighthouse.js` | **Google Lighthouse** (own Chrome) | Performance / accessibility / best-practices / SEO / agentic-browsing scores, Core Web Vitals, and failing non-a11y audits via `extractAudits`. Rendered on `fast.html`. | `sampling.lighthouse` (10) |
| `src/engines/tech.js` | **HTTPArchive/wappalyzer** (vendored, GPL-3.0) | Technology fingerprinting from in-page signals, merged by highest confidence. Update via `scripts/update-wappalyzer.sh`. | `sampling.tech` (10) |
| `src/engines/third-party.js` | response hook + Resource Timing | Per-page third-party (different eTLD+1) cost: requests, bytes, duration, scripts per origin. Rolled up in `src/lib/third-party-rollup.js`. | `sampling.third-party` (25) |
| `src/lib/links.js` (`link-check`) | `fetch` HEAD/GET probes | Broken links (4xx/5xx, DNS, timeout) on sampled pages, checked once per run after the crawl, capped and polite. | `sampling.link-check` (100) + `VITAL_LINK_CHECK_CAP` |
| `src/engines/component-observation.js` | read-only DOM snapshot | Presence, visibility, dialog role and visible button labels for configured `component_signatures`; also annotates axe examples with their DOM component. | only when `component_signatures` is configured |
| `src/engines/consent-action.js` | one click per run | Clicks the site's configured consent button once per run (opt-in `consent_handling`); never guesses, never writes cookies, never removes elements. | only when `consent_handling` is configured |

### Weekly sampling rates

Rates live in one place, `config/targets.yml` under `sampling:` (current defaults
include `axe: 100`, `alfa: 50`, `lighthouse: 10`, `third-party: 25`). A rate is
the share of the week's unique pages an engine runs on; `0` or omitted disables
it. Selection is **deterministic per page** (`src/lib/sampling.js`: a stable
hash of `pageId + engine + week`), so coverage is reproducible, stable within a
week and independent per engine. A target may override individual rates with
its own `sampling:` block.

**Adding a scanner** (the single well-defined extension point): write an engine
module in `src/engines/`, return a compact record (accessibility engines use
`rules: { ruleId: { count, help, examples } }`), dispatch it in `src/scan.js`
behind `runs('<name>')` (or as a config-driven step when it must not be
sampled), aggregate it in `src/aggregate.js`, and add a rate line under
`sampling:`. `deprecated-html.js` is a complete worked example.

### Page selection

`pickBatch` (`src/lib/state.js`) decides which pages each run scans. Pages with
a completed outcome are not rescanned in the same ISO week, so coverage
accumulates across the week's runs. Timeout/error pages are retried in-week (up
to 3 failed attempts), then once more in a later week.

1. **Priority URLs first** (`priority_urls` / `priority_urls_file`: one URL per
   line, `#` comments ok), seeded at depth 0 with `priority: true`.
2. **Then never-scanned before previously-scanned.**
3. **Then a stable per-week random order** (hash of `pageId + week`), so a large
   site gets a different sample each week while staying reproducible.

`importance` (1–5, default 3) scales `max_pages_per_week` (3 = the configured
cap, 1 = a third, 5 = 5/3), so low-value domains consume less weekly budget.

## Finding Evidence and Inspection

Accessibility findings carry canonical, bounded evidence collected once, while
the audited page is still open. Do not add a second evidence pipeline or rescan
a page for a report.

* **Element + semantic evidence** (`src/lib/element-evidence.js`,
  `src/lib/semantic-context.js`): for **each stored example per rule**
  (up to 3/page/rule), tag, explicit role, name-bearing attributes (never text content), selector
  match count, visibility, rect, shadow/iframe state, render context, and the
  nearest landmark region / containing widget. Alfa reports serialized node
  descriptions, so its element evidence is explicitly **unavailable** — never
  guessed.
* **Grouping** (`src/lib/region-groups.js`): `summary.regions`,
  `summary.widgetGroups` and `summary.componentGroups` are three separate
  dimensions. A widget role is a structural category, never a component; only a
  configured signature produces a component group. `unclassified` and
  “no evidence” are separate counts, and `ownership_established` is always
  false.
* **Finding Explorer** (`explore.html`, `renderExplorerPage`): complete static
  index without JavaScript, plus filters and a detail panel as progressive
  enhancement. It reads published `bugs.json`; it does not rescan and does not
  replace the canonical finding on the Accessibility page.
* **Reproduction** (`src/lib/reproduction.js`, `scripts/reproduce.js`,
  `npm run reproduce`): plan → standalone Playwright test → outcome. It checks
  the recorded element and rule, never merely the page; `not_reproduced` does
  **not** mean fixed; nothing runs during a scheduled scan; Alfa/redacted/
  unsafe-selector and frame/shadow-boundary cases are `unavailable`; a changed
  element identity or engine version is reported as changed, not reproduced;
  `REPRO_URL`/`REPRO_SELECTOR`/`REPRO_TIMEOUT_MS` (and the CLI flags) replay a
  staging URL or selector without rewriting recorded identity; exit codes 0–7.
* **Live highlight** (`src/lib/live-inspect.js`): a one-time bookmarklet plus
  a per-finding “Highlight on site” link. The target page receives only a
  selector/rule/WCAG/fix payload in the fragment; the bookmarklet runs locally
  and reports an explicit **located / possible / changed / not found** status.
  Only a unique selector plus matching recorded identity is “located”; multiple
  or incomplete evidence stays a candidate, and a changed element is not
  highlighted as the occurrence. Payloads are versioned, bounded and
  origin-scoped, carry no full URL, and have a URL-free clipboard fallback; a
  strict `script-src` CSP can block bookmarklets. The UI is shadow-root
  isolated, detects removal/replacement/hidden/identity changes with observers,
  and requires Find again rather than switching elements. Text-bearing elements
  also get a native `#:~:text=` link from a bounded 80-character visible-text
  anchor; it is text-only and needs no install. It sends nothing and does not
  replace canonical evidence or the Explorer.
* **Playwright MCP (optional external path)**: the Explorer can copy an
  observation-only prompt for Microsoft's Playwright MCP with the Playwright
  browser extension. It reuses the user's Chrome/Edge profile and session; it is
  not a VITAL dependency, does not run during scans, and still does not prove
  conformance. See `docs-internal/PLAYWRIGHT-MCP.md`.
* **Local inspector** (`scripts/inspect.js`, `npm run inspect`): opens a
  finding or an ad-hoc CSS/XPath target in headed Playwright with the same
  highlighter. No extension/bookmark; `--dry-run` is browser-free, and
  `--print-url` supports sites that block automated browsers (open the URL in
  the normal browser and use the bookmarklet).
* **ACR** (`src/lib/acr.js`): always an **incomplete automated draft**, never a
  conformance report. No automated failure is `not-evaluated`, not `supports`;
  the YAML/HTML carry `INCOMPLETE DRAFT`, a draft legal disclaimer and the
  unverified A/AA criteria. A qualified human must complete and sign it.
* **Coverage** (`src/lib/evidence-coverage.js`): finding-level counts for
  element evidence, locators, semantic regions, widgets, components,
  screenshots and reproduction. Keep `not_captured`, `not_applicable`,
  `unsupported_dom_boundary`, `no_stored_examples`, `no_containing_landmark`
  and `unavailable` distinct; never use “unclassified” for missing evidence.
* **Screenshots** (`src/lib/screenshots.js`): opt-in, one JPEG per page with
  findings, bounded by `max_per_run`/`max_height`/`max_bytes` and maskable;
  stored in the data repo, copied only for referenced findings, pruned with page
  detail. `rect_page` positions the Explorer marker; the image is labelled
  historical and never presented as a live view.
* **Manual validation** (`src/lib/manual-validation.js`): criterion/rule-specific
  prompts. The Explorer can download a blank review record (occurrence,
  element, screenshot reference, privacy note); VITAL never stores it, never
  sets a reviewer or status, and never turns it into a conformance claim.
* **Identity**: `pattern_id` is cross-domain rule identity; `occurrence_id`
  (`VO-…`) is the recorded element; `observation_id` (`VOB-…`) is one scan run;
  `finding_ref` (`VFR-…`) is the durable finding link, independent of which
  sample is representative. Keep the legacy `instance_id` formula frozen; see
  `docs-internal/EVIDENCE-IDENTITY-AUDIT.md`.
* **API**: additive v1 fields (`selector`, `element`, `semantic_context`,
  `evidence`, `reproduction`, `manual_validation`, `scope_of_analysis.regions`
  / `component_groups`). Keep `schema_version: "1"` unless the change is
  breaking; see [API.md](API.md).

Storage bounds: 3 examples per page per rule (each with coherent evidence; a
text-bearing element may add an 80-character visible-text anchor for a native
text link), 5 instances per rule in the summary, and at most `screenshots.max_per_run`
images per run (one per page, never per finding; opt-in, JPEG, pruned with page
detail). Reports select one representative occurrence as a whole
(`occurrence_id`); never mix fields from different examples. Do not store full
DOM or per-violation artifacts without a measured budget.

### Findings ledger

`data/<domain>/findings.json` tracks every unique finding by `pattern_id` with
`firstSeen` / `lastSeen` / `weeksSeen`, surviving page-detail pruning. It is
tracked in the **data repo** (`data_repo` in `config/targets.yml`, default
`mgifford/vital-core-data`), which CI checks out into `data/`. `data/` is not
tracked in this repository. Updated by `src/lib/findings.js` during aggregation
and surfaced as first/last-seen in bug reports.

### Technology ↔ finding association

`src/lib/tech-findings.js` joins a page's detected technologies with its
accessibility findings (both already in the page record). A finding is listed
when it is at least 1.5× as common on pages with a technology as on pages
without it, **and** the approximate 95% risk-ratio interval excludes 1
(`rankAssociations`), with at least 5 pages with the tech, with both, and
without it; a tech on nearly every page is named as not comparable. The
interval suppresses weak pairs but is not a causal model; keep the association
surface labelled exploratory.
Comparing with all pages instead (**lift**) remains in the data for API
consumers. Only pages where both tech and an accessibility engine ran count.
The model lives on the weekly summary and is ranked at render time. Rendered as
`tech-findings.html`; merged across domains into the **Cross-technology issues**
matrix scored by `lift × sites`. It is an *association* surface: say
"associated with", never "caused by".

### Third-party evaluation

`src/engines/third-party.js` records each page's third-party origin cost;
`src/lib/third-party-rollup.js` rolls it up per vendor (`summary.thirdParty`),
and `src/lib/third-party-ledger.js` keeps `third-parties.json` (in the data
repo) with first/last-seen. Rendered as `third-parties.html` and
`<domain>_<DDMMMYYYY>_third-party.csv`. "Pages w/ finding" is co-occurrence,
not a causal claim; the rigorous blocked-load comparison is a planned heavier
mode.

## Report Pages

Basenames live in the `PAGES` map in `src/report-html.js`; link with
`pageHref(key, anchor)`, never a hard-coded filename. Renames require a
`PAGE_REDIRECTS` entry so a hash-preserving stub is written at the old name.
Current names include `accessible.html`, `fast.html` (Lighthouse),
`findable.html` (readability), `third-parties.html`, `explore.html`,
`history.html`, `archive.html`.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `VITAL_WEEK` | Pin the ISO week (e.g. `2026-W23`). Used by the e2e test for determinism; normally derived from the run date. |
| `VITAL_A11Y_SETTLE_DELAY_MS` | Override `settle_delay_ms` — the wait after page load before auditing, so client-side hydration can finish and transient false positives are reduced. |
| `VITAL_LINK_CHECK_CAP` | Override the per-run broken-link probe cap (default 500). |
| `VITAL_SCAN_TIME_BUDGET_MINUTES` | Stop starting new pages after this many minutes, so a run exits cleanly before the CI timeout. |
| `VITAL_DATA_ROOT` | Redirect `data/`, `state/` and `docs/` to a persistent volume (Hugging Face appliance). Config is always read from the repo. |
| `VITAL_PROFILE` | Deployment profile for `aggregate` / the HF appliance (e.g. `va`). |
| `VITAL_OLLAMA_URL` | Optional OpenAI-compatible endpoint for local `ai-findings` summaries. Defaults to `http://localhost:11434`. |
| `VITAL_OLLAMA_MODEL` | Optional model override. Defaults to the first model reported by `/v1/models`, then `local-model`. |

Most behavior is configured per target in `config/targets.yml`
(`pages_per_run`, `max_pages_per_week`, `delay_ms`, `nav_timeout_ms`,
`settle_delay_ms`, `retention_weeks`, `user_agent`, `sampling`, `reporting`,
`screenshots`, `finding_policy`, `evaluation_report`, `component_signatures`,
`page_families`, `consent_handling`),
not via environment variables.

## Spec Kitty Agent Surfaces

Spec Kitty is the workflow and governance layer for non-trivial work in this
repository. It is configured for `codex`, `claude`, and `copilot`; do not treat
the Ollama integration as the agent workflow. Ollama is only an optional runtime
enhancement for `ai-findings` output.

Before starting or resuming Spec Kitty work, run:

```bash
spec-kitty upgrade --agent-check --json
spec-kitty agent config sync --create-missing
spec-kitty agent config status
spec-kitty doctor skills --json
spec-kitty charter preflight --json
npm run check:spec-kitty
```

For new missions, fill `kitty-specs/<mission>/spec.md` from repo evidence before
planning. Use the strongest available reasoning model for `specify`, `plan`,
`tasks`, and `review`; local or weaker models may assist with mechanical
drafting, but should not be final authority for data compatibility, architecture,
or acceptance gates.

The durable surface guide is `kitty-specs/AGENT_SURFACES.md`.

## Repository Rules for Agents

1. **Plain Node, no build step, no TypeScript.** Source is `.js` under `src/` and runs directly with `node`. Do not reintroduce a build step, TypeScript, or a database. Third-party client runtimes (e.g. ParaCharts) are vendored as **prebuilt** bundles under `vendor/` and served first-party — never built from source in the pipeline.
1a. **Reports degrade gracefully.** Report HTML must be fully usable with no JavaScript. Charts render as static accessible SVG + a data-table fallback; JS is only ever a *progressive enhancement* layered on top (e.g. the ParaCharts upgrade — `src/lib/paracharts.js` builds the manifest, a lazy `import()` loader in `report-html.js` mounts `<para-chart>` and hides the SVG fallback, restoring it if the runtime fails). Never make a report's core content depend on JS.
2. **Preserve schema compatibility.** Never introduce breaking changes to the per-page JSON record, `summary.json` or the v1 API without a migration plan — breaking changes destroy historical weekly trend graphs and consumers. Additive fields are preferred.
3. **Stable identity.** `src/lib/urls.js` defines page identity everywhere; treat it as a frozen contract. The same applies to `pattern_id`/`instance_id` in `src/lib/bug-report.js`: `pattern_id` is intentionally identical across domains for the same engine+rule (`VS-hash(engine, ruleId)`) — `mergeFleetPatterns`/`rankFleetPatterns` depend on that cross-domain identity to surface shared CMS/template bugs (see `kitty-specs/cross-domain-pattern-analysis-01KXKV69/spec.md`). Do not scope them to the domain. `src/lib/fingerprint-core.js`'s `a11y_pattern_fingerprint`/`a11y_occurrence_fingerprint` are a separate, additive, domain-scoped dual-write for cross-project correlation; they are never read by the fleet-pattern path (see [ACCESSIBILITY.md's fingerprint profiles](https://mgifford.github.io/ACCESSIBILITY.md/examples/fingerprints/README.html)).
4. Keep changes small, reviewable, and test-backed.
5. Prefer host-scoped, HTML-focused discovery by default.
6. Include tests for behavior changes in discovery, scanning, aggregation, evidence or report rendering.
7. Avoid broad refactors unless requested.
8. **Clean up branches after merging.** Delete the feature branch as soon as its PR merges (`git push origin --delete <branch>` or the GitHub UI). The only branches that should exist are `main`, branches with open PRs, and active work in the current session.
9. **Fleets send engine fixes upstream.** In a fleet repo made from this template (e.g. `vital-core-nsf`, `vital-core-lgd`), record discoveries every fleet would want in `docs-internal/UPSTREAM-SUGGESTIONS.md`, and fix them in vital-core on a branch from `upstream/main`. Never copy changes across by hand. vital-core itself does not ship that file.
10. **Never fabricate evidence.** Do not claim a reproduction, manual review, fix or conformance result that did not happen. `not_reproduced` is not fixed; a review record is not conformance; `unavailable`/`unclassified` are valid answers and must not be replaced with guesses.

## Testing

- `npm run test:unit` — `node --test` over `tests/unit/`. Several suites launch Chromium (component observation, consent, resilience/standards, reproduction), so install it once with `npx playwright install chromium`.
- `npm run test:e2e` — full pipeline over a local fixture site simulating two weeks, including no-JS and browser checks. Requires the same Chromium.
- `npm run test` — both.
- `npm run i18n:check` — fails if `src/locales/template.json` is stale (`npm run i18n:extract` to refresh).
- `npm run check:alfa-metadata` — Alfa rule labels/mappings after a dependency upgrade.
- `npm run check:spec-kitty` — governance surfaces.

## Prompting Pattern for Agents

When making changes, always include:

1. Objective (How does this improve the weekly scan experience?)
2. In-scope files
3. Acceptance criteria (including backward compatibility of data records and evidence honesty)
4. Validation steps (run `test:unit`; run `test:e2e` for pipeline, evidence or report changes)
5. Rollback plan

## Review Checklist

1. Does this improve or preserve accessibility outcomes?
2. **Does this keep outputs reproducible and stable for week-over-week comparisons?**
3. Are findings actionable for engineers?
4. Are tests updated and passing?
5. Is the scan load proportionate to user value, given this runs on a recurring weekly schedule?
6. Does it stay within the plain-JS, no-build, no-database architecture?
7. Is the evidence honest — no invented values, no false reproduction or review claims, unavailable states preserved?
8. Does it stay within the stored-evidence bounds and avoid new per-page or per-run bloat?
9. Are reports still fully usable with JavaScript off?
