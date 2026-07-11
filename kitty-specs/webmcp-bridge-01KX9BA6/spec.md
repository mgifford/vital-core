# Spec: WebMCP Bridge — Read-Only Findings Tools in the Browser

**Mission**: `webmcp-bridge-01KX9BA6`
**Branch**: `main` (spec/plan artifacts only; a dedicated implementation
branch is created when WP work starts — see Assumptions)
**Status**: Draft
**Source issue**: [#214](https://github.com/mgifford/vital-core/issues/214)

---

## Purpose

Issue #214 proposes two separate deliverables: a **local MCP server** (shipped
as phase 1 in mission `local-mcp-server-01KX94K7` / PR #223 — stdio transport,
for a developer's coding client) and, later, **WebMCP** — a browser-facing
feature the issue is explicit is *not* the same thing:

> "WebMCP remains useful as a separate browser-facing feature. It is not the
> bridge between scan results and a local source tree."

This mission is issue #214's **step 10** (its own numbering) pulled forward
out of sequence, at the user's request, because it is architecturally
independent of the still-undone steps 4–9 (local repository source mapping,
Drupal evidence, reproduction, provenance, upstream discovery, patch
preparation — all of which require a local checkout WebMCP does not have).
WebMCP instead exposes the **same read-only evidence layer** the local MCP
server exposes, but to an agent operating **inside the browser** on the
published report site itself, via the emerging [WebMCP proposal](https://github.com/webmachinelearning/webmcp)
(W3C Web Machine Learning Community Group incubation — a JS API, likely
`navigator.modelContext` or equivalent, for a page to register tools an
in-browser AI agent can discover and call).

## Problem Statement

An AI agent browsing a Vital Core report (a browser extension, an
agentic-browsing session, a future browser-integrated assistant) currently
has no structured way to ask the page "what are this domain's top
findings?" — it can only scrape rendered HTML, the same problem #214
identified for local coding agents before the JSON API and local MCP server
existed. The public `/api/v1/` JSON API (issue #136) already provides
normalized data any script can fetch; WebMCP would make that data
**discoverable and callable as tools** by an in-browser agent, without the
agent having to know the API's endpoint shapes or scrape the page.

This is explicitly **not** a bridge to source code, patches, or local
repositories — an in-browser agent has no local checkout to reason about.
It is the same evidence-only capability as `vital_get_project_context` /
`vital_list_findings` / `vital_get_finding_context` from the local MCP
server, offered through a different, browser-native transport.

## Scope of this mission

Add an **opt-in, per-target** client-side script to the generated report
pages that, when the browser supports the WebMCP proposal (feature-detected;
a no-op otherwise), registers a small set of read-only tools sourced from
the same `/api/v1/` data already used by the local MCP server:

- A tool equivalent to `vital_get_project_context` (current domain, week,
  report links).
- A tool equivalent to `vital_list_findings` (filter/sort findings for the
  current domain).
- A tool equivalent to `vital_get_finding_context` (one finding's evidence
  by id).

It does **not** add a server, does not add write capability, does not touch
`mcp/` (the local MCP server is unrelated infrastructure — this mission only
touches the generated HTML/JS report output), and does not attempt local
source mapping, reproduction, or any of #214's remaining steps.

---

## Functional Requirements

| ID | Requirement | Status |
|---|---|---|
| FR-01 | A new per-target config flag (default `false`, e.g. `webmcp: true` in `config/targets.yml`, mirroring the existing `language_switcher` opt-in pattern) controls whether the WebMCP bridge script is emitted for a domain's report pages | Proposed |
| FR-02 | The bridge script feature-detects the WebMCP registration API at runtime; if unsupported, it does nothing further (no error, no fallback UI, no behavior change to the page) | Proposed |
| FR-03 | When supported and enabled, the script registers exactly three tools, functionally equivalent to the local MCP server's `vital_get_project_context`, `vital_list_findings`, `vital_get_finding_context` (same filters, same sort-by-pages-affected default, same bounded/truncated response shape) | Proposed |
| FR-04 | Tool data is sourced from the same public `/api/v1/` JSON already used by the local MCP server (`snapshot.json`, `<week>/findings.json`) for the **current page's domain only** — no cross-domain queries, no new server-side aggregation | Proposed |
| FR-05 | The bridge script is static, versioned, first-party JS shipped with the report build (no CDN, matching the repo's existing ParaCharts/Wappalyzer vendoring convention) — no runtime dependency on an external script host | Proposed |
| FR-06 | Tool schemas/descriptions are static in source, never constructed from finding content (same NFR-04 requirement as the local MCP server) | Proposed |
| FR-07 | Remote/scan-derived text (rule labels, descriptions) returned by a tool is treated as inert data, never interpreted or used to alter script behavior (same NFR-05 requirement as the local MCP server) | Proposed |

## Non-Functional Requirements

| ID | Requirement | Status |
|---|---|---|
| NFR-01 | **Sustainability gate (hard requirement, not optional):** the bridge script must be small (target: under 2 KB gzipped, matching the project's existing CSS budget order of magnitude) and loaded only when `webmcp: true` is configured for that target — domains that don't opt in ship zero additional bytes | Proposed |
| NFR-02 | The script is deferred/non-blocking and never affects the page's no-JavaScript baseline — with JS disabled or the WebMCP API absent, the page renders and functions exactly as it does today | Proposed |
| NFR-03 | No new build-time cost of consequence — the script is static (checked in, not generated per-build) and the config flag only gates whether a `<script>` tag is emitted, mirroring `languageRuntime()` / `exclusionFilterScript()` in `src/report-html.js` | Proposed |
| NFR-04 | Read-only in every dimension: no tool can write to the API, modify the page beyond what already happens, or trigger a scan | Proposed |
| NFR-05 | `npm run test:unit` stays green; new tests follow the repo's existing convention (no DOM mocking beyond what `tests/unit/i18n-render.test.js`-style render tests already do) | Proposed |
| NFR-06 | If a WebMCP JS library/polyfill is used rather than hand-rolled feature detection, it is small, vendored first-party (no CDN, per repo convention), and its choice/version is documented and justified in `plan.md` | Proposed |

## Constraints

| ID | Constraint | Status |
|---|---|---|
| C-01 | Progressive enhancement only — this is the project's `sustainable-web-output` charter directive applied directly: prefer build-time work over client-side; here the work is *inherently* client-side (WebMCP's premise requires runtime JS in the visitor's/agent's browser), so the constraint becomes "opt-in, minimal, and inert when unsupported" rather than "build-time" | Accepted |
| C-02 | Do not implement any capability beyond the three read-only tools already scoped for the local MCP server's phase 1 — no source mapping, no reproduction, no command execution, no writes | Accepted |
| C-03 | Do not consume undocumented internal data — only the published `/api/v1/` contract, same as the local MCP server (C-03 in that mission's spec) | Accepted |
| C-04 | Do not modify `mcp/` (the local MCP server) — this is a separate, browser-only surface; any logic shared between them (e.g. filter/sort semantics) is duplicated deliberately rather than coupling a browser bundle to a Node-only package | Accepted |
| C-05 | The WebMCP proposal itself is an active, pre-standardization incubation — treat its exact API shape as unstable; `plan.md` must record which revision/version is targeted and note that a future spec change may require a follow-up mission | Accepted |

## Out of Scope

- Any of issue #214's steps 2, 4–9 (SQLite cache, local source mapping,
  Drupal evidence, local reproduction, dependency provenance, upstream
  discovery, patch/report preparation) — those remain local-MCP-server-only
  concerns and are unrelated to a browser-facing surface.
- Any write capability, form submission, or page mutation beyond registering
  tools.
- Cross-domain or fleet-wide queries — the bridge only ever answers for the
  domain of the page it's running on.
- A polyfill or shim for browsers that don't support WebMCP — unsupported
  means silently absent, not simulated.
- Making WebMCP the default for all targets — it stays opt-in per FR-01
  unless a future mission proposes otherwise.

---

## User Scenarios & Testing

### Scenario 1: An in-browser agent asks about the current report
A visitor is using a browser with an agentic assistant that supports WebMCP,
viewing `www.cms.gov`'s accessibility report. The assistant discovers the
page's registered tools and calls the findings-list tool with a severity
filter.
**Acceptance**: The tool returns the same data (same fields, same
sort/filter semantics) the local MCP server's `vital_list_findings` would
return for that domain/week.

### Scenario 2: A domain that hasn't opted in
A target's config has no `webmcp: true` (the default).
**Acceptance**: No WebMCP script is emitted for that domain's pages at all —
byte-for-byte identical output to before this mission, for that target.

### Scenario 3: A browser without WebMCP support
A visitor's browser has no WebMCP API, on a domain that *has* opted in.
**Acceptance**: The script detects this and does nothing further; page
weight includes the (small, gzip-tiny) script but no runtime behavior
change, no console errors, no broken rendering.

### Scenario 4: Hostile finding content
Same adversarial case as the local MCP server: a finding's `rule_label`
contains text engineered to look like an instruction.
**Acceptance**: Returned verbatim as tool-call response data; no script
behavior changes as a result.

---

## Success Criteria

1. The bridge script is opt-in per target, emits nothing when disabled, and
   is under the NFR-01 size budget when enabled.
2. All three tools return data consistent with the equivalent local MCP
   server tool for the same domain/week.
3. No-JS and WebMCP-unsupported baselines are unchanged from today's output.
4. `npm run test:unit` passes with new tests; no regressions.
5. `MCP.md` (or a new `WEBMCP.md`, decided in `plan.md`) documents the
   feature, the config flag, the size budget, and explicitly what is out of
   scope.

## Sustainability Acceptance Criterion

This is the one part of issue #214's roadmap that **does** add client-side
JavaScript and does **not** run at build time — flagged directly rather than
glossed over. The charter's `sustainable-web-output` directive is satisfied
by construction rather than by avoidance: **opt-in** (zero cost for targets
that don't enable it — the overwhelming majority by default), a hard size
budget (NFR-01), no CDN/third-party script host (FR-05), and strict
progressive enhancement (NFR-02) so the existing no-JS/no-web-fonts/static-SVG
baseline is preserved for every visitor who isn't an opted-in domain's
WebMCP-capable agent. `plan.md` must show the actual measured gzipped size
against the 2 KB target before this mission can be considered complete.

---

## Key Entities

| Entity | Description |
|---|---|
| `webmcp` config flag | Per-target opt-in in `config/targets.yml`, default `false` |
| Bridge script | Static, first-party, vendored JS emitted only when `webmcp: true` |
| WebMCP tool triad | Browser-transport equivalents of `vital_get_project_context` / `vital_list_findings` / `vital_get_finding_context` |

## Assumptions

- The WebMCP proposal has a concrete, testable JS API by the time this
  mission is implemented; if it's still too unstable to target, `plan.md`
  should say so and this mission should be re-scoped or deferred rather than
  built against a moving target.
- Filter/sort/bounding semantics duplicated from the local MCP server's
  `mcp/tools/list-findings.js` / `get-finding-context.js` stay in sync by
  convention (both read the same `/api/v1/` contract); no shared package is
  created solely to DRY ~50 lines across a Node CLI tool and a browser
  bundle.
- The dedicated implementation branch is deliberately not named yet — it
  will be created once a Claude Code session or developer actually starts
  WP work, rather than guessed now, after `local-mcp-server-01KX94K7`'s
  `meta.json` had to be corrected mid-mission for exactly this reason.
