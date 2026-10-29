# Plan: Canonical URLs

Mission `canonical-urls-01M634QR`. Scaffolded with `spec-kitty specify`
3.2.7 on `claude/vigilant-shannon-79oda8`; the spec is in `spec.md`.

## Summary

Resolve each site's canonical origin once per scan from the homepage
redirect, and pass it to `normalizeUrl()` so every same-site URL is
recorded in that form before it enters the frontier. Rewrite old crawl
state to match. Record a page that redirects within the site under its
landing URL. Make "Served over HTTPS" reflect the resolved scheme, and let
the URL lookup ignore scheme and `www.`.

## Charter check (sustainable-web-output)

- One homepage fetch per run, plus one `http://` fetch only when `https://`
  fails. Duplicate scans and per-page redirects go away.
- The lookup gains a few lines of string handling; no new requests.
- No new dependencies, no build step.

## WP01: Canonical origin, URL rewrite, state merge (FR-001–FR-004, NFR-002, NFR-003)

- `src/lib/canonical.js`:
  - `pickCanonicalOrigin(configuredOrigin, finalUrl)`: the final URL's
    origin when it is the same site (`www.` ignored), otherwise the
    configured origin.
  - `httpsDetail(...)`: the reason text for the HTTPS check.
  - `resolveCanonicalOrigin(configuredOrigin, userAgent, timeoutMs)`: GET
    the homepage following redirects; if an `https://` origin fails, try
    `http://`. Returns `{ origin, configured, httpsOk, httpsDetail, note }`.
- `src/lib/urls.js`: `normalizeUrl(raw, baseUrl, host, canonicalOrigin)`
  sets the scheme, host and port of a same-site URL to the canonical
  origin's. Without the fourth argument it behaves as before.
- `src/lib/state.js`: `canonicalizeState(state, canonicalOrigin, host)`
  re-keys entries whose canonical URL differs, merging duplicates: keep
  this week's scan status (the most recent `lastScannedAt`), OR the
  priority flag, keep the lower depth and failure count.
- Tests: `tests/unit/canonical.test.js` covers the pure parts, and runs
  `resolveCanonicalOrigin` against a real local HTTP server (an `https://`
  origin that fails falls back to `http://`).

## WP02: Scan wiring and redirects (FR-003, FR-005, FR-006)

- `src/scan.js`:
  - resolve the canonical origin before seeding and log it;
  - canonicalize loaded state;
  - pass the origin to `discoverFromSitemaps`, `loadPriorityUrls`,
    `fetchRobots`, `runSecurity`, `runPublicInterest` and
    `runOfflineResilience`;
  - discover links relative to the page's landing URL.
- After `page.goto`, normalize `page.url()`. If it is a different same-site
  URL:
  - add it to the frontier;
  - if it was already scanned this week, mark the requested entry
    `redirect` and skip the audit;
  - otherwise record the audit under the landing URL's page ID and mark the
    requested entry `redirect` with `redirectTo`.
- `src/lib/sitemap.js`, `src/lib/top-tasks.js`: pass the canonical origin
  to `normalizeUrl`.
- `src/engines/security.js`: `runSecurity(origin, ua, timeout, { httpsDetail })`;
  the `https` check uses the resolved origin's scheme, with the detail.
- e2e fixture: a page that redirects to another fixture page; assert only
  the landing page has a record.

## WP03: Lookup, docs

- `src/report-html.js` URL lookup: compare both sides with the scheme, a
  leading `www.`, a fragment and a trailing slash removed.
- CLAUDE.md: a short "Canonical URLs" note; the `urls.js` identity comment.
