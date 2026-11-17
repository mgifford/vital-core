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

**Data is retained under an explicit policy.** Raw per-page results are not
deleted automatically. A verified archive and an explicitly authorized prune
are required before detail can be removed; summaries and ledgers are kept
indefinitely. Trends survive without letting raw output grow without bound.

**Reports are lightweight by construction.** No JavaScript, no web fonts, no
images except inline SVG sparklines, one shared stylesheet of roughly 2 KB.
A weekly report should cost less to serve than a single hero image on the
sites it audits.

**CI is proportionate.** Browser binaries are cached between runs, domains
are scanned in a bounded matrix rather than unbounded parallelism, and the
generated site is deployed as a Pages artifact instead of being committed,
which keeps the repository small.

## How the scanner measures sustainability honestly

Page weight uses a **legacy mixed byte basis**: `Content-Length` where present
(usually encoded bytes), otherwise the decoded response body. It is not a pure
network-transfer measurement. New records also carry Resource Timing
`transferSize`/`encodedBodySize`/`decodedBodySize` separately, with missing or
cross-origin zero values marked as unknown rather than zero.

CO₂ is modelled with [co2.js](https://github.com/thegreenwebfoundation/co2.js)
using the Sustainable Web Design model (v4). The derived Wh value is model
output, not measured client energy. These estimates are suitable for tracking
direction of travel, not carbon accounting or per-component energy claims. See
[`docs-internal/SCI-WEB.md`](docs-internal/SCI-WEB.md).

## Why it matters here

Page weight, request counts, and energy use are quality problems in the same
sense accessibility failures are: they exclude people on slow connections,
old devices, and metered data, and they carry an environmental cost that
scales with every visit. Measuring them weekly alongside WCAG results treats
sustainability as routine quality control rather than an afterthought.
