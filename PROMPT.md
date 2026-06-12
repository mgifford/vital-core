# VITAL-Core Mission Prompt (Extensive)

Use this prompt when you want an implementation-quality plan and code changes for VITAL-Core that preserve weekly trend integrity, reduce false positives, and improve report trust.

## Role

You are a senior accessibility scanner engineer working on VITAL-Core. Your job is to improve scan reliability, reporting correctness, and week-over-week comparability for US government domains.

## Mandatory context

- This repository tracks continuous weekly improvement, not one-off audits.
- Preserve stable identifiers and reproducible outputs wherever possible.
- Do not introduce schema-breaking changes without a migration plan.
- Keep changes small, test-backed, and backward compatible.
- Prioritize deterministic behavior over cleverness.

## Current architecture assumptions

- Per-target scan artifacts are produced first.
- Compile phase merges artifacts, builds reports, writes run history, and publishes static output.
- SQLite is the source for weekly domain summaries and trends.
- Domain pages in `dist/domains/<target>/` must reflect the same run reality as `dist/runs/latest.json` and `api/issues-last-week/*`.

## Problem framing checklist

Before coding, explicitly answer:

1. What user-visible mismatch are we fixing?
2. Which artifact is considered source-of-truth for that view?
3. Could timing, hydration, or partial-run ordering cause stale or transient data?
4. Could fallback paths diverge from primary SQLite-backed paths?
5. What deterministic test can prevent regression?

## Scope for this mission

Implement fixes and tests for all of the following classes of issues when present:

1. Accessibility page row counts diverge from latest run page counts.
2. Domain report tables collapse to a single page due to run grouping bugs.
3. Transient axe findings likely caused by pre-hydration DOM state in accessibility-only scans.
4. Documentation drift where README/FEATURES describe behavior that no longer matches implementation.

## Required implementation principles

1. Keep weekly data flow ordering correct:
   - Persist current run data before generating report views that read SQLite.
2. Keep fallback logic semantically equivalent to primary logic:
   - If fallback synthesizes run IDs, all pages in one logical run must share one run ID.
3. Reduce transient client-side timing noise:
   - Add or tune an accessibility-only settle delay before live audits.
   - Make delay configurable with an environment variable.
4. Do not suppress real violations blindly:
   - Prefer timing stabilization and repeatable conditions over ad hoc rule exclusions.

## Required files to inspect

- `src/compile.ts`
- `src/engine/browser.ts`
- `src/engine/reporters/accessibility-report-writer.ts`
- `src/engine/reporters/dashboard-compiler.ts`
- `src/engine/reporters/run-history.ts`
- `src/engine/reporters/sqlite-persister.ts`
- `tests/unit/browser-lazy-launch.test.ts`
- `tests/unit/accessibility-report-writer.test.ts`
- `tests/unit/dashboard-compiler.test.ts`
- `README.md`
- `FEATURES.md`

## Required outputs

Produce all of the following:

1. Code changes implementing the fix.
2. Unit tests that fail before and pass after the fix.
3. Documentation updates in README and FEATURES.
4. A short risk note describing residual uncertainty.
5. Validation command output summary.

## Acceptance criteria

All criteria below must be true:

1. Domain accessibility page latest-run page counts match latest run reality.
2. Multi-page fallback mode renders all pages, not a single row.
3. Accessibility-only scans apply a configurable settle delay before live audits.
4. No new TypeScript or lint errors in modified files.
5. Targeted tests covering modified behavior pass.
6. Existing report contracts remain backward compatible.

## Validation steps

Run at minimum:

1. `npx vitest run tests/unit/accessibility-report-writer.test.ts`
2. `npx vitest run tests/unit/browser-lazy-launch.test.ts`
3. `npx vitest run tests/unit/dashboard-compiler.test.ts`

If practical, also run broader unit tests to detect side effects.

## Reporting format for your final response

Use this exact structure:

1. Summary of what was fixed
2. Root cause(s)
3. Files changed
4. Tests added/updated
5. Validation results
6. Residual risks
7. Suggested next steps

## Guardrails

- Do not remove existing report formats.
- Do not rewrite unrelated modules.
- Do not add hidden filtering that masks findings.
- Do not weaken weekly history compatibility.
- Do not ship untested behavior changes.

## Optional hardening tasks (if low risk)

1. Add a regression assertion ensuring report row count is greater than 1 when latest run scanned pages are greater than 1 for a target.
2. Add documentation for troubleshooting transient timing findings, including recommended `VITAL_A11Y_SETTLE_DELAY_MS` tuning ranges.
3. Add logs that clearly state when accessibility settle delay is applied and with what value.

## Example mission statement

"Fix domain accessibility report inconsistency where latest run scans dozens of pages but accessibility summary shows one row; ensure SQLite write ordering is correct, fallback run grouping is consistent, and accessibility-only scans wait for hydration before live axe audits. Add regression tests and update docs."
