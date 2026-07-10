---
work_package_id: WP01
title: "Factor bugsCsvTable(bugs) — single source of truth for the CSV schema"
dependencies: []
requirement_refs: [FR-01, C-05, NFR-01]
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main. Merge back to main when WP is complete.
subtasks: [T001]
agent: claude
owned_files:
- "src/lib/csv.js"
- "tests/unit/csv.test.js"
---

# WP01: Factor bugsCsvTable(bugs)

## Objective
Give the bugs.csv column schema one source of truth so the browser CSV
serializer (WP02) can mirror it exactly, with zero change to the written file.

## Context
`writeBugsCsv` (`src/lib/csv.js`) inlines the header list and the per-bug row
mapping, then calls `toCsv(headers, rows)` and writes. Extract a pure exported
`bugsCsvTable(bugs)` returning `{ headers, rows }`; `writeBugsCsv` calls it.

## Subtasks
### T001: Extract + test
- Add `export function bugsCsvTable(bugs)` returning `{ headers, rows }` with the
  current header order and row mapping verbatim.
- `writeBugsCsv` becomes: `const { headers, rows } = bugsCsvTable(bugs); … toCsv(headers, rows)`.
- Unit test in `tests/unit/csv.test.js`: assert the header list and that
  `toCsv(bugsCsvTable(sampleBugs))` equals the prior expected CSV string for a
  couple of synthetic bugs (parity), including CSV escaping of a field with a
  comma/quote.

## Validation
`npm run test:unit` green; the written bugs.csv is byte-identical to before.
