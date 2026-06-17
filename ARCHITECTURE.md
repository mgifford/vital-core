# Architecture & infrastructure

A short guide to how vital-core actually works under the hood — how it
crawls, where data lives, and how the pipeline runs. For the *what* (the
features and engines), see [FEATURES.md](FEATURES.md); for contributor
conventions, [AGENTS.md](AGENTS.md).

## The one big idea

**There is no server and no database.** Everything runs on scheduled
GitHub Actions, and **files are the only state**:

- Raw scan data is committed to the repo under `data/`.
- Crawl progress is committed under `state/`.
- The published website is a **pure function** of `data/` — regenerated
  from scratch each run, never hand-edited, never committed (it ships
  straight to GitHub Pages as a build artifact).

This means anyone can clone the repo and reproduce every number, and the
whole history of every site is in git.

## How crawling works

Crawling is **incremental and polite**, spread across the week rather
than done in one big sweep. One run handles one domain:

1. **Seeding** (first run only, when `state/<domain>/crawl.json` is
   empty): the crawler reads the site's **`sitemap.xml`**
   (`src/lib/sitemap.js`) and the homepage to get an initial set of
   URLs.
2. **Priority URLs** (re-applied every run): URLs listed in a target's
   `priority_urls` / `priority_urls_file` (e.g. top-task pages) are
   always queued first, before the rest of the site.
3. **Batch selection** (`src/lib/state.js` → `pickBatch`): each run
   scans up to `pages_per_run` pages (default 150) that have **not yet
   been scanned this ISO week**, never-scanned pages first. No page is
   scanned more than once per week. Selection within a week is
   deterministic, so runs are replayable.
4. **Scanning**: each page is loaded in a real browser (Playwright /
   headless Chromium), the engines run on it (see FEATURES.md), and one
   JSON record is written per page.
5. **Discovery**: while on a page, same-site links are extracted
   (normalized via `src/lib/urls.js`, depth-capped at `max_crawl_depth`,
   default 6) and added to the crawl state for future runs. "Same site"
   treats the apex domain and its `www.` variant as one host; other
   subdomains are separate targets.

**Politeness and rules we respect:**

- **`robots.txt`** is fetched and obeyed (`src/lib/robots.js`),
  including any `Crawl-delay`.
- A configurable `delay_ms` (default 1.5s) pauses between page loads.
- A real, identifiable **User-Agent** is sent (set per target).
- Weekly volume is capped per domain (`max_pages_per_week`).
- Non-HTML resources (PDFs, binaries) are detected by a cheap `HEAD`
  check and skipped rather than downloaded.

Because coverage accumulates across the week, a large site is sampled a
few hundred pages at a time over many short, low-impact runs instead of
hammered all at once.

### Sampling

Most engines don't run on every page — each has a **weekly coverage
rate** in `config/targets.yml` (e.g. `axe: 100`, `lighthouse: 10`).
Whether a given engine runs on a given page is a **deterministic hash**
of `pageId + engine + week` (`src/lib/sampling.js`), so coverage is
reproducible and a page tends to stay in or out of an engine's sample
for the whole week.

## Where data is stored

Two committed directories, plus one generated (uncommitted) one.

```
data/<domain>/                      ← committed raw scan data
  <ISO-week>/                       e.g. 2026-W25
    pages/<pageId>.json             one record per scanned page (the audit results)
    runs/<timestamp>.json           per-run log (what was scanned, broken links, tally)
    summary.json                    the weekly rollup (committed; survives pruning)
  findings.json                     ledger: every unique finding, first/last seen
  resources.json                    ledger: PDFs/docs/media inventory over time
  broken-links.json                 ledger: broken links + how long they've been broken
  third-parties.json                ledger: third-party vendors first/last seen
  inventory.json                    last-known status of every URL ever scanned

state/<domain>/
  crawl.json                        the crawl frontier: every known URL with
                                    depth, last-scanned week, status, fail count

docs/                               ← GENERATED, not committed
  index.html                        the dashboard
  reports/<domain>/<ISO-week>/...   the per-domain weekly reports + CSV/JSON downloads
  data/<domain>/{weekly,domain}.json machine-readable exports
```

**ISO weeks are the unit of comparison.** Pages scanned in the same
week belong to one dataset; week-over-week change is the primary signal.
`summary.json` files are committed and kept **forever**, so trend graphs
never break — even after the raw per-page detail is pruned.

**Ledgers** (`findings.json`, `resources.json`, etc.) are committed JSON
files that accumulate across the whole life of a site, so they survive
page-detail pruning and answer "when did this first appear?".

**Retention:** per-page detail under `pages/` is pruned after
`retention_weeks` (default 8) by `src/prune.js`; the weekly summaries and
ledgers are kept indefinitely.

## The pipeline

Two GitHub Actions workflows, no server:

```
scan.yml      (several scheduled runs per night, off-peak, one job per domain)
  └─ src/scan.js   crawl a batch, run engines, commit data/ + state/

report.yml    (after the night's scans complete)
  ├─ src/aggregate.js   read data/ → write summaries + docs/
  ├─ src/prune.js       drop page detail older than retention_weeks
  ├─ commit summaries back into data/
  └─ deploy docs/ to GitHub Pages
```

- **`scan.yml`** runs on a staggered set of off-hours cron schedules,
  one parallel job per domain. Each job scans its budget and commits
  only its own `data/<domain>/` and `state/<domain>/` files, so parallel
  jobs never collide. Pushes rebase-and-retry to absorb races.
- **`report.yml`** is triggered when the scan workflow finishes (so the
  published site always reflects the freshest data), and publishes at
  most once per day. It aggregates, prunes, commits the regenerated
  summaries, and deploys `docs/` to Pages. The generated HTML is **never
  committed** — it's rebuilt every time from `data/`.

## Common questions

- **"Is there a database?"** No. The repo *is* the database; everything
  is JSON files in git.
- **"How do you avoid overloading a site?"** Small per-run budgets,
  `robots.txt` + crawl-delay, a 1.5s inter-page delay, off-hours
  scheduling, and weekly caps. A site sees a few hundred slow page loads
  spread across a week.
- **"Can I reproduce the reports?"** Yes — `node src/aggregate.js`
  regenerates all of `docs/` from `data/`. Reports are a pure function
  of committed data.
- **"What if a scheduled run is skipped or a job times out?"** The next
  run picks up where the frontier left off; data is append-only and
  regenerable, so nothing is lost.
- **"Why are some report tabs empty some weeks?"** Sampling — a low-rate
  engine (e.g. Lighthouse) may not have run on any sampled page that
  week. The tab still exists with a "no data this week" note so
  navigation stays consistent.
- **"How are blocked sites handled?"** Sites behind a WAF that returns
  403 to the scanner record as *blocked* (no audit data) and are shown
  separately on the dashboard until the scanner's User-Agent is
  allowlisted — see [WAF-ALLOWLIST.md](WAF-ALLOWLIST.md).
