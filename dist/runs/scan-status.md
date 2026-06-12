# Scan Status Report

Generated: 2026-06-03T02:52:02.503Z

## Per-Domain Summary

| Domain | Known URLs | Queued | Completed | Unchanged | Budget-Skipped | Timed Out | Failed | Quarantined | CDN | Throttle |
|--------|-----------|--------|-----------|-----------|---------------|-----------|--------|-------------|-----|----------|
| https://www.cms.gov | 14 | 5 | 2 | 1 | 5 | 2 | 0 | 0 | fastly | conservative |
| https://www.hhs.gov | 15 | 5 | 5 | 0 | 0 | 0 | 0 | 0 | — | conservative |
| https://www.medicare.gov | 11 | 5 | 0 | 4 | 5 | 1 | 0 | 0 | fastly | conservative |
| https://www.medicaid.gov | 14 | 5 | 2 | 0 | 4 | 2 | 1 | 1 | fastly | conservative |
| https://data.medicaid.gov | 13 | 3 | 3 | 0 | 5 | 0 | 0 | 0 | fastly | conservative |
| https://data.healthcare.gov | 14 | 5 | 2 | 0 | 0 | 3 | 0 | 0 | — | conservative |
| https://www.healthcare.gov | 10 | 5 | 0 | 5 | 5 | 0 | 0 | 0 | — | conservative |
| https://www.cdc.gov | 10 | 5 | 0 | 1 | 0 | 4 | 0 | 9 | azure | conservative |
| https://www.nih.gov | 7 | 5 | 0 | 0 | 0 | 5 | 0 | 2 | — | conservative |
| https://www.health.gov | 15 | 5 | 2 | 0 | 5 | 3 | 0 | 0 | awscloudfront | conservative |

## https://www.cms.gov — Timeout / Failed URLs

| URL | Status | Consecutive Failures | Quarantined Until |
|-----|--------|----------------------|-------------------|
| https://www.cms.gov/digital-service/digital-accessibility | TIMEOUT | 1 | — |
| https://www.cms.gov/digital-service/findsupportgov | TIMEOUT | 1 | — |

## https://www.medicare.gov — Timeout / Failed URLs

| URL | Status | Consecutive Failures | Quarantined Until |
|-----|--------|----------------------|-------------------|
| https://www.medicare.gov/account/login | TIMEOUT | 1 | — |

## https://www.medicaid.gov — Timeout / Failed URLs

| URL | Status | Consecutive Failures | Quarantined Until |
|-----|--------|----------------------|-------------------|
| https://www.medicaid.gov/faq | FAILED | 2 | 2026-06-05T01:43:52.207Z |
| https://www.medicaid.gov/eligibility | TIMEOUT | 1 | — |
| https://www.medicaid.gov/resources-for-states/eligibility-enrollment-and-renewal-tools-and-resources | TIMEOUT | 1 | — |

## https://data.healthcare.gov — Timeout / Failed URLs

| URL | Status | Consecutive Failures | Quarantined Until |
|-----|--------|----------------------|-------------------|
| https://data.healthcare.gov/dataset/cfvf-wask | TIMEOUT | 1 | — |
| https://data.healthcare.gov/stories/s/a7nc-mrxa | TIMEOUT | 1 | — |
| https://data.healthcare.gov/stories/s/Agent-Broker-Registration-and-Termination-List-Lan/a7nc-mrxa | TIMEOUT | 1 | — |

## https://www.cdc.gov — Timeout / Failed URLs

| URL | Status | Consecutive Failures | Quarantined Until |
|-----|--------|----------------------|-------------------|
| https://www.cdc.gov/about/cdc-moving-forward/newcdc-info.html | TIMEOUT | 2 | 2026-06-05T01:52:38.976Z |
| https://www.cdc.gov/museum/accessibility.htm | TIMEOUT | 2 | 2026-06-05T02:21:37.885Z |
| https://www.cdc.gov/other/accessibility.html | TIMEOUT | 2 | 2026-06-05T02:23:53.713Z |
| https://www.cdc.gov/search/index.html | TIMEOUT | 2 | 2026-06-05T02:45:20.010Z |

## https://www.nih.gov — Timeout / Failed URLs

| URL | Status | Consecutive Failures | Quarantined Until |
|-----|--------|----------------------|-------------------|
| https://www.nih.gov/about-nih/impact-nih-research/improving-health | TIMEOUT | 1 | — |
| https://www.nih.gov/about-nih/nih-almanac/chronology-events | TIMEOUT | 1 | — |
| https://www.nih.gov/research-training/safety-regulation-guidance | TIMEOUT | 1 | — |
| https://www.nih.gov/advancing-mecfs-research/announcements/nih-request-information-mecfs-research-efforts | TIMEOUT | 1 | — |
| https://www.nih.gov/regenerative-medicine-innovation-project-rmip/funding-opportunities | TIMEOUT | 1 | — |

## https://www.health.gov — Timeout / Failed URLs

| URL | Status | Consecutive Failures | Quarantined Until |
|-----|--------|----------------------|-------------------|
| https://www.health.gov/careers/current-job-opportunities | TIMEOUT | 1 | — |
| https://www.health.gov/careers/how-apply-jobs-oash | TIMEOUT | 1 | — |
| https://www.health.gov/careers/pathways-program | TIMEOUT | 1 | — |

## Throttle & CDN Guidance

Sites behind **Akamai**, **Cloudflare**, or **Imperva** are auto-assigned the `conservative` throttle profile (3 s base delay + 1.5 s jitter) unless overridden.
Add `throttle_profile: conservative` to a target's `settings` block to enforce it explicitly.
Set `VITAL_SCAN_WINDOW_START_HOUR` / `VITAL_SCAN_WINDOW_END_HOUR` (UTC) to restrict scans to off-peak hours. Recommended window for US government sites: **22:00–06:00 UTC** (6 PM–1 AM ET).