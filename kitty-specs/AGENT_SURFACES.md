# Agent Surfaces

This repository is governed through a small set of stable surfaces:

- Spec Kitty CLI checks, including `spec-kitty upgrade --agent-check --json`,
  `spec-kitty agent config sync --create-missing`, `spec-kitty doctor skills --json`,
  and `spec-kitty charter preflight --json`.
- The repo-local validation gate, `npm run check:spec-kitty`, which verifies
  the committed governance bundle and flags machine-local artifacts.
- The normal Node.js reporting and scan scripts in `package.json`.
- GitHub Actions workflows under `.github/workflows/`, especially scan,
  report, and governance validation.

The runtime charter and generated governance files are the authoritative local
governance source for agents working in this workspace.
