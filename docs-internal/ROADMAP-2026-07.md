# Roadmap — July 2026 review

Source: Fable-tier review session 2026-07-03 (efficiency + actionability + IA).
Each mission below is a spec-kitty mission candidate. Items are sized for
Sonnet-tier implementation; each has why / what / files / acceptance criteria.
Run `spec-kitty.specify` per mission before implementation.

Status legend: [x] done · [ ] todo

---

## Mission A — CI & scan efficiency

Baseline evidence (2026-07-03): ~7,900 runner-minutes/week across 48 scan
runs; tracked tree 543 MB (94k JSON files); git pack 468 MB; docs/ deploy
artifact 271 MB/day. Estimated energy ~100–200 kWh/yr ≈ 40–80 kg CO₂e/yr
(location-based, incl. 1.2 PUE; roughly double with embodied hardware).

### A1. [x] Sparse + partial checkout in scan.yml — DONE 2026-07-03
Scan jobs now check out only `src/ config/ vendor/ state/<domain>/
data/<domain>/` with `filter: blob:none`; matrix job only `src/ config/`.
Cuts per-job transfer from ~500 MB to tens of MB across hundreds of jobs/week.
Watch the first few scheduled runs: confirm the commit/rebase-retry step still
works under sparse checkout (jobs write disjoint paths, so rebases should
never need out-of-cone blobs).

### A2. [x] Independent networkidle cap — DONE 2026-07-03
`networkidle_cap_ms: 8000` in config/targets.yml defaults; src/scan.js uses
`min(networkidle_cap_ms, nav_timeout_ms)` instead of the full 30s
nav_timeout_ms. The wait is passive (Playwright listens, sends nothing), so
capping it cannot add load to target sites — it only stops beacon-heavy pages
from burning 30s of runner idle each. Verify: compare cms.gov job duration
before/after (~27 min baseline).

### A3. [x] Skip no-op scan jobs; surface cap status
Why: late-week runs spawn 11 jobs and 9 do nothing (weekly cap reached or
frontier empty) — each still pays checkout + npm ci + Chromium install.
What:
- In the `matrix` job, additionally sparse-checkout `state/` (small) and read
  each target's scanned-this-week count vs its importance-weighted cap
  (reuse the `weeklyCap` math from src/scan.js:117-119, extract to
  src/lib/state.js or a new lib so scan.js and the matrix step share it).
- Emit only domains with remaining budget AND a non-empty frontier.
- Emit a `::notice::` line listing domains skipped and why
  ("www.cms.gov: 5419/5000 cap reached", "hhs.gov: frontier empty (WAF)").
Note on caps (design decision recorded): the cap is per-domain *pages*, not a
cap on the number of domains — all targets scan every night until they
individually hit cap. Keep the cap: it bounds cost and, more importantly,
politeness toward client sites. The gap was visibility, which the notice fixes.
If a domain consistently hits cap early, raise its `max_pages_per_week` or
`importance` in config/targets.yml — that is the intended tuning knob.
Acceptance: a scheduled run where all domains are at cap spawns 0 scan jobs;
run summary lists per-domain reason. Unit test the budget-check helper.

### A4. [x] Memoize per-origin engines within a run
Why: src/scan.js:291-292 re-runs `runSecurity(baseOrigin, …)` and
`runPublicInterest(baseOrigin, …)` for every sampled page (~15 identical
origin-level request sets per run per domain).
What: compute once per run on first sampled page, reuse the result for later
pages in the same run (store in a run-scoped variable; keep per-page record
shape identical so aggregate.js is untouched).
Acceptance: run log shows security/public-interest network calls once per
run; per-page JSON unchanged in shape; existing tests pass.

### A5. [x] Investigate asset caching across pages in a run
Why: repeated CSS/JS downloads across the ~150 pages of a run may be wasted
transfer (also load on target CDNs).
What (investigate first, then decide):
1. Verify whether Chromium's in-context HTTP cache already dedupes assets —
   all pages share one browser context (src/scan.js:133), so assets with
   cache headers may already be served from memory. Measure: log
   `transferSize` for a repeated asset across pages.
2. CONSTRAINT: the sustainability engine measures page weight from real
   responses (src/engines/sustainability.js). Page weight must keep meaning
   "what a first-time visitor downloads." If forced caching would zero out
   asset bytes, either (a) record cache-hit bytes separately and reconstruct
   cold-load weight, or (b) exclude sustainability-sampled pages from forced
   caching. Do not silently change the metric.
3. Respect origin cache headers — do not cache what the site says not to
   (stale CSS would skew axe/alfa results after a mid-run deploy).
Acceptance: written findings note first; code change only if measurable
saving exists without corrupting sustainability numbers.

### A6. [x] Self-metering: publish what this service costs
Why: transparency — we score other sites' CO₂ with co2.js; report our own.
What:
- Weekly step (report.yml or a small cron workflow) queries the GitHub API
  for the past week's workflow job-minutes (`gh api /repos/{o}/{r}/actions/runs`
  → jobs, sum durations).
- Convert with documented assumptions (4-vCPU Azure runner, ~15–25 W average
  draw incl. host overhead, PUE 1.2, grid intensity constant) — keep the
  factors in one commented module, e.g. src/lib/self-meter.js.
- Store as append-only weekly record (e.g. data/_meta/service-cost.json) and
  render a small dashboard panel: runner-hours, est. kWh, est. g CO₂e,
  week-over-week trend.
Acceptance: dashboard shows current week's figures with an "assumptions"
disclosure link; numbers reproducible from the stored record.

---

## Mission B — Data lifecycle: keep trends, forget detail

Intent (owner decision, 2026-07-03): this is an insight-delivery system, not
an archive. Keep forever: weekly summaries, ledgers (findings, broken links,
resources, third-parties, inventory) — everything needed to know when an
issue was introduced, fixed, or re-introduced. Aggressively forget:
page-level detail that a newer scan supersedes.

- [x] B1. Reduce `retention_weeks` for page detail (config/targets.yml:20,
  src/prune.js). Proposal: 8 → 3. Check first what reads old pages/:
  aggregate.js diffing, CSV exports, bug-report examples — confirm none need
  more than current + previous week.
- [ ] B2. Deduplicate unchanged pages: if a page's record is materially
  identical to last week's (same findings fingerprint), consider storing a
  compact "unchanged, see <week>" stub. Design carefully against the
  longitudinal-consistency principle — summaries must still count the page.
- [x] B3. Git history strategy — DECIDED 2026-07-03: option (c) accepted —
  accept growth for now; partial clone (A1) shields CI. A daily size check in
  report.yml (gate job) warns when server-side repo size passes 1 GB; that
  warning is the trigger to revisit and execute option (b). Original options
  kept below for that future decision:
  prune.js deletes files but git history keeps every blob forever; the 468 MB
  pack becomes multi-GB in a year+. Options:
  (a) periodic history rewrite squashing scan-bot commits older than N weeks
      (rewrites history — conflicts with append-only doctrine; needs charter
      amendment + coordination since forks/clones break),
  (b) move data/ to a companion repo where history can be periodically
      truncated (shallow "rolling" repo), code repo stays light,
  (c) accept growth; partial clone (A1) already shields CI.
  Recommendation: (c) now, prepare (b) when pack > 1 GB.
- [x] B4. Whatever is chosen, document the retention contract in
  ARCHITECTURE.md: "summaries + ledgers forever; page detail N weeks; git
  history policy X."

---

## Mission C — Component clustering & the "next actions" queue (KEY)

The single highest-leverage product change. Developers fix templates and
components, not pages.

- [ ] C1. Cluster findings by component fingerprint.
  Fingerprint = normalized selector path + rule id (+ snippet shape). Page
  records already carry selectors/snippets (axe/alfa examples); tech-findings
  co-occurrence (src/lib/tech-findings.js) shows the join pattern.
  Output per cluster: rule, severity, distinct pages affected, representative
  selector/snippet, "fix one place, resolve N findings on M pages" estimate.
  Rank queue by (severity weight × pages affected) / distinct components.
  Reuse the existing `template_page_threshold` heuristic (targets.yml) as a
  validation signal, then supersede it with real clustering.
- [ ] C2. Design-system alignment.
  New per-target config in config/targets.yml, e.g.:
    design_system: cms-ds        # or uswds, none
    design_system_theme: medicare
  Detect component usage per page by class prefix (`ds-c-*` for the CMS
  design system, `usa-*` for USWDS) and attribute findings to *named design
  system components* ("ds-c-alert: 60% of contrast failures"). Flag pages
  using non-design-system lookalikes (drift). References:
  https://github.com/cmsgov/design-system , https://design.cms.gov/?theme=medicare ,
  prior art: https://github.com/mgifford/design-system-scan and
  https://mgifford.github.io/design-system-scan/ (align approach; do not
  copy code — see INSTRUCTIONS.md provenance rules).
- [ ] C3. "Next 10 actions" view per domain.
  One page: top 10 clusters from C1, each with severity, pages affected,
  who's impacted (FPC model), remediation tip, affected-pages CSV link,
  representative snippet. Include the triage controls that
  accessibility.html already has (see live example:
  reports/<domain>/<week>/accessibility.html) — decisions (fix now / defer /
  assigned-to) stored in localStorage with the same export/import/share
  mechanism as existing triage so a team lead can share state.
- [ ] C4. Copy-paste ticket text, not auto-filing.
  Teams use different GitHub orgs and JIRA — lowest common denominator wins.
  Per cluster: a "Copy as issue" button producing GitHub-flavored Markdown
  and a "Copy for Jira" (Jira wiki markup) variant. Content = the
  bug-report.js structure (rule, WCAG SC, severity, frequency, examples,
  remediation, honest "requires manual testing" placeholders).
  (Auto-filing to this repo's tracker stays an option later; do C4 first.)

---

## Mission D — Information architecture: progressive disclosure

Problem: the report nav (src/report-html.js:263-275) mirrors the *scanner's
engine list* (11 tabs: Accessibility, Lighthouse, Tech, Images…), not the
visitor's questions. Everything is dropped on the page at once; no sense of
progress.

Design principles to encode:
1. Three layers, three audiences, three time budgets:
   - Layer 1 "How are we doing?" (manager, 10 s): score + trend, three
     deltas (new / fixed / regressed this week), one "biggest available win"
     callout. This becomes the domain landing page.
   - Layer 2 "What do I do next?" (developer/designer, 2 min): the Mission C
     next-actions queue with triage.
   - Layer 3 "Show me the evidence" (auditor, deep session): today's engine
     pages, demoted to drill-downs reached from findings, plus CSV/API.
2. Reorganize nav by outcome question, not engine:
   Accessible? · Fast? · Findable? · Trustworthy (privacy/security)? ·
   Sustainable? — engines map many-to-one onto these.
3. Deltas everywhere: every headline number pairs with change vs last week
   (▲/▼ + sparkline). Totals alone don't create progress; differences do.
4. Progress artifacts: "Fixed this week" panel (ledger `lastSeenWeek` <
   current week), open-findings burndown by severity across weeks (ledger
   already has the series), triage completion ("12 of 40 findings triaged"),
   streak badges ("0 criticals for 3 weeks").
5. Collapsed by default with visible counts ("14 moderate findings ▸");
   inverted pyramid on every page (conclusion → support → raw data);
   one primary action per page.
6. One canonical location per finding (the cluster page); other pages link
   to it rather than re-rendering it with different framing.

- [ ] D1. Spec the new IA (page map + nav) — do together with C3.
- [ ] D2. Restructure domain landing page as Layer 1.
- [ ] D3. Regroup subnav by outcome; keep old URLs as redirects/aliases
       (external links and pinned-issue links must not break).
- [ ] D4. Delta/sparkline component reused across pages.
- [ ] D5. Progress panel (fixed-this-week, burndown, triage completion).

---

## Mission E — New data sources

- [ ] E1. Known-vulnerable JS libraries — new report tab.
  src/engines/tech.js already captures library versions (Wappalyzer). Join
  against a vulnerability dataset (retire.js data format is the reference;
  vendor a snapshot like vendor/wappalyzer with a VERSION date + refresh
  script, per provenance rules). Output per domain: library, detected
  version, known CVEs/severity, pages seen on. Add "Vulnerable libraries"
  to the trustworthy/security outcome area (Mission D grouping).
- [ ] E2. PDF accessibility engine.
  data/<domain>/resources.json already inventories every PDF. Scan a few per
  run (configurable, e.g. 5), newest-first by first-seen, then backfill older.
  Store MD5 of each file so re-review happens only on change; display the
  hash + last-checked date with each PDF. Checks (automated-only, honest
  placeholders like bug-report.js): tagged?, has title?, has language?,
  scanned-image-only (no text layer)?, page count, size. Prior art to align
  with (not copy): https://github.com/mgifford/pdf-crawler and
  https://github.com/bloom-works/simplA11yPDFCrawler .
- [ ] E3. Real-user Core Web Vitals via CrUX API (free, one HTTP call).
  Weekly: origin-level record + homepage. Answer to "other pages on
  alternating weeks?": worth trying but expect sparse data — CrUX only has
  page-level records for pages with sufficient traffic; deep pages 404.
  Design: try the priority URLs (config/profiles) monthly, store whatever
  returns, render "no field data" honestly for the rest.
- [ ] E4. Privacy signals (GDPR-relevant).
  Extends src/engines/third-party.js collector: cookies set before any
  consent interaction (count, domains, lifetimes), localStorage writes,
  known-tracker origins, fingerprinting API touches. Lives in the
  "Trustworthy?" outcome area next to security + third-parties.
- [ ] E5. Findability / content health from existing data (zero new
  collection): inventory.json is a link graph → orphan pages (in inventory,
  never linked), redirect chains, duplicate titles/descriptions across
  pages, dead-end pages. Render into the "Findable?" outcome area.
- [ ] E6. Visual site-structure graph per domain.
  From the same link graph: an interactive overview (depth rings or
  force-directed, but keep the no-JS-required principle — render SVG at
  aggregate time, enhance with JS) showing how content is organized,
  colored by section health. Helps everyone grok the site at a glance.

---

## Mission F — Shift left: PR-time regression checks

- [ ] F1. CLI mode: `node src/scan.js --url <preview-url> --compare <domain>`
  (or a new src/check.js): audit one URL with the same engines, fetch the
  domain's latest baseline from the static API (docs/api/v1/…/snapshot.json
  or findings.json), print new-vs-baseline findings, exit non-zero on new
  criticals. No state writes, no data/ writes.
- [ ] F2. A reusable composite GitHub Action wrapping F1 so client teams can
  drop it into their PR workflows against preview deployments.

---

## Suggested sequencing

1. Mission A remainder (A3, A4 small; A6 delightful) — Sonnet, independent PRs.
2. Mission C1 (clustering) — the keystone; C3/C4 and Mission D build on it.
3. Mission D spec (D1) alongside C3 so the queue lands inside the new IA.
4. Mission B decisions (B3 needs owner/charter input before code).
5. Mission E items are independent; E1 and E5 are cheapest wins.
6. Mission F after C1 so the diff uses cluster fingerprints.

Verification norms for every item: unit test for new lib code, e2e fixture
coverage where an engine or report page changes, and no change to committed
data shapes without a summary-schema version note in ARCHITECTURE.md.
