---
name: retry-breaker
description: Use after repeated failed commands, failed edits, or repeated attempts that do not change the failure mode.
---

# Retry Breaker

When the same failure repeats:

1. Stop after two similar failures.
2. State the invariant: what did not change across attempts.
3. Reduce the scope to the smallest failing command or file.
4. Re-read only the evidence needed for the next hypothesis.
5. Ask whether to compact or split the task if the session has drifted.
