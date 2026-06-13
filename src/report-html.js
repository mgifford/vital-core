import fs from 'node:fs';
import path from 'node:path';

/**
 * Report design constraints, in priority order:
 *  1. ACCESSIBILITY.md: semantic structure, visible focus, no
 *     color-only meaning, real tables with captions and scope,
 *     keyboard-complete, dark mode honored.
 *  2. SUSTAINABILITY.md: no JavaScript, no web fonts, one small shared
 *     stylesheet, sparklines as inline SVG marked decorative with the
 *     same data available in tables. A report about page weight should
 *     not be heavy.
 *  3. Then aesthetics: a quiet civic ledger.
 */

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kb = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB');
const fmtScore = (s) => (s == null ? 'n/a' : `${s}/100`);
const fmtMedian = (n) => (n == null ? 'n/a' : String(n));

/** Delta rendered as text first; symbol is reinforcement, not the meaning. */
function delta(n, { goodWhenDown = true, unit = '' } = {}) {
  if (n === 0) return '<span class="delta same">no change</span>';
  const worse = goodWhenDown ? n > 0 : n < 0;
  const cls = worse ? 'worse' : 'better';
  const word = worse ? 'worse' : 'better';
  const sign = n > 0 ? '+' : '';
  return `<span class="delta ${cls}">${sign}${esc(n)}${unit} ${word}</span>`;
}

function sparkline(values, width = 220, height = 36) {
  if (values.length < 2) return '';
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 4 - ((v - min) / span) * (height - 8) + 2).toFixed(1)}`)
    .join(' ');
  return `<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
}

function layout({ title, breadcrumb, body, depth }) {
  const base = '../'.repeat(depth);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${base}style.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header>
  <p class="brand"><a href="${base}index.html">vital-scans</a> <span class="tag">open quality ledger</span></p>
  ${breadcrumb ? `<nav aria-label="Breadcrumb"><ol class="crumbs">${breadcrumb}</ol></nav>` : ''}
</header>
<main id="main">
${body}
</main>
<footer>
  <p>Built in the open with <a href="https://github.com/dequelabs/axe-core">axe-core</a> and
  <a href="https://github.com/Siteimprove/alfa">Siteimprove Alfa</a>; emissions estimated with
  <a href="https://github.com/thegreenwebfoundation/co2.js">co2.js</a> (SWD v4 model).</p>
  <p>This project follows public commitments to
  <a href="https://mgifford.github.io/ACCESSIBILITY.md/">accessibility</a> and
  <a href="https://mgifford.github.io/SUSTAINABILITY.md/">sustainability</a>, and the
  <a href="https://w3c.github.io/sustainableweb-wsg/">W3C Web Sustainability Guidelines</a>.</p>
  <p>Automated checks find roughly a third of accessibility barriers. A clean report is a floor, not a finish line.</p>
</footer>
</body>
</html>`;
}

function ruleTable(caption, rules, kind) {
  const ids = Object.keys(rules).sort((a, b) => rules[b].pages - rules[a].pages || rules[b].count - rules[a].count);
  if (ids.length === 0) return `<p>No ${esc(kind)} findings this week.</p>`;
  const rows = ids
    .map((id) => {
      const r = rules[id];
      const link = r.helpUrl ?? r.ruleUrl;
      const label = r.help ? `${esc(id)}: ${esc(r.help)}` : esc(id);
      return `<tr>
  <th scope="row">${link ? `<a href="${esc(link)}">${label}</a>` : label}</th>
  <td>${r.impact ? esc(r.impact) : 'n/a'}</td>
  <td class="num">${r.pages}</td>
  <td class="num">${r.count}</td>
  <td>${(r.examplePages ?? []).map((u) => `<a href="${esc(u)}">${esc(new URL(u).pathname)}</a>`).join('<br>')}</td>
</tr>`;
    })
    .join('\n');
  return `<table>
<caption>${esc(caption)}</caption>
<thead><tr><th scope="col">Rule</th><th scope="col">Impact</th><th scope="col">Pages affected</th><th scope="col">Instances</th><th scope="col">Example pages</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

/**
 * Structured per-rule bug reports following the best-practices format.
 * Each report is a collapsible block — semantic, keyboard-operable, and
 * JavaScript-free (native <details>). Downloadable as Markdown and JSON.
 */
function bugReportsSection(bugs) {
  if (!bugs || bugs.length === 0) {
    return `<section aria-labelledby="h-bugs">
<h2 id="h-bugs">Bug reports</h2>
<p>No accessibility findings to report this week.</p>
</section>`;
  }
  const sevCount = bugs.reduce((m, b) => ((m[b.severity] = (m[b.severity] ?? 0) + 1), m), {});
  const sevSummary = ['Critical', 'High', 'Medium', 'Low']
    .filter((s) => sevCount[s])
    .map((s) => `${sevCount[s]} ${s.toLowerCase()}`)
    .join(', ');

  const blocks = bugs
    .map((b) => {
      const wcag = b.wcag_sc ? `${esc(b.wcag_sc)} ${esc(b.wcag_name)} (Level ${esc(b.wcag_level)})` : 'undetermined';
      const ruleLink = b.rule_url
        ? `<a href="${esc(b.rule_url)}">${esc(b.tool)} — ${esc(b.rule_id)}</a>`
        : `${esc(b.tool)} — ${esc(b.rule_id)}`;
      return `<details class="bug sev-${esc(b.severity.toLowerCase())}">
<summary><span class="sev-badge">${esc(b.severity)}</span> ${esc(b.summary)}
<span class="bug-meta">${b.frequency.pages_affected}/${b.frequency.total_pages_scanned} pages · ${b.frequency.instances} instances</span></summary>
<dl class="bug-fields">
  <div><dt>Bug ID</dt><dd><code>${esc(b.instance_id)}</code> (pattern <code>${esc(b.pattern_id)}</code>)</dd></div>
  <div><dt>WCAG SC</dt><dd>${wcag}</dd></div>
  <div><dt>Rule</dt><dd>${ruleLink}</dd></div>
  <div><dt>Example URL</dt><dd><a href="${esc(b.url)}">${esc(b.url)}</a></dd></div>
  ${b.xpath ? `<div><dt>Selector</dt><dd><code>${esc(b.xpath)}</code></dd></div>` : ''}
</dl>
${b.html_snippet ? `<p class="bug-label">HTML snippet</p><pre><code>${esc(b.html_snippet)}</code></pre>` : ''}
<p class="bug-label">Description</p><p>${esc(b.description)}</p>
<p class="bug-label">Steps to reproduce</p><ol>${b.steps_to_reproduce.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
<p class="bug-label">Impact</p><p class="bug-placeholder">${esc(b.impact)}</p>
<p class="bug-label">Testing environment</p><p>${esc(b.testing_environment)}</p>
<p class="bug-label">Suggested fix</p><p>${esc(b.suggested_fix)}</p>
</details>`;
    })
    .join('\n');

  return `<section aria-labelledby="h-bugs">
<h2 id="h-bugs">Bug reports</h2>
<p class="meta">${bugs.length} issue type(s): ${esc(sevSummary)}. One report per rule, following
<a href="https://mgifford.github.io/ACCESSIBILITY.md/examples/ACCESSIBILITY_BUG_REPORTING_BEST_PRACTICES.html">accessibility bug-reporting best practices</a>.
Download: <a href="bugs.md">Markdown</a> · <a href="bugs.json">JSON</a>.</p>
<p class="note">Fields marked “requires manual testing” cannot be observed by an automated scan.</p>
${blocks}
</section>`;
}

export function renderDomainReport(target, summary, prev, diff, series, bugs = []) {
  const trendViol = series.map((s) => s.axe.medianViolations ?? 0);
  const body = `
<h1>${esc(target.domain)}: week ${esc(summary.week)}</h1>
<p class="meta">${summary.pagesScanned} pages scanned. Generated ${esc(summary.generatedAt.slice(0, 10))}.
${prev ? `Compared against ${esc(prev.week)} (${prev.pagesScanned} pages).` : 'First recorded week; no comparison yet.'}</p>

<section aria-labelledby="h-summary">
<h2 id="h-summary">This week at a glance</h2>
<dl class="ledger">
  <div><dt>Median axe violations / page</dt><dd>${fmtMedian(summary.axe.medianViolations)} ${sparkline(trendViol)}</dd></div>
  <div><dt>Pages with axe violations</dt><dd>${summary.axe.pagesWithViolations} of ${summary.axe.pagesScanned ?? summary.pagesScanned}</dd></div>
  <div><dt>Median Alfa failures / page</dt><dd>${fmtMedian(summary.alfa.medianFailures)}</dd></div>
  <div><dt>Pages with Alfa failures</dt><dd>${summary.alfa.pagesWithFailures} of ${summary.alfa.pagesScanned ?? summary.pagesScanned}</dd></div>
  <div><dt>Unique pages audited</dt><dd>${summary.pagesAudited ?? summary.pagesScanned}</dd></div>
  ${summary.lighthouse ? `
  <div><dt>Lighthouse performance (median)</dt><dd>${fmtScore(summary.lighthouse.medianPerformance)}<span class="bug-meta"> ${summary.lighthouse.pagesSampled} sampled</span></dd></div>
  <div><dt>Lighthouse SEO (median)</dt><dd>${fmtScore(summary.lighthouse.medianSeo)}</dd></div>
  <div><dt>Lighthouse best practices (median)</dt><dd>${fmtScore(summary.lighthouse.medianBestPractices)}</dd></div>
  ${summary.lighthouse.medianAgentic != null ? `<div><dt>Lighthouse agentic (median)</dt><dd>${fmtScore(summary.lighthouse.medianAgentic)}</dd></div>` : ''}` : ''}
  ${summary.plainLanguage ? `
  <div><dt>Reading ease (median)</dt><dd>${summary.plainLanguage.medianReadingEase}<span class="bug-meta"> ${summary.plainLanguage.pagesScored} prose pages</span></dd></div>
  ${summary.plainLanguage.medianGrade != null ? `<div><dt>Reading grade (median)</dt><dd>${summary.plainLanguage.medianGrade}</dd></div>` : ''}` : ''}
  ${summary.linkCheck ? `
  <div><dt>Broken links</dt><dd>${summary.linkCheck.brokenCount}</dd></div>` : ''}
  ${summary.sustainability ? `
  <div><dt>Median page weight</dt><dd>${kb(summary.sustainability.medianBytes)}
    ${diff?.sustainability ? delta(Math.round(diff.sustainability.medianBytesDelta / 1024), { unit: ' KB' }) : ''}</dd></div>
  <div><dt>Median requests per page</dt><dd>${summary.sustainability.medianRequests}</dd></div>
  <div><dt>Estimated CO₂ per page (mean)</dt><dd>${summary.sustainability.meanCo2g} g</dd></div>` : ''}
</dl>
${prev && summary.pagesScanned !== prev.pagesScanned ? `<p class="note">Note: page counts differ between weeks (${prev.pagesScanned} → ${summary.pagesScanned}). Prefer the “pages affected” columns over raw instance counts when comparing.</p>` : ''}
</section>

${diff ? `
<section aria-labelledby="h-wow">
<h2 id="h-wow">Changes since ${esc(diff.prevWeek)}</h2>
${changeList('axe-core', diff.axe)}
${changeList('Alfa', diff.alfa)}
</section>` : ''}

<section aria-labelledby="h-axe">
<h2 id="h-axe">axe-core findings</h2>
${ruleTable(`axe-core rules failing in ${summary.week}, by pages affected`, summary.axe.rules, 'axe-core')}
</section>

<section aria-labelledby="h-alfa">
<h2 id="h-alfa">Siteimprove Alfa findings</h2>
${ruleTable(`Alfa rules failing in ${summary.week}, by pages affected`, summary.alfa.rules, 'Alfa')}
</section>

${bugReportsSection(bugs)}

${summary.linkCheck ? `
<section aria-labelledby="h-links">
<h2 id="h-links">Broken links</h2>
<table>
<caption>${summary.linkCheck.brokenCount} broken link(s) found on scanned pages in ${summary.week}.</caption>
<thead><tr><th scope="col">Broken URL</th><th scope="col">Status</th><th scope="col">Found on</th></tr></thead>
<tbody>${summary.linkCheck.broken
    .map((b) => `<tr><th scope="row"><a href="${esc(b.url)}">${esc(b.url)}</a></th><td>${esc(b.status || b.reason)}</td><td>${b.foundOn ? `<a href="${esc(b.foundOn)}">${esc(new URL(b.foundOn).pathname)}</a>` : 'n/a'}</td></tr>`)
    .join('\n')}</tbody>
</table>
</section>` : ''}

${summary.plainLanguage?.topUnexplainedAcronyms?.length ? `
<section aria-labelledby="h-acronyms">
<h2 id="h-acronyms">Unexplained acronyms</h2>
<p class="meta">Acronyms used without an on-page expansion (e.g. “Centers for Medicare &amp; Medicaid Services (CMS)”), by pages affected.</p>
<ul>${summary.plainLanguage.topUnexplainedAcronyms.map((a) => `<li><code>${esc(a.acronym)}</code> — ${a.pages} page(s)</li>`).join('')}</ul>
</section>` : ''}

${summary.errorPages.length ? `
<section aria-labelledby="h-errors">
<h2 id="h-errors">Pages that returned errors</h2>
<ul>${summary.errorPages.map((e) => `<li>${esc(e.status)}: <a href="${esc(e.url)}">${esc(e.url)}</a></li>`).join('')}</ul>
</section>` : ''}
`;
  return layout({
    title: `${target.domain} ${summary.week} | vital-scans`,
    breadcrumb: `<li><a href="../../../index.html">All domains</a></li><li aria-current="page">${esc(target.domain)} ${esc(summary.week)}</li>`,
    body,
    depth: 3,
  });
}

function changeList(engineName, d) {
  const items = [];
  for (const id of d.appeared) items.push(`<li><strong>New:</strong> ${esc(id)} appeared this week.</li>`);
  for (const id of d.resolved) items.push(`<li><strong>Resolved:</strong> ${esc(id)} no longer fails on any scanned page.</li>`);
  for (const c of d.changed) {
    const dir = c.pagesAfter > c.pagesBefore ? 'spread' : 'shrank';
    items.push(`<li>${esc(c.id)} ${dir}: ${c.pagesBefore} → ${c.pagesAfter} pages affected.</li>`);
  }
  if (items.length === 0) return `<h3>${esc(engineName)}</h3><p>No rule-level changes.</p>`;
  return `<h3>${esc(engineName)}</h3><ul>${items.join('\n')}</ul>`;
}

export function renderIndex(dashboard) {
  // Separate targets whose latest week is blocked (e.g. a WAF returning
  // 403 to the scanner) so they don't read as zero-violation successes.
  const blocked = dashboard.filter(({ series }) => series[series.length - 1].blocked);
  const active = dashboard.filter(({ series }) => !series[series.length - 1].blocked);

  const blockedCallout = blocked.length === 0 ? '' : `
<section aria-labelledby="h-blocked" class="callout callout-blocked">
<h2 id="h-blocked">Blocked targets</h2>
<p>These sites returned only access-denied responses to the scanner, so no
accessibility or sustainability data could be collected. This is typically a
WAF or bot manager blocking automated traffic, not a scan failure. See
<a href="https://github.com/mgifford/vital-core/blob/main/WAF-ALLOWLIST.md">WAF-ALLOWLIST.md</a>
for how the scanner can be allowlisted.</p>
<ul>${blocked
    .map(({ target, series }) => {
      const latest = series[series.length - 1];
      return `<li><strong>${esc(target.domain)}</strong> — HTTP ${latest.blocked.status} (${esc(latest.week)})</li>`;
    })
    .join('\n')}</ul>
</section>`;

  // Median per-page counts are comparable regardless of how many pages a
  // week happened to cover; raw totals are not, so the table leads with
  // medians. The trend tracks the median axe violations per page.
  const medAxe = (s) => s.axe.medianViolations ?? 0;
  const medAlfa = (s) => s.alfa.medianFailures ?? 0;
  const rows = active
    .map(({ target, series }) => {
      const latest = series[series.length - 1];
      const prev = series.length > 1 ? series[series.length - 2] : null;
      const trend = series.map(medAxe);
      return `<tr>
  <th scope="row"><a href="reports/${esc(target.key)}/${esc(latest.week)}/index.html">${esc(target.domain)}</a></th>
  <td>${esc(latest.week)}</td>
  <td class="num">${latest.pagesAudited ?? latest.pagesScanned}</td>
  <td class="num">${fmtMedian(latest.axe.medianViolations)} ${prev ? delta(medAxe(latest) - medAxe(prev)) : ''}</td>
  <td class="num">${fmtMedian(latest.alfa.medianFailures)} ${prev ? delta(medAlfa(latest) - medAlfa(prev)) : ''}</td>
  <td class="num">${latest.sustainability ? kb(latest.sustainability.medianBytes) : 'n/a'}</td>
  <td>${sparkline(trend)}<span class="visually-hidden">Trend over ${series.length} weeks: ${trend.join(', ')} median axe violations per page.</span></td>
  <td>${series.slice(-8).map((s) => `<a href="reports/${esc(target.key)}/${esc(s.week)}/index.html">${esc(s.week.slice(5))}</a>`).join(' ')}</td>
</tr>`;
    })
    .join('\n');

  const body = `
<h1>Weekly quality ledger</h1>
<p class="meta">Accessibility and sustainability, measured continuously with open source engines.
Thousands of pages per domain, scanned slowly and politely across each week.</p>
${blockedCallout}
${active.length === 0
    ? (dashboard.length === 0
        ? '<p>No scan data yet. The first weekly report appears after the first scheduled scans complete.</p>'
        : '<p>No accessibility or sustainability data could be collected yet — every target is currently blocked (see above).</p>')
    : `
<table>
<caption>Latest week per domain. Counts are medians per page (comparable across weeks regardless of how many pages were covered); pages are unique pages scanned by axe and/or Alfa. Deltas compare against the previous recorded week.</caption>
<thead><tr><th scope="col">Domain</th><th scope="col">Week</th><th scope="col">Pages audited</th><th scope="col">Median axe / page</th><th scope="col">Median Alfa / page</th><th scope="col">Median weight</th><th scope="col">Trend</th><th scope="col">Past weeks</th></tr></thead>
<tbody>${rows}</tbody>
</table>`}
<section aria-labelledby="h-why">
<h2 id="h-why">Why this exists</h2>
<p>Continuous measurement beats one-off audits. This ledger tracks whether each site is getting more
accessible and lighter over time, using <a href="https://github.com/dequelabs/axe-core">axe-core</a> and
<a href="https://github.com/Siteimprove/alfa">Alfa</a> (the open source engine behind Siteimprove) for
accessibility, and page weight with <a href="https://sustainablewebdesign.org/">Sustainable Web Design</a>
CO₂ estimates for sustainability. Everything here is open: the scanner, the data, and the reports.</p>
</section>`;
  return layout({ title: 'vital-scans | weekly quality ledger', breadcrumb: '', body, depth: 0 });
}

export function writeAsset(docsDir) {
  fs.writeFileSync(path.join(docsDir, 'style.css'), CSS);
}

const CSS = `/* vital-scans ledger. System fonts only; ~2 KB; honors user color scheme. */
:root {
  --ink: #1c2326; --paper: #fbfaf7; --accent: #00585c; --rule: #c9c4b8;
  --better: #1d5c2f; --worse: #8c2f1b; --muted: #5a6166;
}
@media (prefers-color-scheme: dark) {
  :root { --ink: #e8e6e1; --paper: #14181a; --accent: #6fd2d6; --rule: #3a4145;
          --better: #8fd6a0; --worse: #f0a48d; --muted: #9aa3a8; }
}
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 72rem; padding: 1rem 1.25rem 3rem;
  font-family: ui-sans-serif, system-ui, sans-serif; line-height: 1.55;
  color: var(--ink); background: var(--paper); }
a { color: var(--accent); }
a:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.skip { position: absolute; left: -999px; }
.skip:focus { left: 1rem; top: 1rem; background: var(--paper); padding: .5rem 1rem;
  border: 2px solid var(--accent); z-index: 1; }
header { border-bottom: 3px double var(--rule); padding-bottom: .5rem; margin-bottom: 1.5rem; }
.brand { font-variant: small-caps; letter-spacing: .06em; font-size: 1.1rem; margin: 0; }
.brand a { text-decoration: none; color: var(--ink); font-weight: 700; }
.tag { color: var(--muted); font-size: .85rem; letter-spacing: .1em; }
.crumbs { list-style: none; padding: 0; margin: .25rem 0 0; font-size: .9rem; }
.crumbs li { display: inline; }
.crumbs li + li::before { content: " / "; color: var(--muted); }
h1 { font-size: 1.6rem; line-height: 1.2; }
h2 { font-size: 1.2rem; border-bottom: 1px solid var(--rule); padding-bottom: .2rem; margin-top: 2.5rem; }
.meta, .note { color: var(--muted); }
.note { border-left: 4px solid var(--rule); padding-left: .75rem; }
.callout-blocked { border-left: 4px solid var(--worse); padding: .25rem 1rem;
  background: color-mix(in srgb, var(--worse) 8%, transparent); border-radius: 2px; }
.callout-blocked h2 { color: var(--worse); border-bottom: none; margin-top: .75rem; }
.callout-blocked ul { margin: .5rem 0; }
.ledger { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: .75rem 2rem; margin: 1rem 0; }
.ledger div { border-top: 1px solid var(--rule); padding-top: .4rem; }
.ledger dt { font-size: .85rem; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.ledger dd { margin: 0; font-size: 1.4rem; font-variant-numeric: tabular-nums; }
.delta { font-size: .85rem; padding: 0 .35rem; border: 1px solid currentColor; border-radius: 2px;
  white-space: nowrap; vertical-align: middle; }
.delta.worse { color: var(--worse); }
.delta.better { color: var(--better); }
.delta.same { color: var(--muted); }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: .95rem; }
caption { text-align: left; color: var(--muted); font-size: .85rem; padding-bottom: .4rem; }
th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid var(--rule);
  vertical-align: top; }
thead th { border-bottom: 2px solid var(--ink); font-size: .8rem; text-transform: uppercase;
  letter-spacing: .05em; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
tbody th[scope="row"] { font-weight: 600; }
.spark { color: var(--accent); vertical-align: middle; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap; }
footer { margin-top: 3rem; border-top: 3px double var(--rule); padding-top: 1rem;
  font-size: .85rem; color: var(--muted); }
@media (prefers-reduced-motion: no-preference) { a { transition: color .15s; } }
.bug { border: 1px solid var(--rule); border-left-width: 4px; border-radius: 2px;
  margin: .6rem 0; padding: 0 .9rem; }
.bug > summary { cursor: pointer; padding: .6rem 0; font-weight: 600; }
.bug[open] > summary { border-bottom: 1px solid var(--rule); margin-bottom: .6rem; }
.bug.sev-critical { border-left-color: var(--worse); }
.bug.sev-high { border-left-color: var(--worse); }
.bug.sev-medium { border-left-color: var(--accent); }
.bug.sev-low { border-left-color: var(--muted); }
.sev-badge { display: inline-block; font-size: .75rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: .05em; padding: 0 .4rem; border: 1px solid currentColor; border-radius: 2px;
  vertical-align: middle; margin-right: .4rem; }
.sev-critical .sev-badge, .sev-high .sev-badge { color: var(--worse); }
.sev-medium .sev-badge { color: var(--accent); }
.sev-low .sev-badge { color: var(--muted); }
.bug-meta { font-weight: 400; color: var(--muted); font-size: .85rem; }
.bug-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: .3rem 1.5rem; margin: .3rem 0; }
.bug-fields div { border-top: 1px solid var(--rule); padding-top: .25rem; }
.bug-fields dt { font-size: .8rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.bug-fields dd { margin: 0; }
.bug-label { font-size: .8rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em;
  margin: .8rem 0 .2rem; }
.bug-placeholder { color: var(--muted); font-style: italic; }
.bug pre { background: color-mix(in srgb, var(--ink) 6%, transparent); padding: .6rem .8rem;
  border-radius: 2px; overflow-x: auto; font-size: .85rem; }
`;
