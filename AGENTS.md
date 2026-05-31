# AGENTS Guide for Vital Core

This file defines how AI coding agents should work in this repository.

## Mission

Build and maintain a government web quality scanner that produces high-confidence, accessible, and actionable findings.

## Operating Priorities

1. Accessibility and Section 508 outcomes
2. Reliable, deterministic data outputs
3. Practical developer remediation guidance
4. Efficient scanning of high-value pages

## Scan Tool Inventory

Every URL in the scan queue is processed by these workers in order. Workers 3–6 are skipped when `VITAL_AUDIT_SCOPE=accessibility` or `VITAL_AUDIT_SCOPE=a11y`.

| # | Worker file | Tool | What it produces | Gated by scope |
|---|-------------|------|-----------------|---------------|
| 1 | `live-worker.ts` | **axe-core** via `@axe-core/playwright` | WCAG 2.x / Section 508 violations (in-browser) | No — always runs |
| 2 | `alfa-worker.ts` | **Siteimprove Alfa CLI** (`@siteimprove/alfa-cli`) | Independent ACT-rules audit against live URL | No — always runs |
| 3 | `lighthouse-worker.ts` | **Google Lighthouse** (`lighthouse` + `chrome-launcher`) | Performance, accessibility, SEO, best-practices, and agentic-browsing scores | Yes |
| 4 | `technology-worker.ts` | **wappalyzer-next** CLI (`--scan-type full`) | CMS / framework / analytics tech fingerprint | Yes |
| 5 | `offline-worker.ts` | **Cheerio** (HTML parser) | Alt-text quality, readability (Flesch-Kincaid), overlay detection, USWDS presence, ambiguous links | Yes |
| 6 | `third-party-impact-worker.ts` | **axe-core** (second pass, JS disabled) | Regression delta caused by third-party scripts | Yes, and only when offline audits ran |

### Required environment variables for tools

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITAL_ALFA_CMD` | `alfa` (must be in PATH) | Path to alfa CLI binary. Set to `node_modules/.bin/alfa` in CI. |
| `VITAL_WAPPALYZER_CMD` | _(empty — tool skipped if unset)_ | Path to wappalyzer-next binary. Set to `.tools/wappalyzer-next/bin/wappalyzer` in CI. |
| `VITAL_AUDIT_SCOPE` | `full` | Set to `accessibility` or `a11y` to run workers 3–6 only (axe + alfa still run). |
| `VITAL_SCAN_INTENSITY` | `standard` | Controls multi-engine browser mode (`deep` enables Firefox + WebKit). |

### Known size limits

Alfa serializes the full DOM tree and HTTP response into its JSON output. A complex page can produce 4–10 MB of raw output. The alfa worker uses a 10 MB `maxBuffer` to accommodate this.

## Repository Rules for Agents

1. Keep changes small, reviewable, and test-backed.
2. Preserve schema compatibility unless a migration is explicitly planned.
3. Prefer host-scoped, HTML-focused discovery by default.
4. Include tests for all behavior changes in discovery, reporting, and schema.
5. Avoid broad refactors unless requested.
6. Do not remove existing report formats when adding new ones.

## Suggested Claude Skill Sets

Use these skill themes when planning, reviewing, or implementing changes.

1. Accessibility governance
- accessibility-general
- bug-reporting
- manual-testing

2. Core UI and interaction accessibility
- keyboard
- navigation
- forms
- aria-live-regions
- touch-pointer

3. Content quality
- content-design
- plain-language
- image-alt-text

4. Visual and component quality
- color-contrast
- light-dark-mode
- tables
- svg
- tooltips

5. Delivery and reliability
- ci-cd
- progressive-enhancement
- opquast-digital-quality

## Prompting Pattern for Agents

When making changes, always include:

1. Objective
2. In-scope files
3. Acceptance criteria
4. Validation steps
5. Rollback plan

## Review Checklist

1. Does this improve or preserve accessibility outcomes?
2. Does this keep outputs reproducible and machine-readable?
3. Are findings actionable for engineers?
4. Are tests updated and passing?
5. Is scan load proportionate to user value?
