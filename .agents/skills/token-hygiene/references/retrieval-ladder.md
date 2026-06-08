# Retrieval Ladder

Use this ladder before reading more code into context:

1. `rg --files` or project file listing for candidate paths.
2. `rg` for symbols, route names, config keys, or error strings.
3. Language-server definition/reference lookup when available.
4. Bounded file reads around the matching lines.
5. Whole-file reads only for short files, central interfaces, generated summaries, or edits where file-wide invariants matter.

After reading a file, keep a one-line state note: what it contains, what changed, and what facts are still missing. If you need the same file again, state the new fact before rereading it.
