---
work_package_id: WP02
title: Origin-level offline and network resilience checks
dependencies: []
requirement_refs:
- FR-003
- FR-005
tracker_refs:
- '#145'
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this mission were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-progressive-web-resilience-01KXPWGM
base_commit: 6e8d047aedb76f23f770a40e8d297600bb8c0d59
created_at: '2026-07-17T18:49:09.996083+00:00'
subtasks:
- T003
- T004
shell_pid: '66388'
authoritative_surface: src/engines/offline-resilience.js
create_intent:
- src/engines/offline-resilience.js
- tests/unit/offline-resilience.test.js
execution_mode: code_change
owned_files:
- src/engines/offline-resilience.js
- src/scan.js
- src/lib/sampling.js
- tests/unit/offline-resilience.test.js
role: implementer
tags: []
---

# WP02: Origin-level offline and network resilience checks

## ⚡ Do This First: Load Agent Profile

Use the `/ad-hoc-profile-load` skill to load the agent profile specified in
the frontmatter, and behave according to its guidance before parsing the
rest of this prompt.

- **Role**: `implementer`
- **Agent/tool**: not fixed — resolve via `spec-kitty agent profile list`.

---

## Objective

Add two new capability checks that cannot be answered from a single
page-context `page.evaluate()` call:

1. **Offline resilience**: does the origin serve something useful (a
   cached page, an offline-fallback page) when network connectivity is
   interrupted, rather than a browser error page?
2. **Network resilience**: does the origin use the Cache Storage API
   (a proxy for "has a cache/versioning strategy"), observable at
   runtime without parsing service-worker source?

Per `research.md` D-03/D-04/D-05 (already decided — do not re-litigate):

- These checks run **once per origin**, not once per page, mirroring how
  `runSecurity`/`runPublicInterest` already memoize per-origin results in
  `scan.js` (`??=` pattern, `scan.js:307-314`).
- The offline check uses a **dedicated, isolated Playwright browser
  context** — never the shared crawl `context` (`scan.js:141`) that every
  other page in the crawl uses. `context.setOffline()` is context-level,
  not page-level; toggling it on the shared context would risk
  interfering with concurrent/future page loads.
- Network-resilience detection is limited to **runtime-observable Cache
  Storage contents** (`caches.keys()` / cache entry counts) — do NOT parse
  or statically analyze service-worker JS source. That is explicitly out
  of scope for this mission (see spec.md "Out of scope").

## Context

`scan.js` launches one `browser` (`chromium.launch(...)`, line 140) and
reuses one `context` for the entire per-domain crawl loop. Per-origin
checks that don't need the shared context already exist as a precedent:

```js
// scan.js:307-309
if (runs('security')) {
  securityResult ??= await runSecurity(baseOrigin, target.user_agent, target.nav_timeout_ms);
  record.security = securityResult;
  mark('security');
}
```

`runSecurity`/`runPublicInterest` use plain `fetch()`, not Playwright,
because their checks (headers, `security.txt`, `carbon.txt`) don't need a
real browser. The offline check in this WP is different — it needs to
actually load a page under Playwright with `context.setOffline(true)` and
observe what renders, so it needs `browser` (available in `scan.js`'s
top-level scope, same scope `runSecurity` is called from) rather than a
plain HTTP client.

### Subtask T003: `runOfflineResilience(browser, baseOrigin, userAgent, navTimeoutMs)` in a new module

**Purpose**: A new origin-level async function, called once per origin,
that opens an isolated context, goes offline, attempts a navigation, and
reports what happened as Pass/Fail/N/A with evidence.

**Steps**:

1. Create `src/engines/offline-resilience.js` (new file — this doesn't fit
   `standards.js`'s page-context style, since it needs its own
   `browser.newContext()`/navigation lifecycle rather than operating on an
   already-loaded `page`; follow `security.js`'s module shape — one
   exported async function, a `checks`/`add()` pattern matching
   `security.js`'s `const checks = []; const add = (id, label, pass, detail = '') => checks.push({ id, label, pass, detail });`).
2. Implement:
   ```js
   import { chromium } from 'playwright'; // browser is passed in; no new launch here — see below
   ```
   Actually: **do not** launch a new `chromium` instance — accept the
   already-launched `browser` object as a parameter (avoid the cost and
   resource-leak risk of a second full browser process). Signature:
   ```js
   export async function runOfflineResilience(browser, baseOrigin, userAgent, navTimeoutMs) {
     const checks = [];
     const add = (id, label, pass, detail = '') => checks.push({ id, label, pass, detail });
     let context;
     try {
       context = await browser.newContext({ userAgent });
       context.setDefaultNavigationTimeout(navTimeoutMs);
       const page = await context.newPage();

       // Baseline: confirm the origin is reachable online first, so an
       // offline failure is attributable to offline handling, not to the
       // origin being unreachable in general.
       let onlineOk = false;
       try {
         const res = await page.goto(baseOrigin, { waitUntil: 'load' });
         onlineOk = !!res && res.status() < 400;
       } catch { /* origin unreachable even online; leave onlineOk false */ }

       if (!onlineOk) {
         add('offline-fallback', 'Offline fallback / cached navigation', false, 'Origin unreachable even with network online; cannot evaluate offline behavior');
       } else {
         await context.setOffline(true);
         let offlineOk = false;
         let detail = '';
         try {
           const res = await page.goto(baseOrigin, { waitUntil: 'load', timeout: navTimeoutMs });
           offlineOk = !!res && res.status() < 400;
           detail = offlineOk ? 'Page loaded successfully while offline (cached navigation or offline-fallback page served)' : `Navigation returned while offline but status ${res?.status()}`;
         } catch (err) {
           detail = `Navigation failed while offline: ${String(err?.message || err).slice(0, 200)}`;
         }
         add('offline-fallback', 'Offline fallback / cached navigation', offlineOk, detail);
         await context.setOffline(false);
       }

       // Network resilience: Cache Storage usage as a proxy for a
       // cache/versioning strategy. Runtime-observable only — no SW source
       // parsing (research.md D-05).
       try {
         const cacheNames = await page.evaluate(() => ('caches' in window ? caches.keys() : []));
         add('cache-storage-in-use', 'Cache Storage API in use (cache/versioning strategy)', cacheNames.length > 0, cacheNames.length ? `Cache(s) found: ${cacheNames.slice(0, 5).join(', ')}` : 'No caches found via Cache Storage API');
       } catch (err) {
         add('cache-storage-in-use', 'Cache Storage API in use (cache/versioning strategy)', false, `Could not inspect Cache Storage: ${String(err?.message || err).slice(0, 200)}`);
       }
     } finally {
       await context?.close();
     }
     const passed = checks.filter((c) => c.pass).length;
     return { engine: 'offline-resilience', checks, passed, total: checks.length };
   }
   ```
   Adjust exact Playwright API calls if `page.goto`'s offline-navigation
   error shape differs from assumed above — verify against Playwright's
   actual behavior for `context.setOffline(true)` + `page.goto` (it should
   reject/error for a page with no service-worker-based offline handling,
   and succeed for one that has SW-cached navigation) during
   implementation; the code above is the intended shape, not
   necessarily byte-exact.
3. Note the Cache Storage check's placement: it runs on whatever page
   state exists after the offline/online navigation attempts, which
   should still be a valid page context — if the offline navigation
   failed entirely (no document loaded), guard the `page.evaluate` call
   so it doesn't throw against a blank/error page (wrap in try/catch as
   shown above; already handled).

**Files**: `src/engines/offline-resilience.js` (new) — expect roughly +55
to +75 lines.

### Subtask T004: Wire into `scan.js` at origin-level cadence + unit tests

**Purpose**: Call `runOfflineResilience` once per origin (memoized, `??=`
pattern) at the same call site as `runSecurity`, gated so it doesn't add
unconditional cost to every scan, and add test coverage.

**Steps — wiring**:

1. Open `src/scan.js`. Add the import near the other engine imports
   (alongside `import { runSecurity } from './engines/security.js';`):
   ```js
   import { runOfflineResilience } from './engines/offline-resilience.js';
   ```
2. Find the per-origin memoization block around `scan.js:305-314`
   (`if (runs('security')) { securityResult ??= ...`). Add a sibling
   block for the new engine, gated the same way (`runs('offline-resilience')`
   — this requires the engine name to participate in the existing
   `ratesFor`/`shouldRun` sampling system, same as every other engine):
   ```js
   if (runs('offline-resilience')) {
     offlineResilienceResult ??= await runOfflineResilience(browser, baseOrigin, target.user_agent, target.nav_timeout_ms);
     record.offlineResilience = offlineResilienceResult;
     mark('offline-resilience');
   }
   ```
3. Declare `let offlineResilienceResult = null;` near the top of the
   per-domain scan alongside the existing `let securityResult = null;` /
   similar declarations (search for where `securityResult` is declared —
   add the new variable right next to it).
4. Add `offline-resilience` as a valid engine name to whatever central
   registry the sampling system (`src/lib/sampling.js` / `ratesFor`)
   already uses to recognize engine names from `config/targets.yml`
   `sampling:` — follow the exact same registration pattern `security` or
   `public-interest` already uses (search `src/lib/sampling.js` for how
   engine names are declared/validated).
5. **Default sampling rate**: per `plan.md`'s Open Questions, default this
   engine's rate the same way `lighthouse` defaults (an explicit non-zero
   rate in `config/targets.yml`, not silently always-on) — do not enable
   it unconditionally for every target; leave `config/targets.yml` changes
   to individual target owners rather than flipping it on repo-wide in
   this WP. Confirm during implementation whether `sampling.js` has a
   "default rate when unspecified" — if so, default this new engine to
   `0` (opt-in) explicitly, since it's the most expensive new check (adds
   a browser context + up to 2 navigations per origin).

**Steps — tests**:

6. Add `tests/unit/offline-resilience.test.js` (or extend an existing
   engine test file if repo convention groups engine tests together —
   check `tests/unit/` for the existing pattern before creating a new
   file). Cover:
   - A synthetic/local fixture server that serves a page normally, then
     verify the function's shape when `context.setOffline(true)` causes
     the second navigation to fail (expect `offline-fallback` check to be
     `pass: false` with a descriptive `detail`).
   - `cache-storage-in-use` check reports `pass: false` with no caches
     present (the common case for most sites) and `pass: true` when a
     test fixture pre-populates `caches` via `page.evaluate` before the
     check runs.
   - The function never throws — wrap the whole exercised call in the
     test and assert it resolves, even when the target origin is
     completely unreachable (e.g. `http://127.0.0.1:1` or similar
     guaranteed-refused port).
   - `context.close()` is called even on error paths (assert via a spy or
     by checking no browser context leak — follow whatever
     resource-cleanup testing convention this repo already uses, if any;
     otherwise note this as a manual-inspection-only guarantee in a code
     comment).

**Files**:
- `src/scan.js` — expect roughly +15 to +20 lines.
- `src/lib/sampling.js` (or wherever engine names are centrally declared)
  — expect roughly +1 to +5 lines.
- `tests/unit/offline-resilience.test.js` (new) — expect roughly +50 to
  +80 lines.

**Validation**:
- `npm run test:unit` green.
- Manual trace: run `npm run scan` against a local/test target with
  `offline-resilience` sampling enabled and confirm `record.offlineResilience`
  appears in the scan output with sensible `checks`.
- Confirm scan duration does not measurably regress for targets where this
  engine's sampling rate is `0` (default) — the gating must make this
  engine fully opt-in-cost, not silently always-on.

---

## Acceptance criteria covered by this WP

- [ ] `runOfflineResilience(browser, baseOrigin, userAgent, navTimeoutMs)`
      exists in a new `src/engines/offline-resilience.js`, runs in an
      isolated context (never the shared crawl context), and always
      closes that context.
- [ ] Offline-fallback check distinguishes "origin unreachable even
      online" from "offline navigation failed" from "offline navigation
      succeeded" with a human-readable `detail` string for each.
- [ ] Network-resilience (`cache-storage-in-use`) check reports evidence
      (cache names found) without parsing service-worker source.
- [ ] The new engine is wired into `scan.js` at the same per-origin,
      memoized cadence as `security`/`public-interest`, gated by the
      existing sampling system and defaulted to opt-in (rate 0 unless a
      target explicitly enables it).
- [ ] Unit tests cover reachable-online/offline-fails,
      reachable-online/offline-succeeds (if fixture-feasible), and
      completely-unreachable-origin paths without throwing.
- [ ] `npm run test:unit` green; no scan-duration regression for targets
      with this engine's sampling rate at the default (0).

FR-001/FR-002 (manifest, service worker) are WP01's scope. FR-004
(installability) is WP03's scope. FR-006/FR-007/FR-008 (section
restructuring, rendering, CSV/API export — including rendering this WP's
`record.offlineResilience` output anywhere in the report) are WP04's
scope. Do not implement report rendering or CSV columns in this WP.
