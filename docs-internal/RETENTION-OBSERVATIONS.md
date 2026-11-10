# Last-observation index and storage accounting

Status: **PR 4 implemented. Reporting/monitoring only; pruning remains unchanged.**

## Last-observation index

`data/<domain>/observations.json` is an additive, bounded index covering every
URL in the crawl state. It is populated by the scan and enriched from retained
page records by aggregate.

Each URL records:

- `first_discovered_at`
- `last_attempt_at`
- `last_success_at`
- `last_status`, `last_week`, `fail_count`
- `outcome`: `success`, `blocked`, `failed`, `redirect` or `never_scanned`
- `clean`: `true`/`false` only when an automated engine ran; `null` otherwise
- `first_finding_at` when an automated finding was observed
- computed `stale` / `never_scanned` / `clean_without_automated_findings`

`clean` means **no axe or Alfa finding was recorded**, not that the page
conforms. It is not a WCAG, Section 508 or ACR claim.

`stale` is computed at read time against the last successful observation, not
the last attempt. A later failure does not erase the earlier success timestamp.

Missing or corrupted index files fall back to an empty index; they never block
scanning, aggregation or reports.

## Storage-growth configuration

Thresholds live in `config/targets.yml`:

```yaml
storage:
  code_ceiling_mb: 100
  data_warning_mb: 1300
  data_critical_mb: 1600
  weekly_growth_warning_mb: 100
  run_growth_warning_mb: 50
```

`.github/workflows/report.yml` calls `scripts/storage-growth.js`, which reads
these values. Warnings are advisory and never delete data. The existing
1,300 MB warning remains a warning, not a destructive trigger.

## Accounting

`archive.html` shows four separate quantities:

- weekly summaries
- available / expired / incomplete / missing archives
- discovered URLs
- never-scanned, stale-success and clean-for-automated-engine counts

These are deliberately not combined into one “preserved” number.

## Tests

`tests/unit/observations.test.js` covers never-scanned, success, blocked/failed,
preserved last success, stale detection, clean/null semantics and corrupt-index
fallback. `tests/unit/storage-guard.test.js` covers thresholds and validation.
E2E checks the committed index after a real local scan.

## Not included

- Any deletion, prune authorization or Git-history rewrite.
- A public URL-by-URL API (the index is data, not a report).
- Enforcement of a stale threshold; it is informational.
