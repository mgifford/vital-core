# AGENTS Guide for Vital Core

This file defines how AI coding agents should work in this repository.

## Mission

Build and maintain a government web quality scanner that produces high-confidence, accessible, and actionable findings.

## Operating Priorities

1. Accessibility and Section 508 outcomes
2. Reliable, deterministic data outputs
3. Practical developer remediation guidance
4. Efficient scanning of high-value pages

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
