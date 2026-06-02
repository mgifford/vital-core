# AGENTS Guide for Vital Core

This file defines how AI coding agents should work in this repository.

## Mission

Build and maintain a government web quality scanner that produces high-confidence, accessible, and actionable findings, **tuned specifically for tracking continuous improvement, weekly trends, and historical remediation** across US government sites. 

## Operating Priorities

1. **Continuous Accessibility Tracking**: Prioritize week-over-week trends, progress, and regression tracking over isolated, single-run reports (WCAG 2.0 AA for federal, WCAG 2.1 AA for state/local).
2. **Reliable, Deterministic Data**: Outputs must generate stable identifiers (e.g., persistent instance/pattern IDs) so findings can be deduplicated and compared cleanly across weekly scan boundaries.
3. **Historical Evidence**: Focus on preserving historical data integrity to prove when issues were introduced and resolved.
4. **Actionable Remediation**: Provide practical developer guidance that helps teams clear their weekly backlog.
5. **Efficient Scanning**: Optimize scanning of high-value pages to support recurring, automated weekly schedules without bloated resource consumption.

## Scan Tool Inventory

Every URL in the scan queue is processed by these workers in order. Workers 3–6 are skipped when `VITAL_AUDIT_SCOPE=accessibility` or `VITAL_AUDIT_SCOPE=a11y`. 

*Note for Agents: When modifying these tools, always consider how their JSON outputs will be aggregated and compared in weekly trend reports.*

| # | Worker file | Tool | What it produces | Gated by scope |
|---|-------------|------|-----------------|---------------|
| 1 | `live-worker.ts` | **axe-core** via `@axe-core/playwright` | WCAG 2.x / Section 508 violations (in-browser). *Requires stable DOM selectors for weekly tracking.* | No — always runs |
| 2 | `alfa-worker.ts` | **Siteimprove Alfa CLI** (`@siteimprove/alfa-cli`) | Independent ACT-rules audit against live URL. | No — always runs |
| 3 | `lighthouse-worker.ts` | **Google Lighthouse** (`lighthouse` + `chrome-launcher`) | Performance, accessibility, SEO, best-practices scores. *Monitored for week-to-week score deltas.* | Yes |
| 4 | `technology-worker.ts` | **wappalyzer-next** CLI (`--scan-type full`) | CMS / framework / analytics tech fingerprint. | Yes |
| 5 | `offline-worker.ts` | **Cheerio** (HTML parser) | Alt-text quality, readability (Flesch-Kincaid), overlay detection, USWDS presence, ambiguous links. | Yes |
| 6 | `third-party-impact-worker.ts` | **axe-core** (second pass, JS disabled) | Regression delta caused by third-party scripts. | Yes, and only when offline audits ran |

### Required environment variables for tools

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITAL_ALFA_CMD` | `alfa` (must be in PATH) | Path to alfa CLI binary. Set to `node_modules/.bin/alfa` in CI. |
| `VITAL_WAPPALYZER_CMD` | _(empty — tool skipped if unset)_ | Path to wappalyzer-next binary. Set to `.tools/wappalyzer-next/bin/wappalyzer` in CI. |
| `VITAL_AUDIT_SCOPE` | `full` | Set to `accessibility` or `a11y` to run workers 3–6 only. |
| `VITAL_SCAN_INTENSITY` | `standard` | Controls multi-engine browser mode (`deep` enables Firefox + WebKit). |

### Known size limits & Data Retention

Alfa serializes the full DOM tree and HTTP response into its JSON output. A complex page can produce 4–10 MB of raw output. Because we track data week-over-week, **data volume compounds quickly**. 
* The alfa worker uses a 10 MB `maxBuffer` to accommodate this. Log situations where the output exceeds `maxBuffer`.
* Agents should optimize data payloads, ensuring only essential tracking data is preserved long-term.

## Repository Rules for Agents

1. **Preserve Schema Compatibility:** Never introduce breaking changes to JSON schemas or report formats without an explicit migration plan. Breaking changes destroy historical weekly trend graphs.
2. **Ensure Stable Identifiers:** When surfacing bugs, rely on reproducible patterns (like XPath, CSS selectors, or hashed element structures) so a bug found in Week 1 is recognized as the *same* bug in Week 2.
3. Keep changes small, reviewable, and test-backed.
4. Prefer host-scoped, HTML-focused discovery by default.
5. Include tests for all behavior changes in discovery, reporting, and weekly aggregation.
6. Avoid broad refactors unless requested.
7. Do not remove existing report formats when adding new ones.

## Suggested Claude/AI Skill Sets

Use these skill themes when planning, reviewing, or implementing changes.

1. **Data Aggregation & Time-Series** *(Crucial for weekly tracking)*
- historical-trending
- data-deduplication
- schema-migrations
- stable-id-generation

2. **Accessibility Governance**
- accessibility-general
- bug-reporting
- manual-testing

3. **Core UI and Interaction Accessibility**
- keyboard / navigation / forms
- aria-live-regions / touch-pointer

4. **Content & Visual Quality**
- content-design / plain-language
- image-alt-text / color-contrast
- tables / svg / tooltips

5. **Delivery and Reliability**
- ci-cd (GitHub Actions / Scheduled Scans)
- progressive-enhancement
- opquast-digital-quality

## Prompting Pattern for Agents

When making changes, always include:

1. Objective (How does this improve the weekly scan experience?)
2. In-scope files
3. Acceptance criteria (Including backward compatibility)
4. Validation steps (How to test against historical data)
5. Rollback plan

## Review Checklist

1. Does this improve or preserve accessibility outcomes?
2. **Does this keep outputs reproducible and stable for week-over-week comparisons?**
3. Are findings actionable for engineers?
4. Are tests updated and passing?
5. Is the scan load proportionate to user value, assuming this will run on a recurring weekly schedule?
