# Evidence reliability and reporting integrity — handoff (2026-11)

Repository: `mgifford/vital-core` only. No downstream repository, scan schedule,
workflow, or deployment was changed.

## Status

| PR | Scope | State |
|---|---|---|
| #318 | Observation identity, durable references, cross-surface validation | Merged |
| #319 | Live-inspection failure states, Chromium/WebKit activation, CSP tests | Merged |
| #320 | Finding-level evidence coverage, component inspection counts | Merged |
| #321 | Reporting integrity: associations, health label, draft ACR, Lighthouse | Open at handoff |
| PR 5 | Manual-review usability, handoff, measurements | This document |

## Architecture assessment

The work stayed inside the existing static architecture:

- Plain Node ESM, no build step, no database, no new browser session per finding.
- Evidence is collected once during the scan and consumed by the reports, API,
  Explorer, reproduction plan, bookmarklet payload and manual record.
- The additive v1 API shape is preserved (`schema_version: "1"`).
- Reports remain usable with JavaScript off. The new manual-review fields and
  coverage table are static/progressive; the review form is in the Explorer's
  client-side detail panel only.
- No AI diagnosis/remediation, no ARRM mapping, no browser extension, no
  downstream changes.

## Confirmed defects and fixes

1. **`instance_id` used the first captured example.** Adding an earlier page
   could move a `#VS-…` anchor. The legacy formula is frozen; `finding_ref`
   (`VFR-…`) is now the content-independent durable reference and renders as a
   stable anchor. A `VS → finding_ref` alias ledger remains future work.
2. **Representative selection used capture order.** It is now deterministic by
   evidence completeness, URL, selector, component and observation id.
3. **No per-scan observation identity.** Added `observation_id` (`VOB-…`) from
   occurrence + page/run/time/engine/consent state.
4. **Alfa findings offered live highlighting with no element evidence.** The
   report now says highlighting is unavailable and links to the install/problem
   guidance; no selector is invented.
5. **Access-denied pages looked like “element not found”.** The bookmarklet and
   local inspector now report **Page access blocked** and suggest the user's
   normal browser; neither bypasses access controls.
6. **No automated failure was reported as OpenACR `supports`.** The export is an
   INCOMPLETE DRAFT; A/AA criteria without a manual outcome are
   `not-evaluated`; no-manual-testing is explicit.
7. **Technology associations could surface weak pairs.** A 1.5× point estimate
   now also needs an approximate 95% interval excluding 1.
8. **The headline “Accessibility score” implied conformance.** Relabelled
   **Automated accessibility health (axe)** with a non-conformance caveat.
9. **Lighthouse savings mixed per-page and portfolio sums.** Per-page median and
   75th percentile are shown separately from total transfer across sampled
   pages; time savings are not summed into a visitor claim.
10. **Manual review records were blank with no reviewer/environment inputs.**
    The Explorer now captures reviewer, status, browser, assistive technology
    and viewport into the downloaded record only.

## Tested vs implemented

**Tested**

- Full unit suite: **786 pass, 0 fail** (Node's runner; includes Chromium and
  WebKit where noted).
- End-to-end pipeline: **all checks passed** over the two-week local fixture.
  This covers scan → aggregate → report → Explorer → API/CSV and the keyboard,
  forced-colours, bookmarklet and screenshot paths already in the suite.
- ACR YAML parsed and validated with pinned **OpenACR 0.3.8** and catalog
  `2.5-edition-wcag-2.2-en`: `Valid!`.
- Cross-surface synthetic suite: 12 scenarios, including header, footer, named
  navigation, search, form field, dialog, consent component, dynamic content,
  shadow DOM, iframe, document-level evidence and identical selectors.
- Chromium and WebKit `javascript:` activation, with no CSP and with
  `script-src 'self'`; both render without CSP and are blocked by script-src.

**Implemented but not human-verified**

- Actual browser bookmark-bar activation. The tests click a real `javascript:`
  link, which is a proxy, not the bookmark UI.
- Firefox, Edge, Safari UI and mobile browsers. Firefox 1522 timed out at launch
  locally and is untested; WebKit 26.4 launched and passed the proxy test.
- Screen-reader and human manual testing. No screen reader was run.
- Screenshots in this handoff. Screenshots remain opt-in; the configured target
  has `screenshots.enabled: false`, and no screenshot was fabricated.

## Identity and provenance

`docs-internal/EVIDENCE-IDENTITY-AUDIT.md` records the contracts and remaining
risks. Key results:

- Re-aggregation of identical data reproduces `occurrence_id` and
  `observation_id`.
- Adding a page leaves an existing occurrence's id and observation id intact;
  it can move the legacy `instance_id` anchor, which is why `finding_ref` exists.
- Re-running the same element in a new run keeps `occurrence_id` and changes
  `observation_id`.
- `finding_ref` survives sample changes, representative changes and
  re-aggregation.
- Weekly summaries retain representative evidence; screenshots and page detail
  remain subject to the configured retention policy; page detail is removed only by the verified, explicitly authorized retention command.

## End-to-end example (local fixture)

From `.e2e-sandbox/docs/reports/localhost/2026-W23/` after the e2e run:

| Field | Value |
|---|---|
| `instance_id` | `VS-10a5122e` |
| `finding_ref` | `VFR-75947b55` |
| `pattern_id` | `VS-9074b4dd` |
| `occurrence_id` | `VO-4dadbc14` |
| `observation_id` | `VOB-bfe9179b` |
| rule | `image-alt` (axe-core 4.14.0) |
| URL | `http://localhost:8123/page-15.html` |
| selector | `img` |
| region | `main` (unnamed) |
| screenshot | `screenshots/2e5504179274f244.jpg` (fixture; not shipped here) |

The same fields were observed in the report data, reproduction plan
(`status: not_attempted`), bookmarklet payload (`id`, `obs`, `ref`), and manual
record (`finding_ref`, `occurrence_id`, `observation_id`,
`not_a_conformance_claim: true`). The native text-fragment link was correctly
absent for this image-only finding.

## Browser and CSP matrix

| Condition | Chromium 148 | WebKit 26.4 | Firefox |
|---|---|---|---|
| No CSP, `javascript:` activation | Pass | Pass | Untested (launch timeout) |
| `script-src 'self'` | Blocked as expected | Blocked as expected | Untested |
| `script-src 'none'` | Blocked (earlier run) | Not separately rerun | Untested |
| `style-src 'none'` with inline script | Overlay rendered (CSSOM) | Untested | Untested |
| Actual bookmark-bar click | Manual only | Manual only | Manual only |
| Edge / Safari UI / mobile | Not tested | Not tested | Not tested |

`docs-internal/LIVE-INSPECT-HARDENING.md` is the detailed CSP/matching record.

## Component and evidence coverage

The e2e fixture week had:

- 14 findings; 70 stored occurrences.
- 5 findings with element evidence and a usable locator; 9 Alfa findings
  explicitly **not applicable** to element evidence (not “missing landmark”).
- 5 semantic-region captures; 2 widget captures; 2 configured-component
  attributions.
- 10 findings with a historical screenshot; 4 without.
- 5 findings eligible for deterministic reproduction; 9 unavailable.
- 1 configured component group, 1 region group, 1 widget group.

The new coverage block is finding-level. It does not turn occurrence counts into
finding counts, and separates `not_captured`, `not_applicable`,
`unsupported_dom_boundary`, `no_stored_examples`, `no_containing_landmark` and
`unavailable`.

## Reporting methodology changes

- **Associations:** effect threshold 1.5×, minimum sample 5 each way, approximate
  95% risk-ratio interval excluding 1, exploratory caveat. Raw lift remains in
  the data for API consumers.
- **Health label:** axe-only automated indicator, explicitly not WCAG
  conformance; Alfa separate.
- **ACR:** incomplete draft, no supports from absence, named unverified criteria,
  draft disclaimer. The generic automation author is **not** an accountable
  owner and must be replaced during human completion.
- **Lighthouse:** median/p75 per affected page plus sample-total transfer; no
  summed time-savings claim.

## ACR validation

Command (scratch install, not committed):

```bash
npx openacr validate -f draft.yaml \
  -c node_modules/@openacr/openacr/catalog/2.5-edition-wcag-2.2-en.yaml
# Valid!
```

The YAML was also parsed in the unit suite: integer `version`, string dates,
author email, no `supports`, `INCOMPLETE DRAFT` first note. It is **not a signed
ACR**; a qualified human must complete the manual outcomes.

## Accessibility test results

- Automated keyboard/focus assertions in the e2e suite pass, including Explorer
  open/close with Enter and focus movement to the detail heading.
- Forced-colours and 320px checks pass in their existing suites.
- Manual script review: review fields have visible labels; status is a native
  select; download is an explicit button; prompts are text, not colour-only.
- **No manual screen-reader test was run.** This is a limitation, not a pass.

## Performance and storage (local fixture, macOS)

Method: e2e fixture, two weeks, 14 tracked findings; `aggregate` timed after the
e2e run. Sizes include the generated reports. These are local measurements, not
production medians.

| Measure | Result |
|---|---|
| Aggregate, 2 weeks / 14 findings | **0.30 s** real |
| `accessible.html` | **263 KB** |
| `explore.html` | **102 KB** |
| `bugs.json` | **209 KB** |
| `acr.yaml` / `acr.html` | **34 KB** / **25 KB** |
| Whole `docs/` fixture output | **5.5 MB** |
| Bookmarklet | **24,853 bytes** |
| Inspection code payload | **318 bytes** |
| Coverage block | **~1.0 KB** JSON per week |
| `finding_ref` | **~30 bytes** per finding |
| New screenshots | **0** (opt-in/disabled; no new storage) |
| Extra scan sessions | **0** |

The Explorer script remains inline; caching it as a static asset is a documented
P3 follow-up. Manual-review fields are generated only when a finding is opened.

## Known unresolved issues

1. Legacy `#VS-…` anchors can still move; no alias ledger.
2. `occurrence_id` includes component attribution, so a changed component
   configuration can change it. Needs a versioned key if attribution changes.
3. Actual bookmark-bar activation, Firefox/Edge/Safari/mobile and screen readers
   are untested.
4. The ACR is an automated draft; no manual conformance outcome exists.
5. The association interval is approximate and uncontrolled; it is exploratory.
6. Component page-family distribution is not on component groups; it remains on
   bug reports.
7. Screenshots are opt-in and were not captured for this handoff.
8. The 12-scenario cross-surface suite is synthetic, not a manual inspection of
   production pages.
9. The "With locator" component count is a count of findings whose representative
   evidence has a selector, not a guarantee that every instance is inspectable.

## Deferred TODOs

`docs-internal/FINDING-EVIDENCE-ROADMAP.md` is the single roadmap. Deferred
items retain objective, dependencies, acceptance criteria, exclusions and
priority:

- Optional browser extension for one-click execution under restrictive CSP,
  same-origin frames and open shadow roots (P2; not required by any report).
- Playwright MCP-assisted discovery of interaction sequences, human-reviewed
  (P2; never per scheduled finding; no AI diagnosis).
- Deterministic interaction replay (P2).
- ARRM task/role mapping (P2; no automatic ownership).
- Guided manual assessment / Accessibility Insights-inspired workflow (P2).
- Design-system manifests (P3).
- Cross-fleet adoption and validation, without editing downstream repos (P3).
- Historical component trends with sampling-change awareness (P3).
- Cache the Explorer script as a static asset (P3).

## Review checklist

1. `git diff main...<PR branch>` — additive fields only; `schema_version` stays 1.
2. `npm run test:unit`, `npm run test:e2e`, `npm run i18n:check`.
3. Re-run the ACR validation command above on a generated draft.
4. Inspect one finding on the Accessibility page and Explorer; confirm the same
   `finding_ref`, `occurrence_id` and `observation_id` and that “Highlight on
   site” is absent for Alfa.
5. Confirm no downstream repository or workflow was touched.
