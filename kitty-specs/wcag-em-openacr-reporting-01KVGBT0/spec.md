# Spec: Weekly WCAG-EM / OpenACR reporting

**Status**: WP01 DONE / WP02 partially done (aggregate wire-up complete; smoke-check pending real data run)

## Goal

Wire the existing `src/lib/acr.js` OpenACR YAML generator into the weekly
report pipeline so an `acr.yaml` file is written for every domain/week as
part of `npm run aggregate` (and therefore the daily `report.yml` GitHub
Action). Fix the correctness defects found during code review before shipping.

The scope is *automated baseline* output only. This is not a full W3C WCAG-EM
conformance evaluation — the YAML explicitly caveats that automated tools
find ~⅓ of real barriers and that manual AT testing is required. The value
is a machine-readable, week-over-week ACR that teams can commit to source
control and layer manual findings on top of.

## Acceptance criteria

### WP01 — Correctness fixes in `src/lib/wcag.js` and `src/lib/acr.js`

- [x] `wcag.js`: `4.1.3` Status Messages corrected to `wcag_version: '2.1'`
      (it was added in WCAG 2.1, not 2.0).
- [x] `wcag.js` WCAG_CRITERIA includes the five criteria that `acr.js` WCAG_CATALOG
      lists but WCAG_CRITERIA was missing: `1.2.3`, `1.2.4`, `1.2.5`, `3.2.3`, `3.2.4`.
- [x] `acr.js:168` `failRate` denominator uses `Math.max(axePages, alfaPages, 1)`
      unconditionally — removing the `axePages > 0` guard that caused all
      Alfa-only failures to be misclassified as `partially-supports`.
- [x] `acr.js` YAML `version` field emitted as a quoted string (`version: "1"`)
      rather than a bare integer.
- [x] Unit test added: Alfa-only scan with >5% failure rate → `does-not-support`
      (regression guard for the failRate bug).
- [x] All existing unit tests still pass (`npm run test:unit`).

### WP02 — Wire into aggregate pipeline + report link

- [x] `src/aggregate.js` imports `writeAcrYaml` from `./lib/acr.js`.
- [x] `aggregate.js` calls `writeAcrYaml(repDir, target, summary, summary.week)`
      for every domain/week in the per-week loop, storing the returned
      `acrData` on `summary` so the accessibility page can use it.
- [x] `src/report-html.js` `renderAccessibilityPage` accepts an `acrYaml`
      option and, when present, renders a download link to `acr.yaml` with a
      brief note explaining what it is.
- [ ] Running `npm run aggregate` against real data/ produces an `acr.yaml`
      in each domain's report directory (manual smoke-check).
- [ ] The file validates against the OpenACR YAML schema
      (catalog: `2.5-edition-wcag-2.2-en`) — confirmed by eyeballing the
      generated YAML for required fields: `title`, `product`, `report_date`,
      `catalog`, `chapters`.
- [x] All unit tests still pass (103 pass, 0 fail).

## Out of scope

- `acr.html` human-readable ACR page (deferred; output format TBD).
- A separate GitHub Actions workflow file — the existing `report.yml`
  triggers `aggregate.js`, so wiring into aggregate is sufficient.
- Full W3C WCAG-EM methodology (representative sampling, manual AT testing,
  structured evaluation steps). This is automated output, not a full WCAG-EM audit.
- Changing the `partially-supports` / `not-evaluated` threshold (5%) — that
  is a policy decision for a later mission.
- AAA criteria or functional performance criteria in the OpenACR output
  (currently `disabled: true`).
