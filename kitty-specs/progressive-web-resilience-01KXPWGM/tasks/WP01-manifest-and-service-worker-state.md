---
work_package_id: WP01
title: Manifest fetch, parsing, and expanded service-worker state
dependencies: []
requirement_refs:
- FR-001
- FR-002
tracker_refs:
- '#145'
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this mission were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-progressive-web-resilience-01KXPWGM
base_commit: 44e56c5957c7560be3f996b198c1a81137793074
created_at: '2026-07-17T18:07:42.405595+00:00'
subtasks:
- T001
- T002
shell_pid: '63009'
authoritative_surface: src/engines/standards.js
create_intent:
- tests/unit/standards.test.js
execution_mode: code_change
owned_files:
- src/engines/standards.js
- tests/unit/standards.test.js
role: implementer
tags: []
---

# WP01: Manifest fetch, parsing, and expanded service-worker state

## ⚡ Do This First: Load Agent Profile

Use the `/ad-hoc-profile-load` skill to load the agent profile specified in
the frontmatter, and behave according to its guidance before parsing the
rest of this prompt.

- **Role**: `implementer`
- **Agent/tool**: not fixed — resolve via `spec-kitty agent profile list`
  and select the best match for `src/engines/standards.js` (a plain
  Node.js ESM engine module, no framework).

---

## Objective

Extend `runStandards(page)` in `src/engines/standards.js` so the existing
PWA signals go from bare presence booleans to real evidence:

1. Fetch and parse the web app manifest JSON (not just detect the
   `<link rel="manifest">` tag) — `start_url`, `display`, `scope`,
   `theme_color`, `background_color`, icon list, and maskable-icon
   presence.
2. Expand service-worker detection beyond a single `hasServiceWorker`
   boolean — report registered / active / installing / waiting / and
   whether the service worker currently controls this page.

This closes issue [#145](https://github.com/mgifford/vital-core/issues/145)'s
complaint that manifest/SW detection is presence-only ("Rather than simply
detecting its presence, report useful manifest characteristics").

## Context

`src/engines/standards.js` (129 lines) already resolves
`manifestHref` and calls `navigator.serviceWorker.getRegistration()` inside
one `page.evaluate(async () => {...})` block (lines 22-83), then converts
the returned `data` object into flat `checks` entries via the `add(id,
label, pass, detail)` helper (lines 85-118). This WP works entirely inside
that same `page.evaluate` block and the `data` object it returns — no new
navigation, no new page load.

Per `research.md` D-01/D-02 (already decided, do not re-litigate):

- Manifest fetch happens via same-origin `fetch()` **inside** the existing
  `page.evaluate` block, not a separate Playwright `page.request` call.
  Cross-origin manifests will fail CORS from in-page `fetch()` — that
  failure IS the "manifest present but unreadable" state (see T001 below),
  not a bug to work around.
- Service-worker expansion reads more fields off the *same*
  `registration` object `getRegistration()` already returns
  (`registration.active`, `.installing`, `.waiting`) plus
  `navigator.serviceWorker.controller` — no new browser API surface.

This WP does **not** touch the `checks` array assembly (the `add(...)`
calls) or the top-level return shape (`resilience` key, `pwa-*` migration)
— that's WP04's job. This WP only produces the underlying data
(`ManifestSummary`, `ServiceWorkerSummary` per `data-model.md`) that WP04
will consume when it builds the new section. To keep this WP independently
testable without depending on WP04's unmerged changes, attach the new data
under two new keys on the existing `data` object returned from
`page.evaluate` — `data.manifest` and `data.serviceWorker` — alongside the
existing `data.manifestHref` / `data.hasServiceWorker` (leave those two
alone; WP04 decides whether to keep, alias, or remove them when it
restructures the section).

### Subtask T001: Manifest fetch and parsing

**Purpose**: Replace bare `manifestHref` presence-detection with a parsed
`ManifestSummary` (per `data-model.md`).

**Steps**:

1. Open `src/engines/standards.js`. Inside the `page.evaluate(async () =>
   {...})` block, find the existing line:
   ```js
   const manifestHref = head?.querySelector('link[rel="manifest"]')?.getAttribute('href') || null;
   ```
2. Immediately after it, add manifest fetch + parse logic:
   ```js
   let manifest = null;
   if (manifestHref) {
     try {
       const manifestUrl = new URL(manifestHref, location.href).href;
       const res = await fetch(manifestUrl);
       if (!res.ok) {
         manifest = { parseError: `HTTP ${res.status}` };
       } else {
         const json = await res.json();
         const icons = Array.isArray(json.icons) ? json.icons : [];
         manifest = {
           startUrl: json.start_url ?? null,
           display: json.display ?? null,
           scope: json.scope ?? null,
           themeColor: json.theme_color ?? null,
           backgroundColor: json.background_color ?? null,
           icons,
           hasMaskableIcon: icons.some((i) => String(i.purpose || '').includes('maskable')),
           parseError: null,
         };
       }
     } catch (err) {
       manifest = { parseError: String(err?.message || err) };
     }
   }
   ```
   Use `URL(manifestHref, location.href)` (not `document.baseURI`) to
   resolve relative manifest paths the same way the browser would.
3. Add `manifest` to the object returned from `page.evaluate` (the `return
   { ... }` block near the end), alongside the existing `manifestHref`:
   ```js
   manifestHref,
   manifest,
   ```
4. `manifest` stays `null` when there is no `manifestHref` at all (no
   manifest link declared) — do not fabricate a `parseError` in that case;
   `null` already distinguishes "no manifest" from "manifest present but
   unreadable" (`{ parseError: '...' }`) per `data-model.md`'s
   `ManifestSummary.parseError` field and spec.md FR-001's explicit
   requirement to distinguish these two states.

**Files**: `src/engines/standards.js` — expect roughly +25 to +35 lines.

**Validation**: Covered by T002's tests (see below) plus manual trace: a
synthetic page with a valid manifest JSON response produces a `manifest`
object with all fields populated; a page with a `manifest` link pointing at
a 404 or invalid JSON produces `{ parseError: <string>, ... other fields absent or null }`
— never a thrown exception out of `runStandards`.

### Subtask T002: Expanded service-worker state + unit tests

**Purpose**: Report registered/active/installing/waiting/controlling
states instead of one boolean, and add unit test coverage for both T001
and T002's new data.

**Steps — service worker expansion**:

1. In the same `page.evaluate` block, find:
   ```js
   let hasServiceWorker = false;
   if ('serviceWorker' in navigator) {
     try {
       const reg = await navigator.serviceWorker.getRegistration();
       hasServiceWorker = !!reg;
     } catch { /* permission error or not supported */ }
   }
   ```
2. Replace with an expanded version that keeps `hasServiceWorker` for
   backward compatibility (WP04 may fold it away later) and adds a
   `serviceWorker` summary object:
   ```js
   let hasServiceWorker = false;
   let serviceWorker = { registered: false, active: false, installing: false, waiting: false, controllingThisPage: false };
   if ('serviceWorker' in navigator) {
     try {
       const reg = await navigator.serviceWorker.getRegistration();
       hasServiceWorker = !!reg;
       serviceWorker = {
         registered: !!reg,
         active: !!reg?.active,
         installing: !!reg?.installing,
         waiting: !!reg?.waiting,
         controllingThisPage: !!navigator.serviceWorker.controller,
       };
     } catch { /* permission error or not supported */ }
   }
   ```
3. Add `serviceWorker` to the returned object alongside `hasServiceWorker`.

**Steps — tests**:

4. Find the existing test file covering `standards.js` under
   `tests/unit/` (search for `runStandards` imports — if none exists yet,
   create `tests/unit/standards.test.js` following the existing
   `tests/unit/*.test.js` conventions: Node built-in test runner, no
   mocking of fs/DB, small synthetic Playwright-like fixtures).
5. Since `runStandards` takes a real Playwright `page` object and calls
   `page.evaluate`, prefer testing via a **minimal fixture HTML page**
   loaded through Playwright in the test (consistent with how other
   engine tests in this repo already exercise `page.evaluate`-based
   engines — check `tests/unit/` for an existing pattern of spinning up a
   Playwright page against a data: URL or local fixture HTML string; reuse
   that pattern rather than inventing a new one).
6. Cover:
   - A page with a valid manifest link + a mocked/served valid manifest
     JSON response → `manifest.startUrl`, `.display`, `.scope`,
     `.themeColor`, `.backgroundColor`, `.icons`, `.hasMaskableIcon` all
     populated correctly; `hasMaskableIcon` is `true` when at least one
     icon's `purpose` contains `"maskable"` and `false` otherwise.
   - A page with a manifest link pointing at a 404 or malformed JSON →
     `manifest.parseError` is a non-empty string, other fields are
     absent/null, no exception thrown.
   - A page with no manifest link at all → `manifest` is `null`.
   - A page with no service worker → `serviceWorker` is all-`false`,
     `hasServiceWorker` is `false`.
   - (Registering an actual live service worker in a test fixture is
     likely impractical for a unit test — if so, state explicitly in the
     test file's comments that `active`/`installing`/`waiting`/
     `controllingThisPage` are verified structurally (fields present,
     correct types, correct defaults) rather than via a real SW
     lifecycle, and note this as a known test-depth limit.)

**Files**:
- `src/engines/standards.js` — expect roughly +15 to +20 lines for the SW
  expansion.
- `tests/unit/standards.test.js` (new or extended) — expect roughly +60 to
  +100 lines.

**Validation**:
- `npm run test:unit` passes, including the new tests.
- No change to any existing test's expected output for the untouched
  `checks` array — this WP only adds new `data.manifest` /
  `data.serviceWorker` fields, it does not change any existing `pwa-*`
  check's `pass`/`label`/`id`.

---

## Acceptance criteria covered by this WP

- [ ] `runStandards()`'s returned `data` includes a `manifest` field:
      `null` when no manifest is declared, `{ parseError, ...fields }`
      when present but unreadable, and a fully populated
      `ManifestSummary` (per `data-model.md`) when valid.
- [ ] `runStandards()`'s returned `data` includes a `serviceWorker` field
      with `registered`/`active`/`installing`/`waiting`/
      `controllingThisPage` booleans.
- [ ] Existing `hasServiceWorker` and `manifestHref` fields are unchanged
      (still present, same semantics) — this WP is additive.
- [ ] Existing `checks` array output (the 5 `pwa-*` entries and all
      others) is byte-for-byte unchanged by this WP — no regression to
      current report output until WP04 restructures it.
- [ ] Unit tests cover valid manifest, malformed/missing manifest, and
      no-manifest-declared cases.
- [ ] `npm run test:unit` green.

FR-004 (installability), FR-003/FR-005 (offline/network resilience), and
FR-006/FR-007/FR-008 (section restructuring, report render, CSV/API export)
are explicitly out of scope for this WP — those are WP02, WP03, and WP04
respectively per `plan.md`'s Implementation Concern Map. Do not implement
them here.
