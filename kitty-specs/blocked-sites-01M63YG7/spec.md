# Mission Specification: Blocked sites, clearly reported

**Mission Branch**: `claude/vigilant-shannon-79oda8`
**Created**: 2026-10-29
**Status**: Implemented; SC-001 checked on a local build from vital-core-lgd data, waits on the live report; SC-002 waits on W45
**Input**: vital-core-lgd, 2026-10-29. The dashboard listed four councils of
five with no word about the fifth. Blackburn's homepage never loaded:
GitHub's network can't connect to it, and after three failures the crawler
stopped trying for good. LBHF showed "B 80, 2 pages audited", but both pages
were its AWS WAF challenge page (HTTP 202), and its other 39 pages were
refused. The maintainer: "Highlighting that a site is blocked should be
something that is clearly highlighted. It is key to let the user know that
there is a firewall rule or robots.txt file that is blocking this."

## Background

The scan audits any 2xx/3xx HTML response, so a firewall's challenge page is
scored as if it were the site. The dashboard lists a target only once it has
an audited page; a "Blocked targets" list exists, but it only catches sites
that returned nothing but errors, sits collapsed at the bottom, and gives an
HTTP status rather than a cause. robots.txt rules that exclude the scanner
are counted in run logs but never reported. A page that fails three times is
never retried, so a site that was down or blocked for three runs drops out
for good.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See which sites block the scanner, and why (Priority: P1)

A report reader opening the dashboard sees, near the top, a one-line notice
naming every configured site that blocks the scanner; opening it gives the
cause in words and what to ask the site for.

**Acceptance Scenarios**:

1. ✓ **Given** a site whose pages answer with a firewall challenge or refusal,
   **When** the dashboard is built, **Then** it is listed as "Blocked by a
   firewall", naming the firewall when headers identify it, with page counts
   and the user agent to allow.
2. ✓ **Given** a site whose robots.txt disallows the scanner, **When** the
   dashboard is built, **Then** it is listed as "Blocked by robots.txt", with
   the number of pages skipped.
3. ✓ **Given** a site that never answered, **When** the dashboard is built,
   **Then** it is listed as "No connection" with the last error in words and
   a pointer to the diagnose workflow, even though it has no page data.
4. ✓ **Given** a configured site with no scan data at all, **When** the
   dashboard is built, **Then** it is listed as not scanned yet, not left out.

### User Story 2 - A challenge page is never scored as the site (Priority: P1)

**Acceptance Scenarios**:

1. ✓ **Given** a response with HTTP 202, `x-amzn-waf-action` or `cf-mitigated`,
   **When** it is scanned, **Then** it is recorded as blocked with the
   firewall named, and no audit engine runs on it.
2. ✓ **Given** page records written before this change with status 202,
   **When** the report is built, **Then** their audit results are left out
   and they count as blocked.

### User Story 3 - A partly blocked site says so on its own page (Priority: P2)

**Acceptance Scenarios**:

1. ✓ **Given** a site where at least 10% of attempted pages were blocked by a
   firewall or robots.txt, **When** its report is built, **Then** its landing
   page opens with a banner giving the cause and counts, and its dashboard
   row says "Partly blocked" in text.

### User Story 4 - A blocked site comes back once unblocked (Priority: P2)

**Acceptance Scenarios**:

1. ✓ **Given** a page that failed three times in an earlier week, **When** a
   new week starts, **Then** it is tried once more, and only failures in the
   current week keep it out.

### Edge Cases

- Ordinary 404s are not "blocked"; refusals are 401, 403 and 429, plus any
  response carrying a firewall action header.
- A handful of blocked pages on a large site is not "partly blocked"; the
  threshold is 10% of attempted pages.
- Status is shown as text, never colour alone.

## Requirements *(mandatory)*

### Functional Requirements

| ID | Requirement |
|---|---|
| FR-001 ✓ | A response with HTTP 202, `x-amzn-waf-action` or `cf-mitigated` is a firewall challenge; 401, 403 and 429 are refusals. Both are written as blocked page records naming the firewall (from headers and cookie names) and are not audited. |
| FR-002 ✓ | Each run log records whether robots.txt allows the scanner at `/`. |
| FR-003 ✓ | Aggregate derives each target's access status for its latest week from page records and run logs: `blocked`, `partial` or `ok`, with firewall, robots.txt and connection details. |
| FR-004 ✓ | Page records with status 202 from before this change are treated as challenges: no audit results counted. |
| FR-005 ✓ | The dashboard lists, near the top in a closed `<details>` whose summary names the count and the sites, every target that is blocked, partly blocked, unreachable or not scanned yet, each with its cause in words and the action to take; partly blocked rows in the ranking table say so in text. (Revised 2026-10-29: the maintainer asked for it to be easy to see without getting in the way.) |
| FR-006 ✓ | A domain's landing and accessibility pages open with a notice when the site is blocked or partly blocked: expanded when nothing could be audited, closed when only part of the site was blocked. |
| FR-007 ✓ | A page that reached the failure threshold in an earlier week is retried in the next week. |

### Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-001 ✓ | **Sustainability:** no new requests; challenge pages skip the audit engines, saving work. A persistently failing page costs one attempt per week. The banner and list are static HTML using existing callout styles; no client-side JavaScript. |
| NFR-002 ✓ | **Accessibility:** each list is under a heading, causes are text, links are descriptive. |
| NFR-003 ✓ | Pure logic (block detection, access assessment, rendering) has unit tests without network mocks. |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After the next report build, vital-core-lgd's dashboard lists
  Blackburn ("No connection") and LBHF ("Blocked by a firewall", AWS WAF),
  and LBHF no longer has a score.
- **SC-002**: Blackburn's homepage is tried again in the next ISO week.
