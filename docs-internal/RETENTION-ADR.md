# ADR: safe retention and durable archives (issue #130)

Status: **PR 1–4 implemented — planning, archives, availability pages, last-observation accounting and configured growth warnings. No destructive change is enabled.**
Date: 2026-11-10

## Context

The data repository is the long-term record of weekly scans. At the start of
this work GitHub reported:

| Repository | GitHub-reported size |
|---|---:|
| `mgifford/vital-core` | 6,297 KB (~6.1 MB) |
| `mgifford/vital-core-data` | 1,435,663 KB (~1.37 GiB) |

Those are **repository-history sizes**, not the active working tree. The
existing `retention_weeks: 2` removes `pages/`, `runs/` and `screenshots/`
from the working tree after a summary exists; Git history still retains the
old blobs. Deleting working-tree files therefore does not, by itself, reduce
the data repository's history size.

Current data paths per domain:

```text
data/<domain>/inventory.json
data/<domain>/findings.json
data/<domain>/<ISO-week>/summary.json
data/<domain>/<ISO-week>/pages/*.json
data/<domain>/<ISO-week>/runs/*.json
data/<domain>/<ISO-week>/screenshots/*
data/<domain>/<ISO-week>/*.csv / *.json
```

Page records can be deduplication stubs (`unchanged: true`) that point to an
earlier observation. Historical summaries are retained indefinitely; page-level
detail is what retention removes.

Reproducible measurements:

```bash
gh api repos/mgifford/vital-core --jq .size
gh api repos/mgifford/vital-core-data --jq .size
du -sh data
git -C data count-objects -vH
```

## Decision (PR 1 scope)

1. **Preserve existing behaviour by default.** No `retention:` config means
   the target keeps its legacy `retention_weeks` fixed window. No archive is
   assumed.
2. **Add a policy layer, not a deletion layer.** Profiles `minimal`, `balanced`,
   `research` and `preserve` describe live/archive/summary policy. Explicit
   target policy wins over global defaults and over `retention_weeks`, with a
   warning when the values disagree.
3. **Planning is read-only.** `npm run retention:plan` classifies each week and
   reports storage/throughput. It never archives, uploads, moves or deletes.
4. **Storage warnings never delete.** The current data repo is already above
   the 1,300 MB warning threshold. This is a warning, not a trigger.
5. **No archive implementation in PR 1.** `archive_candidate` means “needs an
   archive first”; no ZIP is claimed to exist.
6. **Historical summaries remain indefinite.** `summary.retention` must be
   `indefinite` in this version.
7. **No Git history rewrite.** The constitution and issue #130 require explicit
   approval before history rewriting or destructive pruning on real data.

## Policy contract

Precedence:

```text
per-target retention > global defaults.retention > named profile
```

Legacy precedence:

```text
explicit retention: config > retention_weeks
```

If `retention:` is absent, `retention_weeks` is preserved exactly. This keeps
current production behaviour and old report links stable while the archive and
prune implementations remain future work.

Profiles:

| Profile | Live detail | Archive | Summaries |
|---|---|---|---|
| `minimal` | fixed 2 weeks | disabled | indefinite |
| `balanced` | adaptive 4–16 weeks, ×1.25 cycle | 12 months | indefinite |
| `research` | adaptive 8–26 weeks, ×1.5 cycle | 36 months | indefinite |
| `preserve` | fixed 52 weeks | indefinite | indefinite |

An enabled archive requires `verify_before_prune: true`. A disabled archive
requires explicit discard approval before any deletion. Adaptive windows use
**distinct successful observations per week**, not scan attempts or configured
capacity; insufficient evidence falls back to the minimum.

## Planner actions

| Action | Meaning |
|---|---|
| `keep_live` | Inside the live window |
| `archive_candidate` | Older than live and archive enabled; archive + verification required first |
| `legacy_prune_requires_authorization` | Legacy `retention_weeks`; no implied authorization |
| `requires_explicit_discard_approval` | Archive disabled; never automatic |
| `blocked` | Summary missing; do not touch |
| `already_pruned` | No page/run/screenshot detail remains |

Every plan reports `destructiveActionsPerformed: 0`.

## Throughput estimator

`src/lib/retention-metrics.js` uses:

- `inventory.json` (pages + fixed + `cleanCount`) for known URLs; `cleanCount`
  is approximate because clean URLs are folded, not stored individually.
- Retained page records for distinct successful (`2xx/3xx`) observations per
  week.
- Summary `pagesAudited`/`pagesScanned` only when page detail is already pruned.

Outputs disclose `knownBasis`, `distinctBasis` and confidence (`low`/`medium`/
`high`). A current, incomplete week can lower the observed rate; the median and
minimum/maximum clamps are deliberate safeguards, not a claim of complete site
coverage.

## Storage decisions

The following are separate quantities and must not be conflated:

1. Git repository history size (GitHub `size`, `git count-objects`).
2. Active `data/` working tree.
3. External archive bytes (future).
4. Observed weekly growth.

PR 1 reports (1), (2) and growth inputs where available. It does **not** claim
that a working-tree decrease shrinks Git history.

## PR sequence

1. **PR 1 (merged):** policy config, ISO-week calculations, metrics,
   non-destructive planner, CLI, tests, ADR.
2. **PR 2 (this change):** archive creation/integrity, deterministic ZIP and
   manifest, local and S3-compatible backends, checksum round-trip; still no
   pruning by default. See [RETENTION-ARCHIVE.md](RETENTION-ARCHIVE.md).
3. **PR 3 (this change):** archive index/API, static evidence/tombstone pages and
   availability states; controlled prune authorization remains future work.
4. **PR 4 (this change):** last-observation index, configured storage-growth
   warnings, archive/observation accounting, and documentation. See
   [RETENTION-OBSERVATIONS.md](RETENTION-OBSERVATIONS.md).

## Last-observation and growth (PR 4)

The compact `data/<domain>/observations.json` index distinguishes last attempt,
last success, never scanned, blocked/failed, stale evidence and
clean-for-automated-engines. `clean` is never a conformance claim. Growth
thresholds now live in validated `config/targets.yml` storage settings and are
read by `scripts/storage-growth.js`; warnings remain advisory. Archive,
observation and summary counts are reported separately in reports.

## Risks and open questions

- The exact archive backend is not chosen; external storage and retention
  ownership need operator approval.
- `cleanCount` is approximate, so known-URL counts are not a complete clean-URL
  ledger. PR 4's last-observation index is the durable fix.
- Legacy `retention_weeks` remains active until an operator explicitly adopts
  a policy; the plan's `legacy_prune_requires_authorization` is deliberately
  not a delete instruction.
- Old report links and archive-expiry behaviour need PR 3 tests before any
  pruning is enabled.
- `hf_only`/sensitive targets must be excluded from any future archive upload.

## Approval gates

Before merging anything that deletes working-tree data or rewrites Git history,
the operator must explicitly approve:

- the archive backend and retention period;
- a verified restore/read test;
- the exact target list (never `hf_only`);
- a dry-run plan showing `destructiveActionsPerformed: 0`;
- the rollback procedure.

## Tests

`tests/unit/retention.test.js` covers ISO week boundaries, 53-week years,
profile resolution, adaptive clamping, legacy precedence, storage warnings,
non-destructive planning, missing summaries, stubs and metrics fallbacks.
`tests/unit/config.test.js` covers config integration and invalid policies.
`tests/unit/retention-archive-index.test.js` covers index/API/availability/tombstone pages.
`tests/unit/retention-archive.test.js` covers deterministic ZIPs, manifests,
checksums, dedup expansion, incomplete archives, local/S3 round trips, `hf_only`
refusal and the CLI.
