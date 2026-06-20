import fs from 'node:fs';
import path from 'node:path';
import { scoreFor, trajectory, scoreMeaning } from './lib/score.js';
import { rankBugs, fleetWorstOffenders } from './lib/priority.js';
import { prioritizeAccessibilityBugs } from './lib/accessibility-priority.js';
import { performanceImpact } from './lib/perf-impact.js';
import { mergeFleet, rankFleetAssociations } from './lib/tech-findings.js';
import { buildLineManifest } from './lib/paracharts.js';
import { rulePlainLabel } from './lib/rule-label.js';

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

// Report-wide display preference for the sustainability figure, set once
// by aggregate via setSustainabilityMetric(). 'co2' or 'energy'.
let SUSTAINABILITY_METRIC = 'co2';
export function setSustainabilityMetric(metric) {
  SUSTAINABILITY_METRIC = metric === 'energy' ? 'energy' : 'co2';
}
/** The headline sustainability stat for a page, per the configured metric. */
function sustainabilityHeadline(s) {
  if (!s) return null;
  return SUSTAINABILITY_METRIC === 'energy'
    ? { label: 'Estimated energy per page (mean)', value: `${s.meanEnergyWh ?? 'n/a'} Wh` }
    : { label: 'Estimated CO₂ per page (mean)', value: `${s.meanCo2g} g` };
}
const fmtScore = (s) => (s == null ? 'n/a' : `${s}/100`);
const fmtMedian = (n) => (n == null ? 'n/a' : String(n));
/**
 * Affected-page display for a bug: list URLs inline when there are 25 or
 * fewer (more useful than a CSV link for a handful); above that, list the
 * first 25 then link the full CSV. Used in the detailed bug blocks (not
 * the compact "fix first" table, which stays a single count + CSV link).
 */
function affectedPagesBlock(b) {
  const total = b.frequency.pages_affected;
  const urls = b.affected_pages ?? [];
  const li = (u) => {
    let label = u;
    try { label = new URL(u).pathname || u; } catch { /* keep raw */ }
    return `<li><a href="${esc(u)}">${esc(label)}</a></li>`;
  };
  if (total <= 25 && urls.length >= total) {
    return `<ul class="affected">${urls.map(li).join('')}</ul>`;
  }
  const more = b.affected_pages_csv
    ? `<a href="${esc(b.affected_pages_csv)}">all ${total} pages (CSV)</a>`
    : `${total} pages total`;
  return `<ul class="affected">${urls.slice(0, 25).map(li).join('')}</ul><p>…and more — ${more}.</p>`;
}
/** Render the pages that link to a broken URL, capped with a "+N more". */
function linkedFrom(sources) {
  const list = Array.isArray(sources) ? sources : sources ? [sources] : [];
  if (list.length === 0) return 'n/a';
  const shown = list.slice(0, 3).map((u) => {
    let label = u;
    try { label = new URL(u).pathname || u; } catch { /* keep raw */ }
    return `<a href="${esc(u)}">${esc(label)}</a>`;
  });
  const more = list.length > 3 ? ` +${list.length - 3} more` : '';
  return shown.join('<br>') + more;
}

/**
 * Section heading with a shareable anchor link. The "#" reveals on
 * hover/focus, links to the section, and is marked aria-hidden + given a
 * data-attribute so it isn't read by screen readers or copied with the
 * heading text (the CSS uses ::before so the glyph isn't in the DOM text).
 */
function heading(id, text, level = 2) {
  return `<h${level} id="${esc(id)}"><a class="anchor" href="#${esc(id)}" aria-label="Link to this section"></a>${esc(text)}</h${level}>`;
}

/** " Download: CSV · JSON." from optional relative hrefs; '' if none. */
function downloadLinks(csvHref, jsonHref) {
  const parts = [
    csvHref ? `<a href="${esc(csvHref)}">CSV</a>` : '',
    jsonHref ? `<a href="${esc(jsonHref)}">JSON</a>` : '',
  ].filter(Boolean);
  return parts.length ? ` Download: ${parts.join(' · ')}.` : '';
}

/** A long URL: shown truncated (CSS ellipsis) with the full URL on
 * hover/focus (title) and still fully selectable/copyable. */
function urlCell(url) {
  return `<a class="url" href="${esc(url)}" title="${esc(url)}">${esc(url)}</a>`;
}

/**
 * Sub-page navigation shared by every page in a domain's weekly report.
 * `active` is the current page key. The nav is FIXED — it always lists every
 * criterion we evaluate, in the same order, on every domain and every week —
 * so navigation is consistent and predictable. Every sub-page is always
 * written (with a "no data this week" empty state where a criterion had none),
 * so no link 404s. Links are relative within the same week directory.
 */
const SUBNAV_ITEMS = [
  ['index.html', 'Overview', 'overview'],
  ['accessibility.html', 'Accessibility', 'accessibility'],
  ['standards.html', 'Standards', 'standards'],
  ['errors.html', 'Errors', 'errors'],
  ['lighthouse.html', 'Lighthouse', 'lighthouse'],
  ['readability.html', 'Readability', 'readability'],
  ['tech.html', 'Tech stack', 'tech'],
  ['tech-findings.html', 'Tech ↔ issues', 'tech-findings'],
  ['third-party.html', 'Third parties', 'third-party'],
  ['images.html', 'Images', 'images'],
  ['archive.html', 'Archive', 'archive'],
];
function subnav(active) {
  return `<nav class="subnav" aria-label="Domain report pages"><ul>${SUBNAV_ITEMS
    .map(([href, label, key]) => key === active
      ? `<li aria-current="page">${esc(label)}</li>`
      : `<li><a href="${esc(href)}">${esc(label)}</a></li>`)
    .join('')}</ul></nav>`;
}

/**
 * A consistent empty-state page for a criterion that had no data this week.
 * Keeps the full shared nav so navigation never breaks and the page reads as
 * "we evaluate this, there just wasn't data this week" rather than 404.
 */
function emptyCriterionPage(target, summary, { active, label, message }) {
  const body = `
<h1>${esc(target.domain)}: ${esc(label)} — week ${esc(summary.week)}</h1>
${subnav(active)}
<p class="meta">${esc(message)}</p>
<p class="note">This criterion is evaluated for every domain, but a given week's sample may not include pages with data for it. Check the <a href="archive.html">archive</a> for other weeks, or the <a href="index.html">overview</a>.</p>`;
  return layout({
    title: `${target.domain} ${label} ${summary.week} | vital-scans`,
    breadcrumb: `<li><a href="../../../index.html">All domains</a></li><li><a href="index.html">${esc(target.domain)} ${esc(summary.week)}</a></li><li aria-current="page">${esc(label)}</li>`,
    body,
    depth: 3,
  });
}

/**
 * A sortable data table (progressive enhancement: fully usable without
 * JS; columns become click-to-sort when JS is on). Numeric columns sort
 * numerically via a data-sort value. `cols` is [{label, num}], `rows` is
 * arrays of { html, sort } cells.
 */
function sortableTable(caption, cols, rows) {
  const thead = cols
    .map((c, i) => `<th scope="col"${c.num ? ' class="num"' : ''}><button type="button" class="sort-btn" data-col="${i}">${esc(c.label)}<span class="sort-ind" aria-hidden="true"></span></button></th>`)
    .join('');
  const body = rows
    .map((r) => `<tr>${r.map((cell, i) => (i === 0
      ? `<th scope="row" data-sort="${esc(String(cell.sort))}">${cell.html}</th>`
      : (cols[i]?.num
        ? `<td class="num" data-sort="${esc(String(cell.sort))}">${cell.html}</td>`
        : `<td data-sort="${esc(String(cell.sort))}">${cell.html}</td>`))).join('')}</tr>`)
    .join('\n');
  return `<table class="sortable">
<caption>${esc(caption)} <span class="bug-meta">— click a column heading to sort</span></caption>
<thead><tr>${thead}</tr></thead>
<tbody>${body}</tbody>
</table>`;
}

// One small script, included on pages with sortable tables. Tables work
// fully without it; this just adds click-to-sort. No external deps.
const SORT_SCRIPT = `<script>
(function () {
  for (const table of document.querySelectorAll('table.sortable')) {
    const tbody = table.tBodies[0];
    table.querySelectorAll('th .sort-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const col = +btn.dataset.col;
        const asc = btn.dataset.dir !== 'asc';
        table.querySelectorAll('.sort-btn').forEach((b) => { b.removeAttribute('data-dir'); b.querySelector('.sort-ind').textContent = ''; });
        btn.dataset.dir = asc ? 'asc' : 'desc';
        btn.querySelector('.sort-ind').textContent = asc ? ' ▲' : ' ▼';
        const rows = [...tbody.rows];
        rows.sort((ra, rb) => {
          const a = ra.cells[col].dataset.sort, b = rb.cells[col].dataset.sort;
          const na = parseFloat(a), nb = parseFloat(b);
          const cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : String(a).localeCompare(String(b));
          return asc ? cmp : -cmp;
        });
        rows.forEach((r) => tbody.appendChild(r));
      });
    });
  }
})();
</script>`;

/**
 * One combined "Broken links & errors" section. Broken links (from the
 * link-check engine) and pages that returned a non-404 error status
 * (e.g. 403/5xx — 404s are already covered by broken-link checking, so
 * listing them again is redundant). Returns '' when there's nothing.
 */
function linksAndErrorsSection(summary, csvHref = null) {
  const broken = summary.linkCheck?.broken ?? [];
  // Non-404 error pages only (404s show up via broken-link checking).
  const errors = (summary.errorPages ?? []).filter((e) => Number(e.status) !== 404);
  if (broken.length === 0 && errors.length === 0) return '';

  const brokenRows = broken
    .map((b) => {
      const history = b.weeksBroken > 1
        ? ` <span class="bug-meta">(broken for ${b.weeksBroken} weeks, first seen ${esc(b.firstSeen)})</span>`
        : (b.firstSeen ? ` <span class="bug-meta">(first seen ${esc(b.firstSeen)})</span>` : '');
      return `<tr><th scope="row">${urlCell(b.url)}${history}</th><td>${esc(b.status || b.reason)}</td><td>broken link</td><td>${linkedFrom(b.foundOn)}</td></tr>`;
    })
    .join('\n');
  const errorRows = errors
    .map((e) => `<tr><th scope="row">${urlCell(e.url)}</th><td>${esc(e.status)}</td><td>page error</td><td>n/a</td></tr>`)
    .join('\n');
  const dlLink = csvHref ? ` · <a href="${esc(csvHref)}">Download CSV</a>` : '';

  return `<section aria-labelledby="h-links">
${heading('h-links', 'Broken links & errors')}
<p class="meta">Broken links found on scanned pages, plus scanned pages that themselves returned a non-404 error (e.g. 403 or 5xx — 404s are already captured as broken links).${dlLink}</p>
<table>
<caption>${broken.length} broken link(s) and ${errors.length} page error(s) in ${esc(summary.week)}.</caption>
<thead><tr><th scope="col">URL</th><th scope="col">Status</th><th scope="col">Type</th><th scope="col">Linked from</th></tr></thead>
<tbody>${brokenRows}${errorRows}</tbody>
</table>
</section>`;
}

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

/**
 * Accessible light/dark theme toggle, following the light-dark-mode skill
 * from mgifford/accessibility-skills:
 *  - defaults to prefers-color-scheme; manual choice persists in localStorage
 *  - aria-label describes the ACTION ("Switch to dark mode"), updated on click
 *  - shows the moon in light mode (action: go dark) and sun in dark mode
 *  - keyboard-operable native <button>, placed after nav, not sticky
 * The toggle and its tiny script are the only JS in the reports; with JS
 * off, prefers-color-scheme still applies (progressive enhancement).
 */
function themeToggle() {
  return `<button id="theme-toggle" type="button" class="theme-toggle" aria-label="Switch to dark mode" aria-pressed="false" hidden>
  <svg class="icon-sun" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="20" height="20">
    <circle cx="12" cy="12" r="5" fill="currentColor"/>
    <path stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"
      d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>
  </svg>
  <svg class="icon-moon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="20" height="20">
    <path fill="currentColor" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
  </svg>
  <span class="theme-label">Theme</span>
</button>
<script>
  (function () {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.hidden = false; // only show the control when JS can drive it
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    function current() {
      var attr = document.documentElement.getAttribute('data-theme');
      return attr || (mq.matches ? 'dark' : 'light');
    }
    function sync() {
      var dark = current() === 'dark';
      // Label/pressed describe the action and state for screen readers.
      btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      btn.setAttribute('aria-pressed', String(dark));
    }
    sync();
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('vital-theme', next); } catch (e) {}
      sync();
    });
    mq.addEventListener && mq.addEventListener('change', sync);
  })();
</script>`;
}

/**
 * Accessible multi-week line chart: labeled inline SVG with a visually-
 * hidden data table fallback (the SVG is aria-hidden; screen readers get
 * the table). No JavaScript. `points` is [{ week, value }]; lowerIsBetter
 * controls the caption wording only.
 */
/**
 * Multi-series chart: pages affected by axe severity (Critical / Serious /
 * Moderate / Minor) over time. Four lines in one SVG, distinguished by both
 * stroke dash pattern and label — not color alone, so it works in
 * monochrome and for color-blind users.
 */
function severityTrendChart(series) {
  const LEVELS = [
    { key: 'critical', label: 'Critical', dash: 'none' },
    { key: 'serious',  label: 'Serious',  dash: '6 3' },
    { key: 'moderate', label: 'Moderate', dash: '3 3' },
    { key: 'minor',    label: 'Minor',    dash: '1 4' },
  ];

  // Derive pages-affected per severity from axe.rules in each week's summary.
  const pts = series.map((s) => {
    const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    for (const r of Object.values(s.axe?.rules ?? {})) {
      const imp = r.impact?.toLowerCase();
      if (imp in counts) counts[imp] += r.pages ?? 0;
    }
    return { week: s.week, ...counts };
  });

  if (pts.length < 2) return '';

  // Skip levels that are zero in every week (keeps the chart clean when data
  // is sparse).
  const activeLevels = LEVELS.filter((l) => pts.some((p) => p[l.key] > 0));
  if (activeLevels.length === 0) return '';

  const W = 640, H = 200, padL = 44, padR = 90, padT = 16, padB = 28;
  const allVals = activeLevels.flatMap((l) => pts.map((p) => p[l.key]));
  const maxVal = Math.max(...allVals, 1);
  const x = (i) => padL + (i / (pts.length - 1)) * (W - padL - padR);
  const y = (v) => H - padB - (v / maxVal) * (H - padT - padB);
  const xlabels = [0, Math.floor((pts.length - 1) / 2), pts.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="axis">${esc(pts[i].week.slice(5))}</text>`)
    .join('');
  const ylabels = `<text x="4" y="${(y(maxVal) + 4).toFixed(1)}" class="axis">${maxVal}</text><text x="4" y="${(y(0) + 4).toFixed(1)}" class="axis">0</text>`;

  const lines = activeLevels.map((l) => {
    const poly = pts.map((p, i) => `${x(i).toFixed(1)},${y(p[l.key]).toFixed(1)}`).join(' ');
    const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p[l.key]).toFixed(1)}" r="2.5" fill="currentColor"/>`).join('');
    // Inline legend label at the end of each line.
    const lastPt = pts[pts.length - 1];
    const labelY = y(lastPt[l.key]);
    return `<g>
  <polyline points="${poly}" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="${l.dash}"/>
  ${dots}
  <text x="${(x(pts.length - 1) + 6).toFixed(1)}" y="${(labelY + 4).toFixed(1)}" class="axis" text-anchor="start">${esc(l.label)}</text>
</g>`;
  }).join('\n');

  // Data table for the no-JS / screen-reader baseline.
  const tableRows = pts.map((p) =>
    `<tr><th scope="row">${esc(p.week)}</th>${activeLevels.map((l) => `<td>${p[l.key]}</td>`).join('')}</tr>`
  ).join('');
  const table = `<table class="visually-hidden">
<caption>Pages affected by axe severity, by week</caption>
<thead><tr><th scope="col">Week</th>${activeLevels.map((l) => `<th scope="col">${esc(l.label)}</th>`).join('')}</tr></thead>
<tbody>${tableRows}</tbody>
</table>`;

  const ariaLabel = `Axe violations by severity over ${pts.length} weeks. ` +
    activeLevels.map((l) => `${l.label}: ${pts[0][l.key]} → ${pts[pts.length - 1][l.key]} pages`).join('; ') + '.';

  return `<figure class="chart">
<figcaption>Pages affected by axe severity over ${pts.length} weeks (lower is better)</figcaption>
<svg viewBox="0 0 ${W} ${H}" class="linechart chart-fallback" role="img" aria-label="${esc(ariaLabel)}" preserveAspectRatio="xMidYMid meet">
  ${lines}
  ${xlabels}${ylabels}
</svg>
${table}
</figure>`;
}

function lineChart(title, points, { unit = '', lowerIsBetter = true } = {}) {
  const pts = points.filter((p) => p.value != null);
  if (pts.length < 2) {
    return `<p class="meta">${esc(title)}: not enough weeks yet for a trend.</p>`;
  }
  const W = 640, H = 180, padL = 40, padR = 12, padT = 16, padB = 28;
  const vals = pts.map((p) => p.value);
  const max = Math.max(...vals);
  const min = Math.min(...vals, 0);
  const span = max - min || 1;
  const x = (i) => padL + (i / (pts.length - 1)) * (W - padL - padR);
  const y = (v) => H - padB - ((v - min) / span) * (H - padT - padB);
  const poly = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="2.5" fill="currentColor"/>`).join('');
  // A few x labels (first, middle, last) and y gridline labels (min/max).
  const xlabels = [0, Math.floor((pts.length - 1) / 2), pts.length - 1]
    .filter((v, idx, a) => a.indexOf(v) === idx)
    .map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="axis">${esc(pts[i].week.slice(5))}</text>`)
    .join('');
  const ylabels = `<text x="4" y="${(y(max) + 4).toFixed(1)}" class="axis">${max}</text><text x="4" y="${(y(min) + 4).toFixed(1)}" class="axis">${min}</text>`;
  const first = pts[0].value, last = pts[pts.length - 1].value;
  const change = last - first;
  const better = lowerIsBetter ? change < 0 : change > 0;
  const trend = change === 0 ? 'unchanged' : `${better ? 'better' : 'worse'} (${first}${unit} → ${last}${unit})`;

  const table = `<table class="visually-hidden"><caption>${esc(title)} by week</caption>
<thead><tr><th scope="col">Week</th><th scope="col">${esc(title)}</th></tr></thead>
<tbody>${pts.map((p) => `<tr><th scope="row">${esc(p.week)}</th><td>${p.value}${esc(unit)}</td></tr>`).join('')}</tbody></table>`;

  // Progressive enhancement: the SVG + table below are the no-JS baseline. The
  // data-parachart attribute carries a ParaCharts manifest; the loader script
  // (PARACHART_LOADER) lazy-imports the runtime, mounts an accessible
  // <para-chart>, and hides the SVG fallback. If JS is off or the runtime
  // fails to load, the SVG + table remain — nothing regresses.
  const manifest = buildLineManifest(title, title, pts, { unit });
  const dataAttr = esc(JSON.stringify(manifest));

  return `<figure class="chart" data-parachart="${dataAttr}">
<figcaption>${esc(title)} over ${pts.length} weeks — ${esc(trend)}</figcaption>
<svg viewBox="0 0 ${W} ${H}" class="linechart chart-fallback" role="img" aria-label="${esc(title)} trend: ${esc(trend)}" preserveAspectRatio="xMidYMid meet">
  <polyline points="${poly}" fill="none" stroke="currentColor" stroke-width="2"/>
  ${dots}${xlabels}${ylabels}
</svg>
${table}
</figure>`;
}

function layout({ title, breadcrumb, body, depth, extraScript = '' }) {
  const base = '../'.repeat(depth);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${base}style.css">
<script>
  // Apply the saved theme before first paint to avoid a flash of the
  // wrong colour scheme. No saved choice = follow the OS (prefers-color-scheme).
  try {
    var t = localStorage.getItem('vital-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header>
  <p class="brand"><a href="${base}index.html">vital-scans</a> <span class="tag">open quality ledger</span></p>
  ${breadcrumb ? `<nav aria-label="Breadcrumb"><ol class="crumbs">${breadcrumb}</ol></nav>` : ''}
  ${themeToggle()}
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
${paraChartLoader(base)}
${extraScript}
</body>
</html>`;
}

/**
 * Progressive-enhancement loader for ParaCharts. Emitted on every report page;
 * a no-op unless the page has `.chart[data-parachart]` figures. Lazy-imports
 * the vendored runtime (so the 2.8 MB AGPL bundle never blocks first paint or
 * the no-JS baseline), then for each chart builds a <para-chart> from the
 * figure's manifest, mounts it, and hides the static SVG fallback. If the
 * import fails, the SVG + data table remain untouched.
 */
function paraChartLoader(base) {
  return `<script type="module">
const figs = document.querySelectorAll('.chart[data-parachart]');
if (figs.length) {
  import('${base}paracharts.js').then(() => {
    // Remember what had focus before mounting any charts. Some para-chart
    // implementations call .focus() during connectedCallback, which scrolls
    // the page to the first chart on load. We restore focus afterward so the
    // page opens at the top.
    const priorFocus = document.activeElement;
    figs.forEach((fig) => {
      let manifest;
      try { manifest = fig.getAttribute('data-parachart'); } catch (e) { return; }
      if (!manifest) return;
      const chart = document.createElement('para-chart');
      chart.setAttribute('manifestType', 'content');
      chart.setAttribute('type', 'line');
      chart.setAttribute('manifest', manifest);
      chart.style.display = 'block';
      chart.style.width = '100%';
      chart.style.maxWidth = '640px';
      chart.style.aspectRatio = '16 / 7';
      const fallback = fig.querySelector('.chart-fallback');
      if (fallback) fallback.hidden = true;
      fig.insertBefore(chart, fig.firstChild ? fig.firstChild.nextSibling : null);
    });
    // Restore focus to where it was (typically body) so the viewport
    // stays at the top of the page rather than scrolling to the first chart.
    if (priorFocus && typeof priorFocus.focus === 'function') {
      priorFocus.focus({ preventScroll: true });
    }
  }).catch(() => { /* keep the SVG + table fallback */ });
}
</script>`;
}

function ruleTable(caption, rules, kind, engineKey, csvLinks = { byRule: {} }) {
  const ids = Object.keys(rules).sort((a, b) => rules[b].pages - rules[a].pages || rules[b].count - rules[a].count);
  if (ids.length === 0) return `<p>No ${esc(kind)} findings this week.</p>`;
  const rows = ids
    .map((id) => {
      const r = rules[id];
      const link = r.helpUrl ?? r.ruleUrl;
      const plain = rulePlainLabel(engineKey, id, { help: r.help });
      const label = plain ? `${esc(plain)} <span class="bug-meta">[${esc(id)}]</span>` : esc(id);
      const csv = csvLinks.byRule?.[`${engineKey}:${id}`];
      return `<tr>
  <th scope="row">${link ? `<a href="${esc(link)}">${label}</a>` : label}</th>
  <td>${r.impact ? esc(r.impact) : 'n/a'}</td>
  <td class="num">${r.pages}</td>
  <td class="num">${r.count}</td>
  <td>${(r.examplePages ?? []).map((u) => `<a href="${esc(u)}">${esc(new URL(u).pathname)}</a>`).join('<br>')}</td>
  <td>${csv ? `<a href="${esc(csv)}">all ${r.pages} pages (CSV)</a>` : '—'}</td>
</tr>`;
    })
    .join('\n');
  return `<table>
<caption>${esc(caption)}</caption>
<thead><tr><th scope="col">Rule</th><th scope="col">Impact</th><th scope="col" class="num">Pages affected</th><th scope="col" class="num">Instances</th><th scope="col">Example pages</th><th scope="col">All affected</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

/**
 * Structured per-rule bug reports following the best-practices format.
 * Each report is a collapsible block — semantic, keyboard-operable, and
 * JavaScript-free (native <details>). Prioritized so the most actionable
 * issues appear first. Downloadable as CSV, Markdown,
 * and JSON. csvBugsHref is the relative path to bugs.csv (may be null).
 */
function bugReportsSection(target, summary, bugs, csvBugsHref = null, reporting = {}) {
  const view = prioritizeAccessibilityBugs(summary, bugs, { keyPages: reporting.keyPages ?? [], reporting });
  const ordered = view.bugs;
  if (!ordered || ordered.length === 0) {
    return `<section aria-labelledby="h-bugs">
${heading('h-bugs', `Bug reports`)}
<p>No accessibility findings to report this week.</p>
</section>`;
  }
  const sevCount = ordered.reduce((m, b) => ((m[b.severity] = (m[b.severity] ?? 0) + 1), m), {});
  const sevSummary = ['Critical', 'Serious', 'Moderate', 'Minor']
    .filter((s) => sevCount[s])
    .map((s) => `${sevCount[s]} ${s.toLowerCase()}`)
    .join(', ');
  const dupCount = ordered.filter((b) => b.possible_duplicate_of).length;
  const catCounts = ordered.reduce((m, b) => ((m[b.wcag_category ?? 'Undetermined'] = (m[b.wcag_category ?? 'Undetermined'] ?? 0) + 1), m), {});
  const catOrder = ['WCAG 2.0 A', 'WCAG 2.0 AA', 'WCAG 2.1 A', 'WCAG 2.1 AA', 'WCAG 2.2 A', 'WCAG 2.2 AA', 'WCAG 2.x AAA', 'Best Practice', 'Undetermined'];
  const catSummary = catOrder.filter((c) => catCounts[c]).map((c) => `${catCounts[c]} ${c}`).join(', ');

  const blocks = ordered
    .map((b) => {
      const wcagDetail = b.wcag_sc
        ? `${esc(b.wcag_sc)} ${esc(b.wcag_name)} (Level ${esc(b.wcag_level)}, WCAG ${esc(b.wcag_version ?? '2.x')})`
        : b.wcag_category === 'Best Practice' ? 'Best Practice — not a WCAG requirement' : 'undetermined';
      const ruleLabel = b.rule_label && b.rule_label !== b.rule_id
        ? `${esc(b.rule_label)} <span class="bug-meta">[${esc(b.rule_id)}]</span>`
        : esc(b.rule_id);
      const ruleLink = b.rule_url
        ? `<a href="${esc(b.rule_url)}">${esc(b.tool)} — ${ruleLabel}</a>`
        : `${esc(b.tool)} — ${ruleLabel}`;
      const dupNote = b.possible_duplicate_of
        ? `<div><dt>Possible duplicate</dt><dd>Same WCAG SC covered by axe report <code>${esc(b.possible_duplicate_of)}</code> (pattern <code>${esc(b.possible_duplicate_pattern)}</code>). If axe and this engine flag the same element, the axe report takes precedence — mark this as duplicate in JIRA.</dd></div>`
        : '';
      return `<details id="${esc(b.instance_id)}" class="bug sev-${esc(b.severity.toLowerCase())}${b.possible_duplicate_of ? ' possible-dup' : ''}" data-severity="${esc(b.severity)}" data-category="${esc(b.wcag_category ?? 'Undetermined')}" data-default-visible="${b.default_visible ? '1' : '0'}" data-priority-tier="${esc(String(b.priority_tier ?? 5))}"${b.possible_duplicate_of ? ' data-duplicate="1"' : ''}>
<summary><span class="sev-badge">${esc(b.severity)}</span> ${b.wcag_category ? `<span class="wcag-badge"${b.wcag_category === 'Best Practice' ? ' data-cat="best-practice"' : ''}>${esc(b.wcag_category)}</span> ` : ''}${esc(b.summary)}
<span class="bug-meta">${b.frequency.pages_affected}/${b.frequency.total_pages_scanned} pages · ${b.frequency.instances} instances${b.possible_duplicate_of ? ' · possible duplicate' : ''}</span></summary>
<dl class="bug-fields">
  <div><dt>Bug ID</dt><dd><code>${esc(b.instance_id)}</code></dd></div>
  <div><dt>Pattern ID</dt><dd><code>${esc(b.pattern_id)}</code></dd></div>
  <div><dt>Combined ID</dt><dd><code>${esc(b.instance_id)}</code> (pattern <code>${esc(b.pattern_id)}</code>) — use this format in JIRA/spreadsheets to filter by instance or pattern</dd></div>
  <div><dt>WCAG category</dt><dd>${esc(b.wcag_category ?? 'Undetermined')}</dd></div>
  <div><dt>WCAG SC</dt><dd>${wcagDetail}</dd></div>
  <div><dt>Rule</dt><dd>${ruleLink}</dd></div>
  <div><dt>Example URL</dt><dd><a href="${esc(b.url)}">${esc(b.url)}</a></dd></div>
  ${b.xpath ? `<div><dt>XPath / selector</dt><dd><code>${esc(b.xpath)}</code></dd></div>` : ''}
  ${b.first_seen ? `<div><dt>History</dt><dd>first seen ${esc(b.first_seen)}, last seen ${esc(b.last_seen)} (${b.weeks_seen} wk)</dd></div>` : ''}
  ${dupNote}
</dl>
${b.html_snippet ? `<p class="bug-label">HTML snippet — use this to validate the finding without re-running the tool</p><pre><code>${esc(b.html_snippet)}</code></pre>` : ''}
<p class="bug-label">Description</p><p>${esc(b.description)}</p>
<p class="bug-label">Steps to reproduce</p><ol>${b.steps_to_reproduce.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
<p class="bug-label">Impact</p>
${b.impact?.groups?.length
        ? `<p>${esc(b.impact.summary)}</p><ul class="impact-groups">${b.impact.groups
            .map((g) => `<li><strong>${esc(g.group)}</strong> — ${esc(g.percent)} of population${g.estimatedExcluded != null ? ` (~${g.estimatedExcluded.toLocaleString()} people/week potentially excluded)` : ''}</li>`)
            .join('')}</ul>`
        : `<p class="bug-placeholder">${esc(b.impact?.summary ?? 'Requires manual testing.')}</p>`}
<p class="bug-label">Affected pages</p>
${affectedPagesBlock(b)}
<p class="bug-label">Testing environment</p><p>${esc(b.testing_environment)}</p>
<p class="bug-label">Suggested fix</p>${b.remediation_tip ? `<p><strong>How to fix:</strong> ${esc(b.remediation_tip)}</p>` : ''}<p>${esc(b.suggested_fix)}</p>
</details>`;
    })
    .join('\n');

  // Progressive-enhancement filter. Without JS every bug is visible; the
  // script below reveals the controls and filters the <details> blocks by
  // their data-severity / data-category attributes.
  const sevPresent = ['Critical', 'Serious', 'Moderate', 'Minor'].filter((s) => sevCount[s]);
  const catPresent = catOrder.filter((c) => catCounts[c]);
  const sevOpts = sevPresent.map((s) => `<option value="${esc(s)}">${esc(s)} (${sevCount[s]})</option>`).join('');
  const catOpts = catPresent.map((c) => `<option value="${esc(c)}">${esc(c)} (${catCounts[c]})</option>`).join('');
  const filterBar = `<form class="bug-filter" hidden aria-label="Filter bug reports" data-total="${ordered.length}" data-prioritized="${view.visibleCount}">
<div class="bug-filter-row">
<label class="bug-filter-check"><input type="checkbox" id="filter-all"> Show everything</label>
<label>Severity <select id="filter-sev"><option value="">All severities</option>${sevOpts}</select></label>
<label>WCAG category <select id="filter-cat"><option value="">All categories</option>${catOpts}</select></label>
<label class="bug-filter-check"><input type="checkbox" id="filter-dup"> Hide possible duplicates</label>
<button type="button" id="filter-reset">Reset</button>
</div>
<p class="bug-filter-count" aria-live="polite" id="filter-count">Showing ${view.visibleCount} prioritized issue type(s) out of ${ordered.length}.</p>
</form>`;

  const csvLink = csvBugsHref ? ` · <a href="${esc(csvBugsHref)}">CSV (all findings)</a>` : '';
  const hiddenCount = ordered.length - view.visibleCount;
  const priorityLine = hiddenCount > 0
    ? `<p class="note">Default view shows ${view.visibleCount} prioritized issue type(s); ${hiddenCount} more are available if you switch to "Show everything".</p>`
    : `<p class="note">All findings fit within the prioritized view this week.</p>`;
  const dupLine = dupCount > 0
    ? `<p class="note">${dupCount} finding(s) marked "possible duplicate" — Alfa and axe-core both flagged the same WCAG SC on overlapping pages. If they target the same element, the axe-core report is authoritative. Filter the CSV by <code>possible_duplicate_of</code> to see these. Two engines flagging the same barrier reduces the chance of a false positive.</p>`
    : '';

  return `<section aria-labelledby="h-bugs">
${heading('h-bugs', `Bug reports`)}
<p class="meta">${view.visibleCount} issue type(s) are shown by default out of ${ordered.length} total. Prioritized by severity, key pages, WCAG level, and prevalence; use the toggle to show everything.</p>
  <p class="meta">Overall severity mix: ${esc(sevSummary)}. By WCAG category: ${esc(catSummary)}. Ordered by severity, key-page impact, WCAG level, and prevalence. Following
<a href="https://mgifford.github.io/ACCESSIBILITY.md/examples/ACCESSIBILITY_BUG_REPORTING_BEST_PRACTICES.html">accessibility bug-reporting best practices</a>.
Download: <a href="bugs.md">Markdown</a> · <a href="${esc(reporting.bugsJson ?? 'bugs.json')}">JSON (full archive)</a> · <a href="${esc(reporting.aiJson ?? 'ai-findings.json')}">JSON (AI diagnostic)</a>${csvLink}${reporting.priorityPagesCsv ? ` · <a href="${esc(reporting.priorityPagesCsv)}">Priority pages CSV</a>` : ''}${reporting.priorityPagesJson ? ` · <a href="${esc(reporting.priorityPagesJson)}">Priority pages JSON</a>` : ''}.</p>
<p class="note">Fields marked "requires manual testing" cannot be observed by an automated scan. Manual AT verification is required before filing in JIRA. Best Practice findings are axe rules not tied to a WCAG criterion — address WCAG requirements first.</p>
${priorityLine}
${dupLine}
${filterBar}
<div class="bug-list">${blocks}</div>
<p class="bug-filter-empty" hidden>No issues match the current filters. <button type="button" id="filter-reset-2">Clear filters</button></p>
${BUG_FILTER_SCRIPT}
</section>`;
}

// Progressive-enhancement filtering for the bug-report list. Reveals the
// filter form (hidden by default so no-JS users see every bug) and toggles
// each .bug <details> by its data-severity / data-category attributes.
const BUG_FILTER_SCRIPT = `<script>
(function () {
  var form = document.querySelector('.bug-filter');
  if (!form) return;
  form.hidden = false;
  var showAll = document.getElementById('filter-all');
  var sev = document.getElementById('filter-sev');
  var cat = document.getElementById('filter-cat');
  var dup = document.getElementById('filter-dup');
  var count = document.getElementById('filter-count');
  var empty = document.querySelector('.bug-filter-empty');
  var bugs = Array.prototype.slice.call(document.querySelectorAll('.bug-list .bug'));
  var total = bugs.length;
  var prioritized = Number(form.getAttribute('data-prioritized') || '0');
  function apply() {
    var s = sev.value, c = cat.value, hideDup = dup.checked, showEverything = showAll.checked, shown = 0;
    bugs.forEach(function (b) {
      var ok = (showEverything || b.getAttribute('data-default-visible') === '1')
        && (!s || b.getAttribute('data-severity') === s)
        && (!c || b.getAttribute('data-category') === c)
        && (!hideDup || b.getAttribute('data-duplicate') !== '1');
      b.hidden = !ok;
      if (ok) shown++;
    });
    var filtered = showEverything || s || c || hideDup;
    count.textContent = filtered
      ? (showEverything ? 'Showing all ' + shown + ' issue type(s).' : 'Showing ' + shown + ' of ' + total + ' issue type(s).')
      : 'Showing ' + prioritized + ' prioritized issue type(s) out of ' + total + '.';
    if (empty) empty.hidden = shown !== 0;
  }
  function reset() { showAll.checked = false; sev.value = ''; cat.value = ''; dup.checked = false; apply(); }
  showAll.addEventListener('change', apply);
  sev.addEventListener('change', apply);
  cat.addEventListener('change', apply);
  dup.addEventListener('change', apply);
  document.getElementById('filter-reset').addEventListener('click', reset);
  var r2 = document.getElementById('filter-reset-2');
  if (r2) r2.addEventListener('click', reset);
  apply();
})();
</script>`;

/**
 * Per-engine coverage: how many of the week's pages each engine ran on,
 * reflecting the configured weekly sampling rates.
 */
function coverageTable(summary) {
  const cov = summary.coverage;
  if (!cov || Object.keys(cov).length === 0) return '';
  const total = summary.pagesScanned || 1;
  const rows = Object.entries(cov)
    .sort((a, b) => b[1] - a[1])
    .map(([engine, n]) => `<tr><th scope="row">${esc(engine)}</th><td class="num">${n}</td><td class="num">${Math.round((100 * n) / total)}%</td></tr>`)
    .join('\n');
  const attemptLine = (summary.pagesAttempted != null)
    ? ` · ${summary.pagesSucceeded ?? '?'} succeeded of ${summary.pagesAttempted} attempted`
    : '';
  return `<details class="coverage">
<summary>Scan coverage this week (${summary.pagesScanned} pages${attemptLine})</summary>
<table>
<caption>Pages each engine ran on, per the configured weekly sampling rates.</caption>
<thead><tr><th scope="col">Engine</th><th scope="col" class="num">Pages</th><th scope="col" class="num">Coverage</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</details>`;
}

/**
 * Embedded/linked non-HTML resources: PDFs, Office docs, iframes,
 * embedded media. Leads with what's NEW this week (the question a site
 * owner most wants answered), then the by-type inventory, with a CSV of
 * everything (incl. first-seen).
 */
const RESOURCE_LABELS = {
  pdf: 'PDF documents', document: 'Word/text documents', presentation: 'Presentations',
  spreadsheet: 'Spreadsheets', archive: 'Archives (zip, etc.)', video: 'Video files',
  audio: 'Audio files', image: 'Images', svg: 'SVG', iframe: 'Iframes',
  'embedded-media': 'Embedded media players', embed: 'Embeds / objects',
};
function resourcesSection(summary) {
  const r = summary.resources;
  if (!r) return '';
  const typeRows = Object.entries(r.byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => `<tr><th scope="row">${esc(RESOURCE_LABELS[type] ?? type)}</th><td class="num">${n}</td></tr>`)
    .join('\n');
  const newList = (r.newThisWeek ?? []);
  const newBlock = newList.length
    ? `<h3>New this week (${newList.length})</h3>
<ul>${newList.slice(0, 100).map((n) => `<li><span class="bug-meta">${esc(RESOURCE_LABELS[n.type] ?? n.type)}:</span> <a href="${esc(n.url)}">${esc(n.url)}</a></li>`).join('')}</ul>`
    : `<p>No new resources first seen this week.</p>`;
  return `<section aria-labelledby="h-resources">
${heading('h-resources', `Embedded & linked resources`)}
<p class="meta">Non-HTML resources this site links to or embeds — PDFs, Office documents, iframes, and media. The site owner is responsible for their accessibility too. ${r.csv ? `Full inventory with first-seen dates: <a href="${esc(r.csv)}">CSV</a>.` : ''}</p>
${newBlock}
<table>
<caption>${r.total} distinct resources, by type.</caption>
<thead><tr><th scope="col">Type</th><th scope="col" class="num">Count</th></tr></thead>
<tbody>${typeRows}</tbody>
</table>
</section>`;
}

/**
 * Cross-engine consensus: the true number of unique accessibility issues
 * (deduplicated across axe and Alfa via W3C ACT rules), and how many both
 * engines agree on. Prevents the "looks like 2x the errors" problem of
 * summing two engines that overlap.
 */
/**
 * "Fix these first" — the highest-leverage issues for this domain,
 * ranked by pages affected × severity × people reached. Each row links
 * its remediation tip and the CSV of affected pages, so a team can act.
 */
function fixFirstSection(bugs) {
  const top = rankBugs(bugs, 8);
  if (top.length === 0) return '';
  const rows = top
    .map((b) => `<tr>
  <th scope="row"><a href="accessibility.html#${esc(b.instance_id)}">${esc(b.summary)}</a>${b.rule_url ? ` <a href="${esc(b.rule_url)}" class="bug-meta">(rule↗)</a>` : ''}</th>
  <td><span class="sev-badge">${esc(b.severity)}</span></td>
  <td class="num">${b.frequency.pages_affected}</td>
  <td>${b.impact?.groups?.length ? esc(b.impact.groups.map((g) => g.group).slice(0, 2).join(', ')) : '—'}</td>
  <td>${b.remediation_tip ? esc(b.remediation_tip) : (b.suggested_fix ? esc(b.suggested_fix) : '—')}</td>
  <td>${b.affected_pages_csv ? `<a href="${esc(b.affected_pages_csv)}">pages (CSV)</a>` : '—'}</td>
</tr>`)
    .join('\n');
  return `<section aria-labelledby="h-fixfirst">
${heading('h-fixfirst', `Fix these first`)}
<p class="meta">Highest-leverage issues, ranked by pages affected × severity × people reached. Fixing a shared component often clears many pages at once. Issue links go to the full bug detail on the <a href="accessibility.html#h-bugs">Accessibility page</a>.</p>
<table>
<caption>Top ${top.length} issues to prioritize this week.</caption>
<thead><tr><th scope="col">Issue</th><th scope="col">Severity</th><th scope="col" class="num">Pages</th><th scope="col">Who it affects</th><th scope="col">How to fix</th><th scope="col">Evidence</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</section>`;
}

/**
 * Security + web-standards checklists, ScanGov-style (per ScanGov's
 * Security/Botability/Usability topics), measured across our scan rather
 * than just the homepage. Pass/fail with a check icon; credits ScanGov.
 */
function checklist(items) {
  return `<ul class="checklist">${items
    .map((c) => `<li class="${c.pass ? 'pass' : 'fail'}"><span class="check" aria-hidden="true">${c.pass ? '✓' : '✗'}</span> ${esc(c.label)}${c.detail ? ` <span class="bug-meta">${esc(String(c.detail))}</span>` : ''}<span class="visually-hidden">: ${c.pass ? 'pass' : 'fail'}</span></li>`)
    .join('')}</ul>`;
}
function standardsSecuritySection(summary) {
  const sec = summary.security;
  const std = summary.standards;
  const pi = summary.publicInterest ?? null;
  if (!sec && !std && !pi) return '';
  const secBlock = sec ? `
<h3>Security &amp; domain hygiene <span class="bug-meta">${sec.passed}/${sec.total} on the origin</span></h3>
${checklist(sec.checks)}` : '';
  const stdBlock = std ? `
<h3>Web standards &amp; metadata <span class="bug-meta">across ${std.pagesChecked} page(s)</span></h3>
<table>
<caption>Share of checked pages passing each standard (lowest first).</caption>
<thead><tr><th scope="col">Standard</th><th scope="col" class="num">Pass rate</th><th scope="col" class="num">Pages</th></tr></thead>
<tbody>${std.checks.map((c) => `<tr><th scope="row">${esc(c.label)}</th><td class="num">${c.rate}%</td><td class="num">${c.pass}/${c.total}</td></tr>`).join('')}</tbody>
</table>
${std.social?.length ? `<p class="meta">Open social presence found: ${std.social.map((s) => `<a href="${esc(s.href)}">${esc(s.platform)}</a>`).join(', ')}.</p>` : '<p class="meta">No Mastodon/Bluesky links detected on checked pages.</p>'}` : '';
  const piBlock = publicInterestSection(pi);
  return `<section aria-labelledby="h-standards">
${heading('h-standards', `Standards & security`)}
<p class="meta">Web-standards, metadata, and security checks in the spirit of <a href="https://standards.scangov.org/">ScanGov</a> (methodology CC0), run across our scan rather than only the homepage.</p>
${secBlock}
${stdBlock}
${piBlock}
</section>`;
}

function publicInterestSection(pi) {
  if (!pi) return '';

  const badge = (result) => {
    if (result === 'pass') return '<span class="pwa-badge pwa-pass" aria-label="pass">✓</span>';
    if (result === 'fail') return '<span class="pwa-badge pwa-fail" aria-label="not found">✗</span>';
    return '<span class="pwa-badge pwa-partial" aria-label="unknown">~</span>';
  };

  const urlCell = (url) => url ? `<a href="${esc(url)}">${esc(url.replace(/^https?:\/\//, ''))}</a>` : '—';

  // Accessibility statement row.
  const a = pi.a11yStatement ?? {};
  const a11yConf = a.confidence ? ` <span class="bug-meta">(${esc(a.confidence)} confidence)</span>` : '';
  const a11yRow = `<tr>
  <th scope="row">Accessibility statement</th>
  <td>${badge(a.result ?? 'unknown')} ${a.result === 'pass' ? 'Found' : a.result === 'fail' ? 'Not found' : 'Unknown'}${a11yConf}</td>
  <td>${urlCell(a.url)}</td>
  <td class="bug-meta">${a.checkedAt ? esc(a.checkedAt.slice(0, 10)) : '—'}</td>
</tr>`;

  // carbon.txt row.
  const c = pi.carbonTxt ?? {};
  const carbonValidity = c.result === 'pass' ? (c.valid ? ' · file appears valid' : ' · file may be malformed') : '';
  const carbonFields = c.fields && Object.keys(c.fields).length
    ? ` · fields: ${esc(Object.keys(c.fields).slice(0, 4).join(', '))}` : '';
  const carbonRow = `<tr>
  <th scope="row">carbon.txt</th>
  <td>${badge(c.result ?? 'unknown')} ${c.result === 'pass' ? 'Found' : c.result === 'fail' ? 'Not found' : 'Unknown'}${esc(carbonValidity + carbonFields)}</td>
  <td>${urlCell(c.url)}</td>
  <td class="bug-meta">${c.checkedAt ? esc(c.checkedAt.slice(0, 10)) : '—'}</td>
</tr>`;

  // Green Web Foundation row.
  const g = pi.greenWebFoundation ?? {};
  const gwfDetail = g.hostedBy ? ` · hosted by ${esc(g.hostedBy)}` : '';
  const gwfRow = `<tr>
  <th scope="row">Renewable hosting <span class="bug-meta">(Green Web Foundation)</span></th>
  <td>${badge(g.result ?? 'unknown')} ${g.result === 'pass' ? 'Green' : g.result === 'fail' ? 'Not green' : 'Unknown'}${esc(gwfDetail)}</td>
  <td>${g.url ? `<a href="${esc(g.url)}">API response</a>` : '—'}</td>
  <td class="bug-meta">${g.checkedAt ? esc(g.checkedAt.slice(0, 10)) : '—'}</td>
</tr>`;

  // Sitemap rows.
  const s = pi.sitemaps ?? {};
  const xmlRow = `<tr>
  <th scope="row">XML sitemap</th>
  <td>${badge(s.xml?.found ? 'pass' : 'fail')} ${s.xml?.found ? 'Found' : 'Not found'}</td>
  <td>${urlCell(s.xml?.url)}</td>
  <td class="bug-meta">${s.checkedAt ? esc(s.checkedAt.slice(0, 10)) : '—'}</td>
</tr>`;
  const humanRow = `<tr>
  <th scope="row">Human-readable sitemap</th>
  <td>${badge(s.human?.found ? 'pass' : 'fail')} ${s.human?.found ? 'Found' : 'Not found'}</td>
  <td>${urlCell(s.human?.url)}</td>
  <td class="bug-meta">${s.checkedAt ? esc(s.checkedAt.slice(0, 10)) : '—'}</td>
</tr>`;

  return `<h3>Public interest &amp; sustainability signals <span class="bug-meta">origin-level checks</span></h3>
<table>
<caption>Checks run once per week against the domain origin. ✓ = found/green · ✗ = not found · ~ = uncertain.</caption>
<thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">URL</th><th scope="col">Checked</th></tr></thead>
<tbody>
${a11yRow}
${carbonRow}
${gwfRow}
${xmlRow}
${humanRow}
</tbody>
</table>`;
}

function consensusSection(summary, bugs = []) {
  const c = summary.consensus;
  if (!c || c.uniqueIssues === 0) return '';
  const naive = c.rawAxe + c.rawAlfa;
  const saved = naive - c.uniqueIssues;

  // Build a lookup from axe rule_id → bug instance_id so we can link to
  // the full bug detail on the accessibility page.
  const bugByAxeRule = new Map();
  for (const b of bugs) {
    if (b.engine_key === 'axe-core' && b.rule_id && b.instance_id) {
      bugByAxeRule.set(b.rule_id, b.instance_id);
    }
  }

  // Rules flagged by BOTH engines — the highest-confidence findings, since two
  // independent implementations of the same ACT rule agree. List them with
  // links to each engine's rule docs and the canonical ACT rule.
  const axeRules = summary.axe?.rules ?? {};
  const alfaRules = summary.alfa?.rules ?? {};
  const both = Object.values(c.byKey ?? {})
    .filter((g) => g.engines === 'both')
    .sort((a, b) => b.pages - a.pages);
  const bothRows = both
    .map((g) => {
      const axeId = g.axeRules[0];
      const alfaId = g.alfaRules[0];
      const help = axeId
        ? (rulePlainLabel('axe-core', axeId, { help: axeRules[axeId]?.help }) ?? axeId)
        : (alfaId ? (rulePlainLabel('alfa', alfaId) ?? alfaId) : '');
      const axeUrl = axeId ? axeRules[axeId]?.helpUrl : null;
      const alfaUrl = alfaId ? alfaRules[alfaId]?.ruleUrl : null;
      const actUrl = g.actRuleId ? `https://act-rules.github.io/rules/${esc(g.actRuleId)}` : null;
      const links = [
        axeUrl ? `<a href="${esc(axeUrl)}">axe ${esc(axeId)}</a>` : (axeId ? `axe ${esc(axeId)}` : ''),
        alfaUrl ? `<a href="${esc(alfaUrl)}">Alfa ${esc(alfaId)}</a>` : (alfaId ? `Alfa ${esc(alfaId)}` : ''),
        actUrl ? `<a href="${esc(actUrl)}">ACT ${esc(g.actRuleId)}</a>` : '',
      ].filter(Boolean).join(' · ');
      // Link to the axe bug detail on the accessibility page if available.
      const bugAnchor = axeId ? bugByAxeRule.get(axeId) : null;
      const issueCell = bugAnchor
        ? `<a href="accessibility.html#${esc(bugAnchor)}">${esc(help)}</a>`
        : esc(help);
      return `<tr><th scope="row">${issueCell}</th><td class="num">${g.pages}</td><td class="bug-meta">${links}</td></tr>`;
    })
    .join('\n');
  const bothTable = both.length
    ? `<details class="engine-findings" open>
<summary>${both.length} rule type(s) caught by both engines — highest confidence</summary>
<p class="meta">Two independent ACT-rule implementations (Deque axe-core and Siteimprove Alfa) flagged the same issue on the same pages. Agreement between separate engines is strong evidence the barrier is real, not a single-tool false positive — the best place to start.</p>
<table>
<caption>Rules flagged by both axe-core and Alfa in ${esc(summary.week)}, by pages affected.</caption>
<thead><tr><th scope="col">Issue</th><th scope="col" class="num">Pages</th><th scope="col">Rule references</th></tr></thead>
<tbody>${bothRows}</tbody>
</table>
</details>`
    : '<p class="meta">No issues were flagged by both engines on the same pages this week.</p>';

  return `<section aria-labelledby="h-consensus">
${heading('h-consensus', `Unique accessibility issues (axe + Alfa consolidated)`)}
<p class="meta">axe and Alfa both implement W3C ACT rules, so the same issue is often caught by both. These are deduplicated by ACT rule and page, so a shared finding counts once${saved > 0 ? ` (${naive} raw engine findings → ${c.uniqueIssues} unique)` : ''}.</p>
<dl class="ledger">
  <div><dt>Unique issues (rule × page)</dt><dd>${c.uniqueIssues}</dd></div>
  <div><dt>Caught by both engines</dt><dd>${c.consensus}<span class="bug-meta"> highest confidence</span></dd></div>
  <div><dt>axe only</dt><dd>${c.axeOnly}</dd></div>
  <div><dt>Alfa only</dt><dd>${c.alfaOnly}</dd></div>
</dl>
${bothTable}
</section>`;
}

/**
 * Standalone Lighthouse page for a domain/week: every sampled URL with
 * its category scores (performance, accessibility, best-practices, SEO,
 * and the experimental agentic-browsing score) plus Core Web Vitals
 * metrics. Linked from the domain report. Returns null if no LH data.
 */
// Human labels for the recommendation categories (engine uses LH category ids).
const LH_CATEGORY_LABELS = {
  performance: 'Performance',
  seo: 'SEO',
  'best-practices': 'Best Practices',
  'agentic-browsing': 'Agentic (AI-readiness)',
};
const LH_CATEGORY_ORDER = ['performance', 'best-practices', 'seo', 'agentic-browsing'];

/** "340 KB", "1.2 MB", or '' for zero. */
function fmtSavingsBytes(b) {
  if (!b) return '';
  return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
}

/**
 * Recommendations rolled up from Lighthouse's non-accessibility audits,
 * grouped by category and ranked by pages affected then estimated impact.
 * Mirrors the axe rule table: each row is an issue with how many sampled
 * pages it hit and an estimated saving where Lighthouse provides one.
 */
function lighthouseRecommendations(recommendations, pagesSampled) {
  if (!recommendations?.length) return '';
  const byCat = {};
  for (const r of recommendations) (byCat[r.category] ??= []).push(r);
  const sections = LH_CATEGORY_ORDER
    .filter((cat) => byCat[cat]?.length)
    .map((cat) => {
      const rows = byCat[cat]
        .map((r) => {
          const savings = [fmtSavingsBytes(r.savingsBytes), r.savingsMs ? `${(r.savingsMs / 1000).toFixed(1)}s` : '']
            .filter(Boolean).join(' · ') || '—';
          return `<tr>
  <th scope="row">${esc(r.title)}</th>
  <td class="num">${r.pages}/${pagesSampled}</td>
  <td class="num">${savings}</td>
</tr>`;
        })
        .join('\n');
      return `<h3>${esc(LH_CATEGORY_LABELS[cat] ?? cat)}</h3>
<table>
<caption>${esc(LH_CATEGORY_LABELS[cat] ?? cat)} recommendations from Lighthouse, by sampled pages affected.</caption>
<thead><tr><th scope="col">Recommendation</th><th scope="col" class="num">Pages</th><th scope="col">Est. saving</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
    })
    .join('\n');
  return `<section aria-labelledby="h-lh-reco">
${heading('h-lh-reco', `Recommendations`)}
<p class="meta">Issues Lighthouse flagged across the ${pagesSampled} sampled page(s), beyond the headline scores — grouped by category and ranked by how many pages they affect. Estimated savings (transfer bytes or load time) are Lighthouse's own estimates where available. Accessibility audits are intentionally omitted; they overlap with the axe-core findings on the <a href="accessibility.html">Accessibility page</a>.</p>
${sections}
</section>`;
}

/**
 * Plain-language explainer for the Agentic (AI-readiness) score, which is new
 * in Lighthouse 13.4+ and unfamiliar to most readers.
 */
function agenticExplainer(lh) {
  if (lh.medianAgentic == null) return '';
  const agenticRecos = (lh.recommendations ?? []).filter((r) => r.category === 'agentic-browsing');
  const gaps = agenticRecos.length
    ? `<p class="meta">Gaps found on the sampled pages: ${agenticRecos.map((r) => `${esc(r.title)} (${r.pages})`).join(', ')}.</p>`
    : '';
  return `<section aria-labelledby="h-lh-agentic">
${heading('h-lh-agentic', `What the Agentic score means`)}
<p>The <strong>Agentic (AI-readiness)</strong> score is new in Google Lighthouse (13.4+). It measures how well a page works for <strong>AI agents and assistants</strong> — the tools that increasingly mediate how people find and use government services. It checks for things like an <code>llms.txt</code> file (a machine-readable guide for language models), valid <a href="https://schema.org/">structured data</a>, a well-formed accessibility tree that agents can parse, and <a href="https://github.com/webmachinelearning/webmcp">WebMCP</a> tool/form descriptions. A higher score means an AI assistant is more likely to understand the page and complete tasks on a citizen's behalf correctly.</p>
<p class="meta">It is experimental and evolving; treat it as a forward-looking signal, not a compliance requirement. Median across sampled pages: <strong>${fmtScore(lh.medianAgentic)}</strong>.</p>
${gaps}
</section>`;
}

function pwaSignalsSection(lh) {
  const signals = lh.pwaSignals;
  if (!signals?.length) return '';
  const pagesChecked = lh.pagesSampled;

  const PWA_DESCRIPTIONS = {
    'service-worker': 'Service worker registered — enables offline access and background sync.',
    'works-offline': 'Page responds when offline — shows a fallback instead of a browser error.',
    'offline-start-url': 'App start URL responds while offline.',
    'installable-manifest': 'Web app manifest meets criteria for "Add to Home Screen" / install prompt.',
    'apple-touch-icon': 'Apple touch icon present — improves iOS bookmark appearance.',
    'maskable-icon': 'Maskable icon in manifest — fills the full icon shape on Android.',
    'splash-screen': 'Custom splash screen configured in manifest.',
    'themed-omnibox': 'Browser address bar themed to match the site.',
    'content-width': 'Viewport width matches device width.',
    'viewport': 'Viewport meta tag present.',
  };

  const rows = signals.map((s) => {
    const passRate = s.pagesChecked > 0 ? Math.round((s.pagesPass / s.pagesChecked) * 100) : 0;
    const passing = passRate >= 80;
    const badge = passing ? '✓' : passRate > 0 ? '~' : '✗';
    const badgeClass = passing ? 'pwa-pass' : passRate > 0 ? 'pwa-partial' : 'pwa-fail';
    const desc = PWA_DESCRIPTIONS[s.id] ?? '';
    return `<tr>
  <td><span class="pwa-badge ${esc(badgeClass)}">${badge}</span></td>
  <th scope="row">${esc(s.title)}</th>
  <td class="num">${s.pagesPass}/${s.pagesChecked}</td>
  <td class="num">${passRate}%</td>
  <td>${esc(desc)}</td>
</tr>`;
  }).join('\n');

  const hasServiceWorker = signals.find((s) => s.id === 'service-worker' && s.pagesPass > 0);
  const hasOffline = signals.find((s) => s.id === 'works-offline' && s.pagesPass > 0);
  const interpretation = hasServiceWorker
    ? `Service worker detected on ${signals.find((s) => s.id === 'service-worker').pagesPass} of ${pagesChecked} sampled page(s). ${hasOffline ? 'Offline fallback confirmed.' : 'No offline fallback detected.'}`
    : `No service worker detected on any sampled page. This site does not provide offline access or PWA install capability.`;

  return `<section aria-labelledby="h-lh-pwa">
${heading('h-lh-pwa', `PWA / offline readiness`)}
<p class="meta">${interpretation} Checks run on ${pagesChecked} sampled page(s). Service workers and offline access allow pages to load without a network connection, and enable "Add to Home Screen" install on mobile.</p>
<table>
<caption>PWA and offline readiness audit results from Lighthouse.</caption>
<thead><tr><th scope="col"></th><th scope="col">Audit</th><th scope="col" class="num">Pages passing</th><th scope="col" class="num">Pass rate</th><th scope="col">What it checks</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</section>`;
}

export function renderLighthousePage(target, summary, csvHref, jsonHref) {
  const lh = summary.lighthouse;
  if (!lh || !lh.pageDetail?.length) {
    return emptyCriterionPage(target, summary, { active: 'lighthouse', label: 'Lighthouse', message: 'No Lighthouse audits ran on this week\'s sampled pages (Lighthouse is sampled at a low rate; some weeks have none).' });
  }
  const ms = (v) => (v == null ? 'n/a' : `${(v / 1000).toFixed(1)}s`);
  const sc = (v) => (v == null ? 'n/a' : `${v}`);
  const cell = (html, sort) => ({ html, sort: sort == null ? -1 : sort });
  // Sortable per-page table: page name sorts alphabetically, metrics numerically.
  const cols = [
    { label: 'Page' }, { label: 'Perf', num: 1 }, { label: 'A11y', num: 1 },
    { label: 'Best practices', num: 1 }, { label: 'SEO', num: 1 },
    { label: 'PWA', num: 1 }, { label: 'Agentic', num: 1 },
    { label: 'FCP', num: 1 }, { label: 'LCP', num: 1 }, { label: 'Speed Index', num: 1 },
    { label: 'TBT', num: 1 }, { label: 'CLS', num: 1 },
  ];
  const rows = lh.pageDetail.map((p) => {
    const path = (() => { try { return new URL(p.url).pathname || '/'; } catch { return p.url; } })();
    const m = p.metrics || {};
    return [
      cell(`<a class="url" href="${esc(p.url)}" title="${esc(p.url)}">${esc(path)}</a>`, path),
      cell(sc(p.scores.performance), p.scores.performance), cell(sc(p.scores.accessibility), p.scores.accessibility),
      cell(sc(p.scores.bestPractices), p.scores.bestPractices), cell(sc(p.scores.seo), p.scores.seo),
      cell(sc(p.scores.pwa), p.scores.pwa), cell(sc(p.scores.agentic), p.scores.agentic),
      cell(ms(m.firstContentfulPaintMs), m.firstContentfulPaintMs), cell(ms(m.largestContentfulPaintMs), m.largestContentfulPaintMs),
      cell(ms(m.speedIndexMs), m.speedIndexMs), cell(ms(m.totalBlockingTimeMs), m.totalBlockingTimeMs),
      cell(p.metrics.cumulativeLayoutShift ?? 'n/a', p.metrics.cumulativeLayoutShift),
    ];
  });
  const m = lh.metrics ?? {};
  const weights = summary.sustainability?.bytesList ?? [];
  const impact = performanceImpact(lh.pageDetail, weights, target.page_loads_per_week ?? null);

  const dlLinks = [
    csvHref ? `<a href="${esc(csvHref)}">CSV (per-page scores)</a>` : '',
    jsonHref ? `<a href="${esc(jsonHref)}">JSON (AI-ready, includes recommendations)</a>` : '',
    summary.priorityPagesCsv ? `<a href="${esc(summary.priorityPagesCsv)}">Priority pages CSV</a>` : '',
    summary.priorityPagesJson ? `<a href="${esc(summary.priorityPagesJson)}">Priority pages JSON</a>` : '',
  ].filter(Boolean);

  const body = `
<h1>${esc(target.domain)}: Lighthouse — week ${esc(summary.week)}</h1>
${subnav('lighthouse')}
<p class="meta">${lh.pageDetail.length} pages sampled by Google Lighthouse (its own headless Chrome). Scores are 0–100 (higher is better); metrics are Core Web Vitals.${dlLinks.length ? ` Download: ${dlLinks.join(' · ')}.` : ''}</p>
${impact ? perfImpactSection(impact) : ''}
<section aria-labelledby="h-lh-medians">
${heading('h-lh-medians', `Medians across sampled pages`)}
<dl class="ledger">
  <div><dt>Performance</dt><dd>${fmtScore(lh.medianPerformance)}</dd></div>
  <div><dt>Accessibility</dt><dd>${fmtScore(lh.medianAccessibility)}</dd></div>
  <div><dt>Best practices</dt><dd>${fmtScore(lh.medianBestPractices)}</dd></div>
  <div><dt>SEO</dt><dd>${fmtScore(lh.medianSeo)}</dd></div>
  ${lh.medianPwa != null ? `<div><dt>PWA readiness</dt><dd>${fmtScore(lh.medianPwa)}</dd></div>` : ''}
  ${lh.medianAgentic != null ? `<div><dt>Agentic browsing</dt><dd>${fmtScore(lh.medianAgentic)}</dd></div>` : ''}
  <div><dt>Largest Contentful Paint</dt><dd>${ms(m.largestContentfulPaintMs)}</dd></div>
  <div><dt>First Contentful Paint</dt><dd>${ms(m.firstContentfulPaintMs)}</dd></div>
  <div><dt>Speed Index</dt><dd>${ms(m.speedIndexMs)}</dd></div>
  <div><dt>Total Blocking Time</dt><dd>${ms(m.totalBlockingTimeMs)}</dd></div>
  <div><dt>Cumulative Layout Shift</dt><dd>${m.cumulativeLayoutShift ?? 'n/a'}</dd></div>
</dl>
</section>
${pwaSignalsSection(lh)}
${lighthouseRecommendations(lh.recommendations, lh.pageDetail.length)}
${agenticExplainer(lh)}
<section aria-labelledby="h-lh-pages">
${heading('h-lh-pages', `Per-page results`)}
${sortableTable(`Lighthouse scores and Core Web Vitals per sampled page (${summary.week}); PWA = offline/install readiness; Agentic = experimental agentic-browsing score.`, cols, rows)}
</section>`;
  return layout({
    title: `${target.domain} Lighthouse ${summary.week} | vital-scans`,
    breadcrumb: `<li><a href="../../../index.html">All domains</a></li><li><a href="index.html">${esc(target.domain)} ${esc(summary.week)}</a></li><li aria-current="page">Lighthouse</li>`,
    body,
    depth: 3,
    extraScript: SORT_SCRIPT,
  });
}

/**
 * Performance-impact section: extra wait time and data vs Google's
 * benchmarks (LCP 2.5s, page weight 1.6 MB). Per-page averages always;
 * site-wide totals + Wikipedia-copies when traffic is configured.
 */
function perfImpactSection(impact) {
  const secs = (ms) => (ms == null ? 'n/a' : `${(ms / 1000).toFixed(1)}s`);
  const mb = (b) => (b == null ? 'n/a' : `${(b / 1e6).toFixed(2)} MB`);
  const totals = impact.totals;
  return `<section aria-labelledby="h-lh-impact">
${heading('h-lh-impact', `Performance impact`)}
<p class="meta">How far pages fall short of Google's "good" benchmarks: Largest Contentful Paint ≤ 2.5s and page weight ≤ 1.6 MB. Lower is better.</p>
<dl class="ledger">
  <div><dt>Avg extra LCP over 2.5s</dt><dd>${secs(impact.avgExtraLcpMs)}<span class="bug-meta"> ${impact.pagesOverLcp}/${impact.lcpPages} pages over</span></dd></div>
  <div><dt>Avg extra weight over 1.6 MB</dt><dd>${mb(impact.avgExtraWeightBytes)}<span class="bug-meta"> ${impact.pagesOverWeight}/${impact.weightPages} pages over</span></dd></div>
</dl>
${totals ? `<p>With an estimated <strong>${totals.pageLoadsPerWeek.toLocaleString()}</strong> page loads/week, that is roughly <strong>${esc(totals.extraSecondsHuman)}</strong> of extra waiting and <strong>${esc(totals.extraBytesHuman)}</strong> of extra data transferred per week${totals.wikipediaCopies > 0 ? ` (~${totals.wikipediaCopies.toLocaleString()} copies of Wikipedia)` : ''}. Rough estimate, traffic spread evenly across sampled pages.</p>`
    : `<p class="meta">Set <code>page_loads_per_week</code> for this target to also estimate total wasted time and data (the way <a href="https://github.com/mgifford/daily-dap">daily-dap</a> uses traffic counts).</p>`}
</section>`;
}

/**
 * Standalone readability page: a sortable table of every prose page with
 * its word count, Flesch Reading Ease and Flesch-Kincaid grade, plus
 * documentation of what the metrics mean. Returns null if no data.
 */
export function renderReadabilityPage(target, summary, csvHref) {
  const pl = summary.plainLanguage;
  if (!pl || !pl.pageRows?.length) {
    return emptyCriterionPage(target, summary, { active: 'readability', label: 'Readability', message: 'No readable prose pages were sampled this week, so there are no readability metrics to report.' });
  }
  const cell = (html, sort) => ({ html, sort: sort === '' || sort == null ? -1 : sort });
  const cols = [
    { label: 'Page' }, { label: 'Words', num: 1 }, { label: 'Reading ease', num: 1 },
    { label: 'Grade level', num: 1 }, { label: 'Scored', num: 0 },
  ];
  const rows = pl.pageRows.map((r) => {
    const path = (() => { try { return new URL(r.url).pathname || '/'; } catch { return r.url; } })();
    return [
      cell(`<a class="url" href="${esc(r.url)}" title="${esc(r.url)}">${esc(path)}</a>`, path),
      cell(String(r.wordCount), r.wordCount),
      cell(r.fleschReadingEase === '' ? 'n/a' : String(r.fleschReadingEase), r.fleschReadingEase),
      cell(r.fleschKincaidGrade === '' ? 'n/a' : String(r.fleschKincaidGrade), r.fleschKincaidGrade),
      cell(r.scored ? 'yes' : 'too little prose', r.scored ? 1 : 0),
    ];
  });
  const acronyms = summary.plainLanguage?.topUnexplainedAcronyms ?? [];
  const misspellings = summary.plainLanguage?.topMisspellings ?? [];
  const body = `
<h1>${esc(target.domain)}: Readability — week ${esc(summary.week)}</h1>
${subnav('readability')}
<p class="meta">Plain-language metrics for the main content of each scanned page (navigation, header, and footer excluded). ${csvHref ? `<a href="${esc(csvHref)}">Download CSV</a>.` : ''}</p>
<section aria-labelledby="h-read-about">
${heading('h-read-about', `What these mean`)}
<dl class="ledger">
  <div><dt>Words per page</dt><dd>Main-content word count.<span class="bug-meta"> Median ${pl.medianWordsPerPage ?? 'n/a'}</span></dd></div>
  <div><dt>Reading ease (Flesch)</dt><dd>0–100; higher is easier. ~60+ is plain language; below ~30 is very hard.<span class="bug-meta"> Median ${pl.medianReadingEase ?? 'n/a'}</span></dd></div>
  <div><dt>Grade level (Flesch-Kincaid)</dt><dd>US school grade needed to read it; aim for ~8 or lower for the public.<span class="bug-meta"> Median ${pl.medianGrade ?? 'n/a'}</span></dd></div>
  <div><dt>Scored</dt><dd>Pages with too little prose (mostly links/cards) are not scored — those numbers would be misleading.<span class="bug-meta"> ${pl.pagesScored} of ${pl.pagesChecked} scored</span></dd></div>
</dl>
<p class="meta">Heuristics for triage and trends, not authoritative linguistics. They flag pages worth a human plain-language review.</p>
</section>
<section aria-labelledby="h-read-pages">
${heading('h-read-pages', `Per-page readability`)}
${sortableTable(`Readability per scanned page (${summary.week}).`, cols, rows)}
</section>
${acronyms.length ? `<section aria-labelledby="h-acronyms">
${heading('h-acronyms', `Unexplained acronyms`)}
<p class="meta">Acronyms used without an on-page expansion (e.g. "Centers for Medicare &amp; Medicaid Services (CMS)"), by pages affected.${downloadLinks(summary.plainLanguage?.acronymsCsv, summary.plainLanguage?.acronymsJson)}</p>
<ul>${acronyms.map((a) => `<li><code>${esc(a.acronym)}</code> — ${a.pages} page(s)</li>`).join('')}</ul>
</section>` : ''}
${misspellings.length ? `<section aria-labelledby="h-spelling">
${heading('h-spelling', `Possible misspellings`)}
<p class="meta">Main-content words not found in the dictionary or the project allowlist, by pages affected. Government and medical jargon may be false positives — add real terms to <code>config/spelling-allowlist.txt</code>.${downloadLinks(summary.plainLanguage?.spellingCsv, summary.plainLanguage?.spellingJson)}</p>
<ul>${misspellings.map((m) => `<li><code>${esc(m.word)}</code> — ${m.pages} page(s)</li>`).join('')}</ul>
</section>` : ''}`;
  return layout({
    title: `${target.domain} Readability ${summary.week} | vital-scans`,
    breadcrumb: `<li><a href="../../../index.html">All domains</a></li><li><a href="index.html">${esc(target.domain)} ${esc(summary.week)}</a></li><li aria-current="page">Readability</li>`,
    body,
    depth: 3,
    extraScript: SORT_SCRIPT,
  });
}

/**
 * Standalone tech-detection page for a domain/week. Lists all technologies
 * identified across the sampled pages, grouped by category (CMS, framework,
 * analytics, CDN, etc.), with confidence level and the evidence signals that
 * triggered each detection. Linked from the domain's subnav when data exists.
 */
export function renderTechPage(target, summary, csvHref) {
  if (!summary.tech?.length) {
    return emptyCriterionPage(target, summary, { active: 'tech', label: 'Technology stack', message: 'No technology was detected in this week\'s sampled pages.' });
  }
  // Denominator for coverage is the number of pages the tech engine actually
  // ran on (its sample), not every page scanned — so "59% (63 of 106)" reads
  // as "found on 63 of the 106 pages we checked for technology".
  const techRan = summary.coverage?.tech ?? null;
  const coverage = (d) => {
    if (!techRan) return `${d.pagesConfirmed}`;
    return `${Math.round((100 * d.pagesConfirmed) / techRan)}% <span class="bug-meta">(${d.pagesConfirmed} of ${techRan})</span>`;
  };
  const byCategory = {};
  for (const d of summary.tech) {
    (byCategory[d.category] ??= []).push(d);
  }
  const confColor = (c) => c === 100 ? 'var(--better)' : c >= 75 ? 'var(--accent)' : 'var(--muted)';
  const sections = Object.entries(byCategory)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, items]) => {
      const rows = items
        .map((d) => {
          const nameCell = d.website
            ? `<a href="${esc(d.website)}">${esc(d.name)}</a>`
            : esc(d.name);
          const examples = (d.examplePages ?? []).length
            ? `<details><summary class="bug-meta">${d.examplePages.length} example page(s)</summary><ul>${d.examplePages.map((u) => `<li>${urlCell(u)}</li>`).join('')}</ul></details>`
            : '';
          return `<tr>
  <th scope="row">${nameCell}${d.version ? ` <span class="bug-meta">v${esc(d.version)}</span>` : ''}${examples}</th>
  <td class="num" style="color:${confColor(d.confidence)}">${d.confidence}%</td>
  <td class="num" data-sort="${d.pagesConfirmed}">${coverage(d)}</td>
  <td class="bug-meta">${esc(d.categories.join(', '))}</td>
</tr>`;
        })
        .join('\n');
      return `<h3>${esc(cat)}</h3>
<table class="sortable">
<caption>${esc(cat)} technologies detected on ${esc(target.domain)}, ${esc(summary.week)}.</caption>
<thead><tr><th scope="col">Technology</th><th scope="col">Confidence</th><th scope="col">Coverage</th><th scope="col">All categories</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
    })
    .join('\n');

  const ranNote = techRan ? ` The technology engine ran on <strong>${techRan}</strong> of ${summary.pagesScanned} pages scanned this week; coverage below is the share of those ${techRan} pages where each technology was found.` : '';
  const body = `
<h1>${esc(target.domain)}: technology stack</h1>
${subnav('tech')}
<p class="meta"><strong>${summary.tech.length}</strong> technologies detected in <strong>${esc(summary.week)}</strong>, using response headers, HTML meta tags, JavaScript globals, and script/link src patterns. Confidence reflects how specifically the signal identifies the technology. This is automated heuristic detection — verify before relying on results for procurement or compliance decisions.${ranNote}${downloadLinks(csvHref, 'tech.json')}</p>
<p class="note">Detection is additive across the week's sampled pages. Expand a technology to see example pages where it was found.</p>
${sections}`;
  return layout({
    title: `${target.domain} Tech Stack ${summary.week} | vital-scans`,
    breadcrumb: `<li><a href="../../../index.html">All domains</a></li><li><a href="index.html">${esc(target.domain)} ${esc(summary.week)}</a></li><li aria-current="page">Tech stack</li>`,
    body,
    depth: 3,
    extraScript: SORT_SCRIPT,
  });
}

/** "axe:color-contrast" -> "color-contrast (axe)" for display. */
function findingLabel(key) {
  const [engine, ...rest] = String(key).split(':');
  const id = rest.join(':');
  return `${id} (${engine})`;
}

/**
 * Tech ↔ issues page: surfaces accessibility findings that are statistically
 * over-represented on pages running a given technology. The signal is lift
 * (how much more likely a finding is on pages with the tech vs. its overall
 * rate). High lift across many pages is a candidate systemic issue — a barrier
 * that travels with a CMS/theme/widget rather than with any one page's content.
 *
 * Association is not causation: the page says "associated with", and notes that
 * a stack of technologies detected on the same pages will share lift values
 * (collinearity), so the implicated component still needs human confirmation.
 */
export function renderTechFindingsPage(target, summary) {
  const tf = summary.techFindings;
  if (!tf || !tf.associations?.length) {
    return emptyCriterionPage(target, summary, { active: 'tech-findings', label: 'Technology ↔ issues', message: 'No technology-to-finding associations cleared the support threshold this week (need enough pages where both technology detection and an accessibility engine ran).' });
  }
  const model = tf.model;

  // Group the ranked associations by technology, strongest first.
  const byTech = {};
  for (const a of tf.associations) (byTech[a.tech] ??= []).push(a);
  const techOrder = Object.keys(byTech).sort(
    (a, b) => (byTech[b][0]?.lift ?? 0) - (byTech[a][0]?.lift ?? 0)
  );

  const sections = techOrder
    .map((tech) => {
      const rows = byTech[tech]
        .map((a) => `<tr>
  <th scope="row">${esc(findingLabel(a.finding))}</th>
  <td class="num">${a.lift.toFixed(2)}×</td>
  <td class="num">${a.pairPages} / ${a.techPages}</td>
  <td class="num">${a.findingPages}</td>
</tr>`)
        .join('\n');
      return `<h3>${esc(tech)} <span class="bug-meta">${model.tech[tech]} pages</span></h3>
<table class="sortable">
<caption>Findings over-represented on pages running ${esc(tech)} (lift ≥ 1, ≥5 pages support).</caption>
<thead><tr>
  <th scope="col">Finding</th>
  <th scope="col" class="num">Lift</th>
  <th scope="col" class="num">On tech pages</th>
  <th scope="col" class="num">On all pages</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>`;
    })
    .join('\n');

  const body = `
<h1>${esc(target.domain)}: technology ↔ issues</h1>
${subnav('tech-findings')}
<p class="meta">Accessibility findings that appear disproportionately on pages running a given technology, across the ${model.pages} page(s) in <strong>${esc(summary.week)}</strong> where both technology detection and an accessibility engine ran. <strong>Lift</strong> is how many times more likely a finding is on pages with the technology than on pages overall — a value of 2× means twice the baseline rate.</p>
<p class="note">This is an <em>association</em>, not proof of cause. Technologies that are detected on the same set of pages (e.g. a CMS, its host, and its language) will share identical lift values; the listing groups by technology but cannot tell which one in a co-located stack is responsible. Treat high-lift pairs as leads for a human to confirm — a barrier that recurs with the same technology, especially across multiple sites, is likely a bug in that technology rather than in any one page's content.</p>
${sections}`;
  return layout({
    title: `${target.domain} Tech ↔ Issues ${summary.week} | vital-scans`,
    breadcrumb: `<li><a href="../../../index.html">All domains</a></li><li><a href="index.html">${esc(target.domain)} ${esc(summary.week)}</a></li><li aria-current="page">Tech ↔ issues</li>`,
    body,
    depth: 3,
    extraScript: SORT_SCRIPT,
  });
}

/**
 * Third parties page: every third-party vendor (registrable domain) serving
 * resources to the site, with its load cost (median bytes/requests/duration
 * per page it appears on), whether it serves JavaScript, how widely it's
 * deployed, and what share of the pages carrying it also had an accessibility
 * finding. Third-party JS is easy to add and frequently degrades a page; this
 * makes the cost visible. New-this-week vendors are flagged from the ledger.
 *
 * The finding share is an association, not proof of cause — a vendor on heavy
 * pages will co-occur with findings without causing them. The rigorous causal
 * test (blocked-load comparison) is a separate, heavier mode.
 */
export function renderThirdPartyPage(target, summary, csvHref) {
  const tp = summary.thirdParty;
  if (!tp || !tp.vendors?.length) {
    return emptyCriterionPage(target, summary, { active: 'third-party', label: 'Third parties', message: 'No third-party origins were recorded on this week\'s sampled pages (the third-party engine is sampled; some weeks have none).' });
  }
  const dlLink = csvHref ? ` · <a href="${esc(csvHref)}">Download CSV</a>` : '';

  const rows = tp.vendors
    .map((v) => {
      const isNew = v.firstSeen && v.firstSeen === summary.week;
      const findingShare = v.pages ? Math.round((100 * v.pagesWithFindings) / v.pages) : 0;
      return `<tr>
  <th scope="row">${esc(v.origin)}${isNew ? ' <span class="bug-meta">new</span>' : ''}${v.isScriptVendor ? ' <span class="wcag-badge">JS</span>' : ''}</th>
  <td class="num" data-sort="${v.pages}">${v.pages}</td>
  <td class="num" data-sort="${v.medianBytes}">${kb(v.medianBytes)}</td>
  <td class="num" data-sort="${v.medianRequests}">${v.medianRequests}</td>
  <td class="num" data-sort="${v.medianDurationMs}">${v.medianDurationMs} ms</td>
  <td class="num" data-sort="${findingShare}">${findingShare}%</td>
</tr>`;
    })
    .join('\n');

  const scriptVendors = tp.vendors.filter((v) => v.isScriptVendor).length;
  const body = `
<h1>${esc(target.domain)}: third parties</h1>
${subnav('third-party')}
<p class="meta">Third-party origins serving resources to <strong>${esc(target.domain)}</strong> across the ${tp.pagesScanned} page(s) measured in <strong>${esc(summary.week)}</strong>. <strong>${tp.vendors.length}</strong> distinct third-party domains, <strong>${scriptVendors}</strong> of them serving JavaScript (<span class="wcag-badge">JS</span>). Costs are medians per page the vendor appears on.${dlLink}</p>
<p class="note">Third-party JavaScript is easy to add and often reduces accessibility and performance — it injects DOM the site owner never reviewed and adds load time. "Pages w/ finding" is the share of pages carrying this vendor that also had an accessibility finding: an <em>association</em> to investigate, not proof the vendor caused it. Third parties vary per page, so a vendor on few pages may simply not have been sampled elsewhere.</p>
<table class="sortable">
<caption>Third-party vendors on ${esc(target.domain)}, ${esc(summary.week)} — sortable.</caption>
<thead><tr>
  <th scope="col">Vendor (registrable domain)</th>
  <th scope="col" class="num">Pages</th>
  <th scope="col" class="num">Median bytes</th>
  <th scope="col" class="num">Median requests</th>
  <th scope="col" class="num">Median load</th>
  <th scope="col" class="num">Pages w/ finding</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>`;
  return layout({
    title: `${target.domain} Third Parties ${summary.week} | vital-scans`,
    breadcrumb: `<li><a href="../../../index.html">All domains</a></li><li><a href="index.html">${esc(target.domain)} ${esc(summary.week)}</a></li><li aria-current="page">Third parties</li>`,
    body,
    depth: 3,
    extraScript: SORT_SCRIPT,
  });
}

/**
 * Images page: per-page alt-text coverage summary and a table of all
 * images found during the week's scan, with their alt text, dimensions,
 * and lazy-loading attributes. Links to the images.csv download.
 */
// Human label + explanation for each alt-text verdict.
const ALT_VERDICT_INFO = {
  MISSING: ['Missing alt', 'No alt attribute — a screen reader may announce the filename.'],
  FILENAME: ['Filename as alt', 'The alt text looks like a filename (e.g. hero_1234.jpg), not a description.'],
  SUSPICIOUS: ['Redundant / meaningless', 'Phrases like "image of…" or bare values like "photo" add nothing.'],
  TOO_SHORT: ['Too short', 'A single character or word unlikely to convey the image\'s meaning.'],
  TOO_LONG: ['Too long', 'So long it probably belongs in a caption or a separate description.'],
  DECORATIVE: ['Decorative', 'alt="" or aria-hidden — intentionally not announced. Not a problem.'],
  GOOD: ['Looks good', 'Present, plausible, no red flags (still worth a human spot-check).'],
};
const ALT_VERDICT_ORDER = ['MISSING', 'FILENAME', 'SUSPICIOUS', 'TOO_SHORT', 'TOO_LONG', 'GOOD', 'DECORATIVE'];

export function renderImagesPage(target, summary, csvHref) {
  const img = summary.images;
  if (!img) {
    return emptyCriterionPage(target, summary, { active: 'images', label: 'Image inventory', message: 'No images were inventoried on this week\'s sampled pages.' });
  }
  const links = [
    csvHref ? `<a href="${esc(csvHref)}">CSV</a>` : '',
    summary.imagesJson ? `<a href="${esc(summary.imagesJson)}">JSON</a>` : '',
  ].filter(Boolean).join(' · ');
  const dlLink = links ? ` Download: ${links}.` : '';
  const pct = (n) => img.totalImages ? `${Math.round((n / img.totalImages) * 100)}%` : '0%';

  const statsTable = `<table class="stats-table">
<caption>Image alt-text coverage across ${img.pagesScanned} page(s) scanned in ${esc(summary.week)}.</caption>
<thead><tr><th scope="col">Category</th><th scope="col" class="num">Count</th><th scope="col" class="num">Share</th></tr></thead>
<tbody>
<tr><th scope="row">Total image occurrences</th><td class="num">${img.totalImages}</td><td class="num">—</td></tr>
<tr><th scope="row">Unique images</th><td class="num">${img.uniqueImages ?? '—'}</td><td class="num">—</td></tr>
<tr><th scope="row">Has alt text</th><td class="num">${img.withAlt}</td><td class="num">${pct(img.withAlt)}</td></tr>
<tr><th scope="row">Decorative (alt="")</th><td class="num">${img.decorative}</td><td class="num">${pct(img.decorative)}</td></tr>
<tr><th scope="row">Missing alt attribute</th><td class="num">${img.missingAlt}</td><td class="num">${pct(img.missingAlt)}</td></tr>
</tbody>
</table>`;

  // Alt-text quality summary (counted over unique images).
  const verdicts = img.altVerdicts ?? {};
  const totalUnique = img.uniqueImages || 1;
  const qualityRows = ALT_VERDICT_ORDER
    .filter((v) => verdicts[v])
    .map((v) => {
      const [label, expl] = ALT_VERDICT_INFO[v];
      const cls = (v === 'GOOD' || v === 'DECORATIVE') ? '' : ' class="error"';
      return `<tr><th scope="row"${cls}>${esc(label)}</th><td class="num">${verdicts[v]}</td><td class="num">${Math.round((100 * verdicts[v]) / totalUnique)}%</td><td>${esc(expl)}</td></tr>`;
    })
    .join('\n');
  const qualitySection = qualityRows ? `<section aria-labelledby="h-images-quality">
${heading('h-images-quality', 'Alt-text quality')}
<p class="meta">Beyond present-vs-missing, each unique image's alt text is classified for quality. Filenames, redundant phrasing ("image of…"), and too-short or too-long values are technically present but unhelpful — the cases a human should rewrite. Decorative and "looks good" are not problems.</p>
<table>
<caption>Alt-text quality across ${img.uniqueImages} unique image(s).</caption>
<thead><tr><th scope="col">Verdict</th><th scope="col">Images</th><th scope="col">Share</th><th scope="col">What it means</th></tr></thead>
<tbody>${qualityRows}</tbody>
</table>
</section>` : '';

  // Deduplicated images table using the reusable sortableTable helper.
  const tableCols = [
    { label: 'Image URL' },
    { label: 'Alt text' },
    { label: 'Alt verdict' },
    { label: 'Loading' },
    { label: 'Size', num: true },
    { label: 'Pages', num: true },
    { label: 'Occurrences', num: true },
  ];

  const tableRows = (img.uniqueImageList ?? []).slice(0, 500).map((u) => {
    const altCell = u.altVerdict === 'MISSING'
      ? '<span class="error">missing</span>'
      : u.altVerdict === 'DECORATIVE'
        ? '<em>decorative</em>'
        : esc(u.alt ?? '');
    const [vlabel] = ALT_VERDICT_INFO[u.altVerdict] ?? [u.altVerdict];
    const vCls = (u.altVerdict === 'GOOD' || u.altVerdict === 'DECORATIVE') ? 'bug-meta' : 'error';
    const inconsistent = (u.altCount ?? 1) > 1 ? ` <span class="bug-meta">${u.altCount} alt variants</span>` : '';
    const loadingVal = u.loading ?? '—';

    return [
      { html: urlCell(u.src), sort: u.src },
      { html: altCell + inconsistent, sort: u.alt ?? '' },
      { html: `<span class="${vCls}">${esc(vlabel)}</span>`, sort: u.altVerdict },
      { html: esc(loadingVal), sort: loadingVal },
      { html: u.bytes != null ? kb(u.bytes) : '—', sort: u.bytes ?? 0 },
      { html: String(u.pages ?? 1), sort: u.pages ?? 1 },
      { html: String(u.occurrences), sort: u.occurrences },
    ];
  });

  const detailTable = sortableTable(
    `Up to 500 unique image occurrences from ${img.pagesScanned} page(s) scanned, most-reused first.`,
    tableCols,
    tableRows
  );

  const body = `
<h1>${esc(target.domain)}: image inventory</h1>
${subnav('images')}
<p class="meta">Unique images encountered on scanned pages in <strong>${esc(summary.week)}</strong>, deduplicated by URL and Alt — the same image reused across pages with the same explanation is one row. Images with alternate captions are split into separate rows. ${dlLink}</p>
${statsTable}
${qualitySection}
<section aria-labelledby="h-images-detail">
${heading('h-images-detail', 'Image detail')}
${detailTable}
</section>`;
  return layout({
    title: `${target.domain} Images ${summary.week} | vital-scans`,
    breadcrumb: `<li><a href="../../../index.html">All domains</a></li><li><a href="index.html">${esc(target.domain)} ${esc(summary.week)}</a></li><li aria-current="page">Images</li>`,
    body,
    depth: 3,
    extraScript: SORT_SCRIPT,
  });
}

/**
 * Archive page: every retained ISO-week report for a domain, newest
 * first, with key metrics and a week-over-week comparison. Lets reviewers
 * jump back to W24 etc. Lives at the domain's latest-week directory and
 * links into each week's own report folder.
 */
export function renderArchivePage(target, series, latestWeek) {
  if (!series || series.length === 0) return null;
  const ordered = [...series].reverse(); // newest first
  const rows = ordered
    .map((s, i) => {
      const newer = ordered[i - 1]; // the week after this one (for delta)
      const sc = scoreFor(s);
      const med = s.axe.medianViolations ?? 0;
      const d = newer ? med - (newer.axe.medianViolations ?? 0) : null;
      return `<tr>
  <th scope="row"><a href="../${esc(s.week)}/index.html">${esc(s.week)}</a></th>
  <td class="num">${sc ? `<span class="grade grade-${esc(sc.grade)}">${esc(sc.grade)}</span> ${sc.score}` : 'n/a'}</td>
  <td class="num">${s.pagesAudited ?? s.pagesScanned}</td>
  <td class="num">${fmtMedian(s.axe.medianViolations)}${d != null && d !== 0 ? ` ${delta(d)}` : ''}</td>
  <td class="num">${fmtMedian(s.alfa.medianFailures)}</td>
</tr>`;
    })
    .join('\n');
  const body = `
<h1>${esc(target.domain)}: report archive</h1>
${subnav('archive')}
<p class="meta">Every recorded ISO week for this site, newest first. The dashboard headline uses a rolling last-7-days window; these are the full per-week reports for week-over-week comparison.</p>
<table>
<caption>Weekly reports for ${esc(target.domain)} (${series.length} weeks).</caption>
<thead><tr><th scope="col">Week</th><th scope="col" class="num">Score</th><th scope="col" class="num">Pages audited</th><th scope="col" class="num">Median axe / page</th><th scope="col" class="num">Median Alfa / page</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
  return layout({
    title: `${target.domain} archive | vital-scans`,
    breadcrumb: `<li><a href="../../../index.html">All domains</a></li><li><a href="../${esc(latestWeek)}/index.html">${esc(target.domain)}</a></li><li aria-current="page">Archive</li>`,
    body,
    depth: 3,
  });
}

export function renderDomainReport(target, summary, prev, diff, series, bugs = [], csvLinks = { byRule: {}, bugsAll: null }, invSummary = null) {
  const score = scoreFor(summary);
  const traj = trajectory(series, 4);
  const trendViol = series.map((s) => s.axe.medianViolations ?? 0);
  const csvLink = (href, text) => (href ? ` <a href="${esc(href)}" class="csv-link">${text}</a>` : '');
  const resolvedCount = diff ? (diff.axe.resolved.length + diff.alfa.resolved.length) : 0;
  const body = `
<h1>${esc(target.domain)}: week ${esc(summary.week)}</h1>
${subnav('overview')}
<p class="meta">This is the <strong>${esc(summary.week)}</strong> ISO-week report (<strong>${summary.pagesScanned}</strong> pages fetched, <strong>${summary.pagesAudited ?? summary.pagesScanned}</strong> unique pages audited by axe/Alfa). Generated ${esc(summary.generatedAt.slice(0, 10))}.
${prev ? `Compared against ${esc(prev.week)} (${prev.pagesScanned} fetched).` : 'First recorded week; no comparison yet.'} The dashboard headline uses a rolling last-7-days window; this page is the full ISO week.</p>

${score ? `<aside class="scorecard" aria-label="Accessibility scorecard">
  <span class="grade grade-${esc(score.grade)}">${esc(score.grade)}</span>
  <span class="score">${score.score}<span class="score-max">/100</span> <span class="band">${esc(score.band)}</span></span>
  <span class="score-detail">${esc(scoreMeaning(summary, score))}
  ${traj ? `<strong class="traj traj-${esc(traj.direction)}">${esc(traj.direction)}</strong> (${traj.delta >= 0 ? '+' : ''}${traj.delta} pts since ${esc(traj.fromWeek)}).` : ''}
  ${resolvedCount > 0 ? `<strong>${resolvedCount} issue type(s) resolved</strong> since last week.` : ''}</span>
  <span class="score-caveat">Score reflects the typical page's issue count vs other government sites (lower is better). Automated testing finds ~⅓ of barriers — a good score is a floor, not a finish line.</span>
</aside>` : ''}
${invSummary ? `<p class="meta">Over the whole history of this site, <strong>${invSummary.totalKnownPages}</strong> unique pages have been scanned at least once; <strong>${invSummary.pagesWithKnownIssues}</strong> have known accessibility issues. <strong>${invSummary.scannedThisWeek}</strong> of them were re-checked this ISO week. <a href="../../../data/${esc(target.key)}/domain.json">Download full data (JSON)</a>.</p>` : ''}

<section aria-labelledby="h-summary">
${heading('h-summary', `This week at a glance`)}
<dl class="ledger">
  <div><dt>Median axe violations / page</dt><dd>${fmtMedian(summary.axe.medianViolations)} ${sparkline(trendViol)}</dd></div>
  <div><dt>Pages with axe violations</dt><dd>${summary.axe.pagesWithViolations} of ${summary.axe.pagesScanned ?? summary.pagesScanned}${csvLink(csvLinks.axeAll, 'CSV')}</dd></div>
  <div><dt>Median Alfa failures / page</dt><dd>${fmtMedian(summary.alfa.medianFailures)}</dd></div>
  <div><dt>Pages with Alfa failures</dt><dd>${summary.alfa.pagesWithFailures} of ${summary.alfa.pagesScanned ?? summary.pagesScanned}${csvLink(csvLinks.alfaAll, 'CSV')}</dd></div>
  <div><dt>Unique pages audited</dt><dd>${summary.pagesAudited ?? summary.pagesScanned}</dd></div>
  ${summary.lighthouse ? `
  <div><dt>Lighthouse performance (median)</dt><dd>${fmtScore(summary.lighthouse.medianPerformance)}<span class="bug-meta"> ${summary.lighthouse.pagesSampled} sampled</span> ${csvLink('lighthouse.html', 'details')}</dd></div>
  <div><dt>Lighthouse SEO (median)</dt><dd>${fmtScore(summary.lighthouse.medianSeo)}</dd></div>
  <div><dt>Lighthouse best practices (median)</dt><dd>${fmtScore(summary.lighthouse.medianBestPractices)}</dd></div>
  ${summary.lighthouse.medianAgentic != null ? `<div><dt>Lighthouse agentic (median)</dt><dd>${fmtScore(summary.lighthouse.medianAgentic)}</dd></div>` : ''}` : ''}
  ${summary.plainLanguage ? `
  <div><dt>Words per page (median)</dt><dd>${summary.plainLanguage.medianWordsPerPage ?? 'n/a'}<span class="bug-meta"> main content, nav excluded</span></dd></div>
  ${summary.plainLanguage.medianReadingEase != null ? `<div><dt>Reading ease (median)</dt><dd>${summary.plainLanguage.medianReadingEase}<span class="bug-meta"> ${summary.plainLanguage.pagesScored} prose pages</span>${csvLink(summary.plainLanguage.readabilityCsv, 'details')}</dd></div>` : ''}
  ${summary.plainLanguage.medianGrade != null ? `<div><dt>Reading grade (median)</dt><dd>${summary.plainLanguage.medianGrade}</dd></div>` : ''}
  ${summary.plainLanguage.topMisspellings?.length ? `<div><dt>Misspellings</dt><dd>${summary.plainLanguage.topMisspellings.length}+ distinct${csvLink('readability.html#h-spelling', 'details')}</dd></div>` : ''}` : ''}
  ${summary.linkCheck ? `
  <div><dt>Broken links</dt><dd>${summary.linkCheck.brokenCount}${summary.linkCheck.brokenCount > 0 ? ` <a href="errors.html" class="csv-link">details</a>` : ''}</dd></div>` : ''}
  ${summary.sustainability ? `
  <div><dt>Median page weight</dt><dd>${kb(summary.sustainability.medianBytes)}
    ${diff?.sustainability ? delta(Math.round(diff.sustainability.medianBytesDelta / 1024), { unit: ' KB' }) : ''}</dd></div>
  <div><dt>Median requests per page</dt><dd>${summary.sustainability.medianRequests}</dd></div>
  <div><dt>${sustainabilityHeadline(summary.sustainability).label}</dt><dd>${sustainabilityHeadline(summary.sustainability).value}</dd></div>` : ''}
</dl>
${prev && summary.pagesScanned !== prev.pagesScanned ? `<p class="note">Note: page counts differ between weeks (${prev.pagesScanned} → ${summary.pagesScanned}). Prefer the "pages affected" columns over raw instance counts when comparing.</p>` : ''}
${coverageTable(summary)}
</section>

${series.length > 1 ? `
<section aria-labelledby="h-trends">
${heading('h-trends', `Trends over time`)}
${severityTrendChart(series)}
${series.some((s) => s.sustainability) ? lineChart('Median page weight (KB)', series.map((s) => ({ week: s.week, value: s.sustainability ? Math.round(s.sustainability.medianBytes / 1024) : null })), { unit: ' KB', lowerIsBetter: true }) : ''}
</section>` : ''}

${diff ? `
<section aria-labelledby="h-wow">
${heading('h-wow', `Changes since ${diff.prevWeek}`)}
${changeList('axe-core', diff.axe)}
${changeList('Alfa', diff.alfa)}
</section>` : ''}

${fixFirstSection(bugs)}

${resourcesSection(summary)}
`;
  return layout({
    title: `${target.domain} ${summary.week} | vital-scans`,
    breadcrumb: `<li><a href="../../../index.html">All domains</a></li><li aria-current="page">${esc(target.domain)} ${esc(summary.week)}</li>`,
    body,
    depth: 3,
  });
}

/**
 * Standalone accessibility page: bug reports (with anchored <details> per bug),
 * axe-core and Alfa rule tables, and the consensus deduplication summary.
 * Linked from the overview and from "Fix these first" deep links.
 */
export function renderAccessibilityPage(target, summary, bugs, csvLinks, reporting = {}) {
  const acrNote = reporting.acrYaml
    ? `<p class="meta">Automated Accessibility Conformance Report (OpenACR YAML) for this week: <a href="${esc(reporting.acrYaml)}">acr.yaml</a>. Machine-readable; compatible with <a href="https://github.com/GSA/openacr">GSA OpenACR tooling</a>. Automated tools find ~⅓ of real barriers — supplement with manual AT testing.</p>`
    : '';
  const body = `
<h1>${esc(target.domain)}: Accessibility — week ${esc(summary.week)}</h1>
${subnav('accessibility')}
${acrNote}
${bugReportsSection(target, summary, bugs, csvLinks.bugsAll ?? null, reporting)}
<section aria-labelledby="h-axe">
${heading('h-axe', `Deque axe-core findings`)}
<details class="engine-findings">
<summary>Rule-level axe-core summary (${Object.keys(summary.axe.rules).length} rule type(s))</summary>
<p class="meta">Each failing rule links out to the axe-core documentation. For full element-level detail including HTML snippets and XPaths, see the bug reports above.</p>
${ruleTable(`axe-core rules failing in ${summary.week}, by pages affected`, summary.axe.rules, 'axe-core', 'axe-core', csvLinks)}
</details>
</section>
<section aria-labelledby="h-alfa">
${heading('h-alfa', `Siteimprove Alfa findings`)}
<details class="engine-findings">
<summary>Rule-level Alfa summary (${Object.keys(summary.alfa.rules).length} rule type(s))</summary>
<p class="meta">Rule-level summary from Siteimprove Alfa (W3C ACT-based). Findings that overlap with axe-core on the same WCAG success criterion are noted as possible duplicates in the bug reports above.</p>
${ruleTable(`Alfa rules failing in ${summary.week}, by pages affected`, summary.alfa.rules, 'Alfa', 'alfa', csvLinks)}
</details>
</section>
${consensusSection(summary, bugs)}
`;
  return layout({
    title: `${target.domain} Accessibility ${summary.week} | vital-scans`,
    breadcrumb: `<li><a href="../../../index.html">All domains</a></li><li><a href="index.html">${esc(target.domain)} ${esc(summary.week)}</a></li><li aria-current="page">Accessibility</li>`,
    body,
    depth: 3,
  });
}

/**
 * Standalone standards & security page.
 */
export function renderStandardsPage(target, summary) {
  const content = standardsSecuritySection(summary);
  if (!content) {
    return emptyCriterionPage(target, summary, { active: 'standards', label: 'Standards & Security', message: 'No web-standards or security checks ran on this week\'s sampled pages.' });
  }
  const body = `
<h1>${esc(target.domain)}: Standards &amp; Security — week ${esc(summary.week)}</h1>
${subnav('standards')}
${content}
`;
  return layout({
    title: `${target.domain} Standards ${summary.week} | vital-scans`,
    breadcrumb: `<li><a href="../../../index.html">All domains</a></li><li><a href="index.html">${esc(target.domain)} ${esc(summary.week)}</a></li><li aria-current="page">Standards</li>`,
    body,
    depth: 3,
  });
}

/**
 * Standalone errors page: broken links and non-404 error pages.
 */
export function renderErrorsPage(target, summary, csvHref = null) {
  const content = linksAndErrorsSection(summary, csvHref);
  if (!content) {
    return emptyCriterionPage(target, summary, { active: 'errors', label: 'Broken Links & Errors', message: 'No broken links or error pages were found on this week\'s sampled pages — clean week.' });
  }
  const body = `
<h1>${esc(target.domain)}: Broken Links &amp; Errors — week ${esc(summary.week)}</h1>
${subnav('errors')}
${content}
`;
  return layout({
    title: `${target.domain} Errors ${summary.week} | vital-scans`,
    breadcrumb: `<li><a href="../../../index.html">All domains</a></li><li><a href="index.html">${esc(target.domain)} ${esc(summary.week)}</a></li><li aria-current="page">Errors</li>`,
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

/**
 * Fleet-wide sustainability trend: fleet mean CO₂g (or Wh) per page across
 * all active domains by week, expressed as a simple week-over-week line chart.
 * Only weeks where ≥1 domain has sustainability data contribute.
 */
function fleetSustainabilityChart(ranked) {
  const withData = ranked.filter((d) => d.series.some((s) => s.sustainability));
  if (withData.length === 0) return '';
  const allWeeks = [...new Set(withData.flatMap((d) => d.series.map((s) => s.week)))].sort();
  if (allWeeks.length < 2) return '';

  // Per week: fleet mean of each domain's mean CO₂g/page (equal-weight per domain).
  const useEnergy = SUSTAINABILITY_METRIC === 'energy';
  const pts = allWeeks.map((week) => {
    const vals = withData
      .map((d) => {
        const s = d.series.find((x) => x.week === week);
        return useEnergy ? (s?.sustainability?.meanEnergyWh ?? null) : (s?.sustainability?.meanCo2g ?? null);
      })
      .filter((v) => v != null);
    return { week, value: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000 : null };
  }).filter((p) => p.value != null);
  if (pts.length < 2) return '';

  const label = useEnergy ? 'Fleet mean energy per page (Wh)' : 'Fleet mean CO₂ per page (g)';
  const unit = useEnergy ? ' Wh' : ' g';
  return lineChart(label, pts, { unit, lowerIsBetter: true });
}

/**
 * Overlay line chart: every domain's median axe violations/page over the
 * weeks they share. Accessible (role=img + aria-label + a data-table
 * fallback). Each domain gets a distinct dash pattern (not color alone).
 */
function crossDomainChart(ranked) {
  const withSeries = ranked.filter((d) => d.series.length > 1);
  if (withSeries.length < 1) return '';
  const allWeeks = [...new Set(withSeries.flatMap((d) => d.series.map((s) => s.week)))].sort();
  if (allWeeks.length < 2) return '';
  const W = 720, H = 240, padL = 40, padR = 140, padT = 16, padB = 28;
  const valAt = (d, week) => {
    const s = d.series.find((x) => x.week === week);
    return s ? (s.axe.medianViolations ?? null) : null;
  };
  const allVals = withSeries.flatMap((d) => allWeeks.map((w) => valAt(d, w))).filter((v) => v != null);
  if (allVals.length === 0) return '';
  const max = Math.max(...allVals, 1);
  const x = (i) => padL + (i / (allWeeks.length - 1)) * (W - padL - padR);
  const y = (v) => H - padB - (v / max) * (H - padT - padB);
  const dashes = ['', '6 3', '2 3', '8 3 2 3', '4 2'];

  const lines = withSeries.map((d, di) => {
    const pts = allWeeks
      .map((w, i) => ({ i, v: valAt(d, w) }))
      .filter((p) => p.v != null)
      .map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`)
      .join(' ');
    const ly = padT + 14 + di * 16;
    return {
      line: `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="${dashes[di % dashes.length]}" opacity="0.85"/>`,
      legend: `<g transform="translate(${W - padR + 6},${ly})"><line x1="0" y1="-4" x2="18" y2="-4" stroke="currentColor" stroke-width="2" stroke-dasharray="${dashes[di % dashes.length]}"/><text x="22" y="0" class="axis">${esc(d.target.domain)}</text></g>`,
    };
  });
  const xlabels = [0, Math.floor((allWeeks.length - 1) / 2), allWeeks.length - 1]
    .filter((v, idx, a) => a.indexOf(v) === idx)
    .map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="axis">${esc(allWeeks[i].slice(5))}</text>`)
    .join('');

  const table = `<table class="visually-hidden"><caption>Median axe violations per page by domain and week</caption>
<thead><tr><th scope="col">Domain</th>${allWeeks.map((w) => `<th scope="col">${esc(w)}</th>`).join('')}</tr></thead>
<tbody>${withSeries.map((d) => `<tr><th scope="row">${esc(d.target.domain)}</th>${allWeeks.map((w) => `<td>${valAt(d, w) ?? '—'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

  return `<figure class="chart">
<figcaption>Median axe violations per page, all domains — lower is better</figcaption>
<svg viewBox="0 0 ${W} ${H}" class="linechart" role="img" aria-label="Median axe violations per page over time, compared across ${withSeries.length} domains" preserveAspectRatio="xMidYMid meet">
  ${lines.map((l) => l.line).join('')}${lines.map((l) => l.legend).join('')}${xlabels}
  <text x="4" y="${(y(max) + 4).toFixed(1)}" class="axis">${max}</text><text x="4" y="${(y(0) + 4).toFixed(1)}" class="axis">0</text>
</svg>
${table}
</figure>`;
}

export function renderIndex(dashboard, { branding = {} } = {}) {
  // Profile branding overrides the default headline/intro; absent (the
  // GitHub Pages default) it falls back to the original copy unchanged.
  const h1 = branding.title || 'Weekly quality ledger';
  const intro = branding.intro
    || 'Accessibility and sustainability, measured continuously with open source engines. '
     + 'Thousands of pages per domain, scanned slowly and politely across each week.';
  const pageTitle = branding.title ? `${branding.title} | vital-scans` : 'vital-scans | weekly quality ledger';
  // Separate targets whose latest week is blocked (e.g. a WAF returning
  // 403 to the scanner) so they don't read as zero-violation successes.
  const blocked = dashboard.filter(({ series }) => series[series.length - 1].blocked);
  const active = dashboard.filter(({ series }) => !series[series.length - 1].blocked);

  // Blocked targets are useful context but not the headline — collapsed
  // into an accordion at the bottom of the dashboard, not up top.
  const blockedCallout = blocked.length === 0 ? '' : `
<section aria-labelledby="h-blocked">
<details class="blocked-accordion">
<summary><span id="h-blocked">Blocked targets (${blocked.length})</span></summary>
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
</details>
</section>`;

  // Leaderboard: rank domains best->worst by score (computed over the
  // trailing-7-day window so it's a fair, like-for-like benchmark), with
  // trajectory. Links still point at the latest ISO-week report.
  const medAxe = (s) => s.axe.medianViolations ?? 0;
  const ranked = active
    .map((d) => {
      const win = d.windowSummary ?? d.series[d.series.length - 1];
      return { ...d, latest: d.series[d.series.length - 1], win, score: scoreFor(win), traj: trajectory(d.series, 4) };
    })
    .sort((a, b) => (b.score?.score ?? -1) - (a.score?.score ?? -1));

  const arrow = (t) => {
    if (!t) return '<span class="traj traj-stable">— new</span>';
    const sym = t.direction === 'improving' ? '▲' : t.direction === 'worsening' ? '▼' : '▬';
    return `<span class="traj traj-${esc(t.direction)}">${sym} ${esc(t.direction)} ${t.delta >= 0 ? '+' : ''}${t.delta}</span>`;
  };
  const rows = ranked
    .map((d) => {
      const { target, series, latest, win, score, traj } = d;
      const trend = series.map(medAxe);
      return `<tr>
  <th scope="row"><a href="reports/${esc(target.key)}/${esc(latest.week)}/index.html">${esc(target.domain)}</a></th>
  <td class="num">${score ? `<span class="grade grade-${esc(score.grade)}">${esc(score.grade)}</span> ${score.score}` : 'n/a'}</td>
  <td>${arrow(traj)}</td>
  <td class="num">${win.pagesAudited ?? win.pagesScanned}</td>
  <td class="num">${fmtMedian(win.axe.medianViolations)}</td>
  <td class="num">${fmtMedian(win.alfa.medianFailures)}</td>
  <td>${sparkline(trend)}<span class="visually-hidden">Median axe violations per page over ${series.length} weeks: ${trend.join(', ')}.</span></td>
</tr>`;
    })
    .join('\n');

  // Overlay chart: every domain's median axe violations/page over time.
  const overlay = crossDomainChart(ranked);
  // Fleet sustainability trend: mean CO₂g/page across all domains by week.
  const sustainTrend = ''; // fleet sustainability trend removed — too early to tell a useful story

  // Fleet-wide worst offenders: highest-impact issues across all domains.
  const worst = fleetWorstOffenders(active.map((d) => ({ target: d.target, bugs: d.bugs ?? [] })), 20);
  const worstSection = worst.length === 0 ? '' : `
<section aria-labelledby="h-worst">
${heading('h-worst', `Worst offenders across all domains`)}
<p class="meta">Highest-impact issues fleet-wide, ranked by pages affected × severity × people reached — where to focus effort first.</p>
<table>
<caption>Top ${worst.length} issues across all active domains.</caption>
<thead><tr><th scope="col">Domain</th><th scope="col">Issue</th><th scope="col">Severity</th><th scope="col" class="num">Pages</th></tr></thead>
<tbody>${worst
    .map((b) => `<tr>
  <th scope="row"><a href="reports/${esc(b.key)}/${esc(b._week)}/index.html">${esc(b.domain)}</a></th>
  <td>${esc(b.summary)}</td>
  <td><span class="sev-badge">${esc(b.severity)}</span></td>
  <td class="num">${b.frequency.pages_affected}</td>
</tr>`)
    .join('\n')}</tbody>
</table>
</section>`;

  // Fleet-wide tech ↔ issue associations: merge every active domain's latest
  // tech↔finding model, then rank pairs by lift × sites-affected. A finding
  // that recurs with the same technology across multiple independent sites is
  // the strongest systemic signal — likely a bug in that technology itself.
  const tfEntries = active
    .map((d) => {
      const latest = d.series[d.series.length - 1];
      return latest.techFindings?.model ? { domain: d.target.domain, model: latest.techFindings.model } : null;
    })
    .filter(Boolean);
  let techFindingsSection = '';
  if (tfEntries.length >= 2) {
    const fleet = mergeFleet(tfEntries);
    const fleetPairs = rankFleetAssociations(fleet, { minPages: 5, minSites: 2, limit: 25 });
    if (fleetPairs.length) {
      techFindingsSection = `
<section aria-labelledby="h-techfindings">
${heading('h-techfindings', `Cross-technology issues`)}
<p class="meta">Accessibility findings that recur with the same technology across multiple sites — the strongest signal that a barrier lives in a shared CMS, theme, or widget rather than in one site's content. Ranked by lift × number of sites affected. Association, not proof of cause: confirm before attributing.</p>
<table class="sortable">
<caption>Top ${fleetPairs.length} technology ↔ finding associations spanning ≥2 sites.</caption>
<thead><tr>
  <th scope="col">Technology</th>
  <th scope="col">Finding</th>
  <th scope="col" class="num">Lift</th>
  <th scope="col" class="num">Sites</th>
  <th scope="col" class="num">Pages</th>
</tr></thead>
<tbody>${fleetPairs
        .map((p) => `<tr>
  <th scope="row">${esc(p.tech)}</th>
  <td>${esc(findingLabel(p.finding))}</td>
  <td class="num">${p.lift.toFixed(2)}×</td>
  <td class="num">${p.sites}</td>
  <td class="num">${p.pairPages}</td>
</tr>`)
        .join('\n')}</tbody>
</table>
</section>`;
    }
  }

  // Fleet-wide Lighthouse recommendations: merge each domain's latest
  // non-accessibility recommendations by audit id, tracking how many sites and
  // how many pages each affects, plus total estimated savings. A recommendation
  // common across many independent government sites is a shared platform/CDN
  // problem worth a coordinated fix.
  const lhMerged = {}; // auditId -> { id, category, title, sites, pages, savingsBytes, savingsMs }
  for (const d of active) {
    const recos = d.series[d.series.length - 1]?.lighthouse?.recommendations ?? [];
    for (const r of recos) {
      const e = (lhMerged[r.id] ??= { id: r.id, category: r.category, title: r.title, sites: 0, pages: 0, savingsBytes: 0, savingsMs: 0 });
      e.sites++;
      e.pages += r.pages ?? 0;
      e.savingsBytes += r.savingsBytes ?? 0;
      e.savingsMs += r.savingsMs ?? 0;
    }
  }
  const lhFleet = Object.values(lhMerged)
    .filter((e) => e.sites >= 2) // only issues common to multiple sites
    .sort((a, b) => b.sites - a.sites || b.pages - a.pages)
    .slice(0, 25);
  let lighthouseFleetSection = '';
  if (lhFleet.length) {
    const catLabel = (c) => LH_CATEGORY_LABELS[c] ?? c;
    lighthouseFleetSection = `
<section aria-labelledby="h-lhfleet">
${heading('h-lhfleet', `Common Lighthouse recommendations`)}
<p class="meta">Non-accessibility issues Google Lighthouse flagged on multiple sites' sampled pages — performance, best-practices, SEO, and AI-readiness. Recurring across independent government sites usually points at a shared platform, theme, or CDN, where one coordinated fix helps everyone. Ranked by number of sites affected. Accessibility audits are omitted (they overlap with axe-core).</p>
<table class="sortable">
<caption>Top ${lhFleet.length} Lighthouse recommendations spanning ≥2 sites.</caption>
<thead><tr>
  <th scope="col">Recommendation</th>
  <th scope="col">Category</th>
  <th scope="col" class="num">Sites</th>
  <th scope="col" class="num">Pages</th>
  <th scope="col" class="num">Est. saving</th>
</tr></thead>
<tbody>${lhFleet
        .map((e) => {
          const saving = [fmtSavingsBytes(e.savingsBytes), e.savingsMs ? `${(e.savingsMs / 1000).toFixed(1)}s` : '']
            .filter(Boolean).join(' · ') || '—';
          return `<tr>
  <th scope="row">${esc(e.title)}</th>
  <td>${esc(catLabel(e.category))}</td>
  <td class="num">${e.sites}</td>
  <td class="num">${e.pages}</td>
  <td class="num">${saving}</td>
</tr>`;
        })
        .join('\n')}</tbody>
</table>
</section>`;
  }

  const body = `
<h1>${esc(h1)}</h1>
<p class="meta">${esc(intro)}</p>
${active.length === 0
    ? (dashboard.length === 0
        ? '<p>No scan data yet. The first weekly report appears after the first scheduled scans complete.</p>'
        : '<p>No accessibility or sustainability data could be collected yet — every target is currently blocked (see the bottom of this page).</p>')
    : `
<table>
<caption>Domains ranked by accessibility score (best first). Trajectory compares the score against ~4 weeks ago. Counts are medians per page over the last 7 days, comparable across sites of any size.</caption>
<thead><tr><th scope="col">Domain</th><th scope="col" class="num">Score</th><th scope="col">Trajectory</th><th scope="col" class="num">Pages audited (7d)</th><th scope="col" class="num">Median axe / page</th><th scope="col" class="num">Median Alfa / page</th><th scope="col">Trend</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<p class="score-caveat">Scores are a relative, automated signal based on axe violations per page (axe runs on every page; Alfa is sampled and reported separately). Automated testing finds only ~⅓ of barriers — use scores to compare and track direction, not as a pass/fail.</p>
${overlay}
${sustainTrend}
${worstSection}
${techFindingsSection}
${lighthouseFleetSection}
${blockedCallout}`}
<section aria-labelledby="h-why">
${heading('h-why', `Why this exists`)}
<p>Continuous measurement beats one-off audits. This ledger tracks whether each site is getting more
accessible and lighter over time, using <a href="https://github.com/dequelabs/axe-core">axe-core</a> and
<a href="https://github.com/Siteimprove/alfa">Alfa</a> (the open source engine behind Siteimprove) for
accessibility, and page weight with <a href="https://sustainablewebdesign.org/">Sustainable Web Design</a>
CO₂ estimates for sustainability. Everything here is open: the scanner, the data, and the reports.</p>
</section>`;
  return layout({ title: pageTitle, breadcrumb: '', body, depth: 0 });
}

export function writeAsset(docsDir) {
  fs.writeFileSync(path.join(docsDir, 'style.css'), CSS);
  // Serve the vendored ParaCharts runtime first-party (AGPL-3.0). Charts are
  // progressively enhanced: the static SVG + table render without it; this
  // bundle is lazy-imported only on report pages to upgrade them. Copied as a
  // build artifact (never committed to docs/), like style.css.
  const vendorBundle = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../vendor/paracharts/paracharts.js');
  if (fs.existsSync(vendorBundle)) {
    fs.copyFileSync(vendorBundle, path.join(docsDir, 'paracharts.js'));
  }
}

const CSS = `/* vital-scans ledger. System fonts only; ~2 KB; honors user color scheme. */
:root {
  --ink: #1c2326; --paper: #fbfaf7; --accent: #00585c; --rule: #c9c4b8;
  --better: #1d5c2f; --worse: #8c2f1b; --muted: #5a6166;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --ink: #e8e6e1; --paper: #14181a; --accent: #6fd2d6; --rule: #3a4145;
          --better: #8fd6a0; --worse: #f0a48d; --muted: #9aa3a8; }
}
/* Manual overrides (mirror the values above) win over the OS preference. */
:root[data-theme="light"] { --ink: #1c2326; --paper: #fbfaf7; --accent: #00585c; --rule: #c9c4b8;
          --better: #1d5c2f; --worse: #8c2f1b; --muted: #5a6166; }
:root[data-theme="dark"] { --ink: #e8e6e1; --paper: #14181a; --accent: #6fd2d6; --rule: #3a4145;
          --better: #8fd6a0; --worse: #f0a48d; --muted: #9aa3a8; }
* { box-sizing: border-box; }
.theme-toggle { display: inline-flex; align-items: center; gap: .35rem; margin-top: .5rem;
  background: transparent; color: var(--ink); border: 1px solid var(--rule); border-radius: 4px;
  padding: .3rem .6rem; font: inherit; font-size: .85rem; cursor: pointer; }
.theme-toggle:hover { border-color: var(--accent); }
.theme-toggle:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.theme-toggle .icon-sun { display: none; }
.theme-toggle .icon-moon { display: inline; }
:root[data-theme="dark"] .theme-toggle .icon-sun,
.theme-toggle[aria-pressed="true"] .icon-sun { display: inline; }
:root[data-theme="dark"] .theme-toggle .icon-moon,
.theme-toggle[aria-pressed="true"] .icon-moon { display: none; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .theme-toggle .icon-sun { display: inline; }
  :root:not([data-theme="light"]) .theme-toggle .icon-moon { display: none; }
}
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
h2 { font-size: 1.2rem; border-bottom: 1px solid var(--rule); padding-bottom: .2rem; margin-top: 2.5rem; scroll-margin-top: 1rem; }
/* Shareable heading anchor: a "#" that appears on hover/focus. The glyph
   is a CSS ::before so it is never part of the heading's copyable text. */
.anchor { float: left; margin-left: -1.1em; padding-right: .3em; color: var(--rule);
  text-decoration: none; opacity: 0; transition: opacity .1s, color .1s; }
.anchor::before { content: "#"; }
h2:hover .anchor, h2:focus-within .anchor, .anchor:focus { opacity: 1; color: var(--accent); }
@media (max-width: 40rem) { .anchor { float: none; margin-left: 0; } }
/* Long URLs: truncate with ellipsis, full URL on hover/focus (title);
   the text stays fully selectable so it copies in full. */
.url { display: inline-block; max-width: 28rem; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; vertical-align: bottom; }
td .url, th .url { max-width: 22rem; }
.subnav ul { list-style: none; display: flex; flex-wrap: wrap; gap: .25rem 1rem; padding: 0; margin: .25rem 0 1rem; font-size: .95rem; }
.subnav li[aria-current="page"] { font-weight: 700; }
.sort-btn { background: none; border: 0; padding: 0; margin: 0; font: inherit; color: inherit;
  text-transform: inherit; letter-spacing: inherit; cursor: pointer; }
.sort-btn:hover, .sort-btn:focus-visible { color: var(--accent); }
.sort-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.meta, .note { color: var(--muted); }
.note { border-left: 4px solid var(--rule); padding-left: .75rem; }
.callout-blocked { border-left: 4px solid var(--worse); padding: .25rem 1rem;
  background: color-mix(in srgb, var(--worse) 8%, transparent); border-radius: 2px; }
.callout-blocked h2 { color: var(--worse); border-bottom: none; margin-top: .75rem; }
.callout-blocked ul { margin: .5rem 0; }
.blocked-accordion { margin-top: 2rem; border-top: 1px solid var(--rule); padding-top: .5rem; }
.blocked-accordion > summary { cursor: pointer; color: var(--muted); font-weight: 600; }
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
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
th.num button { width: 100%; text-align: right; }
tbody th[scope="row"] { font-weight: 600; }
.spark { color: var(--accent); vertical-align: middle; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap; }
footer { margin-top: 3rem; border-top: 3px double var(--rule); padding-top: 1rem;
  font-size: .85rem; color: var(--muted); }
.scorecard { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem 1rem;
  border: 1px solid var(--rule); border-left: 5px solid var(--accent); border-radius: 4px;
  padding: .8rem 1rem; margin: 1rem 0; }
.scorecard .grade { font-size: 2rem; font-weight: 700; line-height: 1;
  padding: .1rem .5rem; border-radius: 4px; border: 2px solid currentColor; }
.grade-A { color: var(--better); } .grade-B { color: var(--better); }
.grade-C { color: var(--muted); } .grade-D { color: var(--worse); } .grade-F { color: var(--worse); }
.scorecard .score { font-size: 1.6rem; font-variant-numeric: tabular-nums; }
.scorecard .score-max { font-size: .9rem; color: var(--muted); }
.scorecard .band { font-size: 1rem; color: var(--muted); margin-left: .25rem; }
.scorecard .score-detail { flex: 1 1 16rem; }
.scorecard .score-caveat, p.score-caveat { color: var(--muted); font-size: .85rem; flex-basis: 100%; }
.traj { white-space: nowrap; font-size: .9rem; }
.traj-improving { color: var(--better); } .traj-worsening { color: var(--worse); } .traj-stable { color: var(--muted); }
.chart { margin: 1.25rem 0; }
.chart figcaption { color: var(--muted); font-size: .9rem; margin-bottom: .25rem; }
.linechart { width: 100%; height: auto; color: var(--accent); }
.linechart .axis { fill: var(--muted); font-size: 11px; }
.checklist { list-style: none; padding: 0; margin: .5rem 0; }
.checklist li { padding: .2rem 0; }
.checklist .check { display: inline-block; width: 1.2em; font-weight: 700; }
.checklist li.pass .check { color: var(--better); }
.checklist li.fail .check { color: var(--worse); }
@media (prefers-reduced-motion: no-preference) { a { transition: color .15s; } }
.bug-filter { margin: .75rem 0 1rem; padding: .75rem .9rem; border: 1px solid var(--rule);
  border-radius: 2px; background: color-mix(in srgb, var(--accent) 5%, transparent); }
.bug-filter-row { display: flex; flex-wrap: wrap; gap: .75rem 1.25rem; align-items: end; }
.bug-filter label { display: flex; flex-direction: column; gap: .2rem; font-size: .85rem; font-weight: 600; }
.bug-filter-check { flex-direction: row; align-items: center; gap: .4rem; }
.bug-filter select { font: inherit; padding: .25rem .4rem; min-width: 12rem; }
.bug-filter button { font: inherit; padding: .3rem .7rem; cursor: pointer; }
.bug-filter-count { margin: .6rem 0 0; font-size: .85rem; color: var(--muted); }
.bug-filter-empty { padding: .9rem; border: 1px dashed var(--rule); border-radius: 2px; color: var(--muted); }
.bug { border: 1px solid var(--rule); border-left-width: 4px; border-radius: 2px;
  margin: .6rem 0; padding: 0 .9rem; }
.bug > summary { cursor: pointer; padding: .6rem 0; font-weight: 600; }
.bug[open] > summary { border-bottom: 1px solid var(--rule); margin-bottom: .6rem; }
.engine-findings > summary { cursor: pointer; font-weight: 600; padding: .4rem 0; }
.bug.sev-critical { border-left-color: var(--worse); }
.bug.sev-serious { border-left-color: var(--worse); }
.bug.sev-moderate { border-left-color: var(--accent); }
.bug.sev-minor { border-left-color: var(--muted); }
.sev-badge { display: inline-block; font-size: .75rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: .05em; padding: 0 .4rem; border: 1px solid currentColor; border-radius: 2px;
  vertical-align: middle; margin-right: .4rem; }
.sev-critical .sev-badge, .sev-serious .sev-badge { color: var(--worse); }
.sev-moderate .sev-badge { color: var(--accent); }
.sev-minor .sev-badge { color: var(--muted); }
.wcag-badge { display: inline-block; font-size: .72rem; font-weight: 600; padding: 0 .4rem;
  border-radius: 2px; vertical-align: middle; margin-right: .35rem;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); }
.wcag-badge[data-cat="best-practice"] { background: color-mix(in srgb, var(--muted) 12%, transparent);
  color: var(--muted); border-color: color-mix(in srgb, var(--muted) 35%, transparent); }
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
.error { color: var(--worse); font-weight: 600; }
`;
