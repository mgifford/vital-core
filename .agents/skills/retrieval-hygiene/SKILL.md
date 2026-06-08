---
name: retrieval-hygiene
description: Use when Claude Code is repeatedly reading the same files or running broad searches.
---

# Retrieval Hygiene

When inspecting code:

1. Prefer rg and targeted symbol/file searches before broad reads.
2. Read the narrowest range that can answer the question.
3. After reading a file, keep a short file-state summary before deciding to reread it.
4. If the same file appears again, state what new fact is needed before reading.
5. Avoid dumping entire files unless the file is small and central to the task.
