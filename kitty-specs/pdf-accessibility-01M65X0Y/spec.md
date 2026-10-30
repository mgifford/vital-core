# Mission Specification: PDF accessibility checks for linked PDFs

**Mission Branch**: `claude/vigilant-shannon-79oda8`
**Created**: 2026-10-30
**Status**: Implemented; SC-001 and SC-002 wait on the first real runs after merge
**Input**: The maintainer, 2026-10-30: "Is it possible to run the PDF
accessibility scanner on new PDFs both on cron and on a manual GitHub
Actions … part of that could be run separately on the identified PDFs so
that it is clear that the pdf files that are linked to are meeting basic
accessibility guidance. The reports should look like" the
[pdf-crawler reports](https://mgifford.github.io/pdf-crawler/reports/2026-06-30_13-21-31-712_minneapolis.edu.html).
Decisions, same day: check only PDFs on the site's own domain; a
`pdf_audit` setting, off in the template and on in vital-core-lgd; a daily
run of 25 PDFs per site; a manual run that checks the latest 25 unchecked
PDFs of one site even where the setting is off.

## Background

The scans already list every PDF a site links to, with the pages that link
to it (`data/<domain>/resources.json`): 719 across the five LocalGov Drupal
councils, about 168,000 across the CMS sites. Nothing checks them. The
[pdf-crawler](https://github.com/mgifford/pdf-crawler) project checks PDFs
for tagging, title, language, bookmarks, alt text, headings, lists, tables
and forms (WCAG / PDF/UA techniques), but only on PDFs it crawls itself.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See whether a site's linked PDFs pass basic checks (Priority: P1)

A report reader opens a site's PDFs page and sees how many of the site's
PDFs were checked, how many pass and how many have problems, then a table
of each PDF with every check as text, the page that links to it, and when
it was checked.

**Acceptance Scenarios**:

1. ✓ **Given** a site with checked PDFs, **When** the report is built,
   **Then** its PDFs page lists each one with its checks (pass, fail or not
   applicable, as text), pages, publication date and a link to a page that
   links to it, with summary counts above the table.
2. ✓ **Given** PDFs that could not be checked, **When** the report is built,
   **Then** they are listed separately with the reason in words (HTTP
   status, too large, not a PDF, robots.txt, timeout, redirected off-site).
3. ✓ **Given** PDFs on other organisations' hosts, **When** the report is
   built, **Then** the page says how many were not checked and on which
   hosts, and does not download them.
4. ✓ **Given** a site with PDF checks off, **When** the report is built,
   **Then** the page says so and how to run a check, rather than looking
   empty.

### User Story 2 - New PDFs are checked without anyone asking (Priority: P1)

**Acceptance Scenarios**:

1. ✓ **Given** sites with `pdf_audit` enabled, **When** the daily workflow
   runs, **Then** it checks up to 25 of each site's PDFs that have not been
   checked, newest first, and commits the results to the data repo.
2. ✓ **Given** no PDF is waiting, **When** the daily workflow runs, **Then**
   it stops before installing the checker or fetching anything.
3. ✓ **Given** a checked PDF that has not changed, **When** it comes up for a
   recheck, **Then** a conditional request (ETag / Last-Modified) avoids
   downloading it again, and it is not analysed again.

### User Story 3 - Check one site on demand (Priority: P2)

**Acceptance Scenarios**:

1. ✓ **Given** any configured site that is not `hf_only`, **When** someone
   runs the workflow manually with that domain, **Then** it checks the
   latest 25 PDFs not yet checked (or the count given), whether or not
   `pdf_audit` is enabled for it.
2. ✓ **Given** an `hf_only` or unknown domain, **When** it is requested,
   **Then** the run refuses before fetching anything.

### Edge Cases

- A PDF URL that redirects to another host is not followed off-site.
- A response that is an HTML page (a firewall challenge, a login page, a
  404 page served as 200) is "not a PDF", never analysed as one.
- A PDF that fails is retried in a later week, at most three times.
- robots.txt rules for the scanner's user agent apply to PDFs too.

## Requirements *(mandatory)*

### Functional Requirements

| ID | Requirement |
|---|---|
| FR-001 ✓ | A `pdf_audit` setting (global `defaults` or per target) with `enabled` (default false), `per_run` (default 25), `max_file_mb` (default 25), `per_file_timeout` (default 120 s) and `recheck_days` (default 90), validated at config load. |
| FR-002 ✓ | The queue for a site is its PDFs (from `resources.json`) whose host shares the site's registrable domain: first those never checked, newest `firstSeen` first; then failures due for a retry; then checked PDFs older than `recheck_days`; capped at `per_run`. |
| FR-003 ✓ | Each queued PDF is fetched with the target's user agent and politeness delay, honouring robots.txt, following redirects only within the registrable domain, with a size cap, a timeout and a conditional request when an ETag or Last-Modified is known. |
| FR-004 ✓ | Downloaded files are analysed by pdf-crawler's `scripts/analyse_files.py` from a pinned commit; the downloads are deleted afterwards. |
| FR-005 ✓ | Results are kept per site in `data/<domain>/pdf-audit.json`, keyed by URL: status, checked time, attempts, MD5, size, ETag / Last-Modified, the checks as pass / fail / not applicable, page count, publication date, document title, and any errors. A file whose MD5 has not changed keeps its earlier result. |
| FR-006 ✓ | A `pdf-audit` workflow runs daily for enabled sites and on manual dispatch for one named site and count; it refuses `hf_only` targets; `scripts/check-data-push.sh` runs before anything is fetched; it pushes once, with the scan workflow's rebase-and-retry. |
| FR-007 ✓ | Each domain report gets a PDFs page under "Accessible?" in the subnav, written for every week, with the summary, the checked PDFs table, the PDFs that could not be checked and why, the PDFs on other hosts, and a CSV download. |

### Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-001 ✓ | **Sustainability:** a run with nothing queued fetches nothing and installs nothing. Each PDF is downloaded once and re-validated with a conditional request at most every `recheck_days`. Results are stored as a compact subset, not the full analyser output. The page is static HTML with the existing sortable-table script; no new client-side JavaScript, CSS stays within the existing budget. |
| NFR-002 ✓ | **Accessibility:** results are text (Pass / Fail / Not applicable), never colour or emoji alone; tables have captions and header cells; the page says automated checks find some problems but a pass does not prove a PDF is accessible. |
| NFR-003 ✓ | **Security:** `hf_only` targets are refused by the workflow and by the script; only result fields are committed, never the PDFs or response bodies. |
| NFR-004 ✓ | Queue selection, ledger merging, URL eligibility and rendering have unit tests with real module APIs; download behaviour is tested against a local HTTP server. |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After the first daily runs in vital-core-lgd, Walsall's,
  Hackney's and Luton's PDFs pages list checked PDFs, and the backlog of
  about 700 own-domain PDFs clears in about ten days.
- **SC-002**: A manual run for `www.cms.gov` checks 25 PDFs and its PDFs
  page shows them, with `pdf_audit` still off for the CMS fleet.
