# Implementation Plan: Weekly Site Quality Report for U.S. Government Sites

Branch: main  
Date: 2026-06-06  
Spec: kitty-specs/build-a-replacement-for-siteimprove-for-the-us-government-01KSTNMM/spec.md  
Input: Existing partially running TypeScript/Node implementation in vital-core

## Summary

Build on the existing accessibility and site-quality scanner to produce a recurring weekly report for U.S. government websites. The goal is not to recreate all of Siteimprove. The goal is to provide practical weekly value: what changed, what got worse, what improved, which issues matter most, and where maintainers should focus next.

The existing code already includes scanning, reporting, SQLite persistence, static dashboard output, profiles, GitHub Actions workflows, and tests. This plan focuses on stabilizing and completing the reporting loop.

## Technical Context

Language/Version: TypeScript / Node.js, using the repository .nvmrc version.

Primary Dependencies: Existing scanner, axe/alfa/Lighthouse-related workers, Chromium/browser tooling, Wappalyzer/technology detection, SQLite persistence, static HTML/JSON/CSV/Markdown output.

Storage: SQLite database at dist/vital.db, JSON run artifacts under dist/runs/, reports under dist/reports/, dashboard output under dist/.

Testing: Existing unit tests under tests/unit/ and smoke tests under tests/smoke/. Primary command is expected to be npm test, with more specific scripts confirmed from package.json.

Target Platform: Local Node.js CLI and GitHub Actions recurring scheduled scan pipeline.

Project Type: Single TypeScript CLI/static-reporting project.

Performance Goals: Complete weekly scans for configured profiles without browser crashes, runaway memory use, or blocking dashboard generation.

Constraints:
- Do not replace existing scanner architecture.
- Do not remove existing reports, profiles, tests, or workflows without explicit review.
- Preserve exportable Markdown, CSV, JSON, and static HTML outputs.
- Keep reports useful for non-specialist site owners.
- Prioritize recurring weekly value over broad feature expansion.

Scale/Scope: Initial scope is the existing U.S. health/government profiles, including HHS/CMS/CDC/NIH/Medicare/Medicaid-related targets already represented in profiles/ and dist/reports/.

## User Value

A weekly report should answer:

1. What changed since the last scan?
2. What got worse?
3. What improved?
4. Which accessibility or quality issues affect the most pages?
5. Which issues appear to be template-level problems?
6. What should the site owner fix first?
7. What evidence can be exported for review, tickets, or follow-up?

The value is recurring visibility, not one-time auditing.

## Existing Implementation Inventory

The repository already includes:

- src/index.ts as the likely CLI entry point.
- src/compile.ts for compiling dashboard/report artifacts.
- src/engine/ modules for browser handling, discovery, parsing, CDN detection, queue composition, priority seeds, and URL manifests.
- src/types/ for normalized findings, profiles, ratings, and site quality specifications.
- scripts/run-axe-site-check.mjs and related operational scripts.
- scripts/sqlite-api-server.mjs for local data access.
- profiles/us-health.yml and profiles/local-test.yml.
- dist/runs/ with existing scan outputs.
- dist/reports/ with existing Markdown and CSV issue reports.
- dist/index.html, dashboard assets, API JSON, failures page, unique errors page.
- Unit and smoke tests covering discovery, workers, reporting, persistence, dashboard compilation, normalized finding schema, and workflow contracts.
- GitHub Actions workflows for scans, CI, GitHub Pages deployment, quality gates, and monitoring.

This confirms the project is partially operational. The next phase should review and refine rather than rebuild.

## Work Plan

### Phase 1: Confirm Current Baseline

Goal: establish what currently works before changing code.

Tasks:
- Run the existing test suite.
- Run the local test profile.
- Confirm whether dist/ can be regenerated from source.
- Confirm whether reports are generated from current scan data or stale committed artifacts.
- Identify failing tests, flaky tests, and broken workflows.

Relevant files:
- package.json
- README.md
- TEST-STRATEGY.md
- profiles/local-test.yml
- profiles/us-health.yml
- src/index.ts
- src/compile.ts
- tests/smoke/*
- tests/unit/*

Expected output:
- A short baseline note listing working commands, failing commands, and known defects.

### Phase 2: Map Existing Reports to Weekly User Value

Goal: determine what the current reports already provide and what is missing.

Tasks:
- Review existing Markdown and CSV reports in dist/reports/.
- Review dist/runs/latest-summary.json, dist/runs/trends.json, dist/runs/unique-errors.json, and dist/runs/page-state.json.
- Identify whether the current output shows regressions, improvements, recurring issues, and priorities.
- Identify whether the current report distinguishes page-level issues from site-wide/template issues.

Relevant files:
- dist/reports/*
- dist/runs/latest-summary.json
- dist/runs/trends.json
- dist/runs/unique-errors.json
- dist/runs/page-state.json
- tests/unit/run-history-reporter.test.ts
- tests/unit/scan-status-reporter.test.ts
- tests/unit/unique-errors.test.ts
- tests/unit/dashboard-compiler.test.ts

Expected output:
- A gap list comparing current reports against weekly report needs.

### Phase 3: Define the Weekly Report Contract

Goal: define the minimum useful weekly report structure.

Required weekly report sections:
1. Executive summary
2. Scan date and compared previous scan
3. Overall status by domain
4. New issues since last scan
5. Resolved issues since last scan
6. Persistent high-impact issues
7. Top affected pages
8. Likely template-level issues
9. Technology and third-party observations
10. Recommended next actions
11. Export links to CSV, JSON, and Markdown evidence

Relevant files:
- src/types/normalized-finding.ts
- src/types/domain-rating.ts
- src/types/site-quality-spec.ts
- Existing reporter/compiler files identified during code review
- dist/api/*.json
- dist/reports/*

Expected output:
- A documented weekly report data contract, preferably as TypeScript types and test fixtures.

### Phase 4: Implement Missing Weekly Comparison Logic

Goal: make weekly output useful by comparing current and previous runs.

Tasks:
- Identify stable finding keys for comparison.
- Compare latest run against previous run.
- Mark issues as new, resolved, persistent, or changed.
- Aggregate by domain, page, issue type, severity, and likely template pattern.
- Avoid duplicate-heavy reporting.

Relevant files:
- src/types/normalized-finding.ts
- Existing persistence/reporting modules
- dist/runs/index.json
- dist/runs/latest.json
- dist/runs/trends.json
- tests/unit/normalized-finding-*
- tests/unit/run-history-reporter.test.ts
- tests/unit/quality-index.test.ts

Expected output:
- JSON summary suitable for dashboard and Markdown report generation.
- Unit tests for new/resolved/persistent issue classification.

### Phase 5: Improve Report Presentation

Goal: make reports usable by site owners and maintainers.

Tasks:
- Update Markdown report format.
- Update CSV exports if needed.
- Update dashboard API JSON.
- Update dashboard UI only where needed to expose weekly deltas.
- Keep language plain and action-oriented.

Relevant files:
- src/compile.ts
- dist/assets/dashboard.js
- dist/assets/dashboard.css
- Reporter modules identified during review
- tests/unit/dashboard-compiler.test.ts
- tests/smoke/validate-reporting-smoke.ts

Expected output:
- Weekly report pages that clearly show priority, change, evidence, and next action.

### Phase 6: Confirm Recurring Execution

Goal: ensure the weekly schedule works in GitHub Actions.

Tasks:
- Review .github/workflows/vital-scan.yml.
- Confirm scheduled execution.
- Confirm artifacts are generated and committed or deployed correctly.
- Confirm GitHub Pages deployment works.
- Confirm failure reporting is visible.

Relevant files:
- .github/workflows/vital-scan.yml
- .github/workflows/deploy-pages.yml
- .github/workflows/pages-quality-gate.yml
- .github/workflows/monitor-actions-failures.yml
- dist/runs/scan-status.json
- dist/runs/scan-status.md

Expected output:
- Reliable weekly scan workflow with visible failure states.

## Charter Check

This work passes the charter if it:

- Builds on existing open source code.
- Improves accessibility accountability.
- Produces transparent, inspectable outputs.
- Avoids vendor lock-in.
- Prioritizes practical public-sector maintainers.
- Uses tests to protect existing behavior.
- Does not remove existing functionality without review.

## Project Structure

### Documentation

text kitty-specs/build-a-replacement-for-siteimprove-for-the-us-government-01KSTNMM/ ├── spec.md ├── plan.md ├── tasks.md ├── status.json ├── status.events.jsonl └── meta.json 

### Source Code

text src/ ├── cli/ ├── engine/ ├── types/ ├── compile.ts └── index.ts  scripts/ ├── run-axe-site-check.mjs ├── sqlite-api-server.mjs ├── query-db.mjs └── related operational scripts  profiles/ ├── local-test.yml ├── us-health.yml └── sitemap/profile inputs  tests/ ├── unit/ └── smoke/  dist/ ├── api/ ├── reports/ ├── runs/ ├── assets/ ├── failures/ ├── unique-errors/ ├── index.html └── vital.db 

Structure Decision: Continue with the existing single-project TypeScript/Node structure. Do not introduce a separate frontend/backend split unless the existing dashboard becomes too complex to maintain.

## Risks

1. Existing dist/ artifacts may be stale or manually generated.
2. The scanner may work locally but fail in GitHub Actions because of browser, memory, or timeout issues.
3. Weekly comparison requires stable issue identifiers. If finding keys are unstable, trend reporting will be misleading.
4. Too many raw issues will overwhelm users. The report must group and prioritize.
5. “Siteimprove replacement” is too broad. Scope must stay focused on recurring weekly accessibility and quality reporting.

## Immediate Next Step

Complete discovery by reviewing current code paths and writing down:

1. How scans are launched.
2. How findings are normalized.
3. How findings are persisted.
4. How reports are generated.
5. How current and previous runs are compared.
6. What tests already protect this behavior.
7. What is missing for weekly user value.

Only after that should implementation begin.