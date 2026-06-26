---
work_package_id: WP04
title: "Tech-aware remediation prompts"
dependencies:
- WP02
requirement_refs:
- FR-09
- FR-10
- FR-11
- C-01
- C-05
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from the commit that completed WP02. Merge back to main when WP is complete.
subtasks:
- T011
- T012
- T013
agent: claude
scope: codebase-wide
owned_files:
- "src/lib/remediation-prompts.js"
- "src/lib/bug-report.js"
- "src/report-html.js"
---

# WP04: Tech-aware remediation prompts

## Objective

When the site's detected CMS or framework is known, replace the generic
remediation tip with a platform-specific one so developers get actionable
guidance without searching docs.

## Context

- Tech stack detection runs as part of the `tech-findings` engine and is
  already accessible in the data passed to `aggregate.js` — find how the
  detected technologies are stored and passed through.
- `src/lib/bug-report.js` constructs each bug object, including `remediation`
  or `tips` text — this is where the tech-aware selection happens.
- Start with Drupal and WordPress because they are the most common government
  CMS platforms. At minimum cover these axe rules: `color-contrast`,
  `image-alt`, `label`, `aria-required-attr`, `html-has-lang`.
- Tips must be concise (1–2 sentences) and action-oriented, not reference docs.
- No new npm dependencies.

## Subtasks

### T011: Create src/lib/remediation-prompts.js

Export a function `getRemediationTip(ruleId, techStack)` where `techStack` is
an array of technology names (strings) from the existing tech-findings output.

The module contains a static map:
```
{
  "<rule_id>": {
    drupal: "<tip>",
    wordpress: "<tip>",
    generic: "<tip>"   // falls back to existing tip if null
  }
}
```

Cover at minimum: `color-contrast`, `image-alt`, `label`, `aria-required-attr`,
`html-has-lang`, `link-name`, `button-name`, `frame-title`, `duplicate-id`,
`landmark-one-main`.

`getRemediationTip` returns the first matching platform tip (checking
`techStack` against known platform names case-insensitively), or `null` if no
match. The caller falls back to the existing generic tip on `null`.

### T012: Select tip in bug-report.js

In `src/lib/bug-report.js`, when constructing the bug object, call
`getRemediationTip(ruleId, siteConfig.tech_stack)` where `siteConfig.tech_stack`
is the detected stack array. If the return is non-null, set a field
`remediation_tech_tip` on the bug object. Keep the existing generic tip
(`remediation`) unchanged.

### T013: Render tech tip in report-html.js

In the bug detail block in `src/report-html.js`, when `remediation_tech_tip`
is present, render it before the generic remediation section with a small
platform label (e.g. "Drupal tip:"). The generic tip still renders below it
as a fallback for those using a different tool.

## Validation

Run `npm run test:unit` — all tests must pass.
Visually inspect a generated report to confirm the platform label appears for
a known-CMS site and is absent for sites with no detected platform.
