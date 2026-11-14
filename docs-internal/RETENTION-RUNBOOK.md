# Retention operator runbook

Status: **prepared, not authorized for production pruning.**

## 1. Choose and configure a policy

Start read-only. A recommended migration from legacy `retention_weeks` is:

```yaml
retention:
  profile: balanced
  live:
    mode: adaptive
    minimum_weeks: 4
    maximum_weeks: 16
    scan_cycle_multiplier: 1.25
  archive:
    enabled: true
    retention_months: 12
    verify_before_prune: true
    backend: local   # change to s3 only after credentials/restore are proven
  summary:
    retention: indefinite
```

Precedence: per-target `retention` → global `defaults.retention` → named
profile. An explicit `retention` wins over legacy `retention_weeks`; a conflict
is reported in `retentionWarnings`. Omitting `retention` preserves the legacy
fixed window for reading/planning. It never deletes automatically now.

Do not activate a destructive policy until steps 5–8 pass.

## 2. Choose a backend

| Backend | Use |
|---|---|
| `local` | tests, standalone, and a first restore drill |
| `s3` | production S3-compatible object storage (including R2) |

Credentials come only from the environment:

```text
VITAL_ARCHIVE_S3_ACCESS_KEY_ID
VITAL_ARCHIVE_S3_SECRET_ACCESS_KEY
VITAL_ARCHIVE_S3_REGION
VITAL_ARCHIVE_S3_SESSION_TOKEN   # optional
VITAL_ARCHIVE_S3_ENDPOINT
VITAL_ARCHIVE_S3_BUCKET
VITAL_ARCHIVE_S3_PREFIX
```

The S3 client uses path-style URLs and SigV4, including `x-amz-security-token`
when temporary credentials are supplied. It has been exercised against a local
HTTP endpoint, not a live R2/S3 bucket. Treat live-provider compatibility as
unverified until step 5 succeeds with real credentials.

## 3. Preview

```sh
npm run retention:plan -- --domain <key>
npm run retention:plan -- --domain <key> --json
```

Read `live`, `knownUrls`, `distinctBasis`, `confidence`, archive state counts
and storage warnings. Warnings never delete.

## 4. Create and verify archives

```sh
# Dry run builds/verifies in memory only
npm run retention:archive -- --domain <key> --week 2026-W44
npm run retention:archive -- --domain <key> --all-candidates

# Publish to the configured backend; downloads and re-verifies
npm run retention:archive -- --domain <key> --week 2026-W44 --write
```

The command refuses incomplete archives. Successful publication writes
`data/<domain>/archives.json` with key, checksums, publication/verification and
expiry metadata.

## 5. Restore drill

Use a disposable copy, never production:

```sh
# extract the downloaded ZIP into a fresh directory, then compare
unzip -q <archive>.zip -d /tmp/restore
# verify manifest checksums with the retention tests or a custom comparison
```

The automated restore test extracts a fixture archive and compares page
evidence, the resolved dedup stub, manifest, summary and screenshot. Repeat with
a real archive from the selected backend before approving any prune.

## 6. Verify prune readiness

```sh
npm run retention:prune-check -- --domain <key>
```

This downloads each candidate archive, re-verifies the ZIP and all manifest
checksums, and returns READY or BLOCKED per week. It performs no deletion.
READY is not authorization.

## 7. Authorize a disposable test prune

Only in a disposable fixture or a dedicated test target:

```sh
npm run retention:prune -- --domain <test-key> \
  --execute --confirm-domain <test-key>
```

It removes only `pages/`, `runs/` and `screenshots/` for verified weeks;
`summary.json`, ledgers and reports remain. Dedup stubs in retained weeks are
promoted first.

## 8. Investigate a blocked prune

- `legacy_prune_requires_authorization`: explicit policy needed.
- `requires_explicit_discard_approval`: archive disabled.
- `blocked`: summary missing.
- `blocked-missing/expired/incomplete`: archive absent or not usable.
- `blocked-checksum`: object differs from the index.
- `blocked-backend`: credentials/network/permissions.

Fix the archive or policy; do not weaken verification to force a prune.

## 9. Monitor storage

```sh
gh api repos/mgifford/vital-core-data --jq .size
du -sh data
git -C data count-objects -vH
```

Thresholds live under `storage:` in `config/targets.yml`; they are advisory.
`npm run retention:expire-plan` reports metadata expiry only. It never proves an
object was deleted.

## 10. Roll back

Revert the `retention` block and archive backend configuration, then rerun
`retention:plan` and `retention:prune-check`. Do not restore deleted evidence by
rewriting Git history. If archives are intact, restore from the backend into the
data checkout and verify before resuming.

## Limits

- Git history keeps old blobs; working-tree pruning does not shrink history.
- Archive expiry is not physical deletion.
- No automatic deletion exists in any workflow.
- Only the verified, explicitly confirmed command can delete.
