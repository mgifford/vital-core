# Operating Notes

## Source of Truth

GitHub is the canonical repository for code, config, and generated outputs.
Hugging Face Spaces is an optional deployment target. Hugging Face is only updated through the
`hf` remote and the publishing scripts.

## Validation Order

Before merging governance-sensitive changes, run the Spec Kitty checks, then
the repo-local governance gate, then YAML parsing, diff hygiene, and the unit
test suite.

The governance gate is `npm run check:spec-kitty`.

## Report Standards

Generated reports must remain accessible without JavaScript, use semantic HTML,
and tell a clear story of change week to week. Charts should never be the only
way to understand a metric.

## Working Rule

Do not hand-edit generated data or report artifacts when the source scripts can
rebuild them deterministically.
