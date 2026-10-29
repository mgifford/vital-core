# Plan: Blocked sites, clearly reported

Mission `blocked-sites-01M63YG7`. Scaffolded with `spec-kitty specify`
3.2.7 on `claude/vigilant-shannon-79oda8`, after `canonical-urls-01M634QR`
on the same branch; the spec is in `spec.md`.

## Summary

Detect firewall challenges and refusals at scan time and record them as
blocked; derive an access status per target at aggregate time from page
records and run logs; show it prominently on the dashboard and on the
domain landing page; retry failed pages once a week.

## Charter check (sustainable-web-output)

- No new requests. Challenge pages skip every audit engine.
- A failing page is retried once per week instead of never: one request a
  week, and the matrix still skips the domain for the rest of the week.
- Static HTML only, reusing `.callout-blocked`; the unused
  `.blocked-accordion` CSS is removed.

## WP01: Detection and assessment (FR-001–FR-004, NFR-003)

- `src/lib/access.js`:
  - `detectBlock({ status, headers, cookies })`: 202 or a firewall action
    header is a `challenge`; 401/403/429 a `refusal`; names from
    `protectionHints()` (`src/lib/probe.js`).
  - `isBlockedRecord(rec)` / `withoutBlockedAudits(records)`: blocked
    records, including legacy 202 records, keep identity and status only.
  - `assessAccess({ records, runs })`: firewall pages, statuses and names;
    robots.txt (root disallowed in the latest run, pages skipped); runs with
    no page loaded and their last error (`describeNetworkError()` for
    connection codes); `level` = `blocked` when nothing was audited,
    `partial` at ≥10% blocked, else `ok`.
- `src/lib/canonical.js`: keep the homepage error code (`homeError`).
- Tests: `tests/unit/access.test.js`.

## WP02: Scan and state (FR-001, FR-002, FR-007)

- `src/scan.js`: after navigation, `detectBlock()` on the response; a
  blocked page gets a page record with `blocked` and no audits, and counts
  as `blocked` in the tally. Run log gains `robots: { rootAllowed }`. The
  error path sets `lastFailedWeek`.
- `src/lib/state.js`: `pickBatch()` and `budgetStatus()` exclude
  `failCount >= 3` only when `lastFailedWeek` is this week.
- e2e fixture: a 202 page with `x-amzn-waf-action: challenge`.

## WP03: Aggregate and reports (FR-003–FR-006, NFR-002)

- `src/aggregate.js`: strip blocked audits before summarizing (week and
  7-day window); attach `summary.access` for each week; collect targets with
  no page data (`unscanned`, with access from run logs when there are runs).
- `src/report-html.js`:
  - `accessAlert(entries)` on the dashboard, right after the intro, replacing
    the collapsed "Blocked targets" accordion;
  - "Partly blocked" text in ranking rows;
  - `accessBanner(access)` at the top of the domain landing page.
- i18n: regenerate the template; drop the removed strings from the catalogs.
