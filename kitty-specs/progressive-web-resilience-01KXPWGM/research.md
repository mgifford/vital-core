# Research: Progressive Web Resilience section

**Mission**: progressive-web-resilience-01KXPWGM
**Date**: 2026-07-17

---

## Key Decisions

### D-01: Manifest fetch happens inside `page.evaluate`, same-origin `fetch()`

**Decision**: Resolve `manifestHref` to an absolute URL and fetch it via
`fetch()` inside the existing `page.evaluate(async () => {...})` block in
`runStandards`, alongside the current `manifestHref` detection.

**Rationale**: `standards.js` already resolves `manifestHref` inside
`page.evaluate` (`standards.js:45`). A same-origin `fetch()` from within the
page context reuses the browser's own cookie/cache state and CORS handling
for free, and keeps all PWA detection logic in one place rather than
splitting it across a page-context block and a separate Playwright
`page.request` call. Cross-origin manifests (rare, but technically legal) will
fail CORS from `fetch()` inside the page — that failure is exactly the
"manifest present but unreadable" state FR-001 requires; no special-casing
needed.

**Evidence**: `src/engines/standards.js:22-83` — the entire `data` object is
already built through one `page.evaluate` round-trip. `security.js` and
`public-interest.js` are the counter-example (per-origin, outside page
context) — see D-03 below for why those don't apply to manifest parsing.

**Resolves**: spec.md open question — "Where should manifest fetch happen?"

---

### D-02: Service-worker state expands via existing `getRegistration()`, not new APIs

**Decision**: Extend the existing `navigator.serviceWorker.getRegistration()`
call (`standards.js:49-57`) to read `registration.active`,
`registration.installing`, `registration.waiting`, and
`navigator.serviceWorker.controller` (non-null means this page is
currently controlled), rather than introducing a new detection mechanism.

**Rationale**: All of these are already available on the `ServiceWorkerRegistration`
object returned by the call `standards.js` already makes — no new browser
API surface, no new permissions, no added page-load cost. "Navigation
handling" (whether the SW intercepts navigation requests) is not reliably
observable from the page context without triggering an actual navigation
under offline conditions — defer that signal to the offline-resilience check
(D-04) rather than inventing a static heuristic that would produce false
positives.

**Evidence**: `standards.js:49-57`, MDN `ServiceWorkerRegistration` (active /
installing / waiting are standard, universally supported fields since SW
API's introduction — no browser-compat risk).

**Resolves**: spec.md FR-002.

---

### D-03: Offline / network-resilience checks run per-origin, once, memoized — not per page

**Decision**: Offline-fallback detection and any Cache Storage inspection run
once per origin (memoized with `??=`, same pattern as `securityResult` and
`publicInterestResult` in `scan.js:307-314`), not inside the per-page
`runStandards(page)` call.

**Rationale**: `scan.js` reuses a single `browser.newContext()` for the whole
domain crawl (`scan.js:141`) and iterates many pages against it
(`scan.js:248`, `runs('standards')` at `scan.js:304`). `context.setOffline(true)`
is a context-level (not page-level) toggle in Playwright — flipping it
mid-crawl risks affecting other in-flight page loads if the crawl is ever
parallelized, and even sequentially it adds a full extra navigation (online →
offline → re-navigate → restore online) per page, which is wasteful when the
answer ("does this origin have an offline fallback") does not vary by page.
`runSecurity`/`runPublicInterest` already establish the per-origin,
memoize-once pattern for exactly this kind of check (`scan.js:307-314`).

**Evidence**: `src/scan.js:140-145` (shared context), `src/scan.js:304-314`
(per-page vs. per-origin `runs()` calls and `??=` memoization pattern).

**Resolves**: spec.md open question — "Can offline-fallback detection be done
without materially slowing the crawl?" Answer: yes, if scoped to once per
origin using the existing per-origin check pattern; a per-page toggle would
not be.

---

### D-04: Offline-fallback check uses a dedicated browser context, not the shared crawl context

**Decision**: When the offline-resilience check runs (once per origin,
gated behind its own sampling-rate-style flag or piggybacked on the
`security`/`public-interest` per-origin gate), it opens a short-lived
dedicated `browser.newContext()` (or reuses the existing `runSecurity`-style
out-of-band pattern) to toggle `setOffline(true)`, navigate, inspect the
response, then close — rather than touching the shared crawl `context` used
for every other page.

**Rationale**: Directly extends D-03: isolating the offline toggle to its own
context guarantees zero interference with the ongoing per-page crawl loop,
regardless of future parallelization. `runSecurity` already establishes the
precedent of doing origin-level checks outside the shared page/context loop
(it takes `baseOrigin` and `target.user_agent`, not `page`).

**Evidence**: `src/scan.js:307-309` — `runSecurity(baseOrigin, target.user_agent, target.nav_timeout_ms)` takes no `page` argument, confirming origin-level checks are already architected to run independently of the shared crawl context.

**Resolves**: spec.md open question — "offline detection without slowing the crawl" (isolation half of D-03's answer).

---

### D-05: Network-resilience (cache versioning, retry) limited to Cache Storage API inspection; SW source static analysis out of scope for this mission

**Decision**: Detect network-resilience signals only via runtime-observable
state (`caches.keys()`, `caches.open(name).then(c => c.keys())` inside the
same page-context evaluate used for D-01/D-02) — cache name presence/count as
a proxy for "cache versioning in use." Do not parse or statically analyze the
service worker's JS source to infer retry logic.

**Rationale**: Static analysis of arbitrary third-party/CMS-authored SW
source is unbounded in complexity (minified/bundled code, dynamic imports)
and would produce unreliable Pass/Fail signals — directly conflicting with
spec.md's C-02 (no fabricated aggregate confidence) and the issue's request
for defensible evidence. Runtime-observable Cache Storage contents are cheap
(same page-context call, no extra navigation) and give concrete evidence
(cache names, entry counts) a reader can trust.

**Evidence**: spec.md FR-005 already scopes this to "detectable" signals;
issue #145 asks for "cache strategy, cache versioning" without requiring SW
source parsing.

**Resolves**: spec.md open question — "does network resilience require SW
source inspection?" Answer: no, for this mission; flagged as a candidate
follow-up if Cache Storage inspection proves insufficient in practice.

---

### D-06: New section is a distinct top-level key (`resilience`), existing `pwa-*` checks migrate into it

**Decision**: `runStandards()` returns a new `resilience: { checks: [...] }`
array (or similarly named top-level key, finalized in plan.md) alongside the
existing `checks` array. The 5 existing `pwa-*` entries
(`pwa-https`, `pwa-manifest`, `pwa-service-worker`, `pwa-theme-color`,
`pwa-apple-touch-icon`) move out of `checks` into `resilience.checks`, so no
check is duplicated between the two (FR-007).

**Rationale**: Matches the issue's ask for a dedicated section, and mirrors
how `og`/`social` are already broken out as distinct top-level keys
alongside the flat `checks` array in the existing return shape
(`standards.js:120-127`) — this mission extends an established pattern
rather than inventing a new one.

**Evidence**: `standards.js:120-127` — current return shape already has
precedent for non-`checks` structured sub-objects (`social`, `og`).

**Resolves**: spec.md FR-006.

---

## Open questions carried into plan.md

- Exact key name (`resilience` vs `pwa` vs `progressiveWebResilience`) for
  the new section — cosmetic, finalize during plan.md schema design.
- Whether the offline-resilience per-origin check should be gated behind a
  new sampling-rate config entry (`config/targets.yml` `sampling:`) like
  other opt-in-cost engines, given it requires an extra context + navigation
  per origin (not per page, per D-03/D-04, but still non-zero cost at
  fleet scale). Recommend defaulting it on but sampling-configurable,
  consistent with `lighthouse`'s pattern (also an expensive per-origin-ish
  check).
- CSV column additions for the new section fields — enumerate exact column
  names against `src/lib/csv.js`'s existing `bugsCsvTable()` conventions
  during plan.md.
