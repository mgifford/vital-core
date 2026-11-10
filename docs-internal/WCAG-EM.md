# WCAG-EM and ACR: which evaluation artifact?

VITAL can publish one of two evaluation-oriented artifacts per target. They
answer different questions and are not interchangeable.

| Artifact | Question | Typical use |
|---|---|---|
| **OpenACR / ACR / VPAT-style** | What does the vendor/product say about conformance? | Procurement, especially in the USA and Section 508 contexts |
| **WCAG-EM-aligned evaluation** | How was this website evaluated, with what sample and what outcomes? | A website evaluation, especially outside the USA |

An ACR is a **procurement document**. WCAG-EM is a **W3C evaluation
methodology and report structure** for a website. A site-wide automated scan is
closer to the latter, provided the report is honest that the sample and manual
testing are incomplete.

## Configuration

Default remains OpenACR so existing US fleets do not change:

```yaml
defaults:
  evaluation_report: openacr   # openacr | wcag-em | both
```

Per target:

```yaml
targets:
  - domain: example.org
    evaluation_report: wcag-em
```

- `openacr` writes `acr.yaml`, `acr.html` and `acr.zip`.
- `wcag-em` writes `wcag-em.html` and `wcag-em.json`; it does not write an ACR.
- `both` writes both and shows both links during a transition.

The Accessibility page links whichever artifact is configured. The OpenACR output
remains an incomplete draft; the WCAG-EM output is an automated
pre-assessment, not a conformance evaluation.

## What the WCAG-EM output contains

- Scope: website, conformance target, evaluation date, pages scanned/audited,
  and the limitation that authenticated content and complete journeys are not
  established.
- Sample: explicitly **not** a WCAG-EM structured/random sample. It records the
  weekly crawl sample, gives evidence examples, and says they are not a complete
  sample.
- Methods: axe-core and Alfa versions, headless Chromium, no manual AT/keyboard
  testing.
- Results: every WCAG A/AA criterion is **Failure found** or **Not evaluated**.
  No criterion is marked passed or supported from absence of an automated
  finding.
- WCAG-EM step status: scope partial/automated; explore not performed; sample
  not WCAG-EM; audit automated only; report draft.
- Limitations and links to the W3C methodology and Report Tool.

`wcag-em.json` is a VITAL evidence export, **not** a native W3C WCAG-EM Report
Tool import file. Use it to complete the tool's scope, sample and audit steps;
do not claim the automated file is a completed evaluation.

## Recommended use

1. Run VITAL weekly as usual.
2. Download the WCAG-EM report for the week.
3. Use its failure/not-evaluated split and evidence examples to plan the manual
   evaluation.
4. Complete the W3C WCAG-EM Report Tool with a human-defined scope, structured
   and random sample, manual checks, accessibility support baseline and
   evaluator sign-off.
5. Publish an ACR only when a procurement process actually requires one, and
   only after manual completion.

## Downstream fleets

A non-US fleet such as LocalGov Drupal should set `evaluation_report: wcag-em`
in its own `config/targets.yml`. This repository does not edit downstream
configs, workflows or data.

## References

- https://www.w3.org/WAI/test-evaluate/conformance/wcag-em/
- https://www.w3.org/WAI/eval/report-tool/
- https://github.com/w3c/wai-wcag-em-report-tool
- https://github.com/GSA/openacr
