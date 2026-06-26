---
work_package_id: WP06
title: "Triage export/import"
dependencies:
- WP05
requirement_refs:
- FR-15
- FR-16
- C-02
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from the commit that completed WP05. Merge back to main when WP is complete.
subtasks:
- T017
- T018
agent: claude
scope: codebase-wide
owned_files:
- "src/report-html.js"
---

# WP06: Triage export/import

## Objective

Let reviewers share triage state with teammates by downloading a JSON file and
importing it on another machine (or after clearing localStorage).

## Context

- WP05 established the localStorage key scheme
  `vital:triage:{domain}:{week}:{pattern_id}` and the triage record schema
  `{ status, notes }`.
- Export and import buttons should live in the accessibility report toolbar
  (the filter bar or a row above the bug list — pick whichever is least
  disruptive to the existing layout).
- The download filename convention from `src/lib/csv.js` is
  `{domain}_{DDMONYYYY}_{type}.{ext}` — follow it exactly.
- Import is a file picker; it must not submit to any server. Use the File API.
- Import merges (does not replace) — if a local record has a status that the
  imported file also has, the imported file wins. Unmentioned keys in
  localStorage are left untouched.

## Subtasks

### T017: Export triage button

In the accessibility report toolbar in `src/report-html.js`, add an
"Export triage" button rendered as plain HTML (visible only via JS after load).

In the JS block, wire it to:
1. Collect all `vital:triage:{domain}:{week}:*` keys from `localStorage`.
2. Build a JSON object:
   ```json
   {
     "schema_version": "1",
     "domain": "<domain>",
     "week": "<week>",
     "exported_at": "<ISO timestamp>",
     "records": {
       "<pattern_id>": { "status": "...", "notes": "...", "updated_at": "..." }
     }
   }
   ```
3. Trigger a download using a temporary `<a download>` element.
4. Name the file `{domain}_{DDMONYYYY}_triage.json` where `DDMONYYYY` is the
   week's Monday in the same format as CSV exports (use the `week` string
   already embedded in the page).

### T018: Import triage button + merge logic

Add an "Import triage" button and hidden `<input type="file" accept=".json">`
to the toolbar.

In the JS block, wire it to:
1. Open the file picker on button click.
2. Read the selected file with `FileReader`.
3. Parse the JSON and validate `schema_version === "1"` and domain/week match
   the current report (warn via a visible `<p class="triage-import-warning">`
   if they don't match but still allow import).
4. For each record in `records`, merge into localStorage using the key scheme
   from WP05. Imported record wins on conflict.
5. Refresh all `.triage-status` selects, `.triage-notes` textareas, and
   `.triage-badge` spans in the DOM without a page reload, using the same
   restore logic from WP05's `initTriage()`.

## Validation

Run `npm run test:unit` — all tests must pass.
Manual test: export triage from one browser session, clear localStorage,
import the file, verify all badges and notes are restored.
