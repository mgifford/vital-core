# Spec Kitty Operating Notes

Last verified: 2026-06-20

## Current State

- `origin/main` is at `fdac0c3a`; this branch has been fast-forwarded to Mike's latest commits.
- Spec Kitty CLI is installed as `spec-kitty-cli 3.2.1`.
- `spec-kitty doctor skills --json` reports `ok: true`.
- `spec-kitty charter preflight --json` passes after syncing the charter and materializing the fresh-project doctrine seed.
- `npm run check:spec-kitty` guards project charter directives, stale Spec Kitty command strings, fresh-machine bootstrap docs, and archive-only reconstructed WPs.
- `spec-kitty agent config status` reports `copilot`, `claude`, and `codex` configured and OK.
- Codex command skills live under `.agents/skills/spec-kitty.*`; Claude command files live under `~/.claude/commands/spec-kitty.*.md`; Copilot prompts live under `~/.github/prompts/`.
- `ollama-integration-01KVG6SJ` is done: `spec-kitty agent status validate --mission ollama-integration-01KVG6SJ --json` passes, and all four WPs are in `done`.
- The five earlier shipped specs now include reconstructed `plan.md`, `tasks.md`, `wps.yaml`, work-package prompts, and acceptance matrices. Treat those artifacts as archive-only reverse-specification from shipped PRs, not as evidence of fresh execution in this branch.

## Recommended Start For Future Work

Run this from the repository root before creating or resuming a mission:

```bash
git fetch --all --prune
spec-kitty --version
spec-kitty agent config sync --create-missing
spec-kitty agent config status
spec-kitty doctor skills --json
spec-kitty charter preflight --json
npm run check:spec-kitty
```

For a new feature:

```bash
spec-kitty specify "<feature name>" --mission-type software-dev --json
# Fill kitty-specs/<mission>/spec.md from the existing codebase first.
spec-kitty plan --mission <mission-slug> --json
spec-kitty agent context resolve --action tasks --agent <codex|claude|copilot> --mission <mission-slug>
spec-kitty tasks --mission <mission-slug> --json
spec-kitty next --agent <codex|claude|copilot> --mission <mission-slug>
```

For implementation, use the action reported by `spec-kitty next`. The current CLI help says the canonical per-WP entry is:

```bash
spec-kitty agent action implement <WPID> --agent <codex|claude|copilot> --mission <mission-slug>
```

Use the strongest available reasoning model for `specify`, `plan`, `tasks`, and
`review`. Ollama is an optional Vital Core report feature, not the Spec Kitty
workflow substrate. See `kitty-specs/AGENT_SURFACES.md`.

## Evidence-First Spec Habit

Before writing a spec, answer as much as possible from the repo:

- Architecture and extension points: `AGENTS.md`, `ARCHITECTURE.md`, `src/scan.js`, `src/aggregate.js`, `src/lib/`.
- Commands and local workflow: `README.md`, `CLAUDE.md`, `package.json`.
- Existing shipped intent: `kitty-specs/*/spec.md`.
- Historical scan/state compatibility: `data/`, `state/`, `src/lib/urls.js`, `src/lib/week.js`.

Do not infer trend/history behavior from a single report file; use the committed ledgers and weekly summary series.

## Open Questions And Forks

- Doctrine depth: the fresh-project doctrine seed makes preflight pass and falls back to built-in doctrine. If Mike wants project-local doctrine, generate YAML under `.kittify/charter/generated/` and rerun `spec-kitty charter synthesize`.
- Review profile warning: `spec-kitty dispatch ... --profile reviewer-renata --json` returns governance context, but warns that `tactic:bdd-scenario-lifecycle` is missing from the catalog. `generic-agent` dispatch opens cleanly. Decide whether this is an upstream Spec Kitty pack issue or a project-local doctrine gap before making reviewer dispatch a hard gate.
- Lint gate: `spec-kitty charter lint --json` reports 19 medium orphaned built-in directive findings in the built-in-only DRG. Preflight still passes. Decide whether lint warnings should block future mission starts.
- Historical branch context: several shipped specs originally pointed at `public-interest-checks`. They have been normalized to `main` so future Spec Kitty commands do not route new work back to a retired feature branch.
- Reconstructed shipped WPs are intentionally archive-only planning artifacts. To change the underlying product behavior, start a new mission from `main` and cite the reconstructed WP as historical context instead of implementing from it directly.

## Negative Space

This setup does not claim that all future missions are fully planned, that reviewer profile warnings are fixed, that project-local doctrine has been authored, or that reconstructed historical WPs were freshly executed in this branch. It also does not claim Claude/Copilot global files exist on a fresh workstation until `spec-kitty agent config sync --create-missing` and the follow-up checks pass. It establishes a model-agnostic runtime baseline and records the remaining decisions.
