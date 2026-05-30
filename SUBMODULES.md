# Tool Submodules

This repository tracks selected third-party scanner sources as Git submodules for easier upstream review and controlled updates.

## Current submodules

- `tools/submodules/axe-core` -> https://github.com/dequelabs/axe-core
- `tools/submodules/standards` -> https://github.com/ScanGov/standards
- `tools/submodules/purple-ai` -> https://github.com/GovTechSG/purple-ai

## Why submodules here

- Keep a pinned, reviewable upstream commit in this repository.
- Allow periodic update PRs without manually re-adding repositories.
- Reuse existing scanner integrations while still tracking upstream implementation details.
- Mirror U.S. federal web standards source material in-repo for local validation tooling, mappings, and reproducible CI checks.

## Local commands

- Initialize after clone:
  - `npm run submodules:init`
- Pull latest tracked upstream commits:
  - `npm run submodules:update`

## CI automation

- Workflow: `.github/workflows/update-submodules.yml`
- Runs weekly and on manual dispatch.
- Opens a PR when submodule commits advance.
