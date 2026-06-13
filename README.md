# VITAL Scans

An open source website quality engine. It crawls 5–20 domains slowly and
politely across each week, scans thousands of pages per domain with
[axe-core](https://github.com/dequelabs/axe-core) and
[Siteimprove Alfa](https://github.com/Siteimprove/alfa) (the open source
engine behind Siteimprove's commercial checker), measures page weight and
estimated energy costs, and publishes week-over-week reports to GitHub Pages. Everything runs on GitHub Actions. There is no server, no database, and no budget line.

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

## Commitments

This project follows public commitments to
[accessibility](ACCESSIBILITY.md) and
[sustainability](SUSTAINABILITY.md), and aims to advance the
[W3C Web Sustainability Guidelines](https://w3c.github.io/sustainableweb-wsg/).
The reports themselves are part of the argument: semantic HTML, no
JavaScript, no web fonts, ~2 KB of CSS, dark mode respected.

## License

AGPL.
