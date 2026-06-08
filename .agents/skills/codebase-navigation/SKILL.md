---
description: Use when Claude needs to understand a large or unfamiliar codebase without wasting context.
---

# Codebase Navigation

This skill follows Anthropic's large-codebase guidance: make the codebase navigable before adding more automation.

Rules:

1. Keep root CLAUDE.md lean: architecture map, critical commands, and gotchas only.
2. Prefer subdirectory CLAUDE.md files for local build/test conventions.
3. Start Claude in the relevant subdirectory when the task has a clear scope.
4. Build or update a concise codebase map when top-level folders are not self-explanatory.
5. Prefer LSP/code-intelligence lookups for definitions and references before broad grep/read loops.
6. Use MCP integrations only for structured external context; do not paste large external pages or logs into the session.

Generated score bucket: 40_60
Generated waste bucket: 40_60
