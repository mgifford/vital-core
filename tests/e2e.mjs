#!/usr/bin/env node
/**
 * End-to-end test of the whole pipeline against a local fixture site:
 *
 *   1. Generate a 24-page site with known violations + sitemap + robots.
 *   2. "Week 1": scan with a small budget across two runs (verifies
 *      incremental coverage), then aggregate.
 *   3. Fix some violations in the fixtures.
 *   4. "Week 2": scan again, aggregate, and assert the week-over-week
 *      diff reports improvements.
 *
 * Run with: npm run test:e2e
 * Uses VITAL_WEEK to pin ISO weeks deterministically and a throwaway
 * config/state/data sandbox so it never touches real data.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SANDBOX = path.join(ROOT, '.e2e-sandbox');
const SITE = path.join(SANDBOX, 'site');
const PORT = 8123;

// --- 0. Sandbox: run scan/aggregate from a copy so real config/state/data stay untouched.
fs.rmSync(SANDBOX, { recursive: true, force: true });
fs.mkdirSync(SITE, { recursive: true });
for (const d of ['src', 'node_modules', 'package.json']) {
  fs.cpSync(path.join(ROOT, d), path.join(SANDBOX, d), { recursive: true });
}
fs.mkdirSync(path.join(SANDBOX, 'config'));
// Copy the real config data files the engines/reports read (remediation
// tips, spelling allowlist) so the sandbox exercises them too. targets.yml
// is written below with test-specific values.
for (const f of ['remediation-tips.json', 'spelling-allowlist.txt']) {
  const src = path.join(ROOT, 'config', f);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(SANDBOX, 'config', f));
}
fs.writeFileSync(
  path.join(SANDBOX, 'config', 'targets.yml'),
  `defaults:
  pages_per_run: 100
  max_pages_per_week: 1000
  delay_ms: 50
  nav_timeout_ms: 15000
  settle_delay_ms: 100
  max_crawl_depth: 4
  retention_weeks: 8
  user_agent: "vital-scans-e2e/0.1 (+local test)"
sampling:
  axe: 100
  alfa: 100
  plain-language: 100
  deprecated-html: 100
  resources: 100
  link-check: 100
  sustainability: 100
targets:
  - domain: localhost
    importance: 3
    priority_urls:
      - http://localhost:${PORT}/page-20.html
`
);

// --- 1. Fixture site -------------------------------------------------
const PAGES = 24;
function writeSite({ fixed }) {
  const nav = Array.from({ length: PAGES }, (_, i) => `<li><a href="/page-${i + 1}.html">Page ${i + 1}</a></li>`).join('');
  for (let i = 1; i <= PAGES; i++) {
    const broken = !fixed && i % 3 === 0; // pages 3,6,9,... have violations in week 1
    fs.writeFileSync(
      path.join(SITE, `page-${i}.html`),
      `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Page ${i}</title></head>
<body><main><h1>Page ${i}</h1>
${broken ? '<img src="/pixel.png"><input type="text"><p style="color:#aaa;background:#fff">low contrast</p>' : `<img src="/pixel.png" alt="A test pixel"><label>Search <input type="text"></label><p>Readable text.</p>`}
<p>This is a short paragraph of ordinary readable prose written so the plain language engine has real sentences to score. It deliberately contains one mispelled word for the spell check to catch, and enough words to count as content rather than navigation.</p>
<p><a href="/files/report-${i}.pdf">Annual report (PDF)</a></p>
${fixed && i === 1 ? '<p><a href="/files/brand-new-week2.pdf">Newly added PDF</a></p>' : ''}
<iframe src="https://www.youtube.com/embed/abc${i}" title="Embedded video ${i}"></iframe>
<nav aria-label="All pages"><ul>${nav}</ul></nav></main></body></html>`
    );
  }
  fs.writeFileSync(
    path.join(SITE, 'index.html'),
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Fixture home</title></head>
<body><main><h1>Fixture</h1><ul>${nav}</ul>
<p><a href="/does-not-exist-404.html">A deliberately broken link</a></p></main></body></html>`
  );
  // 1x1 png
  fs.writeFileSync(path.join(SITE, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  fs.writeFileSync(path.join(SITE, 'robots.txt'), `User-agent: *\nDisallow: /private/\n`);
  fs.writeFileSync(
    path.join(SITE, 'sitemap.xml'),
    `<?xml version="1.0"?><urlset>` +
      Array.from({ length: 10 }, (_, i) => `<url><loc>http://localhost:${PORT}/page-${i + 1}.html</loc></url>`).join('') +
      `</urlset>`
  );
  fs.mkdirSync(path.join(SITE, 'private'), { recursive: true });
  fs.writeFileSync(path.join(SITE, 'private', 'secret.html'), '<!DOCTYPE html><html><body>robots should block this</body></html>');
}

const serverScript = path.join(SANDBOX, 'server.mjs');
fs.writeFileSync(
  serverScript,
  `import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const SITE = ${JSON.stringify(SITE)};
http.createServer((req, res) => {
  const reqPath = req.url.split('?')[0];
  const f = path.join(SITE, reqPath === '/' ? 'index.html' : reqPath);
  if (fs.existsSync(f) && fs.statSync(f).isFile()) {
    res.setHeader('content-type', f.endsWith('.png') ? 'image/png' : f.endsWith('.xml') ? 'application/xml' : f.endsWith('.txt') ? 'text/plain' : 'text/html');
    res.end(fs.readFileSync(f));
  } else {
    res.statusCode = 404; res.setHeader('content-type', 'text/html');
    res.end('<!DOCTYPE html><html lang="en"><head><title>404</title></head><body><h1>404</h1></body></html>');
  }
}).listen(${PORT}, () => console.log('ready'));
`
);
// The server must be a separate process: execFileSync blocks this
// process's event loop, so an in-process server would never respond.
const { spawn } = await import('node:child_process');
const server = spawn('node', [serverScript], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => d.toString().includes('ready') && resolve());
  server.on('exit', () => reject(new Error('fixture server died')));
  setTimeout(() => reject(new Error('fixture server start timeout')), 5000);
});

const run = (script, args, week) =>
  execFileSync('node', [script, ...args], {
    cwd: SANDBOX,
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, VITAL_WEEK: week },
  }).toString();

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`\u2717 FAIL: ${msg}`);
    server.kill();
    process.exit(1);
  }
  console.log(`\u2713 ${msg}`);
};

try {
  // --- 2. Week 1: two runs with budget 10 ----------------------------
  writeSite({ fixed: false });
  run('src/scan.js', ['--domain', 'localhost', '--budget', '10', '--base-url', `http://localhost:${PORT}`], '2026-W23');
  run('src/scan.js', ['--domain', 'localhost', '--budget', '40', '--base-url', `http://localhost:${PORT}`], '2026-W23');
  run('src/aggregate.js', [], '2026-W23');

  const w1 = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'data', 'localhost', '2026-W23', 'summary.json')));
  assert(w1.pagesScanned >= PAGES, `week 1 covered all ${PAGES}+ pages across two runs (got ${w1.pagesScanned})`);
  assert(w1.axe.violationTotal > 0, `week 1 found axe violations (${w1.axe.violationTotal})`);
  assert(w1.alfa.failedTotal > 0, `week 1 found Alfa failures (${w1.alfa.failedTotal})`);
  assert('image-alt' in w1.axe.rules, 'image-alt rule recorded');
  assert(w1.sustainability && w1.sustainability.medianBytes > 0, 'sustainability metrics recorded');
  assert(w1.sustainability.meanEnergyWh > 0 && w1.sustainability.meanCo2g > 0, 'both energy (Wh) and CO2 (g) recorded');
  // Energy and CO2 are linked by grid intensity (~494 g/kWh in the SWD model).
  const gPerKWh = w1.sustainability.meanCo2g / (w1.sustainability.meanEnergyWh / 1000);
  assert(gPerKWh > 100 && gPerKWh < 1000, `energy/CO2 ratio is a plausible grid intensity (got ${gPerKWh.toFixed(0)} g/kWh)`);
  // Plain language: words-per-page (nav excluded) and spelling.
  assert(w1.plainLanguage.medianWordsPerPage > 0, 'median words per page recorded (main content)');
  const misspelled = w1.plainLanguage.topMisspellings.map((m) => m.word);
  assert(misspelled.includes('mispelled'), `spell check caught the deliberate misspelling (got ${misspelled.join(', ')})`);
  assert(typeof w1.pagesAudited === 'number' && w1.pagesAudited > 0 && w1.pagesAudited <= w1.pagesScanned, 'unique pages audited recorded and bounded by pages scanned');
  assert(typeof w1.axe.medianViolations === 'number', 'median axe violations per page recorded');
  assert(typeof w1.alfa.medianFailures === 'number', 'median Alfa failures per page recorded');
  // axe rate is 100%, so it ran on every auditable (200-HTML) page; that
  // equals pagesAudited, which excludes error pages like the 404.
  assert(w1.coverage && w1.coverage.axe === w1.pagesAudited, 'per-engine coverage recorded (axe 100% of auditable pages)');
  // CSV exports of affected pages.
  const csvDir = path.join(SANDBOX, 'docs', 'reports', 'localhost', '2026-W23', 'csv');
  assert(fs.existsSync(path.join(csvDir, 'axe-pages-with-violations.csv')), 'axe pages-with-violations CSV written');
  const imageAltCsv = path.join(csvDir, 'axe-core__image-alt.csv');
  assert(fs.existsSync(imageAltCsv), 'per-rule CSV written for image-alt');
  const csvBody = fs.readFileSync(imageAltCsv, 'utf8');
  assert(csvBody.startsWith('url,instances'), 'CSV has a header row');
  assert(csvBody.split('\n').filter(Boolean).length - 1 === w1.axe.rules['image-alt'].pages, 'CSV lists every affected page');
  // Impact in the bug report: image-alt -> WCAG 1.1.1 -> vision groups.
  const bugs1 = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'docs', 'reports', 'localhost', '2026-W23', 'bugs.json')));
  const imgAltBug = bugs1.reports.find((r) => r.rule_id === 'image-alt');
  assert(imgAltBug.impact.groups.some((g) => /vision/i.test(g.group)), 'image-alt bug shows vision-impact groups');
  assert(imgAltBug.affected_pages_csv && imgAltBug.affected_pages_csv.endsWith('.csv'), 'bug report links its affected-pages CSV');
  assert(imgAltBug.remediation_tip && /alt/i.test(imgAltBug.remediation_tip), 'bug report carries a remediation tip');
  // Cross-engine consensus: unique issues are not the naive axe+alfa sum.
  assert(w1.consensus && w1.consensus.uniqueIssues > 0, 'consensus computed');
  assert(w1.consensus.uniqueIssues <= w1.consensus.rawAxe + w1.consensus.rawAlfa, 'unique issues never exceed the raw engine sum');
  assert(w1.consensus.consensus > 0, 'at least one issue caught by BOTH engines (image-alt / sia-r2)');
  // Resource catalog: PDFs and embedded media found and inventoried.
  assert(w1.resources && w1.resources.total > 0, 'resources cataloged');
  assert(w1.resources.byType.pdf > 0, 'PDF links cataloged');
  assert(w1.resources.byType['embedded-media'] > 0, 'embedded media (YouTube iframe) cataloged');
  assert(fs.existsSync(path.join(SANDBOX, 'docs', 'reports', 'localhost', '2026-W23', 'resources.csv')), 'resources CSV written');
  // Resource ledger first-seen; in week 1 everything is new this week.
  const resLedger1 = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'data', 'localhost', 'resources.json')));
  const anyRes = Object.values(resLedger1.resources)[0];
  assert(anyRes && anyRes.firstSeen === '2026-W23', 'resource ledger tracks first-seen');
  // Findings ledger written with first/last-seen for this week.
  const ledger1 = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'data', 'localhost', 'findings.json')));
  const anyFinding = Object.values(ledger1.findings)[0];
  assert(anyFinding && anyFinding.firstSeen === '2026-W23' && anyFinding.lastSeen === '2026-W23', 'findings ledger tracks first/last-seen');
  assert(w1.linkCheck && w1.linkCheck.brokenCount >= 1, `link check found the broken link (${w1.linkCheck?.brokenCount ?? 0})`);
  const brokenLink = w1.linkCheck.broken.find((b) => b.url.includes('does-not-exist-404'));
  assert(brokenLink, 'the deliberately broken link is reported');
  // The broken link is traced back to the page(s) that link to it.
  assert(
    Array.isArray(brokenLink.foundOn) && brokenLink.foundOn.some((u) => u.endsWith('/') || u.includes('index')),
    `broken link records its source page(s) (got ${JSON.stringify(brokenLink.foundOn)})`
  );
  // Plain-language ran on every page; the fixture pages are link-heavy so
  // few will have enough prose to score, but the engine must have run and
  // recorded data on the page records.
  const sampleRec = JSON.parse(
    fs.readFileSync(path.join(SANDBOX, 'data', 'localhost', '2026-W23', 'pages', fs.readdirSync(path.join(SANDBOX, 'data', 'localhost', '2026-W23', 'pages'))[0]))
  );
  assert(sampleRec.plainLanguage && typeof sampleRec.plainLanguage.wordCount === 'number', 'plain-language engine ran and recorded data');

  const state = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'state', 'localhost', 'crawl.json')));
  assert(!Object.values(state.pages).some((p) => p.url.includes('/private/')), 'robots.txt disallow respected');

  // Priority URL handling: page-20 was configured as a priority URL and is
  // marked priority in state, and was scanned in the FIRST run (budget 10)
  // even though it would otherwise be deep in the queue.
  const prio = Object.values(state.pages).find((p) => p.url.includes('/page-20.html'));
  assert(prio && prio.priority === true, 'configured priority URL is flagged in state');
  const runsDir = path.join(SANDBOX, 'data', 'localhost', '2026-W23', 'runs');
  const runFiles = fs.readdirSync(runsDir).filter((f) => /T.*Z.*\.json$/.test(f)).sort();
  const firstRun = JSON.parse(fs.readFileSync(path.join(runsDir, runFiles[0])));
  const prioId = Object.keys(state.pages).find((id) => state.pages[id].url.includes('/page-20.html'));
  assert(firstRun.scanned.includes(prioId), 'priority URL scanned in the first run (budget 10), not deferred');
  assert(runFiles.length === 2, 'two run logs recorded for week 1');

  // --- 3. Week 2: violations fixed ------------------------------------
  writeSite({ fixed: true });
  run('src/scan.js', ['--domain', 'localhost', '--budget', '100', '--base-url', `http://localhost:${PORT}`], '2026-W24');
  run('src/aggregate.js', [], '2026-W24');

  const weekly = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'docs', 'data', 'localhost', 'weekly.json')));
  assert(weekly.series.length === 2, 'trend series has two weeks');
  const w2 = weekly.series[1];
  const diff = weekly.diffs['2026-W24'];
  assert(w2.axe.violationTotal < w1.axe.violationTotal, `week 2 axe violations dropped (${w1.axe.violationTotal} -> ${w2.axe.violationTotal})`);
  assert(diff.axe.violationDelta < 0, 'diff reports axe improvement');
  assert(diff.axe.resolved.includes('image-alt'), 'image-alt reported as resolved');

  // Findings ledger: image-alt was seen in W23 but not W24 (fixed), so its
  // lastSeen stays W23; a finding present both weeks spans W23->W24.
  const ledger2 = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'data', 'localhost', 'findings.json')));
  const imageAlt = Object.values(ledger2.findings).find((f) => f.ruleId === 'image-alt');
  assert(imageAlt && imageAlt.firstSeen === '2026-W23' && imageAlt.lastSeen === '2026-W23', 'resolved finding keeps its last-seen week');

  // Resource ledger: the week-2-only PDF is flagged firstSeen W24; the
  // week-1 PDFs are not new in week 2.
  const resLedger2 = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'data', 'localhost', 'resources.json')));
  const newPdf = Object.entries(resLedger2.resources).find(([url]) => url.includes('brand-new-week2.pdf'));
  assert(newPdf && newPdf[1].firstSeen === '2026-W24', 'newly added PDF is first-seen in week 2');
  const oldPdf = Object.entries(resLedger2.resources).find(([url]) => url.includes('report-1.pdf'));
  assert(oldPdf && oldPdf[1].firstSeen === '2026-W23', 'week-1 PDF keeps its earlier first-seen');
  const w2summary = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'data', 'localhost', '2026-W24', 'summary.json')));
  // (summary.json omits newThisWeek; verify via the ledger above. The
  // report's "New this week" list is driven by the same firstSeen check.)
  assert(w2summary.resources.total > 0, 'week 2 resources cataloged');

  // --- 4. Reports ------------------------------------------------------
  const reportPath = path.join(SANDBOX, 'docs', 'reports', 'localhost', '2026-W24', 'index.html');
  const report = fs.readFileSync(reportPath, 'utf8');
  assert(report.includes('Changes since 2026-W23'), 'report includes week-over-week section');
  assert(report.includes('lang="en"') && report.includes('Skip to content'), 'report has basic accessibility scaffolding');
  // Theme toggle: action-describing aria-label, sun+moon icons, no-flash script.
  assert(report.includes('id="theme-toggle"') && /aria-label="Switch to (dark|light) mode"/.test(report), 'theme toggle present with action label');
  assert(report.includes('icon-sun') && report.includes('icon-moon'), 'toggle has sun and moon icons');
  assert(report.includes("data-theme") && report.includes('vital-theme'), 'no-flash theme script + persistence present');
  assert(fs.existsSync(path.join(SANDBOX, 'docs', 'index.html')), 'dashboard generated');
  assert(fs.existsSync(path.join(SANDBOX, 'docs', 'style.css')), 'stylesheet generated');
  // Scorecard + trends on the domain report.
  assert(/class="scorecard"/.test(report) && /class="grade grade-[A-F]"/.test(report), 'domain report shows a score + grade');
  assert(report.includes('id="h-trends"') && report.includes('class="linechart"'), 'domain report shows multi-week trend charts');
  // Rolling inventory committed and surfaced.
  const inv = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'data', 'localhost', 'inventory.json')));
  assert(Object.keys(inv.pages).length >= PAGES, `inventory tracks all known pages (${Object.keys(inv.pages).length})`);
  assert(/pages known on this site/.test(report), 'report cites total known pages from inventory');
  // Dashboard: leaderboard score + trajectory + cross-domain chart.
  const dash = fs.readFileSync(path.join(SANDBOX, 'docs', 'index.html'), 'utf8');
  assert(/<th scope="col">Score<\/th>/.test(dash) && /class="grade grade-[A-F]"/.test(dash), 'dashboard leaderboard shows scores');
  assert(/class="traj traj-/.test(dash), 'dashboard shows trajectory arrows');
  assert(dash.includes('all domains') && dash.includes('linechart'), 'dashboard has cross-domain overlay chart');

  const comment = run('src/issue-comment.js', [], '2026-W24');
  assert(comment.includes('localhost: 2026-W24') && comment.includes('Median axe violations'), 'issue comment generated with deltas');

  console.log('\nAll end-to-end checks passed.');
} finally {
  server.kill();
}
