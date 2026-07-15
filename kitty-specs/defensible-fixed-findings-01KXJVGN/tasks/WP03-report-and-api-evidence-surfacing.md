---
work_package_id: WP03
title: Report and API evidence surfacing
dependencies:
- WP02
requirement_refs:
- FR-004
- FR-005
- NFR-02
tracker_refs: []
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this mission were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T006
- T007
- T008
agent: "claude"
history: []
agent_profile: node-norris
authoritative_surface: src/report-html.js
create_intent: []
execution_mode: code_change
model: ''
owned_files:
- src/report-html.js
- src/lib/api-writer.js
- tests/unit/report-html.test.js
- tests/unit/api-writer.test.js
role: implementer
tags: []
assignee: "claude"
---

# WP03: Report and API evidence surfacing

## ⚡ Do This First: Load Agent Profile

Use the `/ad-hoc-profile-load` skill to load the agent profile specified in the frontmatter, and behave according to its guidance before parsing the rest of this prompt.

- **Profile**: `node-norris`
- **Role**: `implementer`
- **Agent/tool**: `claude`

If no profile is specified, run `spec-kitty agent profile list` and select the best match for this work package's task_type and authoritative_surface.

---

## Objective

Give every "Fixed this week" item on the Layer-1 landing page a visible
`pattern_id` and a clickable link to the evidence (its affected pages), and
expose the confirmed-vs-coverage-lost distinction in the static JSON API, so
issue #222's "where's the evidence for this claimed fix?" question has a
concrete, clickable answer instead of a bare line of text.

## Context

Issue #222's root complaint: the "Fixed this week" list
(`progressSection()` in `src/report-html.js:758-787`) currently renders each
fixed item as plain text — a severity badge plus a summary string, no
`pattern_id`, no link, nothing a reader can click to verify the claim. Compare
this to the live accessibility page, where every finding links via
`pageHref('accessibility', instance_id)` (see `src/report-html.js:325-327` for
the helper, and `src/report-html.js:2448` / `:3522` for call-site examples).

This WP depends on **WP02**, which splits `weekDeltas()`'s `fixed` bucket
(`src/lib/progress.js:39-54`) into a confirmed-fixed sub-bucket and a
coverage-lost/unconfirmed sub-bucket, using the `_coverageLost` ledger flag
added in WP01. By the time this WP runs, `progress.fixed` (or whatever shape
WP02 lands — check WP02's actual output before starting; this prompt assumes
two arrays are available, e.g. `progress.fixed` for confirmed and
`progress.fixedUnconfirmed` / `progress.coverageLost` for the rest — confirm
the exact key names against WP02's committed code and `plan.md`/`data-model.md`
before writing T006/T007) exposes both buckets distinctly. Never merge them
back into one undifferentiated "Fixed this week" list — that would silently
reintroduce the exact defensibility gap this mission exists to close (spec.md
acceptance criterion: "A finding whose affected pages were **not** re-crawled
this week is never labeled 'Fixed' without qualification").

Key design decisions from `plan.md` (IC-03):

- **Reuse the existing `pageHref()` linking convention**, not a new one. Every
  other evidence link in the report already goes through
  `pageHref('accessibility', instance_id)` or a similar `pageHref(key, anchor)`
  call — the fixed-list links should look and behave the same way for
  consistency (same anchor format, same relative-href/locale-suffix handling).
- **No new client-side JS** (NFR-02). These are plain server-rendered `<a
  href="...">` anchors, resolved at build time in `aggregate.js`/
  `report-html.js`. Do not add a fetch, a client-side lookup, or any new
  `<script>` block to satisfy this requirement — the existing
  `triageCompletionScript()`/`severityBurndownChart()` client bits in
  `progressSection()` are unrelated prior art and out of scope to touch except
  where the fixed-list markup itself changes.
- **JSON schema change must be additive** (spec.md C-01, "no forced
  `findings.json` migration"). Add a new field to the per-finding object in
  `buildWeekFindings()`'s output; do not rename, remove, or restructure any
  existing field.

## Subtasks

### Subtask T006: Add pattern-id and evidence link to "Fixed this week" items

**Purpose**: Turn each confirmed-fixed entry in `progressSection()` from plain
text into a line that shows its `pattern_id` and links through to a
representative sample of the pages that prove the fix, reusing the existing
`pageHref()` convention.

**Steps**:
1. Open `src/report-html.js` and locate `progressSection(progress, bugs)`
   (currently `src/report-html.js:758-787`). Focus on the `fixedList` block
   (`src/report-html.js:775-778`), which currently renders:
   ```js
   const fixedList = fixed.length ? `<h3 class="progress-sub">${t('Fixed this week')}</h3>
   <ul class="fixed-list">${fixed.slice(0, 15)
     .map((f) => `<li><span class="sev-badge">${esc(t(f.severity ?? 'Undetermined'))}</span> ${esc(f.summary ?? f.ruleId ?? f.id)}</li>`)
     .join('')}</ul>${fixed.length > 15 ? `...` : ''}` : '';
   ```
2. Confirm what evidence data is actually available on each fixed item by the
   time this WP runs. WP02 pushes `{ id, ...f }` from the ledger (per
   `src/lib/progress.js:50`, `id` is the pattern_id / ledger key). Check
   whether `affected_pages` (or an equivalent sample of URLs) is carried on
   the ledger finding object `f` — search `src/lib/findings.js` for how
   `affected_pages` is populated on ledger entries (it's the same field
   referenced in FR-004: "reuse `affected_pages` already carried on the
   ledger/report data"). If the field name differs from `affected_pages`,
   use whatever the ledger actually stores; do not invent a new field on the
   ledger in this WP (that's IC-01/WP01/WP02 territory).
2b. Confirm there is an `instance_id` (or equivalent per-page identifier) you
    can pass to `pageHref('accessibility', anchor)` for at least one
    representative affected page. If the ledger only stores raw URLs and not
    `instance_id`s that resolve to accessibility-page anchors, link to the
    accessibility page filtered/anchored by `pattern_id` instead (check how
    the accessibility page anchors findings — `src/report-html.js:2448`,
    `:2655` — and reuse whatever anchor scheme already exists for a
    pattern/rule, e.g. a rule-group heading id). Do not build a new anchor
    scheme; find and reuse what's already there.
3. Rewrite the `fixedList` template literal so each `<li>` renders, in order:
   the severity badge (unchanged), the summary text (unchanged), the
   `pattern_id` in a small distinguishable style (e.g. a `<code>` or `<span
   class="pattern-id">VS-xxxxxxxx</span>`), and a link
   (`<a href="${esc(pageHref('accessibility', anchor))}">...</a>`) to the
   representative evidence page/anchor. Follow the exact `esc()` escaping
   pattern used elsewhere in this function — every interpolated value in this
   file goes through `esc()` before being placed in HTML.
4. Keep the existing `fixed.slice(0, 15)` cap and the "…and more" overflow
   note (`src/report-html.js:778`) — do not change the truncation behavior,
   only the per-item markup.
5. If the WP02-produced ledger entry lacks a resolvable anchor for some
   reason (e.g. field genuinely absent for older, pre-mission ledger data),
   degrade gracefully: render the `pattern_id` as plain text (not a dead
   link) rather than throwing or omitting the item. This preserves C-01
   (no forced migration / no crash on old ledger shapes).

**Files**:
- `src/report-html.js` — modify `progressSection()`'s `fixedList` block only
  (approx. 10-20 changed/added lines within the existing ~30-line function;
  do not touch the badges/triage/chart blocks in the same function).

**Validation**:
- `npm run test:unit` (this subtask's own tests land in T008, but re-run
  after T006+T007 together since they touch the same function).
- If you have browser-preview capability, spot-check the rendered "Fixed this
  week" list in a built report (`npm run aggregate` against a fixture domain,
  or reuse whatever local preview flow the profile loaded in the "Do This
  First" step recommends) — per CLAUDE.md, UI-affecting changes should
  ideally be visually spot-checked, not just asserted against via regex in
  tests.

### Subtask T007: Visually distinguish coverage-lost / unconfirmed items

**Purpose**: Ensure the "dropped from this week's sample" bucket (from WP02)
is never silently folded into "Fixed this week" — it must be its own labeled
section with an explanatory note, so a reader can immediately tell the
difference between "we verified this is gone" and "we just didn't check."

**Steps**:
1. In the same `progressSection()` function, after confirming (from WP02's
   actual committed shape — check `src/lib/progress.js` as WP02 leaves it,
   and `plan.md`/`data-model.md` if present) the exact property name for the
   unconfirmed/coverage-lost bucket on the `progress` object, destructure it
   alongside the existing `fixed`/`burndown`/`streaks` reads at the top of
   the function (`src/report-html.js:759-761`).
2. Add a second list block, structurally parallel to `fixedList` but visually
   and textually distinct:
   - Heading: something like `t('Dropped from this week's sample')` (do not
     reuse the "Fixed this week" heading string — translators need a
     distinct source string per the i18n conventions in CLAUDE.md; run
     `npm run i18n:extract` after adding new `t()` calls per CLAUDE.md's i18n
     workflow, or note in your commit that it still needs running if you
     can't run it in this environment).
   - A short explanatory sentence directly under the heading, plain language,
     e.g. explaining that these findings disappeared from this week's scan
     but their previously-affected pages weren't re-crawled to confirm they're
     actually fixed (do not imply that they are still broken either — the
     honest claim is "unknown," not "still broken").
   - Each item rendered the same way as T006's fixed items (pattern_id +
     evidence link where resolvable), so the reader can go look at the
     historical evidence even though it's not currently reconfirmed.
   - Use a distinct CSS class (e.g. `coverage-lost-list` vs `fixed-list`) so
     the two are stylable differently if `src/report-html.js`'s CSS string
     constant is later updated to visually differentiate them (do not add new
     CSS in this subtask unless the existing `.fixed-list`/`.bug-meta` styles
     make the new list illegible — keep changes minimal per CLAUDE.md
     "Surgical Changes").
3. Only render this second block when the bucket is non-empty (same pattern
   as `fixed.length ? ... : ''` used throughout this function) — an empty
   "Dropped from sample" heading with nothing under it would be noise.
4. Update the function's top-of-file doc comment
   (`src/report-html.js:752-757`, "Layer-1 progress panel...") to mention the
   new coverage-lost block in one sentence, consistent with the existing
   comment style (only touch this comment, not unrelated ones, per CLAUDE.md
   "Surgical Changes").

**Files**:
- `src/report-html.js` — same function as T006; expect a similar-sized
  addition (~20-30 lines) for the new block plus the doc-comment update.

**Validation**:
- `npm run test:unit` after T006+T007 land together.
- Confirm by inspection (or browser preview, if available) that the two
  lists render as visibly separate sections with different headings — not
  two subsections that look identical except for a label, and not merged
  into one list with a type flag buried in the markup.

### Subtask T008: Expose coverage-confirmation status in the static JSON API + unit tests

**Purpose**: Give external API consumers (`docs/api/v1/<key>/<week>/findings.json`)
the same honesty signal the HTML report now shows, and lock in both T006/T007's
HTML behavior and this JSON field with unit tests.

**Steps**:
1. Open `src/lib/api-writer.js` and locate `buildWeekFindings(target, summary,
   bugs, ledgerFindings)` (currently `src/lib/api-writer.js:114-140`). Each
   finding is built from `ledgerFindings?.[b.pattern_id]` (line 123,
   `ledgerEntry`).
2. Add a new field to the per-finding object returned in the `findings.map(b
   => ...)` block (lines 124-137), e.g. `coverage_status:` (pick a name
   consistent with spec.md FR-005's wording — "`confirmed` vs
   `coverage_lost`"), computed from `ledgerEntry?._coverageLost` (the flag
   WP01 adds to ledger entries): `_coverageLost` truthy → `'coverage_lost'`,
   otherwise `'confirmed'`. Follow the existing `deriveTrend()` pattern
   (lines 27-38) for how a small pure helper reads off `ledgerEntry` — add a
   similarly small helper (e.g. `deriveCoverageStatus(ledgerEntry)`) rather
   than inlining a ternary directly in the map, for consistency with
   `deriveTrend`'s style.
3. Make sure the new field defaults sensibly when `ledgerEntry` is `null`
   (finding not in the ledger, or ledger predates this mission) — per C-01,
   this must not throw and must not require migrating existing
   `findings.json` files. A reasonable default is `'confirmed'` (absence of
   the flag means nothing to distrust), but check WP01's actual semantics for
   `_coverageLost` before deciding — if WP01's doc comments say something
   different, follow that.
4. This is additive only: do not rename `trend_status` or any other existing
   key, do not remove any existing field, do not change the shape of
   `top_actions` or any other part of the output.
5. Add unit tests:
   - In `tests/unit/api-writer.test.js`, inside or near the existing
     `describe('buildWeekFindings', ...)` block (currently starts at line
     139), add cases: (a) a bug whose `ledgerEntry` has `_coverageLost: true`
     produces `coverage_status: 'coverage_lost'` in the output; (b) a bug
     whose `ledgerEntry` has no `_coverageLost` (or `_coverageLost: false`)
     produces `coverage_status: 'confirmed'`; (c) a bug with no matching
     `ledgerEntry` (not present in `ledgerFindings`) still produces a valid
     `coverage_status` (the default) without throwing. Follow the existing
     `FAKE_TARGET`/`FAKE_SUMMARY`/`FAKE_BUG`/`FAKE_LEDGER` fixture pattern
     already used in that test file (see calls at lines 141, 146, 162, 169,
     176, 181, 186, 207, 225) rather than inventing new fixture shapes.
   - In `tests/unit/report-html.test.js`, extend or add near the existing
     `'renderDomainReport progress panel: burndown, streaks, triage count,
     fixed list'` test (currently at line 278) — or add a new sibling test —
     asserting: the rendered HTML for a confirmed-fixed item contains its
     `pattern_id` string and a `<a href="...">` pointing at the expected
     `pageHref()`-derived target; a coverage-lost/unconfirmed item (using
     whatever property WP02 added to the `progress` fixture object) renders
     under a distinctly-labeled heading/section, not inside the
     `fixed-list`/"Fixed this week" block. Use the existing fixture-building
     style in that test (plain object literals for `target`, `series`,
     `bugs`, `progress` — see lines 279-299) rather than introducing new
     helpers.

**Files**:
- `src/lib/api-writer.js` — add one small helper function (~5-10 lines) plus
  a one-line addition to the per-finding object in `buildWeekFindings()`.
- `tests/unit/api-writer.test.js` — add 2-3 new test cases (~20-40 lines).
- `tests/unit/report-html.test.js` — extend/add 1-2 test cases (~20-40 lines).

**Validation**:
- `npm run test:unit` must pass, including the new cases.
- Manually inspect one generated `findings.json` fixture (or a real one under
  `docs/api/v1/` if you run `npm run aggregate` locally) to confirm the new
  field appears without disturbing existing keys — this is the concrete
  check for the "additive, non-breaking" requirement (spec.md C-01,
  Reviewer Guidance below).

## Definition of Done

- [ ] T006: Each "Fixed this week" item shows its `pattern_id` and a working
      link to representative evidence pages, reusing `pageHref()`.
- [ ] T007: Coverage-lost/unconfirmed items render in a separate, clearly
      labeled section (not merged into "Fixed this week"), with an
      explanatory note.
- [ ] T008: `buildWeekFindings()` output in `src/lib/api-writer.js` carries a
      `coverage_status` (or equivalently named) field per finding, additive
      only, defaulting safely when ledger data is absent.
- [ ] Unit tests added/extended in both `tests/unit/report-html.test.js` and
      `tests/unit/api-writer.test.js` covering confirmed and coverage-lost
      cases.
- [ ] `npm run test:unit` passes.
- [ ] No new client-side JavaScript was added to satisfy this WP (NFR-02) —
      evidence links are plain server-rendered anchors.
- [ ] Spec.md acceptance criteria satisfied end-to-end for this WP's scope:
      "The public HTML report's 'Fixed this week' list shows a `VS-xxxxxxxx`
      pattern id (or equivalent) and a working link per item, not plain
      text"; "`findings.json` / the static API surfaces the same confirmed
      vs. coverage-lost distinction machine-readably"; a reader can see *why*
      something is marked fixed and click through to the pages that prove it.
- [ ] Existing committed `findings.json` files / ledger fixtures still load
      and render without migration or crashes.

## Risks

- **NFR-02 (client-side JS budget)**: The temptation to make the evidence
  links "smarter" (e.g. client-side filtering, a fetch to enrich the link) must
  be resisted — this WP's links are plain anchors resolved at build time, full
  stop. Adding any new `<script>` or client-side fetch here is out of scope
  and would violate the plan's explicit constraint (IC-03 risk in `plan.md`).
- **Burying the coverage-lost distinction**: If the new "dropped from
  sample" block is styled or worded so subtly that it reads the same as
  "Fixed this week" (e.g. same heading level with no visual differentiation,
  vague copy), this WP fails its actual purpose even if tests pass
  mechanically — this is the single most important reviewer check.
  Copy/paste-style repurposing of the fixed-list markup without a distinct
  heading string, a distinct CSS class, and an explanatory sentence, does not
  satisfy FR-004/the acceptance criteria.
- **JSON schema break**: Renaming, removing, or restructuring any existing
  key in `buildWeekFindings()`'s output (rather than strictly adding a new
  one) would break C-01 and any external consumer of the current
  `findings.json` shape. Diff the before/after output for an unchanged
  fixture and confirm only an addition occurred.
- **Anchor/link resolution gaps**: Not every ledger finding may carry a
  resolvable `instance_id`/anchor for older data (pre-mission ledgers). The
  fallback (render pattern_id as plain text, no dead link) must not throw or
  silently omit the item — silently dropping evidence rows would itself be a
  defensibility regression.

## Reviewer Guidance

Focus review on:

1. **Does this actually answer issue #222's original complaint?** A reader
   looking at the "Fixed this week" list should be able to see the
   `pattern_id` and click through to real evidence — not just trust a
   summary string. Click the actual rendered links (or read the `pageHref()`
   call sites) and confirm they resolve to something meaningful, not a dead
   anchor or the wrong page.
2. **Is the coverage-lost bucket clearly distinguished, not buried?** Check
   for a genuinely separate heading, a distinct CSS class, and explanatory
   copy — not a same-looking list item with a subtly different label. This is
   the crux of the whole mission (spec.md problem statement point 3, "no
   coverage-lost signal") and the easiest thing to get technically-passing-
   but-substantively-wrong.
3. **Is the JSON schema change additive?** Confirm no existing field in
   `buildWeekFindings()`'s output was renamed, removed, or had its meaning
   changed — only a new field was added. Existing consumers of
   `findings.json` must keep working unmodified.
4. **No new client-side fetch/JS.** Confirm the evidence links are plain
   `<a href>` anchors resolved server-side at build time — grep the diff for
   any new `<script>` block, `fetch(`, or client-side DOM manipulation tied
   to this feature; there should be none (existing unrelated scripts in
   `progressSection()`, like `triageCompletionScript()`, are prior art and
   out of scope).
5. **Test quality, not just presence.** The new/extended tests in
   `tests/unit/report-html.test.js` and `tests/unit/api-writer.test.js`
   should assert on the actual pattern_id string and link target appearing in
   rendered output / JSON — not just that the function ran without throwing.

**Implementation command**: `spec-kitty agent action implement WP03 --agent <name>`

## Activity Log

- 2026-07-15T19:48:04Z – claude – Moved to in_progress
- 2026-07-15T19:48:18Z – claude – Implemented directly on branch wp03-report-and-api-evidence-surfacing (same rationale as WP01/WP02); merged to main at 851d1472f
