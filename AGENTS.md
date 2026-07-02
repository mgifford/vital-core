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

## Core Architectural Rule

Follow the architecture documented in [ARCHITECTURE.md](ARCHITECTURE.md).

In particular:

* Collect once, use many times.
* Every quality signal has exactly one canonical producer.
* Reuse existing evidence before introducing new scans.
* Reports, APIs, AI summaries, exports, and dashboards consume shared evidence rather than generating it.

## Scan Engine Inventory

Every URL in the batch is processed by the engines listed in the
target's `engines` config (default: all three). Each engine writes a
compact, comparison-friendly record onto the per-page JSON.

| Engine file | Tool | What it produces |
|-------------|------|------------------|
| `src/engines/axe.js` | **axe-core** (injected into the page) | WCAG 2.x / Section 508 violations, reduced to rule ids, counts, and pages affected (full node lists are not stored). |
| `src/engines/alfa.js` | **Siteimprove Alfa** (`@siteimprove/alfa-*`) | Independent ACT-rules audit. Alfa is the open source core of Siteimprove's commercial checker. |
| `src/engines/plain-language.js` | text analysis (in-page) | Readability (Flesch / Flesch-Kincaid), sentence/passive-voice heuristics, unexplained acronyms. `scored: false` when there's too little prose. |
| `src/engines/deprecated-html.js` | DOM query (in-page) | Obsolete/legacy HTML (`<font>`, `<center>`, `<marquee>`, presentational attrs). Example of a rate-controlled scanner. |
| `src/engines/sustainability.js` | **co2.js** (`@tgwf/co2`, SWD model v4) | Page weight (decoded body bytes) and estimated emissions. |
| `src/engines/lighthouse.js` | **Google Lighthouse** (own Chrome) | Performance / accessibility / best-practices / SEO / agentic-browsing scores + Core Web Vitals, plus the failing non-a11y **audits** (recommendations) via `extractAudits`. Drives its own browser. Aggregated into `summary.lighthouse.recommendations` and rendered on `lighthouse.html`. |
| `src/engines/images.js` | DOM eval + response interceptor | Per-page image inventory: src, alt text, dimensions, loading/decoding attrs, byte size, decorative/missing-alt flags, and an alt-text quality verdict from `src/lib/alt-text.js` (`assessAltText`: MISSING/FILENAME/SUSPICIOUS/TOO_SHORT/TOO_LONG/DECORATIVE/GOOD). Capped at 500 images/page. Aggregate deduplicates by src with an occurrence count. |
| `src/engines/tech.js` | **HTTPArchive/wappalyzer** (vendored, GPL-3.0) | Technology fingerprinting from in-page signals; aggregated by highest confidence across sampled pages. Update via `scripts/update-wappalyzer.sh`. |
| `src/engines/third-party.js` | response hook + Resource Timing API | Per-page third-party (different eTLD+1) resource cost: requests, bytes, load duration, script count per origin. Collector attached before navigation, like sustainability. Rolled up per vendor in `src/lib/third-party-rollup.js`. |
| `src/lib/links.js` (`link-check`) | `fetch` HEAD/GET probes | Broken links (4xx/5xx, DNS, timeout) found on sampled pages, checked once per run, capped and polite. |

#### Weekly sampling rates

Each engine has a weekly coverage rate set in one place,
`config/targets.yml` under `sampling:` (e.g. `axe: 100`, `alfa: 30`,
`lighthouse: 10`). The rate is the share of the week's unique pages an
engine runs on; `0` or omitted disables it. Selection is **deterministic
per page** (`src/lib/sampling.js`: a stable hash of `pageId + engine +
week`), so coverage is reproducible, stable within a week, and
independent per engine. A target may override individual rates with its
own `sampling:` block.

**Adding a scanner** (the single, well-defined extension point): write an
engine module in `src/engines/` returning a compact `{ engine, ...,
rules: { ruleId: { count, help, examples } } }` record, dispatch it in
`src/scan.js` behind `runs('<name>')`, aggregate its rules in
`src/aggregate.js`, and add a rate line under `sampling:`. The
deprecated-html engine is a complete worked example.

#### Page selection: priority + weekly sampling

`pickBatch` (`src/lib/state.js`) decides which pages each run scans. The
default rule is that pages with a completed outcome are not rescanned in
the same ISO week (`lastScannedWeek` excludes them), so coverage
accumulates across the week's runs without repeats. Timeout/error pages
are intentionally retried in-week (up to 3 failed attempts) to recover
from transient failures. Within that:

1. **Priority URLs first.** A target's `priority_urls` / `priority_urls_file`
   (top tasks, e.g. from top-task-finder — one URL per line, `#` comments
   ok) are seeded at depth 0 with `priority: true` every run and scanned
   before anything else, so they're always covered early in the week.
2. **Then never-scanned before previously-scanned**, for trend freshness.
3. **Then a stable per-week random order** (hash of `pageId + week`), so a
   large site gets a different random sample each week instead of the same
   shallow pages — reproducible within a week for replay.

`importance` (1–5, default 3) per target scales `max_pages_per_week`
(3 = the configured cap, 1 = a third, 5 = 5/3) so low-value domains
(near-identical open-data sites) consume less weekly budget than key
ones.

#### Findings ledger

`data/<domain>/findings.json` (committed) tracks every unique finding by
`pattern_id` with `firstSeen` / `lastSeen` / `weeksSeen`, accumulated
across the domain's whole history (survives page-detail pruning). Updated
by `src/lib/findings.js` during aggregation; surfaced as first/last-seen
in bug reports.

#### Technology ↔ finding association

`src/lib/tech-findings.js` joins each page's detected technologies with its
accessibility findings (both already in the page record), building a
per-page co-occurrence model in `summarizeRecords`. **Lift** =
`P(finding | tech) / P(finding)` quantifies over-representation; only pages
where both tech and an accessibility engine ran are counted, with a 5-page
minimum support. The model is stored on the weekly summary (`techFindings`,
~9 KB), rendered per-domain as `tech-findings.html`, and merged across
domains on the dashboard (`mergeFleet` / `rankFleetAssociations`) into the
**Cross-technology issues** matrix scored by `lift × sites`. It is an
*association* surface — co-located technologies share identical lift, so the
UI says "associated with", never "caused by".

#### Third-party evaluation

`src/engines/third-party.js` records, per page, every third-party origin's
load cost; `src/lib/third-party-rollup.js` rolls it up per vendor for the
week (`summary.thirdParty`), and `src/lib/third-party-ledger.js` keeps a
committed `third-parties.json` with first/last-seen per vendor (annotated
in-memory for the report after `summary.json` is written, same pattern as
the link ledger). Rendered as `third-party.html` + `third-party.csv`.
"Pages w/ finding" is co-occurrence (association), not a causal claim — the
rigorous blocked-load comparison is a planned heavier mode, not yet built.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `VITAL_WEEK` | Pin the ISO week (e.g. `2026-W23`). Used by the e2e test for determinism; normally derived from the run date. |
| `VITAL_A11Y_SETTLE_DELAY_MS` | Override `settle_delay_ms` — the wait after page load before auditing, which lets client-side hydration finish and removes transient false positives. |
| `VITAL_LINK_CHECK_CAP` | Override the per-run broken-link probe cap (default 500). |
| `VITAL_OLLAMA_URL` | Optional Ollama base URL for local AI summaries in `ai-findings` output. Defaults to `http://localhost:11434`. |
| `VITAL_OLLAMA_MODEL` | Optional Ollama model override. Defaults to the first available model, then `llama3`. |

Most behavior is configured per target in `config/targets.yml`
(`pages_per_run`, `max_pages_per_week`, `delay_ms`, `nav_timeout_ms`,
`settle_delay_ms`, `retention_weeks`, `engines`, `user_agent`), not via
environment variables.

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
2. **Preserve schema compatibility.** Never introduce breaking changes to the per-page JSON record or `summary.json` without a migration plan — breaking changes destroy historical weekly trend graphs.
3. **Stable identity.** `src/lib/urls.js` defines page identity everywhere; treat it as a frozen contract. Week-over-week comparison depends on it.
4. Keep changes small, reviewable, and test-backed.
5. Prefer host-scoped, HTML-focused discovery by default.
6. Include tests for behavior changes in discovery, scanning, or aggregation.
7. Avoid broad refactors unless requested.
8. **Clean up branches after merging.** When a PR is merged, immediately delete the feature branch — do not leave it in the remote. Use `git push origin --delete <branch>` or the GitHub UI. Stale branches accumulate and obscure active work. The only branches that should exist at any time are `main`, any branch with an open PR, and branches actively being worked on in the current session.

## Testing

- `npm run test:unit` — `node --test` over `tests/unit/` (URL identity, ISO weeks, robots.txt parsing, batch picking).
- `npm run test:e2e` — full pipeline over a local fixture site simulating two weeks, asserting week-over-week diffs. Requires Playwright's bundled Chromium (`npx playwright install chromium`).

## Prompting Pattern for Agents

When making changes, always include:

1. Objective (How does this improve the weekly scan experience?)
2. In-scope files
3. Acceptance criteria (including backward compatibility of data records)
4. Validation steps (run `test:unit`; run `test:e2e` for pipeline changes)
5. Rollback plan

## Review Checklist

1. Does this improve or preserve accessibility outcomes?
2. **Does this keep outputs reproducible and stable for week-over-week comparisons?**
3. Are findings actionable for engineers?
4. Are tests updated and passing?
5. Is the scan load proportionate to user value, given this runs on a recurring weekly schedule?
6. Does it stay within the plain-JS, no-build, no-database architecture?
