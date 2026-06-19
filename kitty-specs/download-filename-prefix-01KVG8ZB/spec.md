# Spec: Download filenames include domain and date

**Status**: SHIPPED (2026-W25, PR #151)

## Goal

When a user downloads a CSV or JSON file from a report, the saved filename
should carry the domain and the date so it's self-describing when opened
outside the report directory. Example: `www.cms.gov_15JUN2026_lighthouse.csv`
instead of just `lighthouse.csv`.

## Date format

`DDMONYYYY` — day (zero-padded), three-letter uppercase month abbreviation,
four-digit year. Anchored to the **Monday of the ISO week** the report covers.
Examples: `15JUN2026`, `02JAN2026`, `29DEC2025`.

This format matches the convention used elsewhere in the project.

## Acceptance criteria

- [x] `src/lib/week.js` — `weekToDateStamp(weekStr)` converts `'2026-W25'` →
      `'15JUN2026'`. Falls back to the raw string on parse failure. Exported.
- [x] `src/lib/csv.js` — private `filePrefix(domain, week)` returns
      `'<domain>_<DDMONYYYY>'`. All `writeXxxCsv` / `writeXxxJson` functions
      accept `domain` and `week` as additional first arguments and use the prefix
      in the written filename and return value.
- [x] Files covered: `lighthouse.csv`, `lighthouse.json`, `readability.csv`,
      `spelling.csv`, `spelling.json`, `acronyms.csv`, `acronyms.json`,
      `resources.csv`, `bugs.csv`, `bugs.json`, `images.csv`, `images.json`,
      `tech.csv`, `tech.json`, `third-party.csv`, `errors.csv`,
      `priority-pages.csv`, `priority-pages.json`, `ai-findings.json`.
- [x] Per-rule CSVs in the `csv/` subdirectory are **not** prefixed — they are
      internal links, not user-facing downloads.
- [x] `src/aggregate.js` — all call sites updated with the new signatures;
      `bugsJson`, `aiJson`, `imagesJson` stored on `summary` / `reporting` so
      HTML templates use the correct filename in download links.
- [x] `src/report-html.js` — download links for bugs.json, ai-findings.json, and
      images.json updated to use `reporting.bugsJson`, `reporting.aiJson`,
      `summary.imagesJson` respectively, with fallback to the old name.
- [x] All 91 unit tests pass.

## Out of scope

- Renaming the HTML report files (`accessibility.html`, `lighthouse.html`, etc.) —
  those are the page URLs, not downloads.
- Renaming the per-rule `csv/<engine>__<rule>.csv` files.
