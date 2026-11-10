# Retention archives: format and operation

Status: **PR 2 and PR 3 implemented. Archive publishing and availability reporting are opt-in; pruning is unchanged.**

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
    # optional, only if the bucket is publicly readable:
    # public_base_url: https://evidence.example.gov/weekly
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

## Archive index and availability

`recordVerifiedArchive()` writes an additive
`data/<domain>/archives.json` index after a verified upload. It records the
week, object key, backend, archive ID, ZIP SHA-256, byte size, publication time,
expiry and optional public URL. It never records an incomplete archive and never
deletes a source week.

Availability is computed when read:

| State | Meaning |
|---|---|
| `available` | Complete archive, before expiry |
| `expired` | Retention period passed; summary/findings remain |
| `incomplete` | Unresolved/stale archive; not a preservation claim |
| `missing` | No verified archive entry |

The static reports expose:

- `archive.html` — every week, its archive state and an **Evidence details** link.
- `<week>/evidence.html` — a tombstone/explanation page with a download link
  only when a public URL is configured. Expired/missing pages explicitly say raw
  detail is unavailable and **never redirect** to a newer finding.
- `/api/v1/archives/index.json` — fleet machine-readable archive index.
- `/api/v1/<domain>/archives.json` — per-domain archive states.

`public_base_url` can be set in the archive policy to make download links
public; without it the evidence page says the archive is held in the
operator-configured backend.

## Not in PR 2/3

- `src/prune.js` is unchanged. No deletion is enabled.
- Archive retry policy, object lock, lifecycle rules and a verified restore
  runbook are operator responsibilities before any prune authorization.
- Last-observation index, growth alerts and fleet accounting are PR 4.
- Legacy-link handling is a **static evidence page**, not a redirect: a finding
  that is no longer live is never silently mapped to a current occurrence.

## Tests

`tests/unit/retention-archive.test.js` covers deterministic rebuilds, manifest
checksums, resolved and unresolved stubs, corruption, local backend round trip,
S3-compatible HTTP round trip, `hf_only` refusal, missing credentials and the
CLI. The test suite never touches production data.
