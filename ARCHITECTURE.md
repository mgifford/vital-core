# Architecture & infrastructure

A short guide to how vital-core actually works under the hood — how it
crawls, where data lives, and how the pipeline runs. For the *what* (the
features and engines), see [FEATURES.md](FEATURES.md); for contributor
conventions, [AGENTS.md](AGENTS.md).

## The one big idea

**There is no server and no database.** Everything runs on scheduled
GitHub Actions, and **files are the only persistent state**:

- Raw scan data is committed to the repo under `data/`.
- Crawl progress lives under `state/`. It is **not** committed: in CI it
  is kept as one gzip asset per domain on the rolling `scan-state` GitHub
  Release; locally it is a plain directory. See "Crawl state storage" below.
- The published website is a **pure function** of `data/` — regenerated
  from scratch each run, never hand-edited, never committed (it ships
  straight to GitHub Pages as a build artifact).

The second rule is: **collect once, use many times**.

Scanning is expensive; analysis is cheap. VITAL-Core collects each quality
signal once, stores it as canonical evidence, and reuses that evidence in
reports, APIs, CSV exports, dashboards, AI summaries, and historical
analysis.

Every quality signal should have exactly one canonical producer. Reports
may summarize, correlate, visualize, or aggregate evidence, but they
should not independently collect the same evidence again.

This means anyone can clone the repo and reproduce every number, and the
whole history of every site is in git.

## How crawling works

Crawling is **incremental and polite**, spread across the week rather
than done in one big sweep. One run handles one domain:

1. **Seeding** (first run only, when `state/<domain>/crawl.json` is
   empty): the crawler reads the site's **`sitemap.xml`**
   (`src/lib/sitemap.js`) — following one level of sitemap-index nesting,
   capped at 20,000 URLs — **and** always adds the **homepage** as a
   seed. If there is no sitemap (or it can't be fetched), seeding falls
   back to just the homepage; link discovery in step 5 takes it from
   there. Sitemap and crawling are **complementary, not either/or** —
   the sitemap gives a fast, broad starting set, and link discovery runs
   on every page regardless of whether a sitemap was found.
2. **Priority URLs** (re-applied every run): URLs listed in a target's
   `priority_urls` / `priority_urls_file` (e.g. top-task pages) are
   always queued first, before the rest of the site.
3. **Batch selection** (`src/lib/state.js` → `pickBatch`): each run
   scans up to `pages_per_run` pages (default 150) that have **not yet
  been scanned this ISO week**, never-scanned pages first. Pages with a
  completed outcome are not scanned more than once per week; timeout/
  error pages are retried in-week (up to 3 failed attempts) so transient
  failures can recover. Selection within a week is deterministic, so
  runs are replayable.
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

Two data directories, plus one generated one. None is tracked in this
repo: `data/` is a checkout of the data repo (`data_repo` in
`config/targets.yml`, default `mgifford/vital-core-data`), `state/` lives on
the `scan-state` release, and `docs/` is built at deploy time.

```
data/<domain>/                      ← raw scan data, committed to the data repo
  <ISO-week>/                       e.g. 2026-W25
    pages/<pageId>.json             one record per scanned page (the audit results)
    runs/<timestamp>.json           per-run log (what was scanned, broken links, tally)
    summary.json                    the weekly rollup (committed; survives pruning)
  findings.json                     ledger: every unique finding, first/last seen
  resources.json                    ledger: PDFs/docs/media inventory over time
  broken-links.json                 ledger: broken links + how long they've been broken
  third-parties.json                ledger: third-party vendors first/last seen
  inventory.json                    last-known status of every URL ever scanned

state/<domain>/                     ← NOT committed (gitignored)
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

**Retention contract:** summaries and ledgers are kept forever; page-level
detail under `pages/` and `runs/` is pruned after `retention_weeks`
(set to 2 in `config/targets.yml`; `src/prune.js` falls back to 3 if
unset) — this is an
insight-delivery system, not an archive, so raw per-page detail that a
newer scan supersedes is aggressively forgotten once it's rolled up into
`summary.json` and the ledgers. Consumers (`aggregate.js`, CSV exports,
`url-index.js`) all check `fs.existsSync` before reading `pages/`, so a
pruned week degrades gracefully rather than erroring.

**Git history policy:** `prune.js` deletes files from the working tree,
but git history keeps every blob forever — deleting a file from a later
commit does not shrink any earlier commit that still contains it, so the
repo's `.git` size never decreases on its own; it can only grow slower.

The 1 GB server-side size trigger (decided 2026-07-03) fired 2026-07-14.
Investigation found the growth was **not** primarily page-level detail
(that's correctly bounded by `retention_weeks`, ~10% of history size) —
it was `aggregate.js` and the ledger modules (`inventory.js`,
`findings.js`, `resource-ledger.js`, `third-party-ledger.js`,
`link-ledger.js`) unconditionally rewriting and re-committing their
output on every run, even when the underlying content hadn't changed
(each write stamped a fresh timestamp, which alone made git see the file
as "different"). `inventory.json` was the worst offender: it kept a full
row for every page ever scanned, clean or not, refreshed every run.

Fixed 2026-07-14 (PR #235), root cause first rather than reaching for the
companion-repo split:
- `inventory.js` only keeps a full row for pages with **current** known
  issues (the actual repro evidence); a fixed page gets a small
  `fixed[url]: { fixedAsOf }` marker; a page that's always been clean is
  folded into an approximate `cleanCount` (not stored per-URL — that would
  reproduce the same problem at smaller scale).
- `aggregate.js` recomputes every retained week's `summary.json` on every
  run (not just the current week); it now skips the write when the
  content — ignoring `generatedAt` — is unchanged from what's on disk.
- All ledger `save*()` functions now go through a shared
  `writeLedgerIfChanged()` helper (`src/lib/fs-utils.js`) that compares
  against the on-disk content (ignoring `updatedAt`) and skips the write
  (and the timestamp bump) when nothing real changed.

PR #235 does not by itself shrink the ~1.9 GB already in history — it
only fixes the *growth rate*: reruns with no new scan data now produce a
near-empty diff, instead of rewriting every domain's ledgers and every
retained week's summary daily regardless of content.

**One-time history rewrite (2026-07-14):** with the growth-rate fix
landed, the owner authorized (charter `historical-evidence-preservation`
exception) a one-time `git filter-repo` rewrite of `main` to remove the
already-committed churn rather than executing the `git-history-companion-
repo` mission's companion-repo split. Analysis (`git filter-repo
--analyze`) confirmed the bloat was near-duplicate blob versions of a
small set of frequently-rewritten paths — `data/<domain>/inventory.json`,
`data/<domain>/resources.json`, `data/<domain>/<week>/summary.json`, and
`state/<domain>/crawl.json` — not stale old week-directories (only 6 weeks
of directory names ever existed in history at all, consistent with
`retention_weeks` already bounding page-level detail).

The rewrite ran `git filter-repo --path data/ --path state/
--invert-paths` to strip every historical version of those two
directories from every commit, then re-added the current `data/` and
`state/` content as a single fresh commit on top — so the resulting
working tree is byte-identical to pre-rewrite `main` (verified by
comparing `HEAD^{tree}` hashes) while history no longer carries the
superseded versions. `.git` dropped from 1.8 GB to 128 MB; commit count
dropped from 2075 to 800 (purely-`data/`/`state/` scan-bot commits that
became empty were pruned). `npm run test:unit` and `npm run test:e2e`
were run against the rewritten repo and matched the original exactly
before the force-push.

This was a one-time exception. Any further history rewrite, squash, or
force-push to `main` requires a new explicit owner override given in
that session's chat — see the charter's `historical-evidence-preservation`
directive.

**Regrowth (2026-07 to 2026-10):** after the rewrite, `.git` grew back
from 128 MB to 2.4 GB in three months. Measured 2026-10-13, about
1,449 MB of the pack was `state/<domain>/crawl.json`: 1,101 commits in 30
days, files up to 57 MB, each written as a single line of JSON, so git
could not delta them well. The July rewrite had stripped old versions of
crawl state but kept committing new ones.

**Crawl state storage (since 2026-10):** `state/` is gitignored. In CI,
each domain's `crawl.json` is stored as `<domain-key>.crawl.json.gz` on one
rolling prerelease tagged `scan-state`, through `scripts/state-release.js`:

- the `scan.yml` matrix job downloads every asset (`download-all`) so
  `list-scan-domains.js` can check weekly budgets;
- each scan job restores only its own domain's asset before `scan.js` and
  uploads it with `--clobber` afterwards, so jobs stay isolated per domain;
- a missing asset means "seed fresh" (the existing "state lost" path). Any
  other download error fails the job, and the upload step is skipped, so a
  transient API error can never overwrite good state with a fresh seed;
- `hf_only` (VA) targets are never uploaded: the matrix filter excludes
  them and the script refuses them.

Release assets have no history, which is intended: crawl state is
disposable. Locally nothing changes: `src/lib/state.js` reads and writes
`state/<key>/crawl.json` on disk and knows nothing about releases.

**Second history rewrite (2026-10-13):** with the owner's explicit approval
in chat (charter `historical-evidence-preservation` exception, given twice:
once for the rewrite, once for the force-push), `main` was rewritten with
`git filter-repo --path state/ --invert-paths` to drop every historical
version of `state/<domain>/crawl.json`. `git filter-repo --analyze` put
`state/` at 1,530 MB packed of 2,500 MB. Results:

- pack size 2.36 GiB -> 969.5 MiB;
- `HEAD^{tree}` unchanged (`681a6bf5`), since `state/` was already untracked;
- commit count unchanged at 4,225 (every `state/` commit also touched `data/`,
  so none became empty);
- `npm run test:unit` (527 pass) and `npm run test:e2e` passed on the
  rewritten `main` before the push;
- `main` (`80a7d3c1` -> `7c3c0676`) and the `scan-state` release tag
  (`edaf70bf` -> `2dc507ae`) were pushed with `--force-with-lease`. The tag
  had to move too, or it would have kept the old history alive. The release
  and its assets are unaffected.

`scan.yml` and `report.yml` were disabled for the duration. Commit SHAs
from before the rewrite no longer resolve on `main`; local clones must
re-clone or reset to `origin/main`. GitHub's reported size lags until it
garbage-collects server-side. The remaining ~970 MB is mostly `data/`
(`inventory.json`, `resources.json`, weekly `summary.json` churn).

Any further rewrite still needs a new explicit owner override (see above).

**Data repo (since 2026-10-14):** `data/` moved to its own repository, so
cloning or checking out this repo gets code only (~8 MB of files at the tip,
against ~1,455 MB for `data/`). This is the companion-repo split the
`git-history-companion-repo` mission scoped in July.

- `data_repo` in `config/targets.yml` (default `mgifford/vital-core-data`)
  names it; a target may override it. `ciDataRepo()` refuses a split across
  repos for non-`hf_only` targets until the workflows support several, and
  `hf_only` targets may not set it at all.
- The data repo was created with `git filter-repo --subdirectory-filter
  data/`, so it keeps the full history of `data/`, plus its own `.gitignore`
  for the VA domains.
- `scan.yml` checks out only `<domain>/` of the data repo into `data/`;
  `report.yml` checks out all of it. Both push with the write-enabled
  deploy key whose private half is the `VITAL_DATA_DEPLOY_KEY` secret.
- The size markers (`.repo-size-kb`, `.repo-size-history`,
  `.last-report-date`) live at the data repo root; the gate job reads them
  through the API instead of checking out the data.

**Third history rewrite: `data/` purge (2026-10-14):** with the data safe in
the data repo (full history), the owner approved in chat, once for the
rewrite and once for the force-push, removing `data/` from this repo's
history with `git filter-repo --path data/ --invert-paths`:

- pack size 970 MiB -> 4.7 MiB; a fresh clone is ~5 MB of `.git` plus
  ~9 MB of files;
- `HEAD^{tree}` unchanged (`b8b31def`), since `data/` was already untracked;
- commits 4,239 -> 915: the data-only scan and report commits became empty
  and were pruned (they live on in the data repo);
- `npm run test:unit` (533 pass) and `npm run test:e2e` passed on the
  rewritten `main` before the push;
- `main` (`524d236f` -> `363c659c`) and the `scan-state` tag (`2dc507ae` ->
  `963095cf`, now the merge of #267, since its old commit was data-only)
  were pushed with `--force-with-lease`, workflows paused for the duration.

`CODE_CEILING_MB` dropped to 100. GitHub's reported size lags until it
garbage-collects, so that warning can fire for a few days after the purge.
Any further rewrite still needs a new explicit owner override.

**Alerting:** the `report.yml` gate job checks the server-reported size of
the data repo three ways (this repo only gets an absolute
`CODE_CEILING_MB`):

- run-over-run (`data/.repo-size-kb`): warns on more than ~50 MB of growth
  between two report runs;
- weekly (`data/.repo-size-history`, a rolling list of the last 60 daily
  sizes): warns on more than 100 MB of growth over about 7 days. This
  catches the steady ~25 MB/day pattern that the run-over-run check
  missed;
- absolute ceiling: warns above 1,300 MB, about 330 MB over the size after
  the 2026-10-13 rewrite (~970 MB). It may warn for a few days after a
  rewrite until GitHub's reported size catches up. Lower it after any
  future history rewrite.


Crawler
↓
Evidence producers
↓
Canonical evidence
↓
Aggregation
↓
Consumers
• Reports
• API
• CSV
• AI summaries
• History
• URL lookup



## Per-domain configuration (institutional tuning)

Every site is configured in **one file**, `config/targets.yml`. There's a
`defaults:` block, a global `sampling:` block, and a list of `targets:`.
Each target is just a `domain:` line plus optional per-domain overrides,
so an institution can tune how its own sites are scanned without touching
code. All options are optional; a bare `- domain: example.gov` works.

```yaml
targets:
  - domain: www.cms.gov
    importance: 5
    priority_urls_file: profiles/www.cms.gov-top-tasks.txt
    spelling_allowlist: ["Medicaid", "FMAP", "CHIPRA"]
  - domain: data.cms.gov
    importance: 3            # open-data site; scanned less heavily
    url_exclude: ["?page=", "/api/"]
```

The per-domain options:

- **`importance:` (1–5, default 3)** — scales the weekly page budget
  (`max_pages_per_week`). 5 = scan more of this site; 1 = a fraction
  (good for large, template-similar open-data sites where a sample is
  representative).

- **Top-task pages** — `priority_urls_file:` points at a text file of the
  site's most important URLs (one per line, `#` comments allowed; this is
  the output format of the `top-task-finder` tool). Relative paths
  resolve under `config/` (e.g. `profiles/x.txt` → `config/profiles/x.txt`).
  `priority_urls:` is an inline list for a handful of URLs. **Priority
  URLs are covered first every week, before the rest of the site is
  sampled, and bypass the include/exclude filters** — so an agency's
  top-task pages are always audited even if the broader crawl is scoped
  down. (No URL is scanned more than once per ISO week regardless.)

- **`url_include:` / `url_exclude:`** — pattern filters on the full URL.
  Each pattern is a substring, or a `/regex/` when wrapped in slashes
  (optional trailing flags, e.g. `/\/\d{4}\/\d{2}\//` for dated archives).
  `url_include` restricts the scan to matching URLs only (focus on a
  subtree or topic, e.g. `["/children/"]`); `url_exclude` drops noisy or
  off-limits paths (e.g. `["/news/", "?page="]`). Long lists can be kept in
  a file via **`url_include_file:` / `url_exclude_file:`** (one pattern per
  line, `#` comments allowed; relative paths resolve under `config/` like
  `priority_urls_file`) and are merged with the inline arrays. Applied
  during both crawl and scan. Priority URLs always bypass both.

- **`spelling_allowlist:`** — domain-specific terms (program names,
  medical jargon, agency acronyms) the spell checker should accept,
  layered on top of the project-wide `config/spelling-allowlist.txt`.

- **`spelling_locale:`** — which English the spell checker accepts:
  `en-US` (default), `en-GB`, `en-CA` or `en-AU`, set in `defaults:` or
  per target. Only that dictionary is loaded during a scan. Each
  plain-language record stores the locale it used, and the readability
  page names it, so a switch shows up as a labelled step in the trend.

- **`sampling:`** — a target may override any per-engine coverage rate
  from the global `sampling:` block (e.g. run Lighthouse on more or fewer
  of one site's pages).

This is the institutional configuration surface: which sites, how heavily
each is scanned, which pages matter most, what to include or exclude, and
domain-specific vocabulary — all declarative, all in `targets.yml`.

## The pipeline

Two GitHub Actions workflows, no server:

```
scan.yml      (several scheduled runs per night, off-peak, one job per domain)
  └─ src/scan.js   crawl a batch, run engines, commit data/,
                   upload state/ to the scan-state release

report.yml    (after the night's scans complete)
  ├─ src/aggregate.js   read data/ → write summaries + docs/
  ├─ src/prune.js       drop page detail older than retention_weeks
  ├─ commit summaries back into data/
  └─ deploy docs/ to GitHub Pages

pdf-audit.yml (daily for sites with pdf_audit enabled; manual for one site)
  └─ scripts/pdf-audit.js   queue PDFs from data/<domain>/resources.json,
                            download them, check them with pdf-crawler,
                            commit data/<domain>/pdf-audit.json
```

The scan pipeline is responsible for **collecting evidence**.

The aggregation pipeline is responsible for **transforming evidence into reusable products**.

No report should perform its own scanning or independent measurements. Reports consume aggregated evidence rather than generating it.

- **`scan.yml`** runs on a staggered set of off-hours cron schedules,
  one parallel job per domain. Each job scans its budget, commits only
  its own `data/<domain>/` files and uploads only its own crawl-state
  asset, so parallel jobs never collide. Pushes rebase-and-retry to absorb races.
- **`report.yml`** is triggered when the scan workflow finishes (so the
  published site always reflects the freshest data), and publishes at
  most once per day. It aggregates, prunes, commits the regenerated
  summaries, and deploys `docs/` to Pages. The generated HTML is **never
  committed** — it's rebuilt every time from `data/`.

## Temporary dependency overrides

Each entry in `package.json` `overrides` that works around an upstream
package is a temporary divergence and is recorded here.

**`simple-git` `^4.0.2`** (added 2026-10-13)

- Why: `@siteimprove/alfa-test-utils` 0.84.x pins `simple-git ^3.36.0`,
  which pulls in `simple-git` <4.0.1 and `@simple-git/argv-parser` <2.0.1
  (Dependabot alerts #63 to #66, two critical, two high). Real exposure is
  low: alfa-test-utils only calls `getRemotes`, `branchLocal` and `log` in
  its Siteimprove-upload path, which vital-core does not use. Those three
  calls work unchanged in simple-git 4.
- Downstream owner: Mike Gifford
- Upstream reference: pending PR to Siteimprove/alfa-integrations (bump
  alfa-test-utils to simple-git 4); not yet opened
- Review date: 2026-11-13
- Removal condition: an alfa-test-utils release that depends on simple-git 4
  is adopted here, Dependabot alerts #63 to #66 stay closed, and a scan with
  the Alfa engine is retested
- Rollback: remove the override and run `npm install`; the alerts reopen but
  scanning is unaffected

simple-git 4 and alfa-test-utils both require Node >=22, which is why
`engines.node` is `>=22`.

## Common questions

- **"Is there a database?"** No. The repo *is* the database; everything
  is JSON files in git.
- **"How do you avoid overloading a site?"** Small per-run budgets,
  `robots.txt` + crawl-delay, a 1.5s inter-page delay, off-hours
  scheduling, and weekly caps. A site sees a few hundred slow page loads
  spread across a week.
- **"Can I reproduce the reports?"** Yes — `node src/aggregate.js`
  regenerates all of `docs/` from `data/`. Reports are a pure function of 
  collected evidence. Reports never perform their own scans. They consume
  the committed evidence collected during the scan pipeline, ensuring every
  quality signal has a single canonical source.
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
