# Plan: Target diagnostics

Mission `target-diagnostics-01M621KG`. Scaffolded with `spec-kitty specify`
3.2.7 on `claude/vigilant-shannon-79oda8`; the spec is in `spec.md`.

## Summary

A manual `diagnose` workflow runs `scripts/probe-targets.js` on GitHub's
runners and writes what each domain sends the scanner to the job summary.
Pure logic is in `src/lib/probe.js`; the script does the network and browser
work.

## Charter check (sustainable-web-output)

- Manual only, no schedule; nothing committed or deployed.
- Per domain: up to two homepages, `robots.txt` and one sitemap, for two user
  agents (about ten requests), plus one Chromium page load.
- No new dependencies and no client-side output.

## WP01: `src/lib/probe.js` and tests (FR-004, FR-005, FR-007, FR-009, NFR-003)

- `parseDomains(input)`: split on spaces/commas, lowercase, validate with
  the same pattern `scan.yml` uses for a dispatched domain.
- `resolveProbeTargets(config, domains)`: default to every non-`hf_only`
  target; refuse `hf_only` matches (by domain or `www.`-stripped host);
  return `{ targets, refused }`, carrying each target's `user_agent` and
  `nav_timeout_ms`.
- `twinHost(domain)`: the apex for a `www.` host and vice versa; for any
  other subdomain (`go.walsall.gov.uk`), the site it belongs to.
- `pickHeaders(headers)`: keep `server`, `via`, `location`, `content-type`,
  `retry-after`, `x-cache`, `cf-ray`, `cf-mitigated`, `cf-cache-status`,
  `x-amzn-waf-action`, `x-amz-cf-id`, `x-amz-cf-pop`, `akamai-grn`,
  `x-iinfo`, `x-cdn`, `x-sucuri-id`, `x-azure-ref`, `x-served-by`,
  `x-varnish`, `x-drupal-cache`.
- `cookieNames(setCookie[])`: names only.
- `protectionHints({ headers, cookies })`: Cloudflare (and its challenge),
  AWS WAF / CloudFront, Akamai, Imperva, Sucuri, Azure Front Door, F5
  BIG-IP, Drupal page cache.
- `extractTitle(html)`, `verdict(...)`: timeout / network error / 202
  challenge / 401–403 / 404 / 429 / other 4xx / 503 / 5xx / OK, plus "redirects to
  another subdomain" and "answers the scanner differently from a browser".
- `renderMarkdown(results)`: per-domain tables for the job summary.
- `tests/unit/probe.test.js`: all of the above with synthetic inputs.

## WP02: `scripts/probe-targets.js` (FR-002, FR-003, FR-006, FR-008)

- Hop-by-hop `fetch` with `redirect: 'manual'`, a per-request timeout, and
  the body read up to 256 KB for the title only.
- `robots.txt` through the existing `parseRobots()`; the first sitemap
  (from `robots.txt`, else `/sitemap.xml`) counted by `<loc>`.
- Chromium via Playwright with the scan's launch args, viewport and user
  agent: `goto(..., { waitUntil: 'domcontentloaded' })`, then wait for
  `load` up to the target's `nav_timeout_ms` (60 s by default); track
  request start/finish to list slowest and still-open requests (host and
  path, no query).
- Output: Markdown to stdout and `$GITHUB_STEP_SUMMARY`; `::warning`
  annotations for non-OK verdicts; `--json` for raw results. Exit 0 except
  for invalid or refused arguments.
- `package.json`: `"diagnose": "node scripts/probe-targets.js"`.

## WP03: Workflow and docs (FR-001)

- `.github/workflows/diagnose.yml`: `workflow_dispatch` with an optional
  `domains` input passed through `env:` (never interpolated into the
  script); `contents: read`; installs Chromium; runs the probe.
- README "Setting up a new instance" step 7 and `WAF-ALLOWLIST.md`: run
  `diagnose` when pages don't load; CLAUDE.md security rules: the probe
  refuses `hf_only` targets too.
