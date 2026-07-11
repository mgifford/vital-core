# VITAL Scans

An open source website quality engine. It crawls 5–20 domains slowly and
politely across each week, scans thousands of pages per domain with
[axe-core](https://github.com/dequelabs/axe-core) and
[Siteimprove Alfa](https://github.com/Siteimprove/alfa) (the open source
engine behind Siteimprove's commercial checker), measures page weight,
estimated energy costs, image inventory, and technology stack, and publishes
week-over-week reports to GitHub Pages. Everything runs on GitHub Actions.
There is no server, no database, and no budget line.

Continuous measurement beats one-off audits. The question this answers is
not "is this site accessible?" but "is this site **getting more
accessible** to more people?"

## Design principles

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
- **Reports built for the visitor's question, not the engine list.** Each
  domain's landing page answers "how are we doing?" in ~10 seconds — score
  and trend, three deltas (new / fixed / regressed this week), and the one
  biggest available win — with the detail collapsed below. The sub-nav is
  grouped by outcome (Accessible? · Fast? · Findable? · Trustworthy? ·
  Sustainable?). Renamed pages keep a redirect at their old URL, so existing
  links (including pinned `#finding` anchors) never break.
- **A settle delay before auditing** (`settle_delay_ms`, overridable
  with `VITAL_A11Y_SETTLE_DELAY_MS`) lets client-side hydration finish,
  which removes the largest source of transient false positives.
- **URL path/query filtering.** Per-target `url_include` / `url_exclude`
  pattern arrays (set in `config/targets.yml`) narrow which pages are
  crawled and scanned. Each pattern is a substring or a `/regex/`, and long
  lists can live in a file via `url_include_file` / `url_exclude_file`
  (resolved under `config/`). Priority URLs always bypass the filter.
- **Viewer URL exclusion.** A report reader can hide findings on pages they
  are not responsible for (a section another team owns, legacy `.aspx` pages)
  via a control on the landing and Accessibility pages. The list is a
  substring/`/regex/` set saved per-domain in the browser (`localStorage`),
  shared across both pages, and exportable/importable so a team can agree on
  one scope. Scanning is unaffected — it only changes what the report shows;
  with JavaScript off the full report renders.
- **Plain Node, no build step, no TypeScript, six dependencies.** Less
  machinery to break in CI.

## How a week works

1. The `scan` workflow runs nightly at off-hours (UTC crons in
   `.github/workflows/scan.yml`; adjust for your targets' audiences).
2. Each run scans up to `pages_per_run` pages per domain that have not
   yet been scanned this ISO week, discovering new same-host links as it
   goes. Coverage accumulates: 300 pages/run × 7 runs ≈ 2,000+
   pages/domain/week, within the `max_pages_per_week` cap.
3. After the night's scans finish, the `report` workflow aggregates the
   week, deploys the reports to GitHub Pages, and prunes page-level
   detail older than `retention_weeks`.

For how crawling, storage, and the pipeline work in more detail, see
**[ARCHITECTURE.md](ARCHITECTURE.md)**.

## Setup

### Repository Roles

GitHub is the source of truth for this project. The `main` branch keeps
the full working history, and that is where development should land.

Hugging Face Spaces has been archived. It wasa deployment target, not a second source branch:
it should receive a clean snapshot of the current site state on its own
`main` branch, with large `state/` crawl artifacts stripped out before
push.

1. Create a repository from these files and push to GitHub.
2. Edit `config/targets.yml`: list your 5–10 domains and adjust budgets.
3. In repository **Settings → Pages**, set the source to **GitHub
   Actions**.
4. In **Settings → Actions → General**, allow workflows **read and
   write permissions**.
5. Run the `scan` workflow once manually (Actions → scan → Run
   workflow) to verify, then run `report` to publish the first reports.

## Local use

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

## Languages

Reports can be published in multiple languages. Set `languages` (and optionally
`default_language`) in `config/targets.yml` — globally or per target, e.g.
`languages: [en, fr]` for a Canadian site. The default language keeps the usual
file paths; every other language is published alongside as `<page>-<lang>.html`,
cross-linked by a header language switcher that works without JavaScript. A
reader's choice is remembered in `localStorage` and can be forced from a link
with `?lang=<code>` (e.g. `?lang=fr`); both are progressive enhancement and are
only active when more than one language is configured.

Translation uses a Drupal/gettext-style `t()` where the English phrase is the
key, so untranslated strings fall back to English and partial catalogs are safe.
Catalogs are human-reviewed JSON in `src/locales/<lang>.json` (`en`, `fr`, `ja`,
`nl` supported). Run `npm run i18n:extract` to refresh the translator checklist
(`src/locales/template.json`). Only the UI chrome is translated — engine-sourced
WCAG/rule descriptions stay English. See CLAUDE.md for details.

## JSON API

Every build publishes a static, read-only, versioned JSON API next to the HTML
reports at `/api/v1/` — no server, database, or auth. Consume it with a plain
HTTP `GET` (`curl`, `fetch`, CI) instead of scraping HTML. Endpoints: an
`index.json` of all domains, a per-domain `snapshot.json`, and per-week
`findings.json`, each carrying a `schema_version` and validated against
published JSON Schemas. URLs are redacted for publication (fragments stripped,
sensitive query values `[REDACTED]`) and excluded pages are omitted. See
[API.md](API.md) for the full contract, schemas, retention, and examples.

## Politeness

The crawler honors `robots.txt` (Disallow/Allow/Crawl-delay),
identifies itself with a user agent containing a contact URL, scans one
page at a time per domain with a configurable delay, and runs at night.
If you operate a site being scanned and want changes, open an issue.

## Honest limits

- Automated checkers find roughly 30–40% of WCAG barriers. A clean
  report is a floor, not a finish line. Manual testing with assistive
  technology remains essential. Testing with users with disabilities throughout the design stage. Using a well supported design system is key to learning from past mistakes.
- Byte counts are decoded body sizes seen by the browser, not on-wire
  transfer sizes. They are consistent week over week, which is what the
  trend needs.
- Technology detection (Wappalyzer) fingerprints client-side signals and
  is not authoritative; confidence scores reflect this.

## Commitments

This project follows public commitments to
[accessibility](ACCESSIBILITY.md) and
[sustainability](SUSTAINABILITY.md), and aims to advance the
[W3C Web Sustainability Guidelines](https://w3c.github.io/sustainableweb-wsg/).
The reports themselves are part of the argument: semantic HTML, no
web fonts, ~2 KB of CSS, dark mode respected. They work fully without
JavaScript — every chart renders as a static SVG with a data-table
fallback. Where JavaScript is available, charts are progressively
enhanced into interactive, keyboard- and screen-reader-navigable
[ParaCharts](https://github.com/fizzstudio/ParaCharts), vendored and
served first-party (no CDN).

## License

AGPL-3.0. Vendored third-party components: the
[HTTPArchive/wappalyzer](https://github.com/HTTPArchive/wappalyzer)
fingerprint database (GPL-3.0, `vendor/wappalyzer/`, refreshed via
`scripts/update-wappalyzer.sh`) and the
[ParaCharts](https://github.com/fizzstudio/ParaCharts) accessible-charts
runtime (AGPL-3.0, `vendor/paracharts/`, refreshed via
`scripts/update-paracharts.sh`).
