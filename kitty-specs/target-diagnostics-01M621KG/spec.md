# Mission Specification: Target diagnostics

**Mission Branch**: `claude/vigilant-shannon-79oda8`
**Created**: 2026-10-28
**Status**: Implemented; SC-001 met by the 2026-10-29 run (LBHF: AWS WAF challenge; Blackburn: no TCP connection)
**Input**: vital-core-lgd's first week. Two councils returned almost nothing:
`www.lbhf.gov.uk` answered the scanner with HTTP 202 and 404s, and
`www.blackburn.gov.uk` timed out on its homepage three times. The maintainer:
"Is it possible to get more information about why the pages are failing to
load? These are council websites which should have many more pages."

## Background

The scan records a status code or an error message per page, but not why a
site answered that way: no redirect chain, no response headers, no sign of
which firewall or CDN is in front of it, and no record of what a page was
still loading when it timed out. The development sandbox can't reach the
sites, and a person's own browser (an airport, an office network) isn't
the network the scans run from. So there is no way today to tell "the site
is blocking GitHub's runners" from "the target host is wrong" from "a
third-party script never finishes loading".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find out why a site won't load for the scanner (Priority: P1)

A fleet maintainer whose reports show 202s, 403s, 404s or timeouts runs one
manual workflow from the Actions tab and gets, for each domain, what the
scanner actually receives from GitHub's network, and a plain verdict.

**Why this priority**: without it every blocked site is guesswork, and an
allowlist request to a council needs evidence.

**Independent Test**: run the workflow for one domain and read the job
summary: each URL's redirect hops, status, timing and title, the protection
hints, and a verdict line.

**Acceptance Scenarios**:

1. ✓ **Given** a domain that redirects (apex to www, or to another subdomain),
   **When** the workflow runs, **Then** every hop is listed with its status
   and the final host, and a redirect to a different subdomain is called out.
2. ✓ **Given** a site behind a firewall that challenges the scanner, **When**
   the workflow runs, **Then** the response headers that identify the
   protection (for example `cf-mitigated`, `x-amzn-waf-action`, Imperva or
   F5 cookies) are named, by header or cookie name only.
3. ✓ **Given** a site that treats the scanner's user agent differently from a
   desktop browser's, **When** the workflow runs, **Then** both results are
   shown side by side and the difference is flagged.

### User Story 2 - See what a slow page is waiting for (Priority: P2)

For a homepage that times out, the maintainer sees how long a real browser
(the same Chromium and settings as the scan) took to reach
DOMContentLoaded and `load`, and which requests were still open.

**Why this priority**: a `load` that never fires is often one third-party
script, which a site owner can fix once they know which.

**Independent Test**: probe a slow homepage; the summary lists the open
requests by host and path when `load` didn't fire in time.

**Acceptance Scenarios**:

1. ✓ **Given** a homepage whose `load` event doesn't fire within the timeout,
   **When** the workflow runs, **Then** the DOMContentLoaded time and up to
   10 still-open requests (host and path, no query string) are listed.

### User Story 3 - Check what the crawler can discover (Priority: P3)

The maintainer sees whether `robots.txt` allows the scanner and how many
URLs the site's sitemap lists, to compare with what the scans found.

**Acceptance Scenarios**:

1. ✓ **Given** a domain, **When** the workflow runs, **Then** it reports
   `robots.txt` status, whether `/` is allowed for the scanner's user agent,
   the sitemaps it names, and the number of URLs in the first sitemap.

### Edge Cases

- **`hf_only` targets are refused**, by name or by host, with an error and no
  request sent, because those targets must never run in GitHub Actions.
- An invalid domain argument fails with a clear message before any request.
- With no domains given, every non-`hf_only` target in `config/targets.yml`
  is probed.
- A domain that isn't configured can still be probed, so a new site can be
  checked before it is added.
- Network errors (DNS, TLS, reset) are reported as such, not as timeouts.

## Requirements *(mandatory)*

### Functional Requirements

| ID | Requirement |
|---|---|
| FR-001 ✓ | A manual `diagnose` workflow takes an optional list of domains and runs on GitHub's runners. |
| FR-002 ✓ | For each domain it fetches the homepage, its apex/`www.` twin, `robots.txt` and the first sitemap, once with the configured scanner user agent and once with a desktop browser's. |
| FR-003 ✓ | Redirects are followed hop by hop; each hop records status, time and location. |
| FR-004 ✓ | A short list of identifying response headers and the names (never values) of cookies are kept; bodies are not stored beyond the page title. |
| FR-005 ✓ | Protection hints name the firewall or CDN where headers or cookie names identify it. |
| FR-006 ✓ | The homepage is loaded in Chromium with the scan's viewport and user agent; DOMContentLoaded and `load` times, request count, slowest requests and still-open requests are reported. |
| FR-007 ✓ | Each domain gets a one-line verdict; non-OK verdicts are also GitHub annotations. |
| FR-008 ✓ | Results go to the job summary as Markdown, and to stdout as JSON with `--json`. |
| FR-009 ✓ | `hf_only` targets are refused; invalid domains fail before any request. |

### Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-001 ✓ | **Sustainability:** manual only (no schedule); about ten HTTP requests and one page load per domain; nothing is committed or published. |
| NFR-002 ✓ | No new dependencies: Node's `fetch` and the Playwright already used by the scan. |
| NFR-003 ✓ | Pure logic (hints, verdicts, parsing, rendering) lives in `src/lib/` with unit tests that make no network calls. |

### Constraints

- Plain Node, no build step. The workflow follows the existing ones (pinned
  major action versions, Node from `.nvmrc`).
- It reports what it sees; it doesn't change config, data or state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** ✓: For vital-core-lgd, one run explains LBHF's 202/404s and
  Blackburn's timeouts well enough to choose between "wrong host", "blocked
  by a firewall" and "a slow resource", or says plainly that it can't tell.
- **SC-002** ✓: The workflow refuses an `hf_only` domain without sending a
  request.
