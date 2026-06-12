# vital-scans

An open source website quality engine. It crawls 5–10 domains slowly and
politely across each week, scans thousands of pages per domain with
[axe-core](https://github.com/dequelabs/axe-core) and
[Siteimprove Alfa](https://github.com/Siteimprove/alfa) (the open source
engine behind Siteimprove's commercial checker), measures page weight and
estimated emissions with [co2.js](https://github.com/thegreenwebfoundation/co2.js),
and publishes week-over-week reports to GitHub Pages. Everything runs on
GitHub Actions. There is no server, no database, and no budget line.

Continuous measurement beats one-off audits. The question this answers is
not "is this site accessible?" but "is this site **getting more
accessible**, and is it getting lighter?"

## Design principles

These come from hard lessons. Earlier attempts failed because they had
too many sources of truth. This system has one rule above all others:

**Files are the only state. Data is append-only. Reports are pure
functions of the data directory.**

- `state/<domain>/crawl.json`: the crawl frontier. The only mutable
  file. If it is deleted, the crawler reseeds from the sitemap and no
  history is lost.
- `data/<domain>/<ISO-week>/pages/*.json`: one compact record per page
  per week. Append-only.
- `data/<domain>/<ISO-week>/runs/*.json`: append-only run logs.
- `data/<domain>/<ISO-week>/summary.json`: the weekly rollup, computed
  from the page records and committed. Old page-level detail is pruned
  after `retention_weeks`; summaries are kept forever, so trend history
  never breaks.
- `docs/`: generated HTML, built at deploy time and shipped as a Pages
  artifact. **Never committed.** It cannot drift from the data because
  it does not persist.

Other deliberate choices:

- **Stable page identity.** One URL normalization function
  (`src/lib/urls.js`) defines page identity everywhere. Week-over-week
  comparison depends on it; treat it as a frozen contract.
- **ISO weeks as the unit of comparison.** A page scanned Tuesday and a
  page scanned Saturday of the same week belong to the same dataset.
  There are no synthesized run IDs to group incorrectly.
- **Pages-affected over instance counts.** A rule failing 600 times on
  a nav menu is one fix, not 600. Reports rank rules by pages affected.
- **A settle delay before auditing** (`settle_delay_ms`, overridable
  with `VITAL_A11Y_SETTLE_DELAY_MS`) lets client-side hydration finish,
  which removes the largest source of transient false positives.
- **Plain Node, no build step, no TypeScript, six dependencies.** Less
  machinery to break in CI.

## How a week works

1. The `scan` workflow runs nightly at off-hours (UTC crons in
   `.github/workflows/scan.yml`; adjust for your targets' audiences).
2. Each run scans up to `pages_per_run` pages per domain that have not
   yet been scanned this ISO week, discovering new same-host links as it
   goes. Coverage accumulates: 300 pages/run × 7 runs ≈ 2,000+
   pages/domain/week, within the `max_pages_per_week` cap.
3. Sunday evening, the `report` workflow aggregates the week, deploys
   the reports to GitHub Pages, posts a Markdown summary as a comment on
   the "Weekly scan reports" issue, and prunes page-level detail older
   than `retention_weeks`.

## Setup

1. Create a repository from these files and push to GitHub.
2. Edit `config/targets.yml`: list your 5–10 domains and adjust budgets.
3. In repository **Settings → Pages**, set the source to **GitHub
   Actions**.
4. In **Settings → Actions → General**, allow workflows **read and
   write permissions**.
5. Run the `scan` workflow once manually (Actions → scan → Run
   workflow) to verify, then run `report` to publish the first reports.

<<<<<<< HEAD
The project splits testing into two tiers:

- CI-safe checks (`npm test` / `npm run test:ci`): type validation, profile contract checks, standards-source integrity checks, and deterministic unit tests.
- Live phase checks (`npm run test:phase:live`): network and browser-dependent validations for discovery/browser/worker/reporter flows.

Coverage reports are generated to `coverage/` and uploaded by the CI workflow (`.github/workflows/ci-tests.yml`).

Standards-source integrity is validated by `tests/smoke/validate-standards-source.ts` and confirms that the ScanGov standards submodule and canonical standards data mappings are present for reporting.

## Scan Tool Stack

VITAL-Core runs up to six workers per page. Workers 3-6 are skipped when `VITAL_AUDIT_SCOPE=accessibility` or `a11y`.

| # | Tool | What it produces |
|---|------|-----------------|
| 1 | **axe-core** via `@axe-core/playwright` | WCAG 2.x / Section 508 violations (always runs) |
| 2 | **Siteimprove Alfa CLI** | Independent ACT-rules accessibility audit against live URL (always runs) |
| 3 | **Google Lighthouse** | Performance (FCP, LCP, Speed Index), accessibility, SEO, best-practices, and experimental agentic-browsing scores |
| 4 | **wappalyzer-next** | CMS / framework / analytics tech fingerprint (`--scan-type full`) |
| 5 | **Cheerio** (offline) | Alt-text, readability, overlay detection, USWDS presence, ambiguous links |
| 6 | **axe-core** (JS disabled) | Third-party script regression delta |

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITAL_ALFA_CMD` | `alfa` | Path to alfa binary. Use `node_modules/.bin/alfa` locally and in CI. |
| `VITAL_WAPPALYZER_CMD` | _(empty — tool skipped if unset)_ | Path to wappalyzer-next binary. |
| `VITAL_AUDIT_SCOPE` | `full` | Set to `accessibility` or `a11y` to run workers 3–6 only (axe + alfa still run). |
| `VITAL_SCAN_INTENSITY` | `standard` | `deep` enables Firefox + WebKit in addition to Chromium. |
| `VITAL_A11Y_SETTLE_DELAY_MS` | `1500` (a11y-only) | Extra hydration settle delay before live accessibility audits in `accessibility` scope. Useful for reducing transient JS timing false positives. |

### Alfa accessibility auditing

Alfa and axe both run on every page. Alfa provides independent ACT-rules coverage from Siteimprove; axe provides Deque coverage. Running both improves overall issue detection.

Alfa requires `@siteimprove/alfa-formatter-json` to be installed (it is in `dependencies`) and the `VITAL_ALFA_CMD` environment variable to point to the binary:
=======
## Local use
>>>>>>> 34f1991 (trying to see if claude can fix this)

```sh
npm ci
npx playwright install chromium
node src/scan.js --domain example.gov --budget 25
node src/aggregate.js
npx http-server docs   # or open docs/index.html
```

Tests:

```sh
npm run test:unit   # URL identity, ISO weeks, robots.txt, batch picking
npm run test:e2e    # full pipeline over a local fixture site simulating two weeks
```

## Politeness

The crawler honors `robots.txt` (Disallow/Allow/Crawl-delay),
identifies itself with a user agent containing a contact URL, scans one
page at a time per domain with a configurable delay, and runs at night.
If you operate a site being scanned and want changes, open an issue.

## Honest limits

- Automated checkers find roughly 30–40% of WCAG barriers. A clean
  report is a floor, not a finish line. Manual testing with assistive
  technology remains essential.
- CO₂ figures use the Sustainable Web Design model (v4); they are
  estimates suitable for trends, not absolute claims.
- Byte counts are decoded body sizes seen by the browser, not on-wire
  transfer sizes. They are consistent week over week, which is what the
  trend needs.

## Commitments

This project follows public commitments to
[accessibility](ACCESSIBILITY.md) and
[sustainability](SUSTAINABILITY.md), and aims to advance the
[W3C Web Sustainability Guidelines](https://w3c.github.io/sustainableweb-wsg/).
The reports themselves are part of the argument: semantic HTML, no
JavaScript, no web fonts, ~2 KB of CSS, dark mode respected.

## License

<<<<<<< HEAD
Each generated page also includes a footer linking to the main repository and clarifying non-affiliation:

- Project repo: `https://github.com/mgifford/vital-core`
- Disclaimer: VITAL-Core is an independent open source project and is not affiliated with or endorsed by scanned agencies/sites.

## Incremental Scanning for Scale

To support high-volume weekly scanning, VITAL-Core now probes each URL before launching full browser audits:

- If `ETag` or `Last-Modified` matches the prior run state, that page is marked `SKIPPED_UNCHANGED`.
- If validators are missing, a lightweight content hash probe is used as a fallback.
- Changed or uncertain pages are fully rescanned.

This behavior uses the persisted `runs/page-state.json` cache restored from GitHub Pages at run start.

To override this and force a full rescan:

- In GitHub Actions `workflow_dispatch`, set `force_rescan` to `true`.
- Or run locally with `FORCE_RESCAN=true npm run scan`.

If your Pages base URL differs from the default `https://<owner>.github.io/<repo>`, set a repository variable named `VITAL_PAGES_BASE_URL`.

## Monthly Top-URL Validation Seeding

VITAL-Core now seeds each target queue with high-priority URLs derived from DuckDuckGo `site:` results.

- Seed cache artifact: `dist/runs/top-task-seeds.json`
- Automatic refresh: monthly during scheduled scan workflow (first day of month)
- Staleness policy: refresh when seed cache is older than 31 days
- Manual local refresh: `npm run seeds:refresh`

Discovery order is:

1. Recently updated URLs from prior run state
2. DuckDuckGo priority seeds
3. Profile `priority_urls`
4. Filtered sitemap URLs

Discovery filters now default to:

- Host scope only (`target.base_url` host only; no wildcard subdomain fan-out)
- HTML-like URLs only (non-HTML assets such as PDF, DOCX, XLSX, XML, media, fonts, RSS excluded)

You can opt into subdomain crawling per target by setting `settings.include_subdomains: true`.

The sitemap sampler is deterministic for a given `VITAL_SAMPLING_SEED`. Scheduled runs set that seed from run metadata so each run is reproducible on replay, while local comparisons can use a fixed seed for byte-stable output.

## Scan Politeness and Adaptive Timeout Backoff

To reduce load on upstream sites and avoid bursty same-domain traffic, page scans apply a base pause before each consecutive request to the same host.
When repeated timeouts occur on a host, VITAL-Core adds extra cooldown before the next same-host request.

- `VITAL_MAX_TIMEOUT_MS` (default workflow values by intensity: standard `30000`, light `35000`, ultra_light `45000`, deep `60000`)
- `VITAL_SAME_SITE_DELAY_MS` (default: `1500`)
- `VITAL_TIMEOUT_BACKOFF_THRESHOLD` (default: `2`)
- `VITAL_TIMEOUT_BACKOFF_STEP_MS` (default: `10000`)
- `VITAL_TIMEOUT_BACKOFF_MAX_MS` (default: `60000`)

Example behavior with defaults:

- First and second consecutive timeouts use base same-site delay only.
- Third consecutive timeout adds `10000ms` backoff.
- Fourth adds `20000ms`, capped at `60000ms`.

## Accessibility-First Audit Scope Rotation

To prioritize faster hourly accessibility coverage, VITAL-Core supports scoped audit execution:

- `VITAL_AUDIT_SCOPE=accessibility`: runs accessibility checks only (axe + Alfa still run; technology fingerprinting, third-party differential checks, and Lighthouse are skipped).
- `VITAL_AUDIT_SCOPE=full`: runs all supplemental checks.

Scheduled workflow behavior now defaults to accessibility-first scans during business-hour windows and most off-hours cycles, with full audit rotation every 6 UTC hours (plus deep refresh windows and manual runs).

## Reporting Consistency Notes

- Domain accessibility pages (`domains/<target-id>/accessibility.html`) now read SQLite after the current run is appended, so latest-run page counts and issue rows align with current scan output.
- Fallback rendering (used when SQLite history is unavailable) now groups all pages for a target under one synthetic run ID, preventing accidental single-page summaries.
- If transient findings (for example `aria-hidden-focus`) appear in automated scans but cannot be reproduced manually, increase `VITAL_A11Y_SETTLE_DELAY_MS` (for example `2500`) to allow client-side menu/footer hydration before axe executes.
=======
MIT.
>>>>>>> 34f1991 (trying to see if claude can fix this)
