# Vital Core Runtime Charter

This project builds a government web quality scanner and weekly reporting
surface. The charter binds agents to the repository's public authority in
[AGENTS.md](../../AGENTS.md), [ACCESSIBILITY.md](../../ACCESSIBILITY.md), and
[README.md](../../README.md).

## Purpose

Produce reproducible accessibility and performance reports that help teams
track week-over-week change, preserve historical evidence, and prioritize
remediation work on government sites.

## Binding Directives

| Directive | Requirement |
| --- | --- |
| weekly-accessibility-tracking | Prefer weekly comparisons, regressions, and recovery trends over isolated single-run output. |
| stable-page-identity | Keep URL and page identity stable so records dedupe cleanly across weeks. |
| historical-evidence-preservation | Treat summaries as durable history; prune only page-level detail after retention rules allow it. Committed git history is append-only by default — no agent may rewrite, squash, or force-push over existing history on its own initiative. **Exception (added 2026-07-14, owner-authorized):** a one-time rewrite of `data/`'s git history is permitted to shrink the repository, in response to the unconditional-rewrite bug fixed in PR #235 (see ARCHITECTURE.md "Git history policy" and the `git-history-companion-repo` mission). This exception authorizes that ONE rewrite only. **Any further history rewrite, squash, or force-push to `main` requires a new EXPLICIT OWNER OVERRIDE given in that session's chat before the agent may proceed** — a prior approval, this charter entry, or "we discussed this before" does not carry forward. An agent that believes another rewrite is warranted must stop and ask, not act. |
| accessible-reporting | Generated HTML must be semantic, keyboard-usable, and provide text alternatives for charts and other visualizations. |
| efficient-recurring-scans | Keep scans deterministic, rate-controlled, and proportionate to the site's value and weekly budget. |
| sustainable-web-output | Minimize data transfer and client computation: no web fonts, static SVG, JS only as progressive enhancement, build-time over per-request work, and caching over re-shipping bytes. |

## Testing and Quality

- Validation is required before merge: `spec-kitty upgrade --agent-check --json`,
  `spec-kitty agent config sync --create-missing`, `spec-kitty doctor skills --json`,
  `spec-kitty charter preflight --json`, `npm run check:spec-kitty`, YAML parse,
  `git diff --check`, and `npm run test:unit`.
- Reports must stay accessible without JavaScript and remain readable in
  light and dark themes.
- Output must align with the [W3C Web Sustainability Guidelines](https://w3c.github.io/sustainableweb-wsg/)
  and [SUSTAINABILITY.md](https://mgifford.github.io/SUSTAINABILITY.md/): minimize
  page weight and data transfer, do work at build time rather than per request,
  and treat any client-side computation as progressive enhancement. Every mission
  should carry a sustainability acceptance criterion.
- Automated scan results are a floor, not a release gate by themselves; manual
  review remains necessary for real accessibility confidence.

## Deployment and Branching

- GitHub is the source of truth.
- Hugging Face is a deployment target only and is updated through the `hf`
  remote and the publishing scripts, not by treating a Hugging Face branch as
  the canonical branch.
- Generated reports and weekly data must remain reproducible from the committed
  repository state.
- History is append-only on `main`; no force-push or history rewrite without an
  explicit owner override given in that session's chat (see
  `historical-evidence-preservation` above for the one-time, already-used
  exception and the standing override requirement for any future rewrite).
