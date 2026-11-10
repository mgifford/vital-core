# Retention archives: format and operation

Status: **PR 2 implemented. Archive publishing is opt-in; pruning is unchanged.**

See [RETENTION-ADR.md](RETENTION-ADR.md) for the policy and four-PR sequence.

## Artifact naming

```text
[prefix/]<domain-key>/<ISO-week>.zip
```

Examples:

```text
www.cms.gov/2026-W44.zip
evidence/www.cms.gov/2026-W44.zip
```

The key is stable across retries. A retry overwrites the same object only after
the complete ZIP is built; local writes use a temporary file and atomic rename.

## Commands

Dry run (default — builds and verifies in memory, uploads nothing):

```sh
npm run retention:archive -- --domain www.cms.gov --week 2026-W44
```

Publish and verify a local or S3-compatible backend:

```sh
npm run retention:archive -- --domain www.cms.gov --week 2026-W44 --write
npm run retention:archive -- --domain www.cms.gov --all-candidates --write --json
```

Options: `--config`, `--data-root`, `--archive-dir`, `--now`.

`--all-candidates` uses the read-only planner and selects only
`archive_candidate` weeks. It never selects legacy, blocked, already-pruned or
archive-disabled weeks.

## Configuration

Local filesystem (test/standalone):

```yaml
retention:
  archive:
    enabled: true
    retention_months: 12
    verify_before_prune: true
    backend: local
    path: archives
```

S3-compatible object storage:

```yaml
retention:
  archive:
    enabled: true
    retention_months: 12
    verify_before_prune: true
    backend: s3
    endpoint: https://s3.example.gov
    bucket: vital-evidence
    prefix: weekly
```

Credentials come only from the environment, never YAML:

```text
VITAL_ARCHIVE_S3_ACCESS_KEY_ID
VITAL_ARCHIVE_S3_SECRET_ACCESS_KEY
VITAL_ARCHIVE_S3_REGION          # default us-east-1
VITAL_ARCHIVE_S3_SESSION_TOKEN   # optional
VITAL_ARCHIVE_S3_ENDPOINT        # optional fallback for endpoint
VITAL_ARCHIVE_S3_BUCKET          # optional fallback for bucket
VITAL_ARCHIVE_S3_PREFIX          # optional fallback for prefix
VITAL_ARCHIVE_DIR                # optional local root override
```

GitHub Releases versus S3-compatible storage:

| | GitHub Releases | S3-compatible object storage |
|---|---|---|
| Cost | No extra service for public repos | Storage + requests; can be self-hosted/MinIO |
| Large files | Asset limits and release bookkeeping | Designed for object storage |
| Retention | Manual asset management | Bucket lifecycle rules can enforce expiry |
| Auth | GitHub token and release permissions | S3 credentials / instance role |
| Atomicity | Asset upload is a separate release operation | Per-object PUT is atomic; multipart needs care |
| Fit | Small archives, low volume | Weekly production archives at scale |

No paid backend is required for local testing or a small deployment.

## Manifest

`manifest.json` is inside every ZIP:

```json
{
  "schema_version": 1,
  "domain": "www.cms.gov",
  "week": "2026-W44",
  "generated_at": "2026-11-02T...",
  "scanner": { "axe": "4.14.0", "alfa": "0.117.0" },
  "policy": { "profile": "balanced", "archive_retention_months": 12 },
  "status": "complete",
  "unresolved_stubs": [],
  "files": [
    { "path": "pages/p1.json", "bytes": 123, "sha256": "…", "source_sha256": "…" }
  ],
  "record_ids": ["VO-…", "VFR-…"],
  "archive_id": "…"
}
```

- `status` is `complete` or `incomplete`.
- `unresolved_stubs` lists deduplicated page records whose source week is
  missing. **Incomplete archives are never uploaded.**
- `files[].sha256` covers the archived bytes; `source_sha256` covers the
  original source when one exists.
- `record_ids` links occurrence/observation/finding IDs to the manifest.
- `archive_id` is a deterministic SHA-256 of the manifest without that field.
- The ZIP SHA-256 is returned by the command/backend and is not embedded in the
  ZIP (that would be circular).

## Determinism and deduplication

- Entries are sorted; DOS timestamps are fixed at 1980-01-01; zlib settings are
  fixed. Rebuilding the same source produces the same bytes in the same runtime.
- A page record with `unchanged: true` is expanded from its `since` week. The
  archived record is self-contained and records `archive_source` /
  `resolved_from`; the source stub is not modified.
- Missing/corrupt dedup sources make the archive `incomplete` and block upload.
- Screenshots and run evidence are included when present. `hf_only` targets are
  refused by `assertArchivableTarget`.
- ZIPs are not committed to Git; `/archives/` is ignored locally.

## Verification

`archiveWeek()`:

1. builds the ZIP and manifest;
2. refuses an incomplete archive;
3. uploads to the backend;
4. downloads the object again;
5. checks the ZIP SHA-256, every file SHA-256, sizes and the manifest;
6. only reports success after verification.

A failed upload, download, checksum, missing manifest or incomplete archive
throws and leaves source data untouched.

## Not in PR 2

- `src/prune.js` is unchanged. No deletion is enabled.
- Archive index, tombstone/legacy-link pages, archive expiry UI and a
  human-readable archive list are PR 3.
- Last-observation index, growth alerts and fleet accounting are PR 4.
- S3 object lock, lifecycle policy and a verified restore runbook are operator
  responsibilities before any prune authorization.

## Tests

`tests/unit/retention-archive.test.js` covers deterministic rebuilds, manifest
checksums, resolved and unresolved stubs, corruption, local backend round trip,
S3-compatible HTTP round trip, `hf_only` refusal, missing credentials and the
CLI. The test suite never touches production data.
