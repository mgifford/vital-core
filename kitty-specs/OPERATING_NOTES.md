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

## Generated Orientation Block

The block between `<!-- spec-kitty:orientation -->` markers in
`.github/copilot-instructions.md` is rewritten by Spec Kitty from the state of
the machine that ran it, and anything inside the markers is overwritten. Keep
repository guidance below the closing marker. If a run leaves the block saying
`project: unknown`, `migration-required` or `upgrade-available`, restore it with
`git checkout -- .github/copilot-instructions.md`; `npm run check:spec-kitty`
fails if it is committed. The real migration state comes from
`spec-kitty upgrade --agent-check`.

## Report Standards

Generated reports must remain accessible without JavaScript, use semantic HTML,
and tell a clear story of change week to week. Charts should never be the only
way to understand a metric.

## Working Rule

Do not hand-edit generated data or report artifacts when the source scripts can
rebuild them deterministically.
