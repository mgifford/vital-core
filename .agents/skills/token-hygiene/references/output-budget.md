# Output Budget

Tool output competes with source code and instructions for context. Treat command output as an input budget.

Default patterns:

- Tests: run focused tests first; show failing names, assertion blocks, and a short tail.
- Builds: write full logs to a file when needed, then inspect targeted excerpts.
- JSON: use `jq` to select fields instead of dumping whole objects.
- Logs: filter by timestamp, request id, severity, or component before showing output.
- Search: use `rg -n --context 2` and narrow paths.

Avoid routing every command through a summarizer. Use deterministic shell filters when they answer the question.
