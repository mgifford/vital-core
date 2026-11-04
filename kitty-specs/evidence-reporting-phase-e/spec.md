# Evidence Reporting: Phase E

Status: implemented with automated validation. Spec Kitty runtime unavailable on PATH; no runtime gate or acceptance is claimed.

## Intent

Report readers and API/MCP consumers need evidence-backed weekly findings without conflating engine observations, related tests, remediation priority, owners, or fixes.

## Requirements

- Preserve raw observations, pattern/instance IDs, historical ledgers, API v1 fields, page URLs and fragments.
- Add ACT identities/status, correlation certainty and sanitized representative evidence to HTML and weekly JSON; MCP consumes the same record.
- Count complete confirmed duplicate finding groups once; never infer task or owner counts from grouped observations. Unknown task count is null.
- Distinct URL samples retain query variants and disclose incomplete coverage.
- Separate engine impact from legacy reporting severity and remediation priority.
- Build-time only, no client runtime or additional scans; preserve native disclosure and no-JavaScript usability.

## Acceptance

Focused reporting, API, MCP and HTML tests, all unit tests, e2e, i18n and governance validation pass. Human screen-reader verification remains a separate handoff requirement.