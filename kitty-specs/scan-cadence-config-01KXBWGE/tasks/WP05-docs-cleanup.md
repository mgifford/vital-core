---
work_package_id: WP05
title: Documentation + comment cleanup
dependencies:
- WP01
- WP02
- WP03
- WP04
requirement_refs:
- FR-001
tracker_refs: []
planning_base_branch: claude/vital-core-issue-214-spec-m237h3
merge_target_branch: claude/vital-core-issue-214-spec-m237h3
branch_strategy: Planning artifacts for this mission were generated on claude/vital-core-issue-214-spec-m237h3. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/vital-core-issue-214-spec-m237h3 unless the human explicitly redirects the landing branch.
subtasks:
- T016
- T017
agent: ''
shell_pid: 0
history: []
authoritative_surface: config/targets.yml
create_intent: []
execution_mode: code_change
owned_files:
- config/targets.yml
tags: []
---

## ⚡ Do This First: Load Agent Profile

Before reading anything else in this prompt, load the assigned agent profile
(see this WP's frontmatter `agent_profile`/`role` if set) via the
`ad-hoc-profile-load` skill/command. If no profile is assigned, proceed as a
general implementer.

## Objective

Document the three new per-target config fields
(`domain_scan_cadence`, `url_rescan_interval_days`,
`priority_url_rescan_interval_days`) in `config/targets.yml`'s per-target
options comment block, and remove any `DRAFT`/`NOT YET IMPLEMENTED`
scaffolding comments related to this feature now that WP01–WP04 have
shipped it. This is the final WP in the mission — it depends on all four
others being complete, since it documents the *final, implemented* shape
rather than a moving target.

## Context

`config/targets.yml` already has an established per-target documentation
block (a large comment above the `targets:` list, roughly lines 103-179 as
of this mission's planning) covering `importance`, `priority_urls_file`/
`priority_urls`, `languages`/`default_language`, `url_include`/
`url_exclude` (+ `_file` variants), `spelling_allowlist`,
`url_exclude_patterns`, `design_system`/`design_system_theme`, and
`webmcp`. Each entry follows a consistent style: a bolded-in-comment field
name, a one-to-three-sentence description, and sometimes a short example.
Read a few of the existing entries (e.g. `webmcp:`'s entry, since it's the
most recently added and closest in style to what you're adding) before
writing your own, to match tone and formatting exactly.

## Subtasks

### T016: Document the three new fields.

**Files**: `config/targets.yml`

Add three new entries to the per-target options comment block, in the
same style as the existing entries. Suggested content (adapt formatting to
match the surrounding block exactly — do not deviate from the established
comment style):

```
#   domain_scan_cadence: incremental (default) | daily. incremental allows
#     a domain to be scanned multiple times per UTC day, limited only by
#     eligible URLs and the weekly budget (today's behavior, unchanged).
#     daily limits a domain to at most one scan run per UTC day, regardless
#     of how many times the nightly cron fires — useful for lower-value
#     domains that don't need same-night rescans.
#   url_rescan_interval_days: minimum elapsed days before an ordinary URL
#     is eligible for rescan (default 7). Replaces the old "once per ISO
#     week" rule with an explicit, configurable interval.
#   priority_url_rescan_interval_days: minimum elapsed days before a
#     priority (top-task) URL is eligible for rescan (default 7).
#     Priority URLs are still scanned first in the queue whenever both
#     priority and ordinary URLs are eligible; this only controls how
#     often they become eligible again after a scan.
```

Note these are also declared with their default values in the `defaults:`
block near the top of the file (added by WP01) — this comment block
documents the *option*, the `defaults:` block sets the *default value*.
Do not duplicate the default-value declaration here; reference it briefly
if useful (e.g. "(default 7)") but the source of truth for the actual
default is the `defaults:` block, not this comment.

**Validation**: `config/targets.yml` still parses as valid YAML after your
edit (comments don't affect parsing, but a stray unescaped character could
still break the file — run `node -e "import('yaml').then(y =>
console.log(!!y.parse(require('fs').readFileSync('config/targets.yml',
'utf8'))))"` or equivalent, or simply run `npm run test:unit` which
exercises `loadConfig()` against the real file).

### T017: Remove DRAFT/NOT YET IMPLEMENTED scaffolding comments.

**Files**: `config/targets.yml` (primary), but grep the whole repository
for any other file that might carry a scaffolding comment referencing this
feature.

Search for any comment matching `DRAFT`, `NOT YET IMPLEMENTED`, `TODO`, or
similar scaffolding markers that reference scan cadence, URL rescan
intervals, or the once-per-week eligibility rule — these may exist in
`config/targets.yml` (e.g. if a previous session left a placeholder
comment describing the fields as "draft" before this mission implemented
them) or possibly in `CLAUDE.md`, `README.md`, or inline code comments in
`src/lib/state.js`/`src/scan.js` if WP02/WP03's implementers left any
"TODO: implement cadence" style markers.

Run:
```bash
grep -rn "DRAFT\|NOT YET IMPLEMENTED" config/ src/ CLAUDE.md README.md 2>/dev/null | grep -i "cadence\|rescan\|scan.interval"
```

For every match, either remove the marker entirely (if the feature is now
fully implemented, which it is by the time this WP runs, since it depends
on WP01-WP04) or replace it with accurate, non-draft documentation.

**Validation**: the grep command above returns zero matches after this
subtask. Per spec.md Success Criterion 7, this is a hard requirement, not
a nice-to-have — do not leave dangling scaffolding comments in shipped
code.

## Definition of Done

- [ ] `config/targets.yml`'s per-target options comment block documents all three new fields, matching the existing style.
- [ ] No `DRAFT`/`NOT YET IMPLEMENTED` comments referencing this feature remain anywhere in the repository.
- [ ] `config/targets.yml` still parses correctly (`npm run test:unit` passes, since it exercises `loadConfig()` against the real file).
- [ ] `npm run check:spec-kitty` passes.
- [ ] `www.cms.gov`'s target block remains untouched (this WP only edits the shared comment block, never any individual target entry).

## Risks

Low. Documentation-only change with no runtime behavior impact. The only
real risk is accidentally breaking YAML syntax while editing the comment
block (e.g. an unescaped `:` or `#` in the wrong place) — always re-run
`npm run test:unit` after this edit to catch a parse failure immediately.

## Reviewer Guidance

Confirm: (1) the new documentation accurately describes the *actually
implemented* behavior (cross-check against WP01/WP02/WP03's final code,
not just this prompt's suggested text, in case an implementer deviated
from the plan during those WPs); (2) the grep for DRAFT/NOT YET
IMPLEMENTED markers genuinely returns zero matches; (3) no unrelated part
of `config/targets.yml` (especially any individual target's block, like
`www.cms.gov`) was touched.
