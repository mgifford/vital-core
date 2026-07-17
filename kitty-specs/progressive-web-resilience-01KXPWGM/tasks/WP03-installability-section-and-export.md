---
work_package_id: WP03
title: "Installability, Progressive Web Resilience section, report rendering, and export pipeline"
dependencies:
- WP01
- WP02
requirement_refs:
- FR-004
- FR-006
- FR-007
- FR-008
- C-01
- C-02
tracker_refs:
- '#145'
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this mission were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T005
- T006
- T007
- T008
owned_files:
- src/engines/standards.js
- src/report-html.js
- src/lib/csv.js
- src/aggregate.js
- src/lib/api-writer.js
- tests/unit/standards.test.js
create_intent:
- tests/unit/standards.test.js
execution_mode: code_change
authoritative_surface: src/engines/standards.js
role: implementer
tags: []
---

# WP03: Installability, Progressive Web Resilience section, report rendering, and export pipeline

## ⚡ Do This First: Load Agent Profile

Use the `/ad-hoc-profile-load` skill to load the agent profile specified in
the frontmatter, and behave according to its guidance before parsing the
rest of this prompt.

- **Role**: `implementer`
- **Agent/tool**: not fixed — resolve via `spec-kitty agent profile list`.

---

## Objective

This is the integration WP. It:

1. Derives an installability signal from WP01's manifest/service-worker
   data plus the existing HTTPS check (FR-004), as one more evidence-backed
   check — not a new aggregate score (C-02).
2. Restructures `runStandards()`'s return shape to introduce a
   `resilience` section (migrating the 5 existing `pwa-*` checks out of
   the flat `checks` array — no check exists in both places, FR-007).
3. Wires WP01's manifest/service-worker data, this WP's own installability
   signal, and WP02's offline/network checks into that section.
4. Renders a distinct "Progressive Web Resilience" subsection on the
   **"Findable?" page** (`findable.html`, `standardsSection()` in
   `src/report-html.js`, `#h-standards`) — correcting issue #145's own
   description, which pointed at a `standards.html` URL from an earlier
   report layout that no longer exists (see spec.md's "Correction to
   issue #145's framing"). There is no separate "Standards & Security"
   page in the current report — `security`/`third-party`/`errors` live
   under "Trustworthy?" instead.
5. Extends CSV and the static JSON API to carry the new fields (FR-008).

**Do not start this WP until WP01 and WP02 are merged** (or their branches
are available to build on) — this WP consumes both of their outputs.

## Context

Current `runStandards()` return shape (`src/engines/standards.js:120-127`):

```js
return {
  engine: 'standards',
  checks,       // flat array, includes 5 pwa-* entries mixed with schema-gov/canonical/etc.
  passed,
  total: checks.length,
  social: data.social.slice(0, 10),
  og: data.og,
};
```

After WP01 lands, `data.manifest` and `data.serviceWorker` are also
available inside `runStandards` (see WP01's prompt for their exact shape,
matching `data-model.md`'s `ManifestSummary`/`ServiceWorkerSummary`).

Current report rendering (`src/report-html.js:2510-2541`,
`standardsSection(summary)`): filters `std.checks` by `c.id.startsWith('pwa-')`
into a separate `pwaChecks` table — i.e. today's "section" is a runtime
filter over one flat array, not a real distinct data structure. This WP
replaces that filter-based split with a real `resilience` object.

Current aggregation (`src/aggregate.js:750-761`): accumulates
`rec.standards.checks` into per-check pass-rate totals across all crawled
pages (`standardsChecks[c.id] ??= { label, pass, total }`), the same
pattern `writeTrendsCsv` and `checkRow()` in the report both consume.
**New page-level checks (manifest/SW/installability) should aggregate the
same way.** New origin-level checks (offline/network resilience, from
WP02's `record.offlineResilience`) do **not** fit that pass-rate-across-pages
model — they follow the "latest wins" pattern `security`/`publicInterest`
already use (`aggregate.js:762-763`, no accumulation loop, just
`if (rec.x) xLatest = rec.x;`).

**A pre-existing gap to fix while in this code**: `publicInterestSection`'s
`badge()` helper (`src/report-html.js:2566-2570`) emits `class="pwa-badge pwa-pass"` /
`pwa-fail` / `pwa-partial`, but no `.pwa-badge` CSS rule exists anywhere in
the `CSS` template literal (`src/report-html.js:4400+`) — these badges
currently render unstyled. Since this WP reuses the same badge pattern for
the new tri-state resilience checks, add the missing CSS as part of this
WP (small, in-scope fix, not a separate cleanup task).

### Subtask T005: Installability signal

**Purpose**: A single derived Pass/Fail check with evidence explaining
which criterion (if any) is missing, computed purely from data WP01
already produces plus the existing `isHttps` value.

**Steps**:

1. Open `src/engines/standards.js`. After `const data = await
   page.evaluate(...)` returns (outer function scope, where `isHttps` is
   already available: `const isHttps = pageUrl.startsWith('https://');`
   near the top of `runStandards`), add a small pure helper:
   ```js
   function evaluateInstallability(isHttps, manifest, serviceWorker) {
     const reasons = [];
     if (!isHttps) reasons.push('not served over HTTPS');
     if (!manifest || manifest.parseError) reasons.push('no readable web app manifest');
     else {
       if (!manifest.display || !['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display)) {
         reasons.push('manifest display mode is not standalone/fullscreen/minimal-ui');
       }
       const hasLargeIcon = (manifest.icons || []).some((i) => {
         const sizes = String(i.sizes || '');
         return sizes.includes('192x192') || sizes.includes('512x512') || sizes === 'any';
       });
       if (!hasLargeIcon) reasons.push('no 192x192 or larger icon declared');
     }
     if (!serviceWorker?.registered) reasons.push('no service worker registered');
     return { installable: reasons.length === 0, reasons };
   }
   ```
   This mirrors typical browser install-criteria logic without claiming
   byte-exact parity with any specific browser's internal algorithm — the
   `detail`/`evidence` string reported downstream should make clear this
   is a heuristic derived signal, not a guarantee the browser will
   actually prompt install.
2. Call it: `const { installable, reasons: installReasons } =
   evaluateInstallability(isHttps, data.manifest, data.serviceWorker);`
   This feeds directly into T006's `resilienceChecks` assembly below — no
   separate return-shape change needed for this subtask alone.

**Files**: `src/engines/standards.js` — expect roughly +20 to +30 lines.

**Validation**: Covered by T006's tests (below) plus manual trace: all
criteria met (HTTPS + valid manifest with standalone display + 192 icon +
registered SW) → `installable: true`, `reasons: []`; each individual
missing criterion produces its corresponding reason string; multiple
simultaneous failures produce all applicable reasons, not just the first.

### Subtask T006: Restructure `runStandards()`'s return shape

**Purpose**: Introduce `resilience`, migrate `pwa-*` checks into it, wire
in WP01's data and T005's installability signal.

**Steps**:

1. The `checks`/`add(...)` block (currently
   `src/engines/standards.js:85-118`) needs restructuring:
   - Keep the non-PWA `add(...)` calls (`schema-gov`, `canonical`,
     `hreflang`, `title`, `description`, `charset`, `lang`, `viewport`,
     `open-graph`, `twitter-card`, `open-social`) exactly as-is in the
     `checks` array.
   - Remove the 5 `pwa-*` `add(...)` calls from `checks`.
   - Build a **separate** `resilienceChecks` array with its own `add`
     closure (or reuse the same helper with tri-state `status` instead of
     boolean `pass` — see `data-model.md`'s `ResilienceCheck` shape:
     `{ id, label, status: 'pass'|'fail'|'n/a', evidence, exampleUrl, why }`).
     Populate it with:
     - The 5 migrated checks (`pwa-https`, `pwa-manifest`,
       `pwa-service-worker`, `pwa-theme-color`, `pwa-apple-touch-icon`) —
       keep their existing `id`s unchanged (external consumers may key on
       them; only their *location* in the return shape changes, not their
       identity — see plan.md's Complexity Tracking entry on this).
     - New checks from WP01's `data.manifest` — prefer a small number of
       meaningful checks over one-per-field: `manifest-parsed` (pass when
       `data.manifest && !data.manifest.parseError`, evidence = the
       parsed summary), `manifest-maskable-icon` (pass when
       `data.manifest?.hasMaskableIcon`).
     - New checks from WP01's `data.serviceWorker` — e.g. `sw-active`,
       `sw-controlling`, again a small number of meaningful checks, not
       one-per-field.
     - T005's `installable` → one `installable` check, `status` derived
       from `installable`, `evidence` = joined `installReasons` (or "All
       installability criteria met" when true).
   - Every entry needs `why` (per `data-model.md`) — a short static
     explanation string per check `id`. Add a small lookup object/function
     mapping check id → why-string (e.g. `RESILIENCE_WHY = { 'pwa-service-worker': 'Enables offline access and background sync.', 'manifest-maskable-icon': 'Maskable icons let the OS safely crop/mask the app icon on different device shapes without clipping content.', 'installable': 'Determines whether the browser can offer "Add to Home Screen" / install.', ... }`).
     Write real, specific explanations — not filler — for each check id
     introduced by this mission.
2. Attach WP02's `record.offlineResilience` output (available at the
   `scan.js` call site, NOT inside `runStandards` — `runStandards` only
   receives `page`, not the origin-level result). This means: **do not**
   try to merge WP02's checks inside `runStandards()` itself.
   `runStandards()` returns its own `resilience.checks` (manifest/SW/
   installability/migrated pwa-*, all page-derivable). The offline/network
   checks from WP02 stay a **separate** `record.offlineResilience` field
   on the scan record (already wired by WP02's T004) — this WP's job in
   T007 below is to merge both into the report's view, not to make
   `runStandards()` aware of `offline-resilience`'s existence (keeps the
   two engines decoupled, matches how `security` and `publicInterest` are
   already separate top-level `record.*` keys, not nested inside
   `standards`).
3. Final `runStandards()` return shape:
   ```js
   return {
     engine: 'standards',
     checks,              // unchanged shape, pwa-* removed
     passed,
     total: checks.length,
     social: data.social.slice(0, 10),
     og: data.og,
     resilience: {
       checks: resilienceChecks,  // migrated pwa-* + new manifest/SW/installability checks
       manifest: data.manifest,
       serviceWorker: data.serviceWorker,
     },
   };
   ```

**Files**: `src/engines/standards.js` — expect roughly +50 to +80 lines
(net, including removals).

**Tests for T005+T006**: extend/create `tests/unit/standards.test.js`
(same file WP01 used/created) covering:
- All installability criteria met → `installable` check status `pass`.
- Each individual missing criterion (no HTTPS, no manifest, wrong display
  mode, no large icon, no SW) → status `fail` with the matching reason in
  `evidence`.
- `resilienceChecks` contains exactly the migrated `pwa-*` ids plus the
  new manifest/SW/installability ids — assert none of the 5 `pwa-*` ids
  appear in the top-level `checks` array anymore (FR-007's no-duplication
  requirement, directly testable).
- Every entry in `resilienceChecks` has a non-empty `why` string.

### Subtask T007: Aggregate rollup + report rendering

**Purpose**: Roll up the new per-page `resilience.checks` the same way
existing `standards.checks` already roll up (pass-rate across pages), fold
in WP02's per-origin offline/network checks ("latest wins"), and render a
distinct Progressive Web Resilience subsection.

**Steps — aggregate.js**:

1. Open `src/aggregate.js`. Near the existing `standardsChecks`/
   `standardsPages` accumulators (lines 628-630, 750-761), add parallel
   accumulators for `resilienceChecks`/`resiliencePages`:
   ```js
   const resilienceChecks = {};
   let resiliencePages = 0;
   let offlineResilienceLatest = null; // per-origin, latest wins — same pattern as securityLatest
   ```
   In the per-record loop (near `if (rec.standards) { ... }`), add:
   ```js
   if (rec.standards?.resilience) {
     resiliencePages++;
     for (const c of rec.standards.resilience.checks ?? []) {
       const s = (resilienceChecks[c.id] ??= { label: c.label, pass: 0, total: 0, why: c.why, evidenceExamples: [] });
       s.total++;
       if (c.status === 'pass') s.pass++;
       if (c.evidence && s.evidenceExamples.length < 3) s.evidenceExamples.push({ evidence: c.evidence, url: rec.url });
     }
   }
   if (rec.offlineResilience) offlineResilienceLatest = rec.offlineResilience; // origin-level, latest wins
   ```
   Adjust field names to match whatever `mark('standards')`/`record.standards`
   assembly already does at the `scan.js` call site — verify `rec.standards`
   is really the per-page object `runStandards()` returns (it is, per
   `scan.js:304`) before assuming this shape.
2. Add the rollup to the final summary object (near `standards:
   standardsPages ? {...} : null`, `aggregate.js:961-971`):
   ```js
   resilience: resiliencePages
     ? {
         pagesChecked: resiliencePages,
         checks: Object.entries(resilienceChecks).map(([id, s]) => ({
           id, label: s.label, pass: s.pass, total: s.total,
           rate: Math.round((s.pass / s.total) * 100),
           why: s.why,
           evidenceExamples: s.evidenceExamples,
         })).sort((a, b) => a.rate - b.rate),
         offline: offlineResilienceLatest,
       }
     : null,
   ```

**Steps — report-html.js rendering**:

3. Open `src/report-html.js`. In `standardsSection(summary)`
   (lines 2510-2541), the current PWA block derivation
   (`const pwaChecks = std.checks.filter(...)`) goes away since `pwa-*`
   is no longer in `std.checks` — replace it with reading
   `summary.resilience` (the new aggregate summary key from step 2, a
   sibling of `summary.standards`, NOT nested inside it — confirm this
   matches how `summary.security`/`summary.publicInterest` are already
   siblings of `summary.standards` at the call site, per
   `securitySection(summary)`'s existing `summary.security`/
   `summary.publicInterest` reads).
4. Replace the `pwaBlock`/`pwaChecks` logic with a new
   `resilienceSection(summary)` following the *same structural pattern*
   `publicInterestSection` already uses (badge + evidence + url + why),
   since that pattern already matches FR-006's Pass/Fail/N/A + evidence +
   URL + why reporting model better than the old flat pass-rate table:
   ```js
   function resilienceSection(summary) {
     const res = summary.resilience;
     if (!res) return '';
     const badge = (status) => status === 'pass'
       ? `<span class="pwa-badge pwa-pass" aria-label="${esc(t('pass'))}">✓</span>`
       : status === 'fail'
       ? `<span class="pwa-badge pwa-fail" aria-label="${esc(t('fail'))}">✗</span>`
       : `<span class="pwa-badge pwa-partial" aria-label="${esc(t('not applicable'))}">~</span>`;
     const rows = res.checks.map((c) => `<tr>
       <th scope="row">${esc(c.label)}</th>
       <td>${badge(c.rate === 100 ? 'pass' : c.rate === 0 ? 'fail' : 'partial')} ${c.pass}/${c.total} ${t('pages')}</td>
       <td class="bug-meta">${esc(c.why || '')}</td>
       <td class="bug-meta">${c.evidenceExamples?.[0] ? `<a href="${esc(c.evidenceExamples[0].url)}">${esc(c.evidenceExamples[0].evidence).slice(0, 80)}</a>` : '—'}</td>
     </tr>`).join('');
     const offline = res.offline?.checks?.length ? `
   <h4>${t('Offline & network resilience')}</h4>
   ${checklist(res.offline.checks.map((c) => ({ pass: c.pass, label: c.label, detail: c.detail })))}` : '';
     return `<h3>${t('Progressive Web Resilience')} <span class="bug-meta">${t('across @n page(s)', { '@n': res.pagesChecked })}</span></h3>
   <p class="meta">${t('Capabilities that keep the site useful under real-world conditions — unreliable connectivity, interrupted sessions, mobile install. Not a compliance score: each row is independent evidence.')}</p>
   <table>
   <caption>${t('Progressive Web Resilience signals (lowest pass rate first).')}</caption>
   <thead><tr><th scope="col">${t('Capability')}</th><th scope="col">${t('Result')}</th><th scope="col">${t('Why it matters')}</th><th scope="col">${t('Evidence')}</th></tr></thead>
   <tbody>${rows}</tbody>
   </table>
   ${offline}`;
   }
   ```
   Adjust markup/columns to fit the existing table conventions exactly
   (`<th class="num">` for numeric columns per CLAUDE.md conventions —
   the pass/fail column here is not purely numeric so left-aligned is
   correct; double check against existing similar tables before finalizing).
5. Call `resilienceSection(summary)` from inside `standardsSection`,
   replacing the old `pwaBlock` variable and its insertion point (was:
   `${pwaBlock}` at the end of the returned template — becomes
   `${resilienceSection(summary)}`; `standardsSection` already receives
   `summary` per its signature `function standardsSection(summary)`, so
   `summary.resilience` is directly accessible, no signature change
   needed).
6. Remove the now-dead `pwaChecks`/`hasSW`/`hasManifest`/
   `pwaInterpretation` local variables that only existed to build the old
   `pwaBlock` — but only the ones proven dead after this change; keep
   `metaChecks` if it's still used for the non-PWA checks table (it is —
   `metaChecks` filters the *remaining* `std.checks`, which still needs
   to exist for the "Web standards & metadata" main table, just without
   the old `pwa-` filter needed since those ids no longer appear in
   `std.checks` at all — simplify `metaChecks` to just `std.checks`
   directly once `pwa-*` is confirmed absent from that array).
7. **Fix the pre-existing missing CSS**: add `.pwa-badge`,
   `.pwa-pass`, `.pwa-fail`, `.pwa-partial` rules to the `CSS` template
   literal (`src/report-html.js:4400+`, near the existing `.checklist`
   rules at line ~4543-4547 for proximity). Follow the existing color
   variable conventions (`var(--better)` for pass, `var(--worse)` for
   fail — same variables `.checklist li.pass .check` / `.checklist
   li.fail .check` already use) plus a neutral color for `.pwa-partial`
   (check if a `--neutral` or similar variable already exists in `:root`;
   if not, pick a muted gray consistent with the existing palette — do
   not invent a new bright color). Keep additions minimal, within the
   documented ~2 KB CSS budget (CLAUDE.md sustainability gate) — this is
   a handful of small rules, should not meaningfully move that budget.

**Files**:
- `src/aggregate.js` — expect roughly +25 to +35 lines.
- `src/report-html.js` — expect roughly +40 to +60 lines (new function +
  CSS + call-site changes), with some lines removed (dead `pwaBlock` code).

### Subtask T008: CSV and static JSON API export

**Purpose**: Extend `src/lib/csv.js`'s trend export and confirm/complete
static-API passthrough for the new `resilience` field, per FR-008.

**Steps — CSV**:

1. Open `src/lib/csv.js`. `writeTrendsCsv` (lines 98-130) already adds a
   `standards_pass_pct` column derived from `s.standards.checks`. Add a
   parallel `resilience_pass_pct` column the same way:
   ```js
   s.resilience?.checks?.length ? passRate(s.resilience.checks) : '',
   ```
   inserted into the `rows.map(...)` array (after the existing
   `standards_pass_pct` value) and the corresponding header string added
   to the header array (after `'standards_pass_pct'`, before
   `'security_pass_pct'` — keep column order matching value order
   exactly, this is a common CSV bug class).
2. Check `bugsCsvTable()` (line 223) — confirm whether it includes any
   per-check columns at all (it's likely bug/finding-oriented, not
   check-oriented — read it first). If `resilience` checks don't fit
   `bugsCsvTable`'s row model (checks aren't "bugs"), do not force them in
   — the `trends.csv` column added above is the correct home for a
   summary metric; per-check detail belongs in the HTML report only,
   consistent with how the *existing* `standards.checks` are not
   individually broken out in any CSV today either (verify this is true
   before assuming — grep `csv.js` for any per-check CSV export of
   `standards.checks` as a sanity check; if one exists, mirror it for
   `resilience.checks` too for consistency).

**Steps — static JSON API**:

3. Open `src/lib/api-writer.js`. Based on investigation during this
   mission's planning: `weekly.series` in the domain-snapshot builder
   already carries full per-week summary objects through with no
   per-field allowlist — so `summary.resilience` should already appear in
   `docs/api/v1/<domain>/snapshot.json`'s `weekly.series[].resilience`
   automatically once `aggregate.js` (T007) attaches it, with **no
   api-writer.js code change required**. Verify this by running
   `npm run aggregate` against local/fixture data after T007 lands and
   inspecting the generated `docs/api/v1/<domain-key>/snapshot.json` for
   a `resilience` key inside a week's series entry. If it is missing,
   investigate whether `deepRedactUrls` or another transform in
   `api-writer.js` is stripping it (check `deepRedactUrls`'s allowlist/
   denylist logic) and add explicit wiring only if the automatic
   passthrough turns out not to work — do not add speculative wiring
   before confirming it's needed.
4. Check `buildWeekFindings` (line 114) and any other per-week API
   builder for whether `standards`/`security` currently get explicit
   top-level fields there (separate from the `weekly.series` passthrough)
   — if so, add `resilience` alongside them for consistency; if
   `standards`/`security` are *not* separately surfaced there today, don't
   introduce an inconsistent new precedent for `resilience` alone.

**Files**:
- `src/lib/csv.js` — expect roughly +2 to +5 lines.
- `src/lib/api-writer.js` — 0 lines if passthrough already works
  (verify first), otherwise up to +15 lines if explicit wiring is needed.

**Validation for T006-T008 (T005 validated above)**:
- `npm run test:unit` green — extend/add tests asserting the new
  `resilience` shape from `runStandards()` and its aggregate rollup.
- `npm run i18n:check` green — new user-facing strings (`'Progressive Web
  Resilience'`, `'Offline & network resilience'`, `'Why it matters'`,
  `'Evidence'`, etc.) need `t(...)` wrapping (already used in the snippet
  above) and must appear in `npm run i18n:extract`'s regenerated
  `src/locales/template.json` — run that command and confirm it's not
  stale.
- `npm run check:spec-kitty` green.
- Manual verification: run `npm run aggregate` against existing local
  `data/` (or available fixture data) and open the generated
  `findable.html` for a domain with standards data — confirm the
  "Progressive Web Resilience" subsection renders under `#h-standards`
  with real evidence, the pwa-badge icons are now visibly styled (not
  bare unstyled spans), and no empty table renders when there's nothing
  to show. If no local fixture data with standards results exists, state
  this explicitly rather than claiming visual verification that wasn't
  performed.
- Confirm `checks[].id` values for `pwa-https`/`pwa-manifest`/
  `pwa-service-worker`/`pwa-theme-color`/`pwa-apple-touch-icon` no longer
  appear in `runStandards()`'s top-level `checks` array (only in
  `resilience.checks`) — this is the explicit no-duplication requirement
  (FR-007).

---

## Acceptance criteria covered by this WP

- [ ] Installability is reported as one evidence-backed check derived
      from manifest + service-worker + HTTPS, with human-readable
      reasons for any unmet criterion — no new aggregate score (FR-004,
      C-02).
- [ ] `runStandards()` returns a `resilience` key distinct from `checks`;
      the 5 `pwa-*` checks exist only in `resilience.checks`, never in
      both places (FR-007).
- [ ] Every check in `resilience.checks` carries `status`
      (pass/fail/n/a), `evidence`, and `why` (FR-006's reporting model).
- [ ] The "Findable?" page (`findable.html`, `#h-standards`) renders a
      distinct "Progressive Web Resilience" subsection reusing the
      evidence+why+url pattern already established by
      `publicInterestSection`.
- [ ] Offline/network-resilience results (WP02's per-origin output) are
      folded into the same rendered section via aggregate.js's "latest
      wins" rollup, visually distinguished from the per-page checks table
      (they have a different pages-checked denominator).
- [ ] The pre-existing missing `.pwa-badge`/`.pwa-pass`/`.pwa-fail`/
      `.pwa-partial` CSS rules are added (fixes a real, previously-unstyled
      badge in `publicInterestSection` too, not just this WP's new usage).
- [ ] No check present in the new section duplicates an Accessibility or
      Lighthouse check (C-01 — verify none of the new `id`s collide with
      anything axe/Alfa/Lighthouse already reports).
- [ ] `trends.csv` gains a `resilience_pass_pct` column.
- [ ] Static JSON API (`docs/api/v1/<domain>/snapshot.json`) carries the
      new `resilience` field per week, verified by running
      `npm run aggregate` and inspecting output — with an actual
      wiring fix if automatic passthrough doesn't already cover it.
- [ ] `npm run test:unit`, `npm run i18n:check`, `npm run check:spec-kitty`
      all green.

This WP closes out spec.md's acceptance criteria as a whole — after this
WP, issue #145 should be answerable: "yes, the Findable? page now has a
dedicated Progressive Web Resilience section with manifest characteristics,
expanded SW state, offline/network signals, and installability, each with
evidence — not another aggregate score."
