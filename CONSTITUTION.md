# Vital Core Project Constitution

## Purpose

Vital Core exists to improve public-facing web quality for government services, with accessibility as a first-class outcome and practical remediation as the default output.

## Constitutional Principles

1. Public impact first
- Prioritize pages, workflows, and defects that most affect residents.
- Prefer findings that unblock real user tasks over cosmetic findings.

2. Accessibility is non-negotiable
- Treat WCAG and Section 508 requirements as core quality criteria.
- Do not ship changes that reduce accessibility coverage or report fidelity.

3. Evidence over assumptions
- Every high-severity finding must include reproducible evidence.
- Reports must trace back to URL, element, rule, and standards criterion.

4. Determinism and repeatability
- Scans should be reproducible with stable inputs and clear versioned logic.
- Keep schemas strict and outputs machine-consumable.

5. Minimize unnecessary load
- Constrain scan scope to high-value pages and in-scope hosts.
- Avoid broad crawling that creates cost without user value.

6. Prefer actionable outputs
- Every major finding should include remediation guidance.
- Exports must support engineering workflows in Markdown, CSV, and JSON.

7. Secure and responsible operation
- Do not collect secrets or sensitive personal data.
- Keep automation auditable through history artifacts and change logs.

8. Continuous improvement
- Use trend data and run history to improve coverage month over month.
- Evolve heuristics as federal sites and standards change.

## Decision Rules

1. When speed and coverage conflict, prefer reliable coverage of top-task pages.
2. When discovery is noisy, prioritize host-scoped and HTML-only sampling first.
3. When tests and implementation conflict, fix implementation unless tests are wrong by evidence.
4. When uncertain, choose the option that improves accessibility signal quality.

## Required Artifacts

1. Profile configuration for each monitored target set.
2. Versioned output schema for scan and finding data.
3. Issue exports in at least one human format and one machine format.
4. Run history and trend artifacts published with each scheduled run.

## Amendment Process

1. Open a pull request that describes the proposed change and rationale.
2. Include expected impact on accessibility outcomes and scan reliability.
3. Obtain maintainer approval before adoption.

This constitution is authoritative for project direction and review decisions.
