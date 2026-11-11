# Retention storage measurements

Snapshot: 2026-11-11. These are observations, not thresholds.

| Quantity | Value |
|---|---:|
| `vital-core` GitHub-reported size | 7,337 KB (~7.2 MB) |
| `vital-core-data` GitHub-reported size | 1,540,923 KB (~1.47 GiB) |
| Sparse `data/www.cms.gov` working tree | ~438 MB |
| Sparse `data/` checkout | ~484 MB |
| `vital-core` local pack | ~6.0 MiB |

The data repository was ~1.37 GiB at the start of the retention work and is now
~1.47 GiB. That growth is consistent with continued weekly page records, not a
retention regression. These figures do **not** prove which paths account for
history growth.

## Reproduce

```sh
gh api repos/mgifford/vital-core --jq .size
gh api repos/mgifford/vital-core-data --jq .size
du -sh data data/www.cms.gov
git count-objects -vH
```

For a real per-path analysis, use a full data checkout and:

```sh
git -C data rev-list --objects --all |
  git -C data cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' |
  awk '$1=="blob" {print $3, $4}' | sort -nr | head -30
```

Do not rewrite history from these measurements. A rewrite needs a separate
proposal, recoverability checks, expected savings and owner approval.

## Monitoring

`config/targets.yml` `storage:` thresholds are advisory. The report workflow
uses `scripts/storage-growth.js`; it never deletes. Warnings identify size,
run-over-run growth and 7-day growth, not the responsible path. The per-path
audit above is the next diagnostic step.
