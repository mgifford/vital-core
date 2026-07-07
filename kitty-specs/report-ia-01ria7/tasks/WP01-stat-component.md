---
work_package_id: WP01
title: "Reusable stat component (statTile)"
dependencies: []
requirement_refs:
- FR-01
- NFR-01
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main (ia/progressive-disclosure). Merge back to main when WP is complete.
subtasks:
- T001
agent: claude
scope: report-html
owned_files:
- "src/report-html.js"
- "tests/unit/report-html.test.js"
---

# WP01: Reusable stat component (statTile)

## Objective

Give every headline number the same "number + ▲/▼ + trend" treatment by
composing the existing `delta()` and `sparkline()` helpers into one reusable
`<dl class="ledger">` cell — the foundation the Layer-1 landing page and the
progress panel build on.

## Context

- `delta(n, opts)` (`src/report-html.js:394`) and `sparkline(values)` (`:403`)
  already exist; the overview `<dl class="ledger">` cell shape is
  `<div><dt>label</dt><dd>value [spark]</dd></div>` (`:2506`).
- `.ledger`, `.delta`, `.spark` CSS already exist (`report-html.js` CSS const) —
  add no new styles.

## Subtasks

### T001: `statTile(label, value, opts)`

Add `statTile(label, value, { deltaN, deltaOpts, spark })` that returns a
`<div><dt>${t(label)}</dt><dd>${value}${delta?}${sparkline?}</dd></div>`. Localize
only the label via `t()`; `value` is preformatted by the caller (route counts
through `fmtMedian`/`kb`/`nf`). Emit the delta only when `deltaN != null` and the
sparkline only for ≥2 points. Do **not** rewire existing call sites (WP02 is the
first consumer) so report output is unchanged. Export it for unit testing.

## Validation

`npm run test:unit` passes with new `statTile` cases (label/value, delta
presence + goodWhenDown/unit, sparkline threshold, `dl.ledger` nesting);
`npm run i18n:check` clean; existing render output unchanged.
