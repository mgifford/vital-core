# Sustainability statement

This project follows the practices described in the canonical statement at
<https://mgifford.github.io/SUSTAINABILITY.md> and the
[W3C Web Sustainability Guidelines](https://w3c.github.io/sustainableweb-wsg/),
and applies them to its own footprint, not only to the sites it measures.

## How the scanner limits its own footprint

**Crawling is rationed.** Per-run page budgets, weekly per-domain caps, a
delay between page loads, robots.txt compliance (including Crawl-delay), and
off-hours scheduling mean the scanner never hammers a target. Pages that fail
repeatedly are dropped rather than retried forever.

**Work is never repeated within a week.** Crawl state is persistent. A page
scanned on Tuesday is not scanned again on Thursday; budget goes to pages
that have not been covered yet, oldest first.

**Data is pruned, summaries are kept.** Raw per-page results are deleted
after a configurable retention window once the weekly summary exists. Trends
survive in kilobytes of JSON per domain per week instead of gigabytes of raw
output accumulating in git history.

**Reports are lightweight by construction.** No JavaScript, no web fonts, no
images except inline SVG sparklines, one shared stylesheet of roughly 2 KB.
A weekly report should cost less to serve than a single hero image on the
sites it audits.

**CI is proportionate.** Browser binaries are cached between runs, domains
are scanned in a bounded matrix rather than unbounded parallelism, and the
generated site is deployed as a Pages artifact instead of being committed,
which keeps the repository small.

## How the scanner measures sustainability honestly

Transferred bytes are measured as decoded body size, requests are counted
per page, and CO2 is estimated with [co2.js](https://github.com/thegreenwebfoundation/co2.js)
using the Sustainable Web Design model (v4). These are estimates suitable
for tracking direction of travel, not carbon accounting. The reports say so.

## Why it matters here

Page weight, request counts, and energy use are quality problems in the same
sense accessibility failures are: they exclude people on slow connections,
old devices, and metered data, and they carry an environmental cost that
scales with every visit. Measuring them weekly alongside WCAG results treats
sustainability as routine quality control rather than an afterthought.
