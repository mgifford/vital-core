# Plan: PDF accessibility checks for linked PDFs

Mission `pdf-accessibility-01M65X0Y`. Scaffolded with `spec-kitty specify`
3.2.7 on `claude/vigilant-shannon-79oda8` (single-branch topology); the
spec is in `spec.md`.

## Summary

A separate daily workflow takes each enabled site's own-domain PDFs from
`resources.json`, fetches the next 25 that need a check, runs pdf-crawler's
checks on them from a pinned commit, and keeps a compact result per PDF in
`data/<domain>/pdf-audit.json`. The report build renders a PDFs page per
domain from that ledger.

## Technical context

- **Engine.** pdf-crawler (Python, pikepdf) gains `scripts/analyse_files.py`
  ([pdf-crawler#296](https://github.com/mgifford/pdf-crawler/pull/296)): a
  JSON list of files in, one result per file out, with its per-file process
  timeout. The workflow checks pdf-crawler out at a pinned commit
  (`PDF_CRAWLER_REF`) and installs it with `uv sync --frozen --no-dev`, only
  when something is queued. Pinning keeps a pdf-crawler change from altering
  results unannounced; bumping the SHA is a reviewed change here.
- **Own domain.** `tldts-icann` `getDomain()` (already a dependency for the
  www check): `static.luton.gov.uk` and `www.luton.gov.uk` share
  `luton.gov.uk`; `assets.publishing.service.gov.uk` does not.
- **Why a separate workflow.** PDFs are found by the scan but listed in
  `resources.json` by the report build; checking them is heavier than a page
  audit, needs Python, and must not slow the nightly scan matrix.

## Charter check (sustainable-web-output)

- Nothing queued: the job stops after reading two JSON files per site.
- One download per PDF; rechecks every `recheck_days` use If-None-Match /
  If-Modified-Since, so an unchanged file costs a 304. An unchanged MD5 keeps
  its earlier result without analysis.
- Stored result per PDF is a compact subset (~0.5 KB), not the analyser's
  full output with its issue lists.
- The page is static HTML using the existing `SORT_SCRIPT`; no new
  client-side code, a few CSS lines at most.

## WP01: Settings, queue and ledger (FR-001, FR-002, FR-005, NFR-004)

- `src/lib/config.js`: `t.pdfAudit` from `defaults.pdf_audit` merged with
  the target's, validated (booleans, positive integers).
- `src/lib/pdf-audit.js` (pure):
  - `ownDomain(url, siteDomain)`: same registrable domain.
  - `pdfInventory(resources, siteDomain)`: own-domain PDFs and the other
    hosts with counts.
  - `pdfQueue(resources, ledger, siteDomain, { perRun, recheckDays, now })`:
    never checked (newest `firstSeen`, then `lastSeen`, then URL), retryable
    failures (in a later ISO week than the last attempt, under 3 attempts),
    then stale checks; capped.
  - `compactReport(report)`: checks as `pass` / `fail` / `null` plus pages,
    publication date, title, words, images, exempt flag.
  - `mergeResult(ledger, item, outcome, now)`: analysed, error, unchanged
    (304 or same MD5) keeps the earlier report and refreshes `checkedAt`.
  - `loadPdfLedger` / `savePdfLedger` (`writeLedgerIfChanged`).
- Tests: `tests/unit/pdf-audit.test.js`.

## WP02: Fetch and analyse (FR-003, FR-004, NFR-003)

- `scripts/pdf-audit.js`:
  - `plan --domain <d> --count <n> --out queue.json`: enabled targets, or
    one named target whatever its setting; refuses `hf_only` and unknown
    domains; prints whether anything is queued for the workflow.
  - `run --queue queue.json --checker <dir>`: per site, robots.txt once per
    host; `fetchPdf()` with manual redirects (own domain only, 5 hops),
    timeout, size cap while streaming, conditional headers, MD5; then one
    `analyse_files.py` call per site; merge; delete the downloads; a total
    time budget stops early and keeps what is done.
- Tests: `tests/unit/pdf-fetch.test.js` against a local HTTP server
  (redirects, off-site redirect, 304, oversize, HTML served as a PDF,
  robots.txt).

## WP03: Workflow (FR-006)

- `.github/workflows/pdf-audit.yml`: daily cron (22:41 UTC, off-hours in
  the UK and outside US morning peak), `workflow_dispatch` with `domain`
  and `count`; one job: sparse checkout, `npm ci`, data repo checkout with
  the deploy key, `check-data-push.sh`, plan; only if queued: pdf-crawler
  checkout at `PDF_CRAWLER_REF`, `setup-uv`, `uv sync`, run, commit and push
  with the scan workflow's rebase-and-retry.

## WP04: PDFs page (FR-007, NFR-001, NFR-002)

- `src/report-html.js`: `PAGES.pdfs = 'pdfs'`, subnav item under
  "Accessible?", `renderPdfsPage(target, summary, pdfs, csvHref)`: summary
  tiles, checked table, could-not-check table, other hosts, empty states
  (checks off; none yet).
- `src/aggregate.js`: build the view from `resources.json` and
  `pdf-audit.json` (`pdfReportView()`), write `pdfs.html` for every week and
  `pdfs.csv` for the latest.
- i18n template, unit tests, e2e (`SUBPAGES`, page written).

## WP05: Docs

- `config/targets.yml` (setting), `CLAUDE.md` (a "PDF checks" section),
  `README.md` (workflow list), `ARCHITECTURE.md` if it lists workflows.
