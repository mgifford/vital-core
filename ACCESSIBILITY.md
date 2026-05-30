# Accessibility Reporting Standard

This repository uses this file as a signal that accessibility requirements and reporting quality are mandatory.

## Scope

Applies to:

1. Scan logic
2. Report generation
3. Dashboard presentation
4. CI quality gates
5. Documentation and issue templates

## Minimum Reporting Fields

Every accessibility issue should include:

1. URL
2. Page title or context label
3. Target element locator
4. HTML snippet
5. Rule identifier
6. Severity
7. WCAG success criterion mapping
8. Section 508 mapping when available
9. Repro steps
10. Expected behavior
11. Actual behavior
12. Frequency or impact scope
13. Suggested remediation

## Severity Guidance

1. Critical
- Blocks core tasks for assistive technology or keyboard-only users.

2. Serious
- Major friction that prevents reliable completion for a significant user group.

3. Moderate
- Noticeable barrier that degrades quality and should be fixed in normal cycle.

4. Minor
- Low-impact issue that should be fixed during cleanup or related changes.

## Evidence Quality Standard

1. Findings must be reproducible.
2. Findings must be tied to real page evidence, not assumptions.
3. Systemic issues should be deduplicated with stable identifiers when possible.

## Accessibility Acceptance Baseline

Before release-ready status:

1. Keyboard navigation checks pass for primary flows.
2. Focus visibility and logical tab order are validated.
3. Form labels and error relationships are validated.
4. Color contrast checks meet baseline requirements.
5. Landmarks and headings are semantically coherent.

## CI Expectations

1. Failing accessibility regressions should block merge when confidence is high.
2. Known exceptions must be documented with owner and expiry.

## External Reference

Project direction should remain aligned with the public Accessibility.md initiative at:

https://mgifford.github.io/ACCESSIBILITY.md
