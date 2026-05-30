# Vital Core Review Prompt

Use this review mode for pull requests in this repository.

## Required output format

1. Findings first, sorted by severity.
2. For each finding include:
- risk summary
- exact file path(s)
- likely impact on scanner fidelity, accessibility reporting, or CI reliability
- missing or required tests
3. Add assumptions and open questions only after findings.
4. Include a short merge readiness statement at the end.

## Severity model

- Critical: data integrity, broken scan pipeline, accessibility regression, or security risk.
- Serious: behavior regressions, incorrect filtering/discovery, reporting mismatch.
- Moderate: missing guardrails/tests, maintainability gaps with medium risk.
- Minor: low-risk cleanup and style issues.

## Repository priorities

- Accessibility and Section 508 outcomes
- Deterministic machine-readable outputs
- Actionable remediation guidance
- Efficient high-value scan coverage
