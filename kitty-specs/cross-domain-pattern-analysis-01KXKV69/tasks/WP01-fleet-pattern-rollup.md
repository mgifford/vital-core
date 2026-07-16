---
work_package_id: WP01
title: Fleet pattern rollup
dependencies: []
requirement_refs:
- FR-001
- FR-002
- FR-003
- FR-004
- FR-005
tracker_refs:
- '#221'
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this mission were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-cross-domain-pattern-analysis-01KXKV69
base_commit: 323ddcf87969d9995abf181c9b0ce7452c9c289b
created_at: '2026-07-16T02:09:25.354494+00:00'
subtasks:
- T001
- T002
assignee: claude
agent: claude
shell_pid: '12596'
history: []
agent_profile: node-norris
authoritative_surface: src/lib/priority.js
create_intent: []
execution_mode: code_change
model: ''
owned_files:
- src/lib/priority.js
- src/report-html.js
- tests/unit/lib.test.js
role: implementer
tags: []
---

# WP01: Fleet pattern rollup

## ⚡ Do This First: Load Agent Profile

Use the `/ad-hoc-profile-load` skill to load the agent profile specified in the frontmatter, and behave according to its guidance before parsing the rest of this prompt.

- **Profile**: `node-norris`
- **Role**: `implementer`
- **Agent/tool**: `claude`

If no profile is specified, run `spec-kitty agent profile list` and select the best match for this work package's task_type and authoritative_surface.

---

## Objective

Add a fourth fleet-level rollup to the dashboard: group accessibility
findings by the existing `pattern_id` across all active domains, filter to
patterns seen on ≥2 sites, rank by fix leverage, and render a new
"Recurring patterns across domains" section (`#h-patterns`) — following the
exact merge/filter/rank/render shape already used by the three existing
fleet sections (`#h-worst`, `#h-techfindings`, `#h-lhfleet`).

## Context

Issue [#221](https://github.com/mgifford/vital-core/issues/221) ("Finding
patterns between sites") asks: instead of only "where are the errors?",
answer "what should we fix first to improve the most sites?" — surface
findings that recur across independently-scanned domains, since those point
at a shared CMS template, design-system component, or widget bug rather than
one site's content problem.

`pattern_id` already exists and is already stable across domains: it's
computed as `hash(engine, ruleId)` in `buildBugReports`
(`src/lib/bug-report.js:49`) — the *same* rule on two different domains
produces the *same* `pattern_id`. Today it is only used **within** one
domain's week-over-week ledger (`aggregate.js:210`, `api-writer.js:123`) to
track first/last-seen. Nobody currently rolls it up **across** domains. This
WP closes that gap using data that already exists — no scan-time changes, no
`data/` schema changes.

The dashboard (`renderDashboard` in `src/report-html.js`) already has three
precedents for exactly this shape of cross-domain rollup:

- `fleetWorstOffenders` (`src/lib/priority.js:40`) — flattens ranked bugs
  across domains, `#h-worst` section at `report-html.js:3891`.
- `mergeFleet` / `rankFleetAssociations` (`src/lib/tech-findings.js:123`,
  `:155`) — merges per-domain co-occurrence models, ranks by
  `lift × sites`, `#h-techfindings` section at `report-html.js:3919`.
- An inline Lighthouse-recommendation merge at `report-html.js:3956` —
  `#h-lhfleet` section.

Copy this shape. Do not invent a new aggregation framework.

### Subtask T001: `mergeFleetPatterns` / `rankFleetPatterns` in `src/lib/priority.js`

**Purpose**: Pure functions that group bugs by `pattern_id` across domains
and rank the result by fix leverage, callable the same way
`fleetWorstOffenders` already is.

**Steps**:

1. Open `src/lib/priority.js`. It currently exports `priorityScore`,
   `rankBugs`, `fleetWorstOffenders`, and defines `SEVERITY_WEIGHT` at the
   top (`{ Critical: 4, Serious: 3, Moderate: 2, Minor: 1 }`).
2. Add `mergeFleetPatterns(perDomain)`, same input shape as
   `fleetWorstOffenders`: `perDomain` is `[{ target, bugs }]` where
   `target` has `.domain` and `.key`, and `bugs` is that domain's bug-report
   array (each bug has `.pattern_id`, `.rule_label`, `.wcag_sc`,
   `.severity`, `.frequency.pages_affected`, `.likely_source`, per
   `buildBugReports`'s output shape in `src/lib/bug-report.js`).

   Group by `pattern_id`. For each pattern accumulate:
   - `pattern_id`
   - `rule_label`, `wcag_sc`, `severity`, `likely_source` — taken from the
     **first** bug encountered for that pattern (representative metadata;
     do not attempt to merge/reconcile if they differ slightly across
     domains — first-seen wins, matching how `fleetWorstOffenders` already
     just flattens without reconciliation).
   - `sites` — count of **distinct** domains (`target.key`) that have at
     least one bug with this `pattern_id`. Track via a `Set` per pattern,
     convert to count at the end. Do not double-count a domain that has the
     same pattern on multiple pages within itself — that's `pages`, not
     `sites`.
   - `pages` — sum of `bug.frequency.pages_affected` across every bug with
     this `pattern_id`, across every domain.
   - `domains` — array of `{ domain: target.domain, key: target.key }` for
     every distinct domain carrying this pattern, for linking. One entry
     per distinct domain (not per bug).
   - `representative` — `{ domain: target.domain, key: target.key, week:
     bug._week }` from the **first** bug encountered, so the render step
     can link to one concrete finding (mirrors how `fleetWorstOffenders`
     already carries `domain`/`key`/`week` per entry for linking).

   Return an object/array shape that's easy to rank — e.g. an array of
   `{ pattern_id, rule_label, wcag_sc, severity, likely_source, sites,
   pages, domains, representative }`. (Unlike `mergeFleet`, which returns an
   intermediate model consumed by a separate rank function, here it's fine
   for `mergeFleetPatterns` to return the array directly — there's no
   pairwise lift computation needed, so an intermediate model buys nothing.
   Keep `rankFleetPatterns` as a thin filter+sort so the two-function shape
   still mirrors `mergeFleet`/`rankFleetAssociations` for readability, but
   don't force an unneeded intermediate representation.)

3. Add `rankFleetPatterns(merged, { minSites = 2, limit = 25 } = {})`:
   - Filter to entries with `sites >= minSites`.
   - Compute `score = sites * (SEVERITY_WEIGHT[severity] ?? 1) * pages`,
     rounded the same way `priorityScore` rounds (`Math.round(x * 100) /
     100`) to avoid float noise in tests/snapshots.
   - Sort descending by `score`, tie-break by `sites` descending (mirrors
     `rankFleetAssociations`'s `sort((a, b) => b.score - a.score || b.sites
     - a.sites)`).
   - Return the top `limit`.

4. Export both functions.

**Files**:
- `src/lib/priority.js` — add `mergeFleetPatterns`, `rankFleetPatterns`.
  Expect roughly +40 to +60 lines. Do not modify `priorityScore`,
  `rankBugs`, or `fleetWorstOffenders`.

**Validation**:
- `npm run test:unit` passes, including T002's new tests.
- Manually trace: a pattern present on only 1 domain is excluded from
  `rankFleetPatterns`'s output at the default `minSites=2`.
- Manually trace: the same `pattern_id` on 3 domains with `pages_affected`
  10, 5, 20 produces one merged entry with `sites: 3`, `pages: 35`.

### Subtask T002: Unit tests + dashboard section

**Purpose**: Prove the merge/rank functions are correct, then wire the
result into `renderDashboard` as a new section.

**Steps — tests**:

1. Open `tests/unit/lib.test.js`. It already has a `test('priority: ranks by
   pages x severity x reach; fleet flattens across domains', ...)` block
   around line 650 that imports from `../../src/lib/priority.js` and uses a
   small `bug(sev, pages, prev)` helper. Add a **new** `test(...)` block
   near it (don't cram into the existing one — keep it a separate,
   focused test) that:
   - Imports `mergeFleetPatterns`, `rankFleetPatterns` from
     `../../src/lib/priority.js`.
   - Builds bugs with a shared `pattern_id` across ≥2 synthetic domains and
     asserts `sites`/`pages` aggregate correctly.
   - Asserts a pattern on only 1 domain is dropped by `rankFleetPatterns`
     at `minSites: 2` but present at `minSites: 1`.
   - Asserts ranking order: a low-severity/many-sites pattern vs. a
     high-severity/few-sites pattern — assert whichever has the higher
     `sites × severityWeight × pages` product sorts first (compute the
     expected order by hand in the test, don't just assert "is sorted").
   - Asserts empty input (`mergeFleetPatterns([])`) returns `[]`, and
     `rankFleetPatterns([])` returns `[]`.

**Steps — dashboard rendering**:

2. Open `src/report-html.js`. Find `renderDashboard` (the function
   containing the `#h-techfindings` block — search for
   `techFindingsSection`). The three existing fleet sections
   (`worstSection`, `techFindingsSection`, `lighthouseFleetSection`) are
   computed in sequence starting around line 3890, then concatenated into
   the page body around line 4020 (`${worstSection}` /
   `${techFindingsSection}` / `${lighthouseFleetSection}`).
3. After the `lighthouseFleetSection` block closes (after the `if
   (lhFleet.length) { ... }` block, before the `const body = ...` /
   `${worstSection}` concatenation point), add:
   ```js
   // Fleet-wide recurring patterns: the same pattern_id (same underlying
   // axe/Alfa rule) appearing on multiple independent domains is the
   // strongest signal of a shared CMS template, design-system component,
   // or widget bug — issue #221. Ranked by fix leverage (sites × severity
   // × pages), not raw count, so a moderate issue hitting 50 sites can
   // outrank a critical issue on one site.
   const patternEntries = active.map((d) => ({ target: d.target, bugs: d.series[d.series.length - 1]?.bugs ?? [] }));
   const mergedPatterns = mergeFleetPatterns(patternEntries);
   const fleetPatterns = rankFleetPatterns(mergedPatterns, { minSites: 2, limit: 25 });
   let patternsSection = '';
   if (fleetPatterns.length) {
     patternsSection = `
   <section aria-labelledby="h-patterns">
   ${heading('h-patterns', t('Recurring patterns across domains'))}
   <p class="meta">${t('The same underlying rule failing on multiple independent sites — the strongest signal of a shared CMS template, design-system component, or widget bug rather than a one-off content issue. Ranked by fix leverage: sites affected × severity × pages, not raw count.')}</p>
   <table class="sortable">
   <caption>${t('Top @n patterns spanning ≥2 sites.', { '@n': fleetPatterns.length })}</caption>
   <thead><tr>
     <th scope="col">${t('Pattern')}</th>
     <th scope="col">${t('Severity')}</th>
     <th scope="col">${t('Likely source')}</th>
     <th scope="col" class="num">${t('Sites')}</th>
     <th scope="col" class="num">${t('Pages')}</th>
   </tr></thead>
   <tbody>${fleetPatterns
       .map((p) => `<tr>
     <th scope="row"><a href="reports/${esc(p.representative.key)}/${esc(p.representative.week)}/index.html">${esc(p.rule_label)}</a></th>
     <td><span class="sev-badge">${esc(t(p.severity))}</span></td>
     <td>${esc(t(p.likely_source ?? 'Unknown'))}</td>
     <td class="num">${p.sites}</td>
     <td class="num">${p.pages}</td>
   </tr>`)
       .join('\n')}</tbody>
   </table>
   </section>`;
   }
   ```
   Match the *exact* empty-state convention used by `techFindingsSection`/
   `lighthouseFleetSection`: `''` when nothing qualifies, no empty table
   ever rendered (FR-005).

   Adjust field names/paths above if the actual shape of `d.series[...]`
   or `bugs[].likely_source` differs slightly from what's described here —
   verify against `buildBugReports`'s real output
   (`src/lib/bug-report.js`) and the `active`/`d.series` shape already used
   two sections above by `techFindingsSection` (`d.series[d.series.length -
   1]?.techFindings?.model`) and `lighthouseFleetSection` (`d.series[...]
   ?.lighthouse?.recommendations`) before assuming the snippet above is
   copy-paste correct — those two existing sections are the ground truth
   for how to read `active`/`d.series`, follow their exact pattern for
   reading `bugs` too.
4. Add the import for `mergeFleetPatterns`, `rankFleetPatterns` at the top
   of `src/report-html.js` wherever `fleetWorstOffenders` (or the
   `priority.js` import) is already imported — extend that same import
   line/block, don't add a new duplicate import statement.
5. Insert `${patternsSection}` into the body template alongside
   `${worstSection}` / `${techFindingsSection}` / `${lighthouseFleetSection}`
   (right after `${lighthouseFleetSection}`, so ordering is worst →
   tech-findings → lighthouse → patterns).
6. Do **not** add a new top-level subnav entry — this section lives on the
   existing fleet dashboard page exactly like the other three, reachable
   via the same page's existing structure (FR-004: "same outcome group
   these other fleet sections already live under").
7. `.sortable` table CSS, `.sev-badge` styling, and `heading()`/`esc()`/
   `t()` helpers are all pre-existing — do not add new CSS.

**Files**:
- `tests/unit/lib.test.js` — add new `test(...)` block per above. Expect
  roughly +25 to +40 lines.
- `src/report-html.js` — add the `patternsSection` computation + render
  block in `renderDashboard`, plus the import line update, plus the
  `${patternsSection}` insertion point. Expect roughly +35 to +50 lines.

**Validation**:
- `npm run test:unit` green.
- `npm run i18n:check` green — if it flags new user-facing strings, add
  them via `npm run i18n:extract` regenerating `src/locales/template.json`;
  do not hand-edit that file.
- `npm run check:spec-kitty` green.
- Manual verification: run `npm run aggregate` against existing `data/` (or
  whatever local fixture data is available) and confirm the dashboard
  either shows the new "Recurring patterns across domains" section when ≥2
  domains share a pattern, or omits it cleanly (no empty table, no broken
  layout) when they don't. If no local multi-domain fixture data exists,
  state this explicitly rather than claiming visual verification that
  wasn't actually performed.

---

## Acceptance criteria covered by this WP

- [ ] `mergeFleetPatterns` groups bugs by `pattern_id` across all active
      domains, tracking sites, pages, severity, and representative metadata.
- [ ] `rankFleetPatterns` filters to `sites >= minSites` (default 2) and
      ranks by `sites × severityWeight × pages`, not raw count.
- [ ] Dashboard renders "Recurring patterns across domains" (`#h-patterns`)
      using the same table/empty-state conventions as the three existing
      fleet sections, linking each pattern to a representative finding.
- [ ] Section is omitted (not an empty table) when there's nothing to show.
- [ ] Unit tests cover the merge/rank functions.
- [ ] `npm run test:unit`, `npm run i18n:check`, `npm run check:spec-kitty`
      all green.
- [ ] No `data/` schema change; no new runtime dependency; no new
      client-side JS.

FR-006 (CSV export of the ranked pattern list) is explicitly out of scope
for this WP per `plan.md` — do not implement it here.
