# Spec Kitty Agent Surfaces

Last verified: 2026-06-20T01:03:05Z

## Configured Surfaces

This repository is configured for three Spec Kitty agent surfaces:

| Agent | Surface | Intended use |
|---|---|---|
| `codex` | Project skills in `.agents/skills/spec-kitty.*` | Preferred when working in Codex or another strong reasoning model. |
| `claude` | Global slash commands in `~/.claude/commands/spec-kitty.*.md` | Preferred when Mike works in Claude Code. |
| `copilot` | Global prompts in `~/.github/prompts/` | Supported fallback because this was the original configured surface. |

Run this from the repo root to verify the current machine:

```bash
spec-kitty agent config sync --create-missing
spec-kitty agent config status
spec-kitty agent config list
spec-kitty doctor skills --json
spec-kitty charter preflight --json
npm run check:spec-kitty
```

`claude` and `copilot` use global user directories, so a repo checkout alone
does not prove those command files exist on a fresh workstation. The sync command
above creates missing configured surfaces before status/doctor checks run.

## Model Policy

Spec Kitty is the workflow layer. Ollama is not the workflow layer.

Use the strongest available reasoning model for these steps:

- `specify`: ambiguous requirements, negative space, acceptance criteria.
- `plan`: architecture, data compatibility, test strategy, rollback planning.
- `tasks`: WP slicing, dependency ordering, ownership boundaries.
- `review`: correctness, regressions, missing tests, historical schema compatibility.

Lower-capability local models can help with mechanical drafting, but they should not be trusted as the final authority for scope, safety, architecture, or acceptance gates.

## New Mission Start

```bash
spec-kitty upgrade --agent-check --json
spec-kitty agent config sync --create-missing
spec-kitty charter preflight --json
npm run check:spec-kitty
spec-kitty specify "<feature name>" --mission-type software-dev --json
# Fill kitty-specs/<mission>/spec.md from the codebase before planning.
spec-kitty plan --mission <mission-slug> --json
spec-kitty agent context resolve --action tasks --mission <mission-slug> --agent <codex|claude|copilot> --json
spec-kitty tasks --mission <mission-slug> --json
spec-kitty agent mission finalize-tasks --mission <mission-slug> --validate-only --json
```

## Implementation Start

```bash
spec-kitty next --agent <codex|claude|copilot> --mission <mission-slug>
spec-kitty agent action implement <WPID> --agent <codex|claude|copilot> --mission <mission-slug>
```

## Historical Specs

The shipped specs under `kitty-specs/*` now include reconstructed `plan.md`, `tasks.md`, `wps.yaml`, work-package prompts, and acceptance matrices where they were missing. Treat those artifacts as archive-only reconstruction from shipped PRs, not as evidence of new execution in this branch. Reconstructed WPs use `execution_mode: planning_artifact`, keep code paths under `## Historical Implementation Files`, and must not be launched with `spec-kitty agent action implement`.
