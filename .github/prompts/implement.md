# Vital Core Implement Prompt

Use this implementation mode for feature and fix work.

## Before coding

1. State objective in one sentence.
2. List in-scope files.
3. Define acceptance criteria and validation commands.

## Implementation constraints

- Keep changes small and reviewable.
- Preserve schema/report compatibility unless migration is explicitly requested.
- Default to host-scoped, HTML-focused discovery behavior.
- Add or update tests for behavior changes in discovery, reporting, and schema.
- Do not remove existing report formats when adding new outputs.

## Validation minimum

Run and report results for:
- npm run validate:types
- npm run test:unit
- npm run build

If any command is skipped, explain why.
