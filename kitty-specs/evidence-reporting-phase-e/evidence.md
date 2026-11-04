# Phase E Handoff

ModelCheck | model=unknown | tier=B | fit=bounded reporting implementation with local deterministic tests | escalate_if=identity migration or automatic owner/fix inference

## Changes

- One non-mutating reporting projection for HTML and static API v1, consumed verbatim by MCP.
- All engine findings retained. Complete confirmed duplicates share one remediation group. Possible duplicates and related findings remain separate. Fix count is null; ownership is not established.
- ACT mappings/status and source provenance, engine impact versus reporting severity and priority, bounded sanitized HTML/selectors, and distinct stored URL evidence with completeness flags.
- Exact URL repeats are removed from the inline list; query variants remain distinct and now have distinct visible labels. No URL/ID/ledger migration.
- Native finding disclosures restored to the Tab sequence; no new client script or scan.

## Evidence

Run from the repository root:

- `npm run test:unit`: 626 tests passed, zero failed.
- `npm run test:e2e`: all checks passed, including real Tab/Enter native disclosures with JavaScript disabled on desktop, mobile and forced-colors contexts.
- `npm run i18n:check`: passed (746 source strings).
- `npm run check:spec-kitty`: committed governance validator passed.
- `git diff --check`: passed before handoff documentation.
- Editor diagnostics: no errors reported for edited source, schema and browser test files.

Focused tests cover raw-data immutability, complete versus capped duplicate evidence,
unique query URLs, incomplete samples, preserved API identity/history/severity,
sanitization and MCP passthrough. Existing deep-link redirect checks still pass.

## Learnings

Reuse the API projection and MCP verbatim-return contract; do not infer relationships
again in clients. Source extraction alone does not catch retired translation keys:
the locale catalog unit test found one such key, removed in three catalogs.
The parser was initially only available from a parent installation; parse5 is now a
declared direct dependency. No delegated model or agent was used.

## Risks And Boundaries

- No human screen-reader or OS-level contrast-theme verification was performed.
  Browser keyboard/forced-colors checks are not a full accessibility verdict.
- `spec-kitty` is absent from PATH. Manual mission artifacts and the committed
  validator are not runtime initialization, review, acceptance or merge approval.
- Sanitized snippets deliberately omit text and form values. Selectors can be
  unavailable; original scanner observations stay internally available unchanged.
- Checked-in ACT mappings may lag upstream reports; missing mappings remain empty,
  and unverified publication statuses remain Unknown.
- Legacy severity totals and top-action heuristics retain their v1 meaning. The
  new remediation group count is not a number of fixes; legacy impact estimates
  are not verified task counts or causal ownership.
- No push, pull request, merge, production scan or deployment was performed.

## Next Step And Owner

Maintainer: review the local `feat/evidence-reporting` branch and approve upstream
submission. After upstream merge, integrate the same commits into fleets through
Git. Rollback uses a normal revert of the Phase E commit, with no data migration.