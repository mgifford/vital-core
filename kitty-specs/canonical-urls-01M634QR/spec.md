# Mission Specification: Canonical URLs

**Mission Branch**: `claude/vigilant-shannon-79oda8`
**Created**: 2026-10-29
**Status**: Implemented; SC-001 and SC-002 wait on a week of scans and a report build
**Input**: vital-core-lgd, 2026-10-29. Walsall's sitemap lists its pages as
`http://`, so 453 of the 474 pages scanned that week were recorded under
`http://go.walsall.gov.uk/…` although the site redirects every one to
`https://`. 157 pages sat in the crawl queue twice, once per scheme, and the
URL lookup found nothing for the `https://` address a visitor copies from
the browser. The maintainer: "We want to treat those redirects as they are
intended and only scan one canonical URL, not its duplicate (often
redirect)", and "some sites have a http but no https. That is worth noting
as that is a quality problem."

## Background

`normalizeUrl()` keeps the scheme and host exactly as written, while the
crawler's same-site test ignores `www.`. So `http://`, `https://`,
`example.gov.uk` and `www.example.gov.uk` forms of one page all enter the
frontier as different pages, each audited on its own and each paying a
redirect. The scan also assumes `https://<domain>` for robots.txt, the
sitemap and the origin checks, so the "Served over HTTPS" security check
always passes, even for a site that has no working HTTPS.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One page, one record (Priority: P1)

A fleet maintainer whose target redirects `http://` to `https://`, or the
apex to `www.` (or back), gets each page scanned and reported once, under
the address the site redirects to.

**Independent Test**: scan a site whose sitemap lists `http://` URLs that
redirect to `https://`; every page record and crawl-state entry uses
`https://`, and no page is queued twice.

**Acceptance Scenarios**:

1. ✓ **Given** a homepage that redirects to another scheme or to the other of
   `www.`/apex on the same site, **When** a scan starts, **Then** that final
   scheme and host become the site's canonical origin, and sitemap entries,
   discovered links, priority URLs and the homepage seed are all recorded
   in that form.
2. ✓ **Given** a crawl state that already holds `http://` or other-host
   variants, **When** a scan starts, **Then** those entries are rewritten to
   the canonical form and duplicates are merged, keeping this week's scan
   status so nothing is rescanned or lost.
3. ✓ **Given** a page that redirects to a different page on the same site,
   **When** it is scanned, **Then** the audit is recorded under the page it
   lands on, the redirecting URL is marked as a redirect and not counted as
   a page, and a landing page already scanned this week is not audited again.

### User Story 2 - A site without HTTPS is reported (Priority: P1)

A maintainer sees, in the existing "Served over HTTPS" check, when a site
only answers over HTTP or when its HTTPS redirects to HTTP.

**Acceptance Scenarios**:

1. ✓ **Given** a site whose `https://` homepage fails but `http://` answers,
   **When** it is scanned, **Then** the site is scanned over HTTP and the
   "Served over HTTPS" check fails with a detail naming the HTTPS error.
2. ✓ **Given** a site whose `https://` homepage redirects to `http://`,
   **When** it is scanned, **Then** the check fails with "HTTPS redirects
   to HTTP".

### User Story 3 - The URL lookup finds a page however it is written (Priority: P2)

A report reader who pastes a page's address into the URL lookup finds it
whether they include `http://`, `https://`, `www.` or a trailing slash.

**Acceptance Scenarios**:

1. ✓ **Given** a page recorded as `http://go.walsall.gov.uk/events/x`,
   **When** a reader searches `https://go.walsall.gov.uk/events/x/`,
   **Then** the page is found.

### Edge Cases

- A homepage that redirects to a **different** site (another subdomain, as
  `walsall.gov.uk` → `go.walsall.gov.uk`) does not change the canonical
  origin; the configured one is kept and the scan log says so.
- When the homepage can't be reached at all, the configured origin is kept.
- Test mode (`--base-url`) resolves against the local server like any site.
- A redirect to another site from an ordinary page is out of scope; it is
  handled as today.

## Requirements *(mandatory)*

### Functional Requirements

| ID | Requirement |
|---|---|
| FR-001 ✓ | Each scan resolves the site's canonical origin by following the homepage's redirects; a same-site final URL sets the scheme and host, otherwise the configured origin is kept. |
| FR-002 ✓ | If `https://` fails and `http://` answers, the canonical origin is `http://`, and the reason is kept for the HTTPS check. |
| FR-003 ✓ | `normalizeUrl()` can rewrite a same-site URL to the canonical scheme and host; the sitemap, link discovery, priority URLs and the homepage seed all use it. |
| FR-004 ✓ | Crawl state loaded at the start of a scan is rewritten to canonical URLs, merging duplicates without losing this week's scan status, priority or the lower failure count. |
| FR-005 ✓ | A page that lands on a different same-site URL is recorded under the landing URL; the requested URL is marked `redirect`, is not written as a page record and is not rescanned that week. |
| FR-006 ✓ | robots.txt, the security, public-interest and offline-resilience checks use the canonical origin; "Served over HTTPS" fails for HTTP-only sites and HTTPS-to-HTTP redirects, with the reason as its detail. |
| FR-007 ✓ | The URL lookup ignores the scheme, a leading `www.`, a fragment and a trailing slash when matching. |

### Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-001 ✓ | **Sustainability:** at most two extra requests per scan run (the homepage, and `http://` only when `https://` fails); every duplicate scan and per-page redirect it removes is a saving. No client-side cost beyond a few lines in the lookup script. |
| NFR-002 ✓ | URL identity changes only for URLs that weren't already canonical. Pages already recorded in their canonical form keep their page IDs. |
| NFR-003 ✓ | Pure logic (canonical choice, URL rewrite, state merge, lookup matching) has unit tests with no network mocks; any network test uses a real local server. |

### Constraints

- Plain Node, no new dependencies.
- Data already in `data/` is not rewritten. A site whose URLs change form
  sees one week where finding IDs built from the first affected URL change
  (they show once as fixed and new).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a week of scans, `go.walsall.gov.uk` has no page
  recorded under `http://` and no page queued under two forms.
- **SC-002**: The URL lookup finds
  `https://go.walsall.gov.uk/events/junior-paint-master-workshop-rob-conway-morning`.
- **SC-003** ✓: A unit test shows an HTTP-only site failing "Served over HTTPS".
