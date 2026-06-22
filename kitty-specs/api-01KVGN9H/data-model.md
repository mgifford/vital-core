# Data Model: Static JSON API for Scan Results

**Mission**: api-01KVGN9H
**Date**: 2026-06-19

---

## Entities

### IndexEntry (one per domain in `index.json`)

| Field | Type | Source | Notes |
|---|---|---|---|
| `domain` | string | `target.domain` | e.g. `"www.cms.gov"` |
| `key` | string | `target.key` | URL-safe domain key |
| `latest_week` | string | `series[last].week` | ISO week e.g. `"2026-W25"` |
| `pages_scanned` | number | `latest.pagesScanned` | Latest week page count |
| `critical_count` | number | derived from `bugs` | Count of Critical severity findings |
| `serious_count` | number | derived from `bugs` | Count of Serious severity findings |
| `snapshot_url` | string | computed | `/api/v1/<key>/snapshot.json` |
| `findings_url` | string | computed | `/api/v1/<key>/<latest_week>/findings.json` |

---

### DomainSnapshot (`snapshot.json` — one per domain, latest week only)

| Field | Type | Source | Notes |
|---|---|---|---|
| `schema_version` | string | constant `"1"` | Bump on breaking changes |
| `domain` | string | `target.domain` | |
| `key` | string | `target.key` | |
| `generated_at` | string | `new Date().toISOString()` | |
| `latest_week` | string | `series[last].week` | |
| `latest_score` | number | `scoreFor(latest)` | 0–100 composite |
| `summary` | object | derived | See SummaryBlock below |
| `inventory` | object | `invSummary` | `{ totalKnownPages, pagesWithKnownIssues }` |
| `findings` | object | `ledger.findings` | All tracked findings with first/last-seen |
| `tech_findings` | array\|null | `latest.techFindings.associations` | Top tech↔finding lift associations |
| `weekly` | object | `{ series, diffs }` | Full trend history |

> **Note**: `pages` (per-URL inventory) is omitted from snapshot due to size — large sites have thousands of URLs. Use `inventory.totalKnownPages` for counts.

#### SummaryBlock

| Field | Type | Source |
|---|---|---|
| `pages_scanned` | number | `latest.pagesScanned` |
| `critical_count` | number | count of Critical bugs in latest week |
| `serious_count` | number | count of Serious bugs in latest week |
| `moderate_count` | number | count of Moderate bugs in latest week |
| `minor_count` | number | count of Minor bugs in latest week |
| `total_findings` | number | total bugs in latest week |

---

### WeeklyFindings (`<week>/findings.json` — one per domain/week)

| Field | Type | Source | Notes |
|---|---|---|---|
| `schema_version` | string | constant `"1"` | |
| `domain` | string | `target.domain` | |
| `week` | string | `summary.week` | ISO week |
| `generated_at` | string | `new Date().toISOString()` | |
| `pages_scanned` | number | `summary.pagesScanned` | |
| `findings` | FindingEntry[] | `bugs` | See FindingEntry below |

#### FindingEntry (one per bug in the week's bug report)

| Field | Type | Source |
|---|---|---|
| `finding_id` | string | `bug.pattern_id` |
| `rule_id` | string | `bug.rule_id` |
| `rule_label` | string | `bug.rule_label` |
| `engine` | string | `bug.engine_key` |
| `severity` | string | `bug.severity` (Critical/Serious/Moderate/Minor) |
| `wcag_sc` | string\|null | `bug.wcag_sc` |
| `wcag_level` | string\|null | `bug.wcag_level` |
| `pages_affected` | number | `bug.frequency.pages_affected` |
| `trend_status` | string | `"new"\|"persistent"\|"worsening"\|"improving"` |
| `first_seen` | string | `bug.first_seen` |
| `last_seen` | string | `bug.last_seen` |
| `weeks_seen` | number | `bug.weeks_seen` |

---

## URL → File Mapping

| URL (GitHub Pages) | File path in `docs/` |
|---|---|
| `/api/v1/index.json` | `docs/api/v1/index.json` |
| `/api/v1/www.cms.gov/snapshot.json` | `docs/api/v1/www.cms.gov/snapshot.json` |
| `/api/v1/www.cms.gov/2026-W25/findings.json` | `docs/api/v1/www.cms.gov/2026-W25/findings.json` |

---

## Relationships

```
index.json
  └── entries[] → snapshot.json (per domain)
                    └── weekly.series[] → findings.json (per domain/week)
```

Every file is self-contained (no cross-file references required to parse it), but `snapshot_url` and `findings_url` in the index provide navigable links for consumers that want to follow references.
