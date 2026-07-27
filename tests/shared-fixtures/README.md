# Shared Cross-Repo Policy Fixtures

The JSON files in this directory are local copies of the canonical fixtures maintained in [`mgifford/ACCESSIBILITY.md`](https://github.com/mgifford/ACCESSIBILITY.md), `examples/shared-fixtures/`. See that directory's `README.md` for the full rationale.

`tests/unit/shared-fixture.test.js` translates each fixture's `standards[]`/`test_results[]` shape into a `finding-policy.js` bug object and asserts that `applyFindingPolicy()` with the default policy produces the same `obligation`/`handling` as the fixture's own `policy` object.

**These files must stay byte-identical to their canonical source.** If `ACCESSIBILITY.md`'s copy changes, copy it here again in the same change that updates this repository's `finding-policy.js` or `wcag.js` behavior to match — do not let the two silently diverge. This is intentionally a local copy rather than a build-time fetch, so the test suite has no network dependency and CI stays deterministic.
