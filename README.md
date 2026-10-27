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
  file. Not committed: CI keeps it on the `scan-state` release (see
  ARCHITECTURE.md). If it is deleted, the crawler reseeds from the sitemap
  and no history is lost.
- `data/`: scan data. Not tracked in this repo: it is its own repo
  (`data_repo` in `config/targets.yml`, default
  [mgifford/vital-core-data](https://github.com/mgifford/vital-core-data)),
  checked out into `data/` by CI. Clone it there locally only when you need
  the data; the code runs and tests without it.
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

Hugging Face Spaces has been archived. It was a deployment target, not a second source branch:
it should receive a clean snapshot of the current site state on its own
`main` branch, with large `state/` crawl artifacts stripped out before
push.

### Setting up a new instance

An instance is two repositories: this code (the workflows, `config/`) and a
companion **data repository** that CI commits scan results to. Every step
below is needed; a missing one tends to fail quietly, late in a run.

1. **Create the code repo from the template, then join its history to
   upstream.** This repository is a GitHub template: choose **Use this
   template → Create a new repository**, leaving "Include all branches"
   unticked. GitHub starts the new repo with one "Initial commit" that
   copies these files but not their history, so `git merge upstream/main`
   can't work until the two histories are joined. Join them once, straight
   away. It changes no files:
   ```sh
   git clone git@github.com:<owner>/<name>.git
   cd <name>
   git remote add upstream https://github.com/mgifford/vital-core
   git fetch upstream main
   # The upstream commit that "Initial commit" was copied from:
   ROOT_TREE=$(git rev-parse "$(git rev-list --max-parents=0 HEAD)^{tree}")
   BASE=$(git log --format='%H %T' upstream/main | awk -v t="$ROOT_TREE" '$2 == t { print $1; exit }')
   if [ -n "$BASE" ]; then
     git merge -s ours --allow-unrelated-histories "$BASE" \
       -m "Record vital-core ${BASE:0:7} as upstream base"
     git push
   else
     echo "No upstream commit matches the initial commit." >&2
   fi
   ```
   If no commit matches, the first commit isn't an unchanged copy of an
   upstream commit, so don't guess one. Never run the `-s ours` merge
   against `upstream/main` itself: it records every upstream change made
   since the copy as merged without applying it.

   Instead of the template, you can clone this repository and push it to a
   new, empty repo (`git remote rename origin upstream`, then add your repo
   as `origin`). That keeps the shared history from the start, with no join
   step.

   A repo made from the template has the scheduled scan and report
   workflows switched on from its first commit, with this repo's targets in
   `config/targets.yml`. Until step 4 they stop at the push-access check
   without fetching any site, so finish step 3 before adding the key.
2. **Create the data repo:** a **public** repository such as `<name>-data`,
   with an initial commit (a README is enough). It must be public: the
   report's `gate` job reads its marker files with the workflow's own token.
3. **Edit `config/targets.yml`:**
   - list your domains and adjust budgets
   - set `data_repo:` to the data repo
   - point the `user_agent` contact URL at your repo
   - set `report_base_url:` to `https://<owner>.github.io/<name>`; CSV
     links, `llms.txt` and the API catalog are built from it
   - set `finding_policy.conformance` (the WCAG target) and, where a law
     sets a lower minimum, `legal_baseline` (for US federal sites, Section
     508: WCAG 2.0 AA). The shipped default is Section 508, so change or
     remove it for any other jurisdiction
   - cut `languages:` down to the ones your readers need. Every listed
     language is built and deployed on each report run, even with the
     switcher hidden

   Run `npm run test:unit` before pushing; it fails on a config that
   doesn't load.
4. **Add a deploy key so CI can push scan data:**
   - `ssh-keygen -t ed25519 -N "" -C "<name> Actions" -f data-key`
   - add `data-key.pub` to the **data repo** → Settings → Deploy keys, with
     **Allow write access** ticked
   - add the private `data-key` file, including its BEGIN/END lines, to the
     **code repo** → Settings → Secrets and variables → Actions, as the
     repository secret **`VITAL_DATA_DEPLOY_KEY`**
   - delete both local files

   Without the key, checkout quietly falls back to a read-only token. The
   "Check data repo push access" step now stops the run first, and its
   annotation names the cause.
5. **In the code repo's settings:**
   - **Pages:** set the source to **GitHub Actions**
   - **Actions → General:** allow workflows **read and write permissions**
   - **Issues:** keep them enabled; the report workflow posts a "Weekly
     scan reports" issue
6. **Run the first scan:** Actions → scan → Run workflow, with the domain
   left blank, a small budget (e.g. 10) and **Run report** ticked. Start one
   scan at a time: the `scan-global` concurrency group keeps only the
   newest waiting run and cancels the others.
7. **Check that it really worked.** A green run alone doesn't prove anything
   was scanned. Look for:
   - new commits in the data repo
   - the site at `https://<owner>.github.io/<name>/`
   - the "Weekly scan reports" issue

### Taking upstream updates

```sh
git fetch upstream main
git merge upstream/main
```

Conflicts should only appear in files you changed yourself. A fix that
reached both repos by copying rather than merging (for example, one you
made in your repo and then ported upstream) can conflict once. Take
upstream's version (`git checkout --theirs <file>`) unless you meant to keep
yours. For `package-lock.json`, take upstream's version, then run `npm ci`
to confirm it still matches `package.json`.

### Sending discoveries upstream

Keep a `docs-internal/UPSTREAM-SUGGESTIONS.md` in your repo for anything
every instance would want: an engine bug, a US-only assumption, a missing
setup step. vital-core never ships that file, so it never conflicts. Fix
those things in vital-core, on a branch from `upstream/main`, then merge
upstream into your repo. See CLAUDE.md, "Fleets made from this template".

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

Every deployed site also publishes `/llms.txt` (the
[llmstxt.org](https://llmstxt.org/) convention): a plain-text index pointing
an LLM or coding agent at the JSON API, `API.md`, and `MCP.md`, so the data
behind the HTML report is discoverable without already knowing this
repository exists.

## Local MCP server

`mcp/` is a local, read-only-by-default [Model Context Protocol](https://modelcontextprotocol.io/)
server that lets an MCP-compatible coding client (Claude Code, GitHub
Copilot, etc.) list and inspect findings from a Vital Core instance's JSON
API. It runs on your own machine over stdio — no network port, no local
repository access, no command execution. See [MCP.md](MCP.md) for setup,
`.vital.yml`, the available tools, and what's intentionally not implemented
yet.

A separate, opt-in [WebMCP](https://github.com/webmachinelearning/webmcp)
bridge registers the same read-only tools directly in a domain's report
pages, for an in-browser agent instead of a local coding client — see
[MCP.md#webmcp](MCP.md#webmcp).

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
