# Prune rollout gate

Status: **read-only readiness check. No deletion is enabled.**

Issue #130's destructive step is deliberately separate from archive creation.
Before any operator authorizes a prune, run:

```sh
npm run retention:prune-check -- --domain www.cms.gov
npm run retention:prune-check -- --domain www.cms.gov --json
```

The check:

1. builds the normal retention plan;
2. requires every `archive_candidate` week to have a complete archive index
   entry;
3. requires a key, SHA-256 and available state;
4. downloads the object through the configured backend and re-verifies the ZIP
   and manifest checksums;
5. reports `READY` or `BLOCKED` per week.

It reports `destructiveActionsPerformed: 0`. It never calls `src/prune.js`.

`READY` is not authorization. An operator still needs:

- an approved archive backend and retention owner;
- a restore/read drill against a real archive;
- the exact target list, with `hf_only` excluded;
- explicit approval before enabling deletion.

Legacy `retention_weeks`, archive-disabled policies, missing summaries,
expired/incomplete archives and unreadable/corrupt objects are all blockers.
