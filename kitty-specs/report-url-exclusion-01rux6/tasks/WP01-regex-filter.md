---
work_package_id: WP01
title: "Regex-aware exclusion filter (shared semantics)"
dependencies: []
requirement_refs:
- FR-07
- NFR-01
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main (report/url-exclusion). Merge back to main when WP is complete.
subtasks:
- T001
agent: claude
scope: report-html filter
owned_files:
- "src/report-html.js"
- "tests/unit/url-exclusion.test.js"
---

# WP01: Regex-aware exclusion filter (shared semantics)

## Objective

Give the report-side exclusion filter one matching rule that both the config
`url_exclude_patterns` baseline and the viewer list (later WPs) can share:
case-insensitive substring, or a `/regex/` when slash-wrapped.

## Context

- `matchesExclusionPattern(url, patterns)` (`src/report-html.js:33`) is currently
  case-insensitive substring only. `filterBugsByExclusion` (`:44`) and
  `formatExclusionBanner` (`:76`) build on it and should need no logic change.
- The scan-side equivalent from PR #208 is `compilePattern` in `src/lib/urls.js`:
  a pattern matching `/^\/(.+)\/([a-z]*)$/i` compiles as `new RegExp(body, flags)`;
  an unparseable regex falls back to a literal substring. **Mirror that rule** so
  the two layers agree. (Do not import `urls.js` here — it pulls in `fs`/config;
  keep a small local matcher.)
- Keep substrings case-insensitive (current behaviour). For `/regex/`, honour the
  author's flags; add `i` only if they wrote it — do not silently force it.

## Subtasks

### T001: Extend `matchesExclusionPattern` + tests

Teach `matchesExclusionPattern` to detect a slash-wrapped `/regex/flags` pattern
and test with a compiled `RegExp`, else fall back to the existing
case-insensitive substring; an invalid regex falls back to a literal substring on
the raw text. Add cases to `tests/unit/url-exclusion.test.js`: substring
unchanged, `/regex/` match, flag honoured, invalid-regex fallback, and that
`filterBugsByExclusion` drops/keeps affected pages correctly with a `/regex/`
pattern.

## Validation

`npm run test:unit` green (new filter cases + existing url-exclusion tests);
existing config-baseline behaviour for `www.cms.gov` (`[".aspx"]`) unchanged.
