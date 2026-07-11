# Implementation Plan: JSON API — Schemas, Docs, and Redaction Proof

**Branch**: `main` | **Spec**: [spec.md](spec.md)
**Mission**: `api-schemas-docs-redaction-01KX7DN5`

## Summary

Close the three remaining gaps from issue #136 on top of the already-shipped
`src/lib/api-writer.js`: (1) published JSON Schemas + a validation test,
(2) `API.md` + README link, (3) exclusion parity and URL redaction for the API
feed, proven by a leak test. No new dependencies; no change to the shipped
endpoint layout or to reporting calculations.

## Technical Context

- **Language**: Node.js ESM ≥20, no build step, no bundler.
- **Testing**: Node built-in test runner (`npm run test:unit`), smoke `test:e2e`.
- **Storage**: files only; `docs/` is a gitignored build artifact.
- **Dependencies**: none added (NFR-01). JSON Schema validation uses a small
  in-repo validator — the schemas we author are simple (types, required,
  const, pattern, enum), so a compact recursive checker covers them without
  pulling `ajv`.

## Charter Check

- **Sustainability gate**: build-time only. No client JS, no data transfer,
  no fonts/scripts in `API.md`. PASS.
- **Security rules**: FR-06/07/08 strengthen the privacy boundary (excluded and
  sensitive URLs kept out of the published API). No VA-domain behavior change. PASS.

## Design

### Source of truth for schemas
Schemas live under `src/api/schema/*.schema.json` (checked in). `writeApiFiles`
copies them into `docs/api/v1/schema/` at aggregate time (C-04: `docs/` is
generated). Three schemas: `index`, `snapshot`, `findings`.

### Redaction + exclusion (new module `src/lib/api-redact.js`)
Two concerns, one small module:

- `redactUrl(url, { denyParams })` — drop the `#fragment`; for each query param
  whose name matches a built-in sensitive set (token, key, secret, session,
  sid, auth, password, pwd, email, apikey, access_token, id_token, code,
  signature, sig) or a configured denylist entry, replace its **value** with
  `[REDACTED]`; keep param names and harmless values. Parse/serialize with
  `URL` where possible, string-fallback otherwise (some entries are already
  normalized paths without an origin).
- `redactBugUrls(bug, opts)` — map `redactUrl` over the URL-bearing fields a bug
  can surface into the API: `url`, `examples[].url`, `affected_pages[]`.

Exclusion parity reuses the existing `filterBugsByExclusion` (import from
`report-html.js`) — no forked logic (C-03).

### Wiring in aggregate.js
Before feeding bugs to the API builders, run them through the same exclusion +
redaction the report path already implies:

- Per-week feed (~line 181): filter+redact `bugs` → `buildWeekFindings`.
- Latest feed (~lines 398-400): filter+redact `latestBugsOnly` before
  `buildIndexEntry` / `buildSnapshot`.

`excl = target.url_exclude_patterns ?? []`; `opts.denyParams =
target.api_redact_params ?? []` (optional per-target extension).

`buildSnapshot`'s `top_actions.drift_pages[].url` also emits URLs — redact at the
`api-writer` boundary (a redactor applied inside `apiTopActions`) so every URL
api-writer emits is covered in one place.

### Determinism
Filtering + redaction are pure and order-preserving; no new timestamps. Schema
files are static. No new per-build churn (NFR-04).

## Work Breakdown (one session)

1. **WP-A — Redaction/exclusion module + unit tests** — `src/lib/api-redact.js`;
   `tests/unit/api-redact.test.js`. → verify `npm run test:unit`.
2. **WP-B — Wire exclusion + redaction into the API feed** — `src/aggregate.js`,
   `src/lib/api-writer.js` (`apiTopActions` redactor).
3. **WP-C — JSON Schemas + validation** — `src/api/schema/{index,snapshot,findings}.schema.json`,
   `src/lib/api-schema-validate.js`, copy step in `writeApiFiles`,
   `tests/unit/api-schema.test.js`.
4. **WP-D — Docs** — `API.md` + README section.
5. **WP-E — Leak test** — `tests/unit/api-redaction-leak.test.js`.

## Complexity Tracking

No charter violations. In-repo schema validator chosen over `ajv` to honor
NFR-01 (no new dependency); the schemas are simple enough that this is not a
maintenance burden.
