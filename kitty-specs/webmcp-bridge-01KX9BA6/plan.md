# Implementation Plan: WebMCP Bridge — Read-Only Findings Tools in the Browser

**Branch**: `claude/vital-core-issue-214-spec-m237h3`
**Spec**: [spec.md](spec.md)
**Mission**: `webmcp-bridge-01KX9BA6`

## Summary

Add an opt-in, per-target client-side script (`webmcpBridgeScript()` in
`src/report-html.js`, following the exact pattern already used by
`languageRuntime()` and `exclusionFilterScript()`) that, when a browser
supports the WebMCP proposal, registers three read-only tools — functional
equivalents of the local MCP server's `vital_get_project_context`,
`vital_list_findings`, `vital_get_finding_context` — sourced from the same
public `/api/v1/` JSON, fetched relative/same-origin from the report page
itself. Emitted only for targets with `webmcp: true`; zero bytes otherwise.

## Technical Context

- **Language**: plain ES5-compatible inline JS (no build step, no bundler,
  no TypeScript) — matches every existing inline `<script>` in
  `report-html.js` (`exclusionFilterScript()`, `bugFilterScript()`,
  `triageScript()`), because these run raw in the visitor's browser with no
  transpilation step.
- **WebMCP detection point**: the proposal is pre-standardization (W3C Web
  Machine Learning CG incubation, https://github.com/webmachinelearning/webmcp).
  Isolate the actual registration call behind one small function,
  `detectWebMcp()`, inside the generated script, so a future API-shape
  change is a one-function edit. At the time this plan is written, the
  incubation's working shape is a page-level registration point (candidate:
  `navigator.modelContext.provideContext(...)` / `registerTool(...)`); **pin
  the exact call signature at WP02 implementation time** against whatever
  the proposal's current explainer shows then, not against this plan.
- **Testing**: Node built-in test runner for config/render-level assertions
  (`npm run test:unit`); this sandbox has Playwright + Chromium
  pre-installed (unlike some prior missions' environments), so a real
  headless-browser check is feasible — inject a stub `navigator.modelContext`
  before loading a generated report page and assert the bridge script calls
  it correctly, no Playwright-mock-only testing.
- **Storage**: none new. The script fetches already-published static
  `/api/v1/` files; no client-side cache beyond an in-memory JS variable for
  the page's lifetime (mirrors the local MCP server's in-memory cache, C-04
  — deliberately not shared code, just the same shape).
- **Target Platform**: any browser rendering the generated report pages;
  inert (FR-02) where the WebMCP API is absent.

## Charter Check

*GATE: checked before design, re-checked after design below.*

- **Sustainability gate**: this is the one part of this mission that
  genuinely adds client-side JS and does *not* run at build time — spec.md's
  Sustainability Acceptance Criterion requires this be justified, not
  glossed over. Satisfied by construction: opt-in per target (FR-01), hard
  size budget (NFR-01), no CDN (FR-05), strict progressive enhancement
  (NFR-02). PASS, contingent on WP03 proving the measured size.
- **Security rules**: no VA-domain interaction, no `.env`/`HF_TOKEN`
  handling. Read-only, same-origin fetches only, no write capability
  anywhere (NFR-04). PASS.

*Re-check after Design: unchanged — the concrete module layout below
doesn't introduce new risk beyond what the Charter Check above already
covers.*

## Project Structure

### Documentation (this feature)

```
kitty-specs/webmcp-bridge-01KX9BA6/
├── spec.md
├── plan.md              # this file
└── tasks.md             # produced by the tasks phase, not this plan
```

### Source Code (repository root)

```
src/
├── report-html.js        # + webmcpBridgeScript(target), wired next to
│                          #   exclusionFilterScript() on domain/accessibility
│                          #   pages
└── lib/
    └── config.js          # + t.webmcpEnabled resolution (opt-in, default false)

config/
└── targets.yml            # + per-target `webmcp: true` opt-in (documented example)

tests/
├── unit/
│   ├── config.test.js           # + webmcpEnabled resolution cases
│   └── webmcp-bridge.test.js    # render tests: script present/absent by flag,
│                                 #   static schema shape, no-secrets assertion
└── e2e/ (exact location decided during WP03)
    └── webmcp-bridge.spec.js     # real headless-Chromium check: stub
                                   #   navigator.modelContext, load a built
                                   #   report page, assert tool registration
                                   #   and one tool call round-trip
```

**Structure Decision**: no new top-level directory — this mission only
touches the existing report-generation path (`src/report-html.js`,
`src/lib/config.js`, `config/targets.yml`), consistent with C-04 (do not
modify `mcp/`, which is unrelated local-dev infrastructure).

## Design

### Config flag

`config/targets.yml` gains an optional per-target `webmcp: true` (default
`false` — opt-in, unlike `language_switcher` which defaults **on**). In
`src/lib/config.js`, alongside the existing `t.showLanguageSwitcher`
resolution:

```js
t.webmcpEnabled = t.webmcp === true;
```

No global default is supported initially (C-02/scope discipline — one flag,
one behavior, no cross-cutting global toggle to reason about yet).

### `webmcpBridgeScript(target)` in `src/report-html.js`

Returns `''` when `!target.webmcpEnabled` (FR-01 — literally zero bytes,
not just a disabled script). When enabled, returns a `<script>` block
structured like `exclusionFilterScript()`:

```js
function webmcpBridgeScript(target) {
  if (!target.webmcpEnabled) return '';
  return `<script>
(function () {
  'use strict';
  if (!detectWebMcp()) return;
  function detectWebMcp() { /* feature detection, pinned at WP02 time */ }
  var domain = ${JSON.stringify(target.key)};
  var apiBase = '/api/v1/';
  var cache = {};
  function fetchJson(path) { /* same-origin fetch, cached in `cache` */ }
  function getProjectContext() { /* domain, latest week, report link */ }
  function listFindings(args) { /* filter/sort mirrors mcp/tools/list-findings.js */ }
  function getFindingContext(args) { /* verbatim lookup mirrors mcp/tools/get-finding-context.js */ }
  registerTools({ ... });
})();
</script>`;
}
```

Wired next to `exclusionFilterScript()` on both `renderDomainReport` (the
landing page) and the accessibility page — same two call sites
`exclusionFilterScript()` already has (`report-html.js:1677`, `:3333`).

### Filter/sort logic: deliberate duplication, not a shared package

Same precedent as `exclusionFilterScript()`'s inline `compile()`/`apply()`
(which duplicates matching logic rather than importing a bundler-free
browser build of a shared module): `listFindings`'s filter/sort/bound logic
is a small, hand-written mirror of `mcp/tools/list-findings.js`, not an
import. C-04 already rules out coupling a browser bundle to the Node-only
`mcp/` package; this makes that explicit at the code level. The mirror is
small enough (severity filter, `min_pages_affected`, `rule_id`, sort by
`pages_affected` descending, a `limit` cap) that drift risk is low and is
caught by the render/e2e tests in WP03 asserting output shape matches the
API contract, not by trying to keep two implementations byte-identical.

### Tool registration shape

Static tool names/descriptions/schemas (NFR-04), matching the local MCP
server's naming so the same mental model applies: `vital_get_project_context`,
`vital_list_findings`, `vital_get_finding_context`. Whatever the actual
WebMCP registration call turns out to require (input schema format, return
envelope) is adapted at WP02 time — this plan fixes the *tool contract*
(names, arguments, return shape), not the *registration mechanics*.

### Size budget

NFR-01's target is under 2 KB gzipped for the whole `<script>` block. WP03
measures the actual gzipped size of the generated script (a simple test:
gzip the string, assert byte length) and records it in the mission's
completion notes — if it doesn't fit, the scope in WP02 gets trimmed
(e.g. drop client-side sorting and let the caller sort) rather than the
budget being quietly raised.

## Work Breakdown

1. **WP01 — Config flag** — `config/targets.yml` (documented example),
   `src/lib/config.js` (`t.webmcpEnabled`); `tests/unit/config.test.js`
   additions. Covers FR-01.
2. **WP02 — Bridge script** — `webmcpBridgeScript()` in
   `src/report-html.js`, wired at both existing `exclusionFilterScript()`
   call sites; feature detection, same-origin fetch + cache, the three tool
   handlers. Covers FR-02–FR-07, NFR-02, NFR-04, C-05 (pin the actual
   detection/registration call here, against the proposal's state at
   implementation time).
3. **WP03 — Size budget + render + adversarial tests** — gzip-size
   assertion against the NFR-01 budget; a render test asserting the script
   is present only when `webmcp: true` (Scenario 2) and absent/inert
   otherwise (Scenario 3); a hostile-finding-text fixture through
   `listFindings`/`getFindingContext` mirroring the local MCP server's NFR-05
   test (Scenario 4); if time/environment allows, the real headless-Chromium
   check described in Technical Context (Scenario 1). Covers NFR-01, NFR-05,
   NFR-06.
4. **WP04 — Docs** — a `## WebMCP` section in `MCP.md` (not a new file —
   keeps the "MCP-related" documentation in one place) covering the config
   flag, the size budget, what's shared with the local MCP server and what
   isn't (C-04), and the explicit unstable-API caveat (C-05); a short
   README mention. Covers spec.md Success Criterion 5.

Dependency order: WP01 has no dependencies. WP02 depends on WP01 (needs the
resolved flag). WP03 depends on WP02. WP04 depends on WP02 (needs the final
shape to document) but can start drafting in parallel.

## Complexity Tracking

*Fill ONLY if Charter Check has violations that must be justified.*

No charter violations requiring justification beyond what the Charter Check
section already states directly: this mission adds client-side JS by
necessity (WebMCP's entire premise requires runtime browser JS), and the
sustainability gate is satisfied by opt-in scope + a hard size budget rather
than by the usual build-time-preferred pattern.
