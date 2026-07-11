# VITAL static JSON API (v1)

VITAL publishes a stable, read-only JSON API alongside the HTML reports so
developers, dashboards, CI pipelines, and local tools can consume scan findings
without scraping HTML or coupling to the internal `data/` layout.

The API is **static files only** — no server, no database, no authentication.
It is generated during the normal `npm run aggregate` build and deployed with
the GitHub Pages artifact. Consuming it is a plain HTTP `GET`.

All paths below are relative to the API root: `https://<pages-host>/api/v1/`.

---

## Versioning

Every resource carries a top-level `schema_version` (currently `"1"`). Within a
version, fields may be **added**; consumers must ignore unknown fields. A
**breaking** change (removing or repurposing a field) ships under a new path
(`/api/v2/`), and `/api/v1/` is kept until consumers migrate. `schema_version`
is the API contract version — it is **not** the npm package version.

JSON Schemas for each resource are published under
[`/api/v1/schema/`](#schemas) and can be used to validate responses in CI.

---

## Resources

| Path | Description |
|---|---|
| `/api/v1/index.json` | All published domains — latest week, severity counts, links |
| `/api/v1/<domain-key>/snapshot.json` | Full domain history — summary, findings ledger, weekly series, tech associations |
| `/api/v1/<domain-key>/<week>/findings.json` | Per-week normalized accessibility findings with trend status |
| `/api/v1/schema/*.schema.json` | JSON Schemas for the resources above |

`<domain-key>` is the stable `key` from `config/targets.yml` (e.g. `www.cms.gov`).
`<week>` is an ISO year-week (e.g. `2026-W25`).

### `index.json`

```json
{
  "schema_version": "1",
  "domains": [
    {
      "domain": "www.cms.gov",
      "key": "www.cms.gov",
      "latest_week": "2026-W25",
      "pages_scanned": 421,
      "top_actions_count": 8,
      "critical_count": 2,
      "serious_count": 37,
      "snapshot_url": "/api/v1/www.cms.gov/snapshot.json",
      "findings_url": "/api/v1/www.cms.gov/2026-W25/findings.json"
    }
  ]
}
```

### `findings.json`

Each finding is a **normalized** public model — not a raw axe-core or Alfa
object. Severity uses the axe-core taxonomy verbatim (`Critical`, `Serious`,
`Moderate`, `Minor`). `trend_status` is one of `new`, `persistent`,
`improving`, `worsening`. `axe-core` and `alfa` are preserved as distinct
engines.

```json
{
  "schema_version": "1",
  "domain": "www.cms.gov",
  "week": "2026-W25",
  "generated_at": "2026-07-11T02:14:40.411Z",
  "pages_scanned": 421,
  "top_actions": { "...": "component-cluster next-actions queue, or null" },
  "findings": [
    {
      "finding_id": "VS-1a2b3c",
      "rule_id": "color-contrast",
      "rule_label": "Elements must meet minimum contrast",
      "engine": "axe-core",
      "severity": "Serious",
      "wcag_sc": "1.4.3",
      "wcag_level": "AA",
      "pages_affected": 18,
      "trend_status": "persistent",
      "first_seen": "2026-W22",
      "last_seen": "2026-W25",
      "weeks_seen": 4
    }
  ]
}
```

### `snapshot.json`

Full per-domain history: a `summary` block (severity counts + pages scanned),
the `findings` ledger keyed by `finding_id`, `tech_findings`, `top_actions`,
and a `weekly.series` of per-week summaries with `weekly.diffs`. Use it to build
trends or to diff week-over-week (e.g. fail CI when `summary.critical_count`
rises).

---

## Schemas

Published under `/api/v1/schema/`:

- `index.schema.json`
- `snapshot.schema.json`
- `findings.schema.json`

They are JSON Schema **draft-07**. Generated resources are validated against
them in the test suite (`tests/unit/api-schema.test.js`), so the published files
always conform.

---

## Retention

The API reflects the project's retention model: `snapshot.json` keeps the full
weekly **summary** series for a domain, but detailed per-page records are pruned
over time. Historical weeks therefore expose summary metrics and findings, not
resurrected page-level detail. Page-level evidence resources are not part of v1.

---

## Privacy and redaction

The API is public, so URLs it emits are sanitized (issue #136):

- **Scan-time exclusions** (`url_exclude`): excluded pages are never fetched, so
  they never enter the API.
- **Report exclusions** (`url_exclude_patterns`): the API applies the same
  baseline the HTML report does, so a page hidden from the report is also absent
  from the API (finding counts are recomputed on the remaining pages).
- **Fragment stripping**: any `#fragment` is removed from emitted URLs.
- **Query redaction**: the value of any sensitive query parameter (token, key,
  secret, session, auth, password, email, apikey, signature, code, jwt, bearer,
  nonce, state, otp, and similar families, plus a per-target `api_redact_params`
  denylist) is replaced with `[REDACTED]`. Harmless params (e.g. `page`, `sort`)
  are preserved.

Engine-sourced rule descriptions and technology names remain in English by
design; the API does not localize.

---

## Partial and missing data

- **Missing resources** return an HTTP `404` from the static host — there is no
  in-band error body.
- Zero, empty array, and absent are **not** interchangeable: a `0` count means
  "measured zero", an omitted optional field means "not available".
- Incomplete scans are represented explicitly in the summary data rather than
  presented as clean results; a scanner failure is never reported as a confirmed
  site failure.

---

## Examples

Fetch the domain list:

```bash
curl https://<pages-host>/api/v1/index.json
```

Fetch one domain's latest findings:

```bash
curl https://<pages-host>/api/v1/www.cms.gov/2026-W25/findings.json
```

Load a domain summary from JavaScript:

```js
async function loadDomainSummary(domainKey) {
  const response = await fetch(
    `/api/v1/${encodeURIComponent(domainKey)}/snapshot.json`
  );
  if (!response.ok) {
    throw new Error(`Unable to load domain snapshot: ${response.status}`);
  }
  return response.json();
}
```

---

## Known limitations

- Read-only. There are no write, query, or filter endpoints — consumers fetch a
  whole resource and filter client-side.
- No `rules.json` catalogue and no per-page evidence resources in v1.
- `generated_at` timestamps change every build; treat them as provenance, not
  as part of a finding's identity.
- The API is UI-chrome-free structured data; it is not a substitute for the
  human-readable HTML reports.
