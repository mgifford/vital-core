---
work_package_id: WP05
title: "Browser-side triage (status + notes + badges)"
dependencies:
- WP02
- WP04
requirement_refs:
- FR-12
- FR-13
- FR-14
- C-02
- C-03
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from the commit that completed WP04. Merge back to main when WP is complete.
subtasks:
- T014
- T015
- T016
agent: claude
scope: codebase-wide
owned_files:
- "src/report-html.js"
---

# WP05: Browser-side triage (status + notes + badges)

## Objective

Let report reviewers mark each finding with a triage status and add notes,
persisting that state in `localStorage` so it survives page reloads and can
be shared via export/import (WP06).

## Context

- `src/report-html.js` already injects a minimal vanilla-JS block for sorting
  and filtering — extend that block. No frameworks, no external scripts.
- The collapsed finding header has data attributes (`data-pattern-id`,
  `data-severity`, etc.) — add `data-pattern-id` if not already present;
  this is the localStorage key component.
- The `domain` and `week` for the report are already embedded somewhere in the
  rendered HTML (e.g. in the page title or a `<meta>` tag) — use those to
  namespace the localStorage key as `{domain}:{week}:{pattern_id}`.
- All triage content is JS-only (progressive enhancement). Without JS the
  report is fully readable; the triage panel simply does not appear.
- Do not add any framework dependencies. Vanilla JS only.

## Subtasks

### T014: Add triage markup to each finding

In `src/report-html.js`, inside each finding's `<details>` block, after the
existing content, add a `<div class="triage-panel">` containing:
- A `<select class="triage-status">` with options:
  `unreviewed`, `valid`, `false_positive`, `duplicate`, `deferred`, `fixed`
- A `<textarea class="triage-notes" placeholder="Notes…"></textarea>`
- A `<span class="triage-badge"></span>` in the `<summary>` line (collapsed
  header), initially empty

The panel is hidden by default via `display:none` in the CSS block and revealed
by the JS below.

### T015: Triage persistence JS

In the JS block at the bottom of `src/report-html.js`, add a
`initTriage()` function called on `DOMContentLoaded`:
1. Read `domain` and `week` from a `<meta name="vital-domain">` and
   `<meta name="vital-week">` tag (add these two meta tags to the page
   `<head>` in the renderer if not already present).
2. For each `.triage-panel`, derive the `pattern_id` from the nearest
   `[data-pattern-id]` ancestor or attribute.
3. Build the localStorage key `vital:triage:{domain}:{week}:{pattern_id}`.
4. Load saved state (JSON) and restore status select + notes textarea value.
5. Update the `.triage-badge` in the header to show the current status label
   (skip for `unreviewed`).
6. On `change` of the select or `input` of the textarea, save to localStorage
   and update the badge.

### T016: Reveal triage panels

In `initTriage()`, after restoring state, set `.triage-panel { display: block }`
via the DOM (not a stylesheet override) to reveal the panels.
Add a thin CSS rule in the report CSS block:
`.triage-badge { font-size: 0.75em; margin-left: 0.5em; padding: 0.1em 0.4em; border-radius: 3px; }`
and status-specific colour classes: `.triage-valid`, `.triage-false-positive`,
`.triage-duplicate`, `.triage-deferred`, `.triage-fixed`.

## Validation

Run `npm run test:unit` — all tests must pass.
Generate a report with `npm run aggregate`, open in a browser, mark a finding,
reload — state must persist. Disable JS — report must still be fully readable.
