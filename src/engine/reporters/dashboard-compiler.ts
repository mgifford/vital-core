import * as fs from 'fs';
import * as path from 'path';
import { TargetScanResult } from '../../types/site-quality-spec';
import { QualityIndexReporter, TargetQualityIndexEntry } from './quality-index';
import { DiscoveryNonHtmlExclusion } from '../discovery';

export class DashboardCompiler {
  private static DIST_DIR = path.resolve(process.cwd(), 'dist');
  private static ASSETS_DIR = path.join(this.DIST_DIR, 'assets');

  /**
   * Compiles global scan runs into an interactive, flat HTML single-page app
   */
  public static compileStaticDashboard(
    allResults: TargetScanResult[],
    options: { nonHtmlDiscoveryExclusions?: DiscoveryNonHtmlExclusion[] } = {}
  ): void {
    if (!fs.existsSync(this.DIST_DIR)) {
      fs.mkdirSync(this.DIST_DIR, { recursive: true });
    }

    if (!fs.existsSync(this.ASSETS_DIR)) {
      fs.mkdirSync(this.ASSETS_DIR, { recursive: true });
    }

    const jsonPayload = JSON.stringify(allResults)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

    const targetQualityIndex = QualityIndexReporter.buildTargetQualityIndex(allResults);

    const targetQualityPayload = JSON.stringify(targetQualityIndex)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

    const siteFooterHtml = this.buildSiteFooterHtml();

    fs.writeFileSync(path.join(this.ASSETS_DIR, 'dashboard.css'), this.buildDashboardCss(), 'utf8');
    fs.writeFileSync(path.join(this.ASSETS_DIR, 'dashboard.js'), this.buildDashboardJs(), 'utf8');

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VITAL-Core System Compliance Dashboard</title>
  <link rel="stylesheet" href="assets/dashboard.css">
</head>
<body>
  <header>
    <div class="header-main">
      <h1>🩺 VITAL-Core // Federal Quality &amp; Accessibility Registry</h1>
      <nav class="quick-domain-nav" aria-label="Quick domain navigation">
        <label for="domain-page-select">Jump to domain page</label>
        <select id="domain-page-select">
          <option value="">Select domain report page...</option>
        </select>
      </nav>
    </div>
    <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Switch to dark mode">
      <svg class="theme-icon theme-icon-moon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      <svg class="theme-icon theme-icon-sun" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
  </header>
  <main>
    <div id="live-scan-status" class="card" aria-live="polite">
      <h2 id="live-scan-ticker" tabindex="-1">Live Scan Ticker</h2>
      <p id="live-scan-primary">Checking scan status...</p>
      <p id="live-scan-secondary" class="muted-small"></p>
    </div>
    <div id="summary" class="metric-grid"></div>
    <div id="trend-summary" class="metric-grid"></div>
    <nav class="card section-links" aria-label="In-page section navigation">
      <h2 id="jump-links" tabindex="-1">Jump To Sections</h2>
      <p>
        <a href="#pages-scanned-latest-run">Pages Scanned (Latest Run)</a>
        &nbsp;|&nbsp;
        <a href="#detected-software-latest-run">Detected Software (Latest Run)</a>
        &nbsp;|&nbsp;
        <a href="#run-history">Run History</a>
        &nbsp;|&nbsp;
        <a href="#blocked-system-issues">Blocked System Issues</a>
        &nbsp;|&nbsp;
        <a href="#domain-ongoing-reports">Domain Ongoing Reports</a>
      </p>
    </nav>
    <div class="card" id="blocked-issues">
      <h2 id="blocked-system-issues" tabindex="-1">Blocked System Issues (Latest Run)</h2>
      <p class="muted-small">Pages that were blocked, timed out, or failed to scan. See the failures view for the full audit trail.</p>
      <p><a href="failures/index.html">Open failures and skips view</a></p>
      <table id="blocked-issues-table">
        <caption>Blocked, timeout, and failed pages with reasons from the latest run.</caption>
        <thead>
          <tr>
            <th scope="col">Domain</th>
            <th scope="col">URL</th>
            <th scope="col">Status</th>
            <th scope="col">Reason</th>
            <th scope="col">Timestamp</th>
          </tr>
        </thead>
        <tbody id="blocked-issues-body"></tbody>
      </table>
    </div>
    <div class="card">
      <h2 id="run-data-exports" tabindex="-1">Run Data Exports</h2>
      <p>
        <a href="runs/latest.json">Latest Full Run JSON</a>
        &nbsp;|&nbsp;
        <a href="runs/index.json">Historical Run Index JSON</a>
        &nbsp;|&nbsp;
        <a href="runs/trends.json">Trend Summary JSON</a>
        &nbsp;|&nbsp;
        <a href="runs/domain-ongoing.json">Domain Ongoing Reports JSON</a>
        &nbsp;|&nbsp;
        <a href="runs/top-task-seeds.json">Domain Size Estimate JSON</a>
        &nbsp;|&nbsp;
        <a href="runs/software-by-domain.json">Software by Domain JSON</a>
        &nbsp;|&nbsp;
        <a href="api/index.json">API Endpoint Manifest JSON</a>
        &nbsp;|&nbsp;
        <a href="failures/index.html">Failures &amp; Skips View</a>
        &nbsp;|&nbsp;
        <a href="#run-history">Jump to Run History</a>
      </p>
    </div>
    <div class="card">
      <h2 id="pages-scanned-latest-run" tabindex="-1">Pages Scanned (Latest Run)</h2>
      <p id="pages-status-summary" class="muted-small">Loading latest page status summary...</p>
      <details id="pages-status-guide" class="status-guide">
        <summary>Status guide and latest run breakdown</summary>
        <p><strong>COMPLETED</strong> means the page was fetched and audited in this run.</p>
        <p><strong>SKIPPED_UNCHANGED</strong> means the page was recently scanned and unchanged, so the scanner reused prior evidence to save time and budget.</p>
        <ul id="pages-status-breakdown" class="status-breakdown"></ul>
      </details>
      <details id="pages-results-table" open>
        <summary>Show page-level results table</summary>
        <table id="pages-table">
          <caption>Latest run page-level scan results by domain, URL, and status.</caption>
          <thead>
            <tr>
              <th scope="col">Domain</th>
              <th scope="col">URL</th>
              <th scope="col">Status</th>
              <th scope="col">Violations</th>
              <th scope="col">Scanned At</th>
            </tr>
          </thead>
          <tbody id="pages-body"></tbody>
        </table>
      </details>
    </div>
    <div class="card" id="software-detections">
      <h2 id="detected-software-latest-run" tabindex="-1">Detected Software (Latest Run)</h2>
      <table id="software-table">
        <caption>Technology detected in the latest run, aggregated by domain.</caption>
        <thead>
          <tr>
            <th scope="col">Domain</th>
            <th scope="col">Technologies Detected</th>
            <th scope="col">Categories</th>
            <th scope="col">Versions</th>
          </tr>
        </thead>
        <tbody id="software-body"></tbody>
      </table>
    </div>
    <div class="card">
      <h2 id="domains-leaderboard" tabindex="-1">Domains Leaderboard</h2>
      <table id="target-table">
        <thead>
          <tr>
            <th>Domains</th>
            <th>Pages / Estimated Size</th>
            <th>Score</th>
            <th>Recommendations</th>
          </tr>
        </thead>
        <tbody id="target-body"></tbody>
      </table>
      <p class="legend-note">
        Lighthouse thresholds used for color cues: Perf (green ≥ 90, amber 70-89, red &lt; 70),
        FCP (green ≤ 1800ms, amber 1801-3000ms, red &gt; 3000ms),
        LCP (green ≤ 2500ms, amber 2501-4000ms, red &gt; 4000ms),
        SI (green ≤ 3400ms, amber 3401-5800ms, red &gt; 5800ms).
      </p>
    </div>
    <div class="card" id="run-history">
      <h2 id="run-history-heading" tabindex="-1">Run History</h2>
      <table id="history-table">
        <thead>
          <tr>
            <th>Run Timestamp</th>
            <th>Pages</th>
            <th>Violations</th>
            <th>Duration</th>
            <th>Data</th>
          </tr>
        </thead>
        <tbody id="history-body"></tbody>
      </table>
    </div>
    <div class="card">
      <h2 id="requirement-compliance-over-time" tabindex="-1">Requirement Compliance Over Time</h2>
      <svg id="compliance-chart" class="compliance-chart" viewBox="0 0 900 260" role="img" aria-label="Requirement compliance percentages across recent runs"></svg>
      <p id="compliance-caption" class="muted-small">Compliance percentages by requirement across recent runs. Legal baseline and target levels are shown separately.</p>
      <p class="muted-tiny">Manual testing remains a primary release criterion; automated metrics are indicators, not substitutes for keyboard and assistive-technology validation.</p>
    </div>
    <div class="card">
      <h2 id="domain-ongoing-reports" tabindex="-1">Domain Ongoing Reports</h2>
      <table id="ongoing-table">
        <thead>
          <tr>
            <th>Domain</th>
            <th>Period</th>
            <th>Quality Indicators</th>
            <th>Suggested Improvements</th>
            <th>Pages Needing Most Improvement</th>
          </tr>
        </thead>
        <tbody id="ongoing-body"></tbody>
      </table>
      <p class="legend-note">
        Lighthouse thresholds used for color cues: Perf (green ≥ 90, amber 70-89, red &lt; 70),
        FCP (green ≤ 1800ms, amber 1801-3000ms, red &gt; 3000ms),
        LCP (green ≤ 2500ms, amber 2501-4000ms, red &gt; 4000ms),
        SI (green ≤ 3400ms, amber 3401-5800ms, red &gt; 5800ms).
      </p>
    </div>
  </main>
${siteFooterHtml}
  <script id="vital-dashboard-data" type="application/json">${jsonPayload}</script>
  <script id="vital-dashboard-target-quality" type="application/json">${targetQualityPayload}</script>
  <script defer src="assets/dashboard.js"></script>
</body>
</html>`;

    fs.writeFileSync(path.join(this.DIST_DIR, 'index.html'), htmlContent, 'utf8');
    this.writeFailuresPage(allResults, options.nonHtmlDiscoveryExclusions ?? []);
    this.writeDomainSubpages(allResults, targetQualityIndex);
    console.log(`📊 Static dashboard assets successfully compiled to dist/index.html`);
  }

  private static writeFailuresPage(allResults: TargetScanResult[], discoveryExclusions: DiscoveryNonHtmlExclusion[]): void {
    const failuresDir = path.join(this.DIST_DIR, 'failures');
    fs.mkdirSync(failuresDir, { recursive: true });

    const siteFooterHtml = this.buildSiteFooterHtml();
    const failureEntries: Array<{ targetId: string; url: string; status: string; timestamp: string; reason: string }> = [];
    const skippedEntries: Array<{ targetId: string; url: string; status: string; timestamp: string; reason: string }> = [];
    const timeoutEntries: Array<{ targetId: string; url: string; status: string; timestamp: string; reason: string }> = [];
    const nonHtmlEntries: Array<{ targetId: string; url: string; status: string; timestamp: string; reason: string }> = [];

    allResults.forEach(target => {
      const pages = Array.isArray(target.pagesScanned) ? target.pagesScanned : [];
      pages.forEach(page => {
        const url = String(page?.url || '');
        const status = String(page?.status || 'UNKNOWN');
        const entry = {
          targetId: String(target.targetId || 'unknown'),
          url,
          status,
          timestamp: String(page?.timestamp || ''),
          reason: String(page?.errorMessage || '')
        };

        if (status === 'SKIPPED_UNCHANGED') {
          skippedEntries.push(entry);
        }
        if (status === 'TIMEOUT') {
          timeoutEntries.push(entry);
          failureEntries.push(entry);
        }
        if (status === 'FAILED' || status === 'WAF_BLOCKED') {
          failureEntries.push(entry);
        }
        if (/\.(pdf|docx)(?:$|[?#])/i.test(url)) {
          nonHtmlEntries.push(entry);
        }
      });
    });

    const discoveryNonHtmlEntries = (Array.isArray(discoveryExclusions) ? discoveryExclusions : []).map(entry => ({
      targetId: String(entry?.targetId || 'unknown'),
      url: String(entry?.url || ''),
      status: 'EXCLUDED_AT_DISCOVERY',
      timestamp: String(entry?.excludedAt || ''),
      reason: String(entry?.reason || 'Excluded during discovery')
    }));

    const formatRows = (entries: Array<{ targetId: string; url: string; status: string; timestamp: string; reason: string }>, emptyMessage: string): string => {
      if (!Array.isArray(entries) || entries.length === 0) {
        return `<tr><td colspan="5">${this.escapeHtml(emptyMessage)}</td></tr>`;
      }

      return entries
        .slice()
        .sort((a, b) => Date.parse(String(b.timestamp || '')) - Date.parse(String(a.timestamp || '')))
        .slice(0, 500)
        .map(entry => `
          <tr>
            <td>${this.escapeHtml(String(entry.targetId || '').toUpperCase())}</td>
            <td><a href="${this.escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(entry.url)}</a></td>
            <td>${this.escapeHtml(entry.status)}</td>
            <td>${this.escapeHtml(entry.timestamp || 'n/a')}</td>
            <td>${this.escapeHtml(entry.reason || 'n/a')}</td>
          </tr>`)
        .join('');
    };

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VITAL-Core Failures and Skips</title>
  <link rel="stylesheet" href="../assets/dashboard.css">
</head>
<body>
  <header>
    <div class="header-main">
      <h1>VITAL-Core Failures, Timeouts, and Skipped Pages</h1>
      <p><a href="../index.html">Back to main dashboard</a></p>
    </div>
  </header>
  <main>
    <div class="metric-grid">
      <div class="card"><h2>Failed/WAF/Timeout</h2><p style="font-size:2rem;font-weight:bold">${failureEntries.length}</p></div>
      <div class="card"><h2>Skipped Unchanged</h2><p style="font-size:2rem;font-weight:bold">${skippedEntries.length}</p></div>
      <div class="card"><h2>Timeout Only</h2><p style="font-size:2rem;font-weight:bold">${timeoutEntries.length}</p></div>
      <div class="card"><h2>PDF/DOCX URLs Seen</h2><p style="font-size:2rem;font-weight:bold">${nonHtmlEntries.length}</p></div>
      <div class="card"><h2>Excluded at Discovery</h2><p style="font-size:2rem;font-weight:bold">${discoveryNonHtmlEntries.length}</p></div>
    </div>

    <div class="card">
      <h2>Failures and Timeouts</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Domain</th>
            <th scope="col">URL</th>
            <th scope="col">Status</th>
            <th scope="col">Timestamp</th>
            <th scope="col">Reason</th>
          </tr>
        </thead>
        <tbody>${formatRows(failureEntries, 'No failed, blocked, or timeout pages in latest run.')}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>Skipped Unchanged Pages</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Domain</th>
            <th scope="col">URL</th>
            <th scope="col">Status</th>
            <th scope="col">Timestamp</th>
            <th scope="col">Reason</th>
          </tr>
        </thead>
        <tbody>${formatRows(skippedEntries, 'No pages were skipped as unchanged in latest run.')}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>PDF/DOCX URLs Seen in Page Reports</h2>
      <p class="muted-small">These URLs are expected to be excluded at discovery time. If any appear here, they bypassed the HTML-only filter and should be investigated.</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Domain</th>
            <th scope="col">URL</th>
            <th scope="col">Status</th>
            <th scope="col">Timestamp</th>
            <th scope="col">Reason</th>
          </tr>
        </thead>
        <tbody>${formatRows(nonHtmlEntries, 'No PDF/DOCX URLs were included in latest page reports.')}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>Excluded at Discovery (Non-HTML)</h2>
      <p class="muted-small">URLs filtered out during discovery before scan queue creation (for example PDFs, DOCX, feeds, and other non-HTML resources).</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Domain</th>
            <th scope="col">URL</th>
            <th scope="col">Status</th>
            <th scope="col">Timestamp</th>
            <th scope="col">Reason</th>
          </tr>
        </thead>
        <tbody>${formatRows(discoveryNonHtmlEntries, 'No non-HTML URLs were excluded during discovery in latest run.')}</tbody>
      </table>
    </div>
  </main>
${siteFooterHtml}
</body>
</html>`;

    fs.writeFileSync(path.join(failuresDir, 'index.html'), htmlContent, 'utf8');
  }

  private static writeDomainSubpages(allResults: TargetScanResult[], targetQualityIndex: TargetQualityIndexEntry[]): void {
    const domainsRoot = path.join(this.DIST_DIR, 'domains');
    fs.mkdirSync(domainsRoot, { recursive: true });
    const siteFooterHtml = this.buildSiteFooterHtml();

    for (const target of allResults) {
      const safeTargetId = this.sanitizePathSegment(target.targetId);
      const domainDir = path.join(domainsRoot, safeTargetId);
      fs.mkdirSync(domainDir, { recursive: true });

      const quality = targetQualityIndex.find(item => String(item.targetId || '') === String(target.targetId || '')) || null;
      const pages = Array.isArray(target.pagesScanned) ? target.pagesScanned : [];
      const completedPages = pages.filter(page => page?.status === 'COMPLETED').length;
      const skippedPages = pages.filter(page => page?.status === 'SKIPPED_UNCHANGED').length;
      const timeoutPages = pages.filter(page => page?.status === 'TIMEOUT').length;
      const failedPages = pages.filter(page => page?.status === 'FAILED').length;
      const wafBlockedPages = pages.filter(page => page?.status === 'WAF_BLOCKED').length;
      const blockedPages = timeoutPages + failedPages + wafBlockedPages;
      const allViolations = pages.flatMap(page => page?.liveAudits?.accessibilityViolations || []);
      const totalViolations = allViolations.length;
      const wcag20Count = allViolations.filter(v =>
        this.deriveWcagVersion(v.wcagVersion ? [v.wcagVersion] : (v.impactedCriteria || [])) === '2.0'
      ).length;
      const wcag21Count = allViolations.filter(v =>
        this.deriveWcagVersion(v.wcagVersion ? [v.wcagVersion] : (v.impactedCriteria || [])) === '2.1'
      ).length;
      const wcag22Count = allViolations.filter(v =>
        this.deriveWcagVersion(v.wcagVersion ? [v.wcagVersion] : (v.impactedCriteria || [])) === '2.2'
      ).length;
      const severityCounts = allViolations
        .reduce((acc, violation) => {
          const severity = String(violation?.severity || 'unknown').toLowerCase();
          acc.set(severity, (acc.get(severity) || 0) + 1);
          return acc;
        }, new Map<string, number>());
      const topRuleRows = Array.from(
        pages
          .flatMap(page => page?.liveAudits?.accessibilityViolations || [])
          .reduce((acc, violation) => {
            const ruleId = String(violation?.id || '').trim();
            if (!ruleId) {
              return acc;
            }
            acc.set(ruleId, (acc.get(ruleId) || 0) + 1);
            return acc;
          }, new Map<string, number>())
          .entries()
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([ruleId, count]) => `
          <tr>
            <td>${this.escapeHtml(ruleId)}</td>
            <td>${this.escapeHtml(count)}</td>
          </tr>`)
        .join('');
      const softwareSummary = Array.from(
        pages
          .flatMap(page => page?.technologyStack || [])
          .reduce((acc, tech) => {
            const techName = String(tech?.name || '').trim();
            if (!techName) {
              return acc;
            }
            acc.set(techName, (acc.get(techName) || 0) + 1);
            return acc;
          }, new Map<string, number>())
          .entries()
      )
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 20)
        .map(([techName, count]) => `${this.escapeHtml(techName)} (${this.escapeHtml(count)})`)
        .join(', ');
      const latestPageRows = pages
        .slice()
        .sort((a, b) => Date.parse(String(b?.timestamp || '')) - Date.parse(String(a?.timestamp || '')))
        .slice(0, 25)
        .map(page => {
          const pageViolations = Array.isArray(page?.liveAudits?.accessibilityViolations)
            ? page.liveAudits.accessibilityViolations.length
            : 0;
          return `
            <tr>
              <td><a href="${this.escapeHtml(String(page?.url || ''))}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(String(page?.url || 'n/a'))}</a></td>
              <td>${this.escapeHtml(String(page?.status || 'UNKNOWN'))}</td>
              <td>${this.escapeHtml(pageViolations)}</td>
              <td>${this.escapeHtml(String(page?.timestamp || 'n/a'))}</td>
            </tr>`;
        })
        .join('');
      const statusCounts = pages.reduce((acc, page) => {
        const status = String(page?.status || 'UNKNOWN');
        acc.set(status, (acc.get(status) || 0) + 1);
        return acc;
      }, new Map<string, number>());
      const statusSummaryText = Array.from(statusCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([status, count]) => `${status}: ${count}`)
        .join(' | ') || 'No page statuses recorded in latest run.';

      const accessibilityRows = pages
        .flatMap(page => {
          const violations = page?.liveAudits?.accessibilityViolations || [];
          return violations.map(v => {
            const wcagVer = v.wcagVersion || this.deriveWcagVersion(v.impactedCriteria || []);
            return `
            <tr>
              <td>${this.escapeHtml(page.url)}</td>
              <td>${this.escapeHtml(v.id)}</td>
              <td>${this.escapeHtml(v.severity)}</td>
              <td>${this.escapeHtml(wcagVer)}</td>
              <td>${this.escapeHtml(v.description)}</td>
            </tr>`;
          });
        })
        .join('');

      const performanceRows = pages
        .map(page => {
          const lighthouse = page?.liveAudits?.lighthouse;
          if (!lighthouse) {
            return '';
          }
          return `
            <tr>
              <td>${this.escapeHtml(page.url)}</td>
              <td>${this.escapeHtml(lighthouse?.performanceScore ?? 'n/a')}</td>
              <td>${this.escapeHtml(lighthouse?.firstContentfulPaintMs ?? 'n/a')}</td>
              <td>${this.escapeHtml(lighthouse?.largestContentfulPaintMs ?? 'n/a')}</td>
              <td>${this.escapeHtml(lighthouse?.speedIndexMs ?? 'n/a')}</td>
            </tr>`;
        })
        .join('');

      const contentRows = pages
        .map(page => {
          const content = page?.offlineAudits?.contentMetrics;
          if (!content) {
            return '';
          }
          return `
            <tr>
              <td>${this.escapeHtml(page.url)}</td>
              <td>${this.escapeHtml(content?.fleschKincaidGrade ?? 'n/a')}</td>
              <td>${this.escapeHtml(content?.averageSentenceLength ?? 'n/a')}</td>
              <td>${this.escapeHtml(content?.ambiguousLinkTextCount ?? 'n/a')}</td>
              <td>${this.escapeHtml(content?.suspiciousAltTextCount ?? 'n/a')}</td>
            </tr>`;
        })
        .join('');

      const thirdPartyRows = pages
        .map(page => {
          const impact = page?.thirdPartyImpact;
          if (!impact) {
            return '';
          }
          const providers = Array.isArray(impact?.likelyIntroducedByProviders) ? impact?.likelyIntroducedByProviders.join(', ') : 'n/a';
          return `
            <tr>
              <td>${this.escapeHtml(page.url)}</td>
              <td>${this.escapeHtml(impact?.regressionDetected ? 'yes' : 'no')}</td>
              <td>${this.escapeHtml(impact?.addedByJavaScriptCount ?? 'n/a')}</td>
              <td>${this.escapeHtml(providers)}</td>
            </tr>`;
        })
        .join('');

      const sharedNav = `
        <p>
          <a href="../../index.html">Main dashboard</a> |
          <a href="index.html">Domain overview</a> |
          <a href="accessibility.html">Accessibility</a> |
          <a href="performance.html">Performance</a> |
          <a href="content.html">Content</a> |
          <a href="third-party.html">Third-party impact</a>
        </p>`;

      const overviewHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(String(target.targetId).toUpperCase())} Domain Overview</title>
  <link rel="stylesheet" href="../../assets/dashboard.css">
</head>
<body>
  <header><h1>${this.escapeHtml(String(target.targetId).toUpperCase())} Domain Reports</h1></header>
  <main>
    <div class="card">
      <h2>Overview</h2>
      ${sharedNav}
      <p><strong>Domain:</strong> ${this.escapeHtml(target.domain)}</p>
      <p><strong>Pages in latest run:</strong> ${this.escapeHtml(pages.length)}</p>
      <p><strong>Scan duration (latest run):</strong> ${this.escapeHtml(this.formatHumanDuration(target.scanDurationMs))}</p>
      <p><strong>Quality gate:</strong> ${this.escapeHtml(String((quality && quality.gateStatus) || 'n/a'))}</p>
      <p><strong>Quality score:</strong> ${this.escapeHtml(String((quality && quality.score) || 'n/a'))}</p>
      <p><strong>Status breakdown:</strong> ${this.escapeHtml(statusSummaryText)}</p>
      <p><strong>Completed:</strong> ${this.escapeHtml(completedPages)} | <strong>Skipped unchanged:</strong> ${this.escapeHtml(skippedPages)} | <strong>Blocked:</strong> ${this.escapeHtml(blockedPages)}</p>
      <p><strong>Total accessibility violations:</strong> ${this.escapeHtml(totalViolations)} (critical: ${this.escapeHtml(severityCounts.get('critical') || 0)}, serious: ${this.escapeHtml(severityCounts.get('serious') || 0)}, moderate: ${this.escapeHtml(severityCounts.get('moderate') || 0)}, minor: ${this.escapeHtml(severityCounts.get('minor') || 0)})</p>
      <p><strong>By WCAG version:</strong> WCAG 2.0 AA (legal baseline): ${this.escapeHtml(wcag20Count)} &nbsp;|&nbsp; WCAG 2.1 AA (recommended): ${this.escapeHtml(wcag21Count)} &nbsp;|&nbsp; WCAG 2.2 AA (target): ${this.escapeHtml(wcag22Count)}</p>
      <p><strong>Detected software (top):</strong> ${softwareSummary || 'n/a'}</p>
    </div>

    <div class="card">
      <h2>Top Accessibility Rules (Latest Run)</h2>
      <table>
        <thead>
          <tr><th>Rule ID</th><th>Count</th></tr>
        </thead>
        <tbody>${topRuleRows || '<tr><td colspan="2">No accessibility violations in latest run.</td></tr>'}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>Recent Page Results (Latest Run)</h2>
      <table>
        <thead>
          <tr><th>URL</th><th>Status</th><th>Violations</th><th>Scanned At (UTC)</th></tr>
        </thead>
        <tbody>${latestPageRows || '<tr><td colspan="4">No page results available in latest run.</td></tr>'}</tbody>
      </table>
    </div>
  </main>
  ${siteFooterHtml}
</body>
</html>`;

      const accessibilityHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${this.escapeHtml(String(target.targetId).toUpperCase())} Accessibility</title><link rel="stylesheet" href="../../assets/dashboard.css"></head>
<body><header><h1>${this.escapeHtml(String(target.targetId).toUpperCase())} Accessibility</h1></header><main><div class="card"><h2>Accessibility Findings</h2>${sharedNav}
    <p><strong>Latest run status breakdown:</strong> ${this.escapeHtml(statusSummaryText)}</p>
<table><thead><tr><th>URL</th><th>Rule</th><th>Severity</th><th>WCAG</th><th>Description</th></tr></thead><tbody>${accessibilityRows || '<tr><td colspan="5">No accessibility violations in latest run.</td></tr>'}</tbody></table>
</div></main>${siteFooterHtml}</body></html>`;

      const performanceHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${this.escapeHtml(String(target.targetId).toUpperCase())} Performance</title><link rel="stylesheet" href="../../assets/dashboard.css"></head>
<body><header><h1>${this.escapeHtml(String(target.targetId).toUpperCase())} Performance</h1></header><main><div class="card"><h2>Lighthouse Metrics</h2>${sharedNav}
    <p><strong>Latest run status breakdown:</strong> ${this.escapeHtml(statusSummaryText)}</p>
    <table><thead><tr><th>URL</th><th>Perf</th><th>FCP (ms)</th><th>LCP (ms)</th><th>Speed Index (ms)</th></tr></thead><tbody>${performanceRows || '<tr><td colspan="5">No performance data available in the latest run. This usually means pages were skipped unchanged or no full Lighthouse samples were collected.</td></tr>'}</tbody></table>
</div></main>${siteFooterHtml}</body></html>`;

      const contentHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${this.escapeHtml(String(target.targetId).toUpperCase())} Content</title><link rel="stylesheet" href="../../assets/dashboard.css"></head>
<body><header><h1>${this.escapeHtml(String(target.targetId).toUpperCase())} Content Quality</h1></header><main><div class="card"><h2>Content Metrics</h2>${sharedNav}
    <p><strong>Latest run status breakdown:</strong> ${this.escapeHtml(statusSummaryText)}</p>
    <table><thead><tr><th>URL</th><th>Grade</th><th>Avg Sentence Length</th><th>Ambiguous Links</th><th>Suspicious Alt Text</th></tr></thead><tbody>${contentRows || '<tr><td colspan="5">No content metrics available in the latest run. Grade appears only when pages are completed with offline content analysis.</td></tr>'}</tbody></table>
</div></main>${siteFooterHtml}</body></html>`;

      const thirdPartyHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${this.escapeHtml(String(target.targetId).toUpperCase())} Third-Party Impact</title><link rel="stylesheet" href="../../assets/dashboard.css"></head>
<body><header><h1>${this.escapeHtml(String(target.targetId).toUpperCase())} Third-Party Impact</h1></header><main><div class="card"><h2>JavaScript Regression Signals</h2>${sharedNav}
    <p><strong>Latest run status breakdown:</strong> ${this.escapeHtml(statusSummaryText)}</p>
    <table><thead><tr><th>URL</th><th>Regression Detected</th><th>Added Violations</th><th>Likely Providers</th></tr></thead><tbody>${thirdPartyRows || '<tr><td colspan="4">No third-party impact data available in the latest run.</td></tr>'}</tbody></table>
</div></main>${siteFooterHtml}</body></html>`;

      fs.writeFileSync(path.join(domainDir, 'index.html'), overviewHtml, 'utf8');
      fs.writeFileSync(path.join(domainDir, 'accessibility.html'), accessibilityHtml, 'utf8');
      fs.writeFileSync(path.join(domainDir, 'performance.html'), performanceHtml, 'utf8');
      fs.writeFileSync(path.join(domainDir, 'content.html'), contentHtml, 'utf8');
      fs.writeFileSync(path.join(domainDir, 'third-party.html'), thirdPartyHtml, 'utf8');
    }
  }

  private static sanitizePathSegment(value: string): string {
    return String(value || 'unknown')
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'unknown';
  }

  private static escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Derives the minimum WCAG version that introduced a criterion from raw axe tags.
   * Mirrors LiveWorker.classifyWcagVersion but works on both wcagVersion strings
   * and raw impactedCriteria tags for backward compatibility with older run data.
   */
  private static deriveWcagVersion(criteria: string[]): '2.0' | '2.1' | '2.2' | 'section508' | 'best-practice' {
    const tags = criteria.map(s => String(s || '').toLowerCase());
    if (tags.some(t => t === '2.2' || t.startsWith('wcag22'))) return '2.2';
    if (tags.some(t => t === '2.1' || t.startsWith('wcag21'))) return '2.1';
    if (tags.some(t => t === '2.0' || t === 'wcag2a' || t === 'wcag2aa' || t === 'wcag2aaa')) return '2.0';
    if (tags.some(t => t === 'section508' || t.includes('508'))) return 'section508';
    return 'best-practice';
  }

  private static buildSiteFooterHtml(): string {
    return `
  <footer class="site-footer">
    <p>
      <strong>Project:</strong>
      <a href="https://github.com/mgifford/vital-core" target="_blank" rel="noopener noreferrer">github.com/mgifford/vital-core</a>
    </p>
    <p>
      VITAL-Core is an independent open source project. It is not affiliated with, endorsed by, or operated by the websites and agencies scanned by this dashboard.
    </p>
  </footer>`;
  }

  private static formatHumanDuration(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.ceil(Number(durationMs || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return String(hours) + 'h ' + String(minutes) + 'm';
    }
    if (minutes > 0) {
      return String(minutes) + 'm ' + String(seconds) + 's';
    }
    return String(seconds) + 's';
  }

  private static buildDashboardCss(): string {
    return `:root {
  --gov-blue: #112e51;
  --gov-light-blue: #005ea2;
  --link-color: #005ea2;
  --link-visited-color: #5b2d90;
  --focus-ring-color: #005ea2;
  --dark-gray: #212121;
  --light-bg: #f0f4f8;
  --critical-red: #b50909;
  --border-gray: #d6d7d9;
  --surface-bg: #ffffff;
  --text-color: #212121;
  --muted-color: #4d4d4d;
  --table-header-bg: #f0f4f8;
}
html[data-theme='dark'] {
  --gov-blue: #0b1f36;
  --gov-light-blue: #7cc4ff;
  --link-color: #7cc4ff;
  --link-visited-color: #c9b7ff;
  --focus-ring-color: #9dd1ff;
  --dark-gray: #e6edf5;
  --light-bg: #0f1722;
  --critical-red: #ff7f7f;
  --border-gray: #324355;
  --surface-bg: #162231;
  --text-color: #e6edf5;
  --muted-color: #c5d0dc;
  --table-header-bg: #203144;
}
@media (prefers-color-scheme: dark) {
  html:not([data-theme='light']) {
    --gov-blue: #0b1f36;
    --gov-light-blue: #7cc4ff;
    --link-color: #7cc4ff;
    --link-visited-color: #c9b7ff;
    --focus-ring-color: #9dd1ff;
    --dark-gray: #e6edf5;
    --light-bg: #0f1722;
    --critical-red: #ff7f7f;
    --border-gray: #324355;
    --surface-bg: #162231;
    --text-color: #e6edf5;
    --muted-color: #c5d0dc;
    --table-header-bg: #203144;
  }
}
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  margin: 0;
  padding: 0;
  background: var(--light-bg);
  color: var(--text-color);
  line-height: 1.5;
}
header {
  background: var(--gov-blue);
  color: white;
  padding: 1.5rem 2rem;
  border-bottom: 4px solid var(--gov-light-blue);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}
.header-main {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
}
.quick-domain-nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.quick-domain-nav label {
  font-size: 0.92rem;
  font-weight: 600;
}
.quick-domain-nav select {
  min-width: 280px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.14);
  color: #ffffff;
  padding: 0.35rem 0.5rem;
  font-size: 0.92rem;
}
.quick-domain-nav select option {
  color: #111111;
}
h1 {
  margin: 0;
  font-size: 1.8rem;
  font-weight: 700;
  letter-spacing: -0.03em;
}
main {
  max-width: 1200px;
  margin: 2rem auto;
  padding: 0 1rem;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.5rem;
  margin-bottom: 2rem;
}
.card {
  background: var(--surface-bg);
  border-radius: 4px;
  border: 1px solid var(--border-gray);
  padding: 1.5rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}
.card h2 {
  margin-top: 0;
  font-size: 1.3rem;
  border-bottom: 2px solid var(--light-bg);
  padding-bottom: 0.5rem;
}
.card h2:target {
  scroll-margin-top: 5rem;
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}
.section-links p {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.status-guide {
  margin-top: 0.75rem;
}
.status-guide summary {
  font-weight: 600;
  cursor: pointer;
}
.status-breakdown {
  margin: 0.6rem 0 0 1.1rem;
  padding: 0;
}
.status-breakdown li {
  margin: 0.25rem 0;
}
#pages-results-table {
  margin-top: 0.75rem;
}
#pages-results-table > summary {
  font-weight: 600;
  cursor: pointer;
}
.badge {
  display: inline-block;
  padding: 0.2rem 0.5rem;
  border-radius: 3px;
  font-size: 0.85rem;
  font-weight: bold;
  background: #e1f3ff;
  color: #005ea2;
}
.badge.alert {
  background: #fbeae5;
  color: var(--critical-red);
}
table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 1rem;
  text-align: left;
}
th, td {
  padding: 0.75rem;
  border-bottom: 1px solid var(--border-gray);
  font-size: 0.95rem;
}
th {
  background: var(--table-header-bg);
  font-weight: 600;
}
a {
  color: var(--link-color);
  text-decoration: underline;
  text-underline-offset: 0.12em;
  font-weight: 600;
}
a:visited {
  color: var(--link-visited-color);
}
a:hover {
  text-decoration: underline;
}
a:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 2px;
  text-decoration-thickness: 0.14em;
}
.muted-small {
  font-size: 0.9rem;
  color: var(--muted-color);
  margin-top: 0.4rem;
}
.muted-tiny {
  font-size: 0.85rem;
  margin-top: 0.4rem;
  color: var(--muted-color);
}
.legend-note {
  font-size: 0.85rem;
  margin-top: 0.6rem;
  color: var(--muted-color);
}
.compliance-chart {
  width: 100%;
  height: auto;
  border: 1px solid var(--border-gray);
  background: #fff;
}
.small-muted-inline {
  font-size: 0.85rem;
  color: var(--muted-color);
}
.theme-toggle {
  border: 1px solid rgba(255, 255, 255, 0.65);
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  border-radius: 999px;
  padding: 0.45rem 0.6rem;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.theme-icon { display: none; }
/* Light mode: show moon (clicking will switch to dark) */
html[data-theme='light'] .theme-icon-moon,
html:not([data-theme='dark']) .theme-icon-moon { display: inline; }
/* Dark mode: show sun (clicking will switch to light) */
html[data-theme='dark'] .theme-icon-sun { display: inline; }
.theme-toggle:focus {
  outline: 3px solid #ffffff;
  outline-offset: 2px;
}
@media (max-width: 920px) {
  header {
    align-items: flex-start;
    flex-direction: column;
  }

  .quick-domain-nav select {
    min-width: 220px;
  }
}
.small-block-gap {
  margin-top: 0.45rem;
}
.progress-wrap {
  margin-top: 0.5rem;
}
.progress-track {
  width: 100%;
  height: 0.6rem;
  border-radius: 999px;
  background: #e6eaf0;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  width: 0;
  background: linear-gradient(90deg, #0071bc 0%, #2e7d6b 100%);
}
.progress-meta {
  margin-top: 0.35rem;
  font-size: 0.82rem;
  color: #4d4d4d;
}
.site-footer {
  max-width: 1200px;
  margin: 0 auto 2rem;
  padding: 1rem;
  font-size: 0.92rem;
  color: var(--muted-color);
}
.site-footer p {
  margin: 0.35rem 0;
}
`;
  }

  private static buildDashboardJs(): string {
    return String.raw`(function () {
  const REQUEST_TIMEOUT_MS = 8000;

  function readEmbeddedJson(id, fallback) {
    const element = document.getElementById(id);
    if (!element) {
      return fallback;
    }

    try {
      const text = String(element.textContent || '');
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getInitialTheme() {
    try {
      const stored = localStorage.getItem('vital.theme');
      if (stored === 'light' || stored === 'dark') {
        return stored;
      }
    } catch {
      // Ignore storage access issues.
    }

    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    } catch {
      return 'light';
    }
  }

  function applyTheme(theme) {
    const nextTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', nextTheme);

    if (themeToggleEl) {
      const label = nextTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
      themeToggleEl.setAttribute('aria-label', label);
    }
  }

  function initThemeToggle() {
    applyTheme(getInitialTheme());

    if (!themeToggleEl) {
      return;
    }

    themeToggleEl.addEventListener('click', function () {
      const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        localStorage.setItem('vital.theme', next);
      } catch {
        // Ignore storage access issues.
      }
    });
  }

  async function fetchJsonWithRetry(url, options) {
    const retries = Number(options && options.retries) || 2;
    const timeoutMs = Number(options && options.timeoutMs) || REQUEST_TIMEOUT_MS;
    const headers = options && options.headers ? options.headers : undefined;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          headers,
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error('Request failed with status ' + String(response.status));
        }

        clearTimeout(timeout);
        return await response.json();
      } catch {
        clearTimeout(timeout);
        if (attempt >= retries) {
          return null;
        }
        await wait(250 * (attempt + 1));
      }
    }

    return null;
  }

  const data = readEmbeddedJson('vital-dashboard-data', []);
  const targetQuality = readEmbeddedJson('vital-dashboard-target-quality', []);
  const targetQualityMap = new Map(targetQuality.map(item => [item.targetId, item]));
  const summaryEl = document.getElementById('summary');
  const trendSummaryEl = document.getElementById('trend-summary');
  const liveScanPrimaryEl = document.getElementById('live-scan-primary');
  const liveScanSecondaryEl = document.getElementById('live-scan-secondary');
  const themeToggleEl = document.getElementById('theme-toggle');
  const tbodyEl = document.getElementById('target-body');
  const historyBodyEl = document.getElementById('history-body');
  const ongoingBodyEl = document.getElementById('ongoing-body');
  const pagesBodyEl = document.getElementById('pages-body');
  const pagesStatusSummaryEl = document.getElementById('pages-status-summary');
  const pagesStatusBreakdownEl = document.getElementById('pages-status-breakdown');
  const blockedBodyEl = document.getElementById('blocked-issues-body');
  const softwareBodyEl = document.getElementById('software-body');
  const domainPageSelectEl = document.getElementById('domain-page-select');
  const sizeEstimateByTarget = new Map();
  const topUrlsByTarget = new Map();

  let totalPages = 0;
  let totalViolations = 0;
  const softwareFound = new Set();
  const softwareByDomain = new Map();
  const blockedEntries = [];
  const currentRunUniquePages = new Set();
  const leaderboardRows = [];
  const summaryValueById = new Map();

  function formatEstimatedDomainSize(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 'Estimated size: n/a';
    }

    return 'Estimated size: ~' + new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(value))) + ' pages';
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(Number(value) || 0)));
  }

  function formatLimitedList(values, maxItems) {
    const list = Array.isArray(values) ? values.filter(Boolean) : [];
    const limit = Math.max(1, Number(maxItems) || 1);
    const shown = list.slice(0, limit);
    const hidden = Math.max(0, list.length - shown.length);
    const base = shown.join(', ');
    if (hidden <= 0) {
      return base || 'n/a';
    }
    return base + ' +' + String(hidden) + ' more';
  }

  function estimateDomainCompletion(scannedCount, estimatedTotal, scanDurationMs) {
    // Conservative weekly throughput model aligned with workflow intensity policy:
    // weekday off-hours at standard speed + weekday light/ultra-light windows + weekends standard.
    const THROTTLED_WEEKLY_SCAN_HOURS =
      (5 * 16 * 1.0) +   // Weekday off-hours (standard)
      (5 * 2 * 0.45) +   // Weekday edge business hours (light)
      (5 * 6 * 0.25) +   // Weekday peak business hours (ultra-light)
      (2 * 24 * 1.0);    // Weekends (standard)

    const scanned = Math.max(0, Number(scannedCount) || 0);
    const estimated = Number.isFinite(Number(estimatedTotal)) ? Math.max(0, Math.round(Number(estimatedTotal))) : null;
    const durationMs = Math.max(0, Number(scanDurationMs) || 0);

    const coverageRatio = estimated && estimated > 0 ? Math.min(1, scanned / estimated) : null;
    const pagesRemaining = estimated && estimated > scanned ? estimated - scanned : 0;
    const pagesPerHour = durationMs > 0 ? (scanned / durationMs) * 3600000 : 0;
    const etaHours = pagesPerHour > 0 && pagesRemaining > 0 ? pagesRemaining / pagesPerHour : null;
    const weeklyCapacity = Math.max(0, Math.round(pagesPerHour * THROTTLED_WEEKLY_SCAN_HOURS));
    const weeklyFeasible = estimated ? weeklyCapacity >= estimated : null;

    return {
      coverageRatio,
      etaHours,
      weeklyFeasible,
      estimated
    };
  }

  function buildCoverageMetaText(completion) {
    const coveragePct = completion.coverageRatio === null
      ? 'Coverage: n/a'
      : 'Coverage: ' + String(Math.round(completion.coverageRatio * 100)) + '%';

    const weeklyTarget = completion.weeklyFeasible === null
      ? 'Weekly target: n/a'
      : (completion.weeklyFeasible ? 'On track for weekly full coverage' : 'Likely needs more than one week');

    return coveragePct + ' | ' + formatEtaHours(completion.etaHours) + ' | ' + weeklyTarget;
  }

  function formatEtaHours(hours) {
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0) {
      return 'ETA: n/a';
    }

    if (hours < 24) {
      return 'ETA: ~' + String(Math.ceil(hours)) + 'h';
    }

    const days = hours / 24;
    if (days < 14) {
      return 'ETA: ~' + String(Math.ceil(days)) + 'd';
    }

    const weeks = days / 7;
    return 'ETA: ~' + weeks.toFixed(1) + 'w';
  }

  function buildRecommendations(quality, targetViolations, jsRegressionPages) {
    const actions = [];
    if (!quality) {
      actions.push('Run quality index computation for this target.');
    } else {
      if (quality.gateStatus === 'BLOCKED') {
        actions.push('Address critical issues first to remove BLOCKED status.');
      } else if (quality.gateStatus === 'WARNING') {
        actions.push('Prioritize serious violations to improve score this cycle.');
      } else {
        actions.push('Maintain momentum and target incremental score gains.');
      }
    }

    if (targetViolations > 0) {
      actions.push('Resolve top recurring page-level failures in latest run.');
    }
    if (jsRegressionPages > 0) {
      actions.push('Review third-party JS regressions with provider owners.');
    }
    if (actions.length === 0) {
      actions.push('No immediate recommendations. Keep monitoring trend stability.');
    }

    return actions.slice(0, 2).join(' ');
  }

  function toDomainIdSegment(targetId) {
    return String(targetId || '')
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'unknown';
  }

  function populateDomainSelectMenu(targets) {
    if (!domainPageSelectEl) {
      return;
    }

    domainPageSelectEl.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select domain report page...';
    domainPageSelectEl.appendChild(placeholder);

    if (!Array.isArray(targets) || targets.length === 0) {
      domainPageSelectEl.disabled = true;
      return;
    }

    domainPageSelectEl.disabled = false;

    const domainPages = [
      ['Overview', 'index.html'],
      ['Accessibility', 'accessibility.html'],
      ['Performance', 'performance.html'],
      ['Content', 'content.html'],
      ['Third-party', 'third-party.html']
    ];

    targets
      .slice()
      .sort((a, b) => String(a.targetId || '').localeCompare(String(b.targetId || '')))
      .forEach(target => {
        const group = document.createElement('optgroup');
        group.label = String(target.targetId || '').toUpperCase() + ' - ' + String(target.domain || 'n/a');

        const segment = toDomainIdSegment(target.targetId);
        domainPages.forEach((entry, index) => {
          const option = document.createElement('option');
          option.value = 'domains/' + segment + '/' + entry[1];
          option.textContent = entry[0];
          if (index === 0) {
            option.textContent = 'Overview';
          }
          group.appendChild(option);
        });
        domainPageSelectEl.appendChild(group);
      });

    if (domainPageSelectEl.dataset.bound !== 'true') {
      domainPageSelectEl.addEventListener('change', function () {
        const selected = String(domainPageSelectEl.value || '');
        if (!selected) {
          return;
        }
        window.location.href = selected;
      });
      domainPageSelectEl.dataset.bound = 'true';
    }
  }

  function summarizeLighthouseMetrics(pagesScanned) {
    const performance = [];
    const fcp = [];
    const lcp = [];
    const speedIndex = [];

    (Array.isArray(pagesScanned) ? pagesScanned : []).forEach(page => {
      const lighthouse = page && page.liveAudits ? page.liveAudits.lighthouse : null;
      if (typeof (lighthouse && lighthouse.performanceScore) === 'number') {
        performance.push(lighthouse.performanceScore);
      }
      if (typeof (lighthouse && lighthouse.firstContentfulPaintMs) === 'number') {
        fcp.push(lighthouse.firstContentfulPaintMs);
      }
      if (typeof (lighthouse && lighthouse.largestContentfulPaintMs) === 'number') {
        lcp.push(lighthouse.largestContentfulPaintMs);
      }
      if (typeof (lighthouse && lighthouse.speedIndexMs) === 'number') {
        speedIndex.push(lighthouse.speedIndexMs);
      }
    });

    const average = values => {
      if (!Array.isArray(values) || values.length === 0) {
        return null;
      }
      return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    };

    return {
      performance: average(performance),
      fcp: average(fcp),
      lcp: average(lcp),
      speedIndex: average(speedIndex)
    };
  }

  function metricColor(metric, value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return '#4d4d4d';
    }

    if (metric === 'performance') {
      if (value >= 90) return '#1a7f37';
      if (value >= 70) return '#9a6700';
      return 'var(--critical-red)';
    }

    if (metric === 'fcp') {
      if (value <= 1800) return '#1a7f37';
      if (value <= 3000) return '#9a6700';
      return 'var(--critical-red)';
    }

    if (metric === 'lcp') {
      if (value <= 2500) return '#1a7f37';
      if (value <= 4000) return '#9a6700';
      return 'var(--critical-red)';
    }

    if (metric === 'speedIndex') {
      if (value <= 3400) return '#1a7f37';
      if (value <= 5800) return '#9a6700';
      return 'var(--critical-red)';
    }

    return '#4d4d4d';
  }

  function setSummaryMetric(id, value) {
    const valueEl = summaryValueById.get(id);
    if (valueEl) {
      valueEl.textContent = value;
    }
  }

  function addSummaryCard(id, title, value, color) {
    const wrapper = document.createElement('div');
    wrapper.className = 'card';

    const heading = document.createElement('h3');
    heading.textContent = title;

    const valueEl = document.createElement('p');
    valueEl.style.fontSize = '2rem';
    valueEl.style.margin = '0';
    valueEl.style.fontWeight = 'bold';
    if (color) {
      valueEl.style.color = color;
    }
    valueEl.textContent = value;

    wrapper.appendChild(heading);
    wrapper.appendChild(valueEl);
    summaryEl.appendChild(wrapper);
    summaryValueById.set(id, valueEl);
  }

  function getRepoFromPageLocation() {
    try {
      const owner = String(window.location.hostname || '').split('.')[0];
      const pathBits = String(window.location.pathname || '').split('/').filter(Boolean);
      const repo = pathBits.length > 0 ? pathBits[0] : 'vital-core';
      if (!owner || !repo) {
        return { owner: 'mgifford', repo: 'vital-core' };
      }
      return { owner, repo };
    } catch {
      return { owner: 'mgifford', repo: 'vital-core' };
    }
  }

  function getNextScheduledScanUtc(nowDate) {
    const now = new Date(nowDate);

    const hourly = new Date(now.getTime());
    hourly.setUTCMinutes(0, 0, 0);
    hourly.setUTCHours(hourly.getUTCHours() + 1);

    const daily = new Date(now.getTime());
    daily.setUTCHours(5, 0, 0, 0);
    if (daily <= now) {
      daily.setUTCDate(daily.getUTCDate() + 1);
    }

    const monthly = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 2, 0, 0, 0));
    if (monthly <= now) {
      monthly.setUTCMonth(monthly.getUTCMonth() + 1);
    }

    return [hourly, daily, monthly].sort((a, b) => a.getTime() - b.getTime())[0];
  }

  function appendTrendCard(title, value, subtitle, accentColor) {
    const wrapper = document.createElement('div');
    wrapper.className = 'card';

    const heading = document.createElement('h3');
    heading.textContent = title;

    const valueEl = document.createElement('p');
    valueEl.style.fontSize = '1.6rem';
    valueEl.style.margin = '0';
    valueEl.style.fontWeight = 'bold';
    if (accentColor) {
      valueEl.style.color = accentColor;
    }
    valueEl.textContent = value;

    const subtitleEl = document.createElement('p');
    subtitleEl.style.marginTop = '0.5rem';
    subtitleEl.style.fontSize = '0.9rem';
    subtitleEl.textContent = subtitle;

    wrapper.appendChild(heading);
    wrapper.appendChild(valueEl);
    wrapper.appendChild(subtitleEl);
    trendSummaryEl.appendChild(wrapper);
  }

  function formatDelta(value, suffix) {
    const sign = value > 0 ? '+' : '';
    return sign + String(value) + suffix;
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return String(hours) + 'h ' + String(minutes) + 'm';
    }
    if (minutes > 0) {
      return String(minutes) + 'm ' + String(seconds) + 's';
    }
    return String(seconds) + 's';
  }

  function formatDateTimeForViewer(value) {
    const parsed = new Date(value || '');
    if (Number.isNaN(parsed.getTime())) {
      return String(value || 'n/a');
    }

    try {
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
      }).format(parsed);
    } catch {
      return parsed.toLocaleString();
    }
  }

  function drawComplianceChart(series) {
    const chart = document.getElementById('compliance-chart');
    if (!chart) {
      return;
    }

    while (chart.firstChild) {
      chart.removeChild(chart.firstChild);
    }

    if (!Array.isArray(series) || series.length === 0) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', '20');
      text.setAttribute('y', '130');
      text.setAttribute('fill', '#555');
      text.textContent = 'No compliance trend data available yet.';
      chart.appendChild(text);
      return;
    }

    const width = 900;
    const height = 260;
    const margin = { left: 60, right: 24, top: 16, bottom: 40 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    const axis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    axis.setAttribute('x1', String(margin.left));
    axis.setAttribute('y1', String(margin.top + plotHeight));
    axis.setAttribute('x2', String(margin.left + plotWidth));
    axis.setAttribute('y2', String(margin.top + plotHeight));
    axis.setAttribute('stroke', '#7c7c7c');
    chart.appendChild(axis);

    const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    yAxis.setAttribute('x1', String(margin.left));
    yAxis.setAttribute('y1', String(margin.top));
    yAxis.setAttribute('x2', String(margin.left));
    yAxis.setAttribute('y2', String(margin.top + plotHeight));
    yAxis.setAttribute('stroke', '#7c7c7c');
    chart.appendChild(yAxis);

    [0, 25, 50, 75, 100].forEach(value => {
      const y = margin.top + plotHeight - ((value / 100) * plotHeight);
      const grid = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      grid.setAttribute('x1', String(margin.left));
      grid.setAttribute('y1', String(y));
      grid.setAttribute('x2', String(margin.left + plotWidth));
      grid.setAttribute('y2', String(y));
      grid.setAttribute('stroke', '#ececec');
      chart.appendChild(grid);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', '10');
      label.setAttribute('y', String(y + 4));
      label.setAttribute('fill', '#555');
      label.setAttribute('font-size', '12');
      label.textContent = String(value) + '%';
      chart.appendChild(label);
    });

    const metrics = [
      { key: 'wcag20AALegalBaseline', label: 'WCAG 2.0 AA legal baseline', color: '#1a7f37' },
      { key: 'wcag21AA', label: 'WCAG 2.1 AA', color: '#005ea2' },
      { key: 'wcag22AATarget', label: 'WCAG 2.2 AA target', color: '#9a6700' },
      { key: 'accessibilityNoViolations', label: 'A11y no violations', color: '#b50909' },
      { key: 'performanceThreshold', label: 'Performance >= 70', color: '#6f42c1' },
      { key: 'plainLanguageGrade', label: 'Plain language grade <= 8', color: '#b3257a' },
      { key: 'plainLanguageLinks', label: 'No ambiguous links', color: '#4d4d4d' },
      { key: 'completedStatus', label: 'Completed status', color: '#2e7d6b' }
    ];

    const xForIndex = index => {
      if (series.length === 1) {
        return margin.left + (plotWidth / 2);
      }
      return margin.left + ((index / (series.length - 1)) * plotWidth);
    };

    const yForPercent = percent => margin.top + plotHeight - ((Math.max(0, Math.min(100, Number(percent) || 0)) / 100) * plotHeight);

    metrics.forEach(metric => {
      const points = series.map((entry, index) => {
        const value = entry.compliancePercentages ? entry.compliancePercentages[metric.key] : null;
        return String(xForIndex(index)) + ',' + String(yForPercent(value));
      }).join(' ');

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', metric.color);
      line.setAttribute('stroke-width', '2.5');
      line.setAttribute('points', points);
      chart.appendChild(line);
    });
  }

  async function updateLiveScanTicker() {
    const repoInfo = getRepoFromPageLocation();
    const workflowApi = 'https://api.github.com/repos/' + repoInfo.owner + '/' + repoInfo.repo + '/actions/workflows/vital-scan.yml/runs?per_page=1';

    const payload = await fetchJsonWithRetry(workflowApi, {
      retries: 1,
      timeoutMs: 8000,
      headers: { Accept: 'application/vnd.github+json' }
    });
    const runInfo = payload && Array.isArray(payload.workflow_runs) ? payload.workflow_runs[0] : null;
    const latestPublished = await fetchJsonWithRetry('runs/latest.json', { retries: 1, timeoutMs: 5000 });

    const nextScheduled = getNextScheduledScanUtc(new Date());
    const lastPublishedAt = latestPublished && latestPublished.generatedAt ? new Date(latestPublished.generatedAt).toISOString() : 'unknown';

    if (runInfo && (runInfo.status === 'in_progress' || runInfo.status === 'queued')) {
      const started = runInfo.run_started_at ? new Date(runInfo.run_started_at).toISOString() : 'unknown';
      liveScanPrimaryEl.textContent = 'Scanning now: ' + String(runInfo.name || 'Execute Continuous Web Quality Compliance Scan');
      liveScanSecondaryEl.textContent =
        'Status: ' + String(runInfo.status) +
        ' | Started: ' + started +
        ' | Last published run: ' + lastPublishedAt +
        ' | Expected next page refresh after run completion.';
    } else {
      const conclusion = runInfo && runInfo.conclusion ? String(runInfo.conclusion) : 'unknown';
      liveScanPrimaryEl.textContent = 'No active scan right now.';
      liveScanSecondaryEl.textContent =
        'Last published run: ' + lastPublishedAt +
        ' | Last workflow conclusion: ' + conclusion +
        ' | Next scheduled scan: ' + nextScheduled.toISOString() + '.';
    }
  }

  function appendHistoryRow(run) {
    const tr = document.createElement('tr');

    const tsCell = document.createElement('td');
    const ts = new Date(run.generatedAt);
    tsCell.textContent = Number.isNaN(ts.getTime()) ? String(run.generatedAt || '') : formatDateTimeForViewer(run.generatedAt);

    const pagesCell = document.createElement('td');
    pagesCell.textContent = String(run.pagesScanned || 0);

    const violationsCell = document.createElement('td');
    violationsCell.textContent = String(run.totalViolations || 0);

    const durationCell = document.createElement('td');
    const durationMs = Number(run.scanDurationMs || 0);
    durationCell.textContent = Number.isFinite(durationMs) ? formatDuration(durationMs) : 'n/a';

    const dataCell = document.createElement('td');
    const link = document.createElement('a');
    link.href = String(run.artifactPath || '#');
    link.textContent = 'View JSON';
    dataCell.appendChild(link);

    tr.appendChild(tsCell);
    tr.appendChild(pagesCell);
    tr.appendChild(violationsCell);
    tr.appendChild(durationCell);
    tr.appendChild(dataCell);

    historyBodyEl.appendChild(tr);
  }

  function appendLatestPageRow(target, page) {
    const tr = document.createElement('tr');

    const domainCell = document.createElement('td');
    domainCell.textContent = String(target && target.targetId ? target.targetId : 'n/a').toUpperCase();

    const urlCell = document.createElement('td');
    const url = page && typeof page.url === 'string' ? page.url : '';
    if (url) {
      const link = document.createElement('a');
      link.href = url;
      link.textContent = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      urlCell.appendChild(link);
    } else {
      urlCell.textContent = 'n/a';
    }

    const statusCell = document.createElement('td');
    statusCell.textContent = String(page && page.status ? page.status : 'UNKNOWN');

    const violationsCell = document.createElement('td');
    const violations = page && page.liveAudits && Array.isArray(page.liveAudits.accessibilityViolations)
      ? page.liveAudits.accessibilityViolations.length
      : 0;
    violationsCell.textContent = String(violations);

    const scannedAtCell = document.createElement('td');
    const timestamp = page && page.timestamp ? new Date(page.timestamp) : null;
    scannedAtCell.textContent = timestamp && !Number.isNaN(timestamp.getTime())
      ? formatDateTimeForViewer(page.timestamp)
      : 'n/a';

    tr.appendChild(domainCell);
    tr.appendChild(urlCell);
    tr.appendChild(statusCell);
    tr.appendChild(violationsCell);
    tr.appendChild(scannedAtCell);

    pagesBodyEl.appendChild(tr);
  }

  function renderPagesStatusSummary(latestPages) {
    const counts = new Map();
    latestPages.forEach(entry => {
      const status = String(entry && entry.page && entry.page.status ? entry.page.status : 'UNKNOWN');
      counts.set(status, (counts.get(status) || 0) + 1);
    });

    const completed = Number(counts.get('COMPLETED') || 0);
    const skippedUnchanged = Number(counts.get('SKIPPED_UNCHANGED') || 0);
    const timedOut = Number(counts.get('TIMEOUT') || 0);
    const failed = Number(counts.get('FAILED') || 0) + Number(counts.get('WAF_BLOCKED') || 0);

    if (pagesStatusSummaryEl) {
      pagesStatusSummaryEl.textContent =
        'Latest run summary: ' +
        String(latestPages.length) + ' pages total • ' +
        String(completed) + ' COMPLETED • ' +
        String(skippedUnchanged) + ' SKIPPED_UNCHANGED • ' +
        String(timedOut) + ' TIMEOUT • ' +
        String(failed) + ' FAILED/WAF_BLOCKED.';
    }

    if (!pagesStatusBreakdownEl) {
      return;
    }

    while (pagesStatusBreakdownEl.firstChild) {
      pagesStatusBreakdownEl.removeChild(pagesStatusBreakdownEl.firstChild);
    }

    const ordered = Array.from(counts.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

    if (ordered.length === 0) {
      const empty = document.createElement('li');
      empty.textContent = 'No page status data available in the latest run.';
      pagesStatusBreakdownEl.appendChild(empty);
      return;
    }

    ordered.forEach(([status, count]) => {
      const item = document.createElement('li');
      item.textContent = String(status) + ': ' + String(count);
      pagesStatusBreakdownEl.appendChild(item);
    });
  }

  function renderBlockedIssues() {
    if (!blockedBodyEl) {
      return;
    }

    blockedBodyEl.innerHTML = '';

    if (blockedEntries.length === 0) {
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = 5;
      emptyCell.textContent = 'No blocked, timeout, or failed pages in the latest run.';
      emptyRow.appendChild(emptyCell);
      blockedBodyEl.appendChild(emptyRow);
      return;
    }

    blockedEntries
      .slice()
      .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0))
      .slice(0, 200)
      .forEach(entry => {
        const tr = document.createElement('tr');

        const domainCell = document.createElement('td');
        domainCell.textContent = String(entry.targetId || 'n/a').toUpperCase();

        const urlCell = document.createElement('td');
        if (entry.url) {
          const link = document.createElement('a');
          link.href = entry.url;
          link.textContent = entry.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          urlCell.appendChild(link);
        } else {
          urlCell.textContent = 'n/a';
        }

        const statusCell = document.createElement('td');
        statusCell.textContent = String(entry.status || 'UNKNOWN');

        const reasonCell = document.createElement('td');
        reasonCell.textContent = String(entry.reason || 'No explicit error message was recorded.');

        const tsCell = document.createElement('td');
        tsCell.textContent = entry.timestamp
          ? formatDateTimeForViewer(entry.timestamp)
          : 'n/a';

        tr.appendChild(domainCell);
        tr.appendChild(urlCell);
        tr.appendChild(statusCell);
        tr.appendChild(reasonCell);
        tr.appendChild(tsCell);
        blockedBodyEl.appendChild(tr);
      });
  }

  function renderSoftwareDetections() {
    if (!softwareBodyEl) {
      return;
    }

    softwareBodyEl.innerHTML = '';
    const rows = Array.from(softwareByDomain.values())
      .sort((a, b) => String(a.targetId || '').localeCompare(String(b.targetId || '')));

    if (rows.length === 0) {
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = 4;
      emptyCell.textContent = 'No software fingerprints were detected in the latest run.';
      emptyRow.appendChild(emptyCell);
      softwareBodyEl.appendChild(emptyRow);
      return;
    }

    rows.forEach(item => {
      const tr = document.createElement('tr');

      const domainCell = document.createElement('td');
      const domainStrong = document.createElement('strong');
      domainStrong.textContent = String(item.targetId || 'n/a').toUpperCase();
      const domainBreak = document.createElement('br');
      const domainSmall = document.createElement('small');
      domainSmall.textContent = String(item.domain || 'n/a');
      domainCell.appendChild(domainStrong);
      domainCell.appendChild(domainBreak);
      domainCell.appendChild(domainSmall);

      const technologies = Array.from(item.technologies.values())
        .map(tech => String(tech.displayName || '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

      const technologiesCell = document.createElement('td');
      technologiesCell.textContent =
        String(technologies.length) + ' total: ' + formatLimitedList(technologies, 10);

      const categoryCell = document.createElement('td');
      categoryCell.textContent = formatLimitedList(
        Array.from(item.categories).sort((a, b) => a.localeCompare(b)),
        8
      );

      const versionCell = document.createElement('td');
      versionCell.textContent = formatLimitedList(
        Array.from(item.versions).sort((a, b) => a.localeCompare(b)),
        8
      );

      tr.appendChild(domainCell);
      tr.appendChild(technologiesCell);
      tr.appendChild(categoryCell);
      tr.appendChild(versionCell);
      softwareBodyEl.appendChild(tr);
    });
  }

  async function updateUniqueCoverageFromHistory(indexPayload) {
    if (!indexPayload || !Array.isArray(indexPayload.runs) || indexPayload.runs.length === 0) {
      return;
    }

    const allTime = new Set(currentRunUniquePages);
    const thisWeek = new Set(currentRunUniquePages);
    const now = Date.now();
    const weekWindowMs = 7 * 24 * 60 * 60 * 1000;

    for (const run of indexPayload.runs.slice(0, 200)) {
      const generatedAtMs = Date.parse(String(run && run.generatedAt ? run.generatedAt : ''));
      const artifactPath = String(run && run.artifactPath ? run.artifactPath : '');
      if (!artifactPath || !artifactPath.startsWith('runs/')) {
        continue;
      }

      const artifact = await fetchJsonWithRetry(artifactPath, { retries: 1, timeoutMs: 5000 });
      const targets = artifact && Array.isArray(artifact.results) ? artifact.results : [];

      targets.forEach(target => {
        const pages = target && Array.isArray(target.pagesScanned) ? target.pagesScanned : [];
        pages.forEach(page => {
          const url = page && typeof page.url === 'string' ? page.url : '';
          if (!url) {
            return;
          }

          allTime.add(url);
          if (Number.isFinite(generatedAtMs) && (now - generatedAtMs) <= weekWindowMs) {
            thisWeek.add(url);
          }
        });
      });
    }

    setSummaryMetric('unique-pages-total', String(allTime.size));
    setSummaryMetric('unique-pages-week', String(thisWeek.size));
  }

  data.forEach(target => {
    let targetViolations = 0;
    let jsRegressionPages = 0;
    (Array.isArray(target.pagesScanned) ? target.pagesScanned : []).forEach(p => {
      totalPages += 1;
      if (p && typeof p.url === 'string' && p.url) {
        currentRunUniquePages.add(p.url);
      }
      const pageStatus = String(p && p.status ? p.status : 'UNKNOWN');
      if (pageStatus === 'FAILED' || pageStatus === 'WAF_BLOCKED' || pageStatus === 'TIMEOUT') {
        const fallbackReason = pageStatus === 'WAF_BLOCKED'
          ? 'Blocked by anti-bot or web application firewall controls.'
          : pageStatus === 'TIMEOUT'
            ? 'Scan timed out before audit completion.'
            : 'Page scan failed before audit completion.';
        blockedEntries.push({
          targetId: String(target && target.targetId ? target.targetId : ''),
          url: String(p && p.url ? p.url : ''),
          status: pageStatus,
          reason: String((p && p.errorMessage) || fallbackReason),
          timestamp: String((p && p.timestamp) || ''),
          ts: Date.parse(String((p && p.timestamp) || '')) || 0
        });
      }
      targetViolations += p && p.liveAudits && Array.isArray(p.liveAudits.accessibilityViolations)
        ? p.liveAudits.accessibilityViolations.length
        : 0;
      if (p && p.thirdPartyImpact && p.thirdPartyImpact.regressionDetected) {
        jsRegressionPages += 1;
      }
      const stack = Array.isArray(p && p.technologyStack) ? p.technologyStack : [];
      const targetId = String(target && target.targetId ? target.targetId : 'unknown');
      const domain = String(target && target.domain ? target.domain : '');
      const domainAggregate = softwareByDomain.get(targetId) || {
        targetId,
        domain,
        categories: new Set(),
        versions: new Set(),
        technologies: new Map()
      };

      stack.forEach(tech => {
        const displayName = String(tech && tech.name ? tech.name : '').trim();
        const name = displayName.toLowerCase();
        if (name) {
          softwareFound.add(name);

          const existing = domainAggregate.technologies.get(name) || {
            displayName,
            categories: new Set(),
            versions: new Set()
          };

          const category = String(tech && tech.category ? tech.category : '').trim();
          if (category) {
            existing.categories.add(category);
            domainAggregate.categories.add(category);
          }

          const version = String(tech && tech.version ? tech.version : '').trim();
          if (version) {
            existing.versions.add(version);
            domainAggregate.versions.add(version);
          }

          domainAggregate.technologies.set(name, existing);
        }
      });

      softwareByDomain.set(targetId, domainAggregate);
    });
    totalViolations += targetViolations;

    const quality = targetQualityMap.get(target.targetId);
    leaderboardRows.push({
      target,
      targetViolations,
      jsRegressionPages,
      quality,
      score: quality ? Number(quality.score) : -1
    });
  });

  const latestPages = [];
  data.forEach(target => {
    const pages = Array.isArray(target && target.pagesScanned) ? target.pagesScanned : [];
    pages.forEach(page => {
      latestPages.push({
        target,
        page,
        ts: Date.parse(String(page && page.timestamp ? page.timestamp : '')) || 0
      });
    });
  });

  if (latestPages.length === 0) {
    const emptyRow = document.createElement('tr');
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 5;
    emptyCell.textContent = 'No page-level scan records are available in the latest run.';
    emptyRow.appendChild(emptyCell);
    pagesBodyEl.appendChild(emptyRow);
  } else {
    latestPages
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 300)
      .forEach(entry => appendLatestPageRow(entry.target, entry.page));
  }
  renderPagesStatusSummary(latestPages);

  addSummaryCard('targets-total', 'Ecosystem Targets Evaluated', String(data.length), '');
  addSummaryCard('software-total', 'Software found', String(softwareFound.size), '');
  addSummaryCard('blocked-total', 'Total Blocked System Issues', String(blockedEntries.length), blockedEntries.length > 0 ? 'var(--critical-red)' : '');
  addSummaryCard('violations-total', 'Total Accessibility Violations', String(totalViolations), totalViolations > 0 ? 'var(--critical-red)' : '');
  addSummaryCard('unique-pages-total', 'Unique Pages Scanned (All Time)', String(currentRunUniquePages.size), '');
  addSummaryCard('unique-pages-week', 'Unique Pages Scanned (This Week)', String(currentRunUniquePages.size), '');
  renderBlockedIssues();
  renderSoftwareDetections();
  populateDomainSelectMenu(data);

  leaderboardRows
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (a.targetViolations !== b.targetViolations) {
        return a.targetViolations - b.targetViolations;
      }
      return String(a.target.targetId).localeCompare(String(b.target.targetId));
    })
    .forEach((row, index) => {
      const target = row.target;
      const tr = document.createElement('tr');

      const domainCell = document.createElement('td');
      const domainStrong = document.createElement('strong');
      domainStrong.textContent = '#' + String(index + 1) + ' ' + String(target.targetId || '').toUpperCase();
      const domainBreak = document.createElement('br');
      const domainSmall = document.createElement('small');
      domainSmall.textContent = String(target.domain || '');
      const domainLinks = document.createElement('div');
      domainLinks.className = 'small-muted-inline small-block-gap';

      const domainIdSegment = toDomainIdSegment(target.targetId);
      const domainPages = [
        ['Overview', 'index.html'],
        ['Accessibility', 'accessibility.html'],
        ['Performance', 'performance.html'],
        ['Content', 'content.html'],
        ['Third-party', 'third-party.html']
      ];

      domainPages.forEach((item, linkIndex) => {
        const link = document.createElement('a');
        link.href = 'domains/' + domainIdSegment + '/' + item[1];
        link.textContent = item[0];
        domainLinks.appendChild(link);

        if (linkIndex < domainPages.length - 1) {
          domainLinks.appendChild(document.createTextNode(' | '));
        }
      });
      domainCell.appendChild(domainStrong);
      domainCell.appendChild(domainBreak);
      domainCell.appendChild(domainSmall);
      domainCell.appendChild(domainLinks);

      const pagesCell = document.createElement('td');
      const scannedCount = Array.isArray(target.pagesScanned) ? target.pagesScanned.length : 0;
      const initialEstimate = sizeEstimateByTarget.get(target.targetId);
      const initialCompletion = estimateDomainCompletion(scannedCount, initialEstimate, target.scanDurationMs);
      const scannedText = document.createElement('div');
      scannedText.setAttribute('data-scanned-summary-target-id', String(target.targetId || ''));
      if (initialCompletion.estimated && initialCompletion.estimated > 0) {
        scannedText.textContent = formatNumber(scannedCount) + ' / ' + formatNumber(initialCompletion.estimated) + ' pages scanned';
      } else {
        scannedText.textContent = formatNumber(scannedCount) + ' pages scanned';
      }
      const estimateText = document.createElement('div');
      estimateText.className = 'small-muted-inline';
      estimateText.setAttribute('data-size-estimate-target-id', String(target.targetId || ''));
      estimateText.textContent = formatEstimatedDomainSize(sizeEstimateByTarget.get(target.targetId));

      const progressWrap = document.createElement('div');
      progressWrap.className = 'progress-wrap';

      const progressTrack = document.createElement('div');
      progressTrack.className = 'progress-track';
      const progressFill = document.createElement('div');
      progressFill.className = 'progress-fill';
      progressFill.setAttribute('data-progress-fill-target-id', String(target.targetId || ''));
      progressFill.style.width = initialCompletion.coverageRatio === null
        ? '0%'
        : String(Math.max(0, Math.min(100, Math.round(initialCompletion.coverageRatio * 100)))) + '%';
      progressTrack.appendChild(progressFill);

      const progressMeta = document.createElement('div');
      progressMeta.className = 'progress-meta';
      progressMeta.setAttribute('data-progress-meta-target-id', String(target.targetId || ''));
      progressMeta.textContent = buildCoverageMetaText(initialCompletion);

      progressWrap.appendChild(progressTrack);
      progressWrap.appendChild(progressMeta);
      pagesCell.appendChild(scannedText);
      pagesCell.appendChild(estimateText);
      pagesCell.appendChild(progressWrap);

      const scoreCell = document.createElement('td');
      if (row.quality) {
        const qualityBadge = document.createElement('span');
        qualityBadge.className = 'badge';
        if (row.quality.gateStatus !== 'PASS') {
          qualityBadge.className += ' alert';
        }
        qualityBadge.textContent = String(Number(row.quality.score).toFixed(2)) + ' (' + row.quality.gateStatus + ')';
        scoreCell.appendChild(qualityBadge);
      } else {
        scoreCell.textContent = 'n/a';
      }

      const recommendationsCell = document.createElement('td');
      const recommendationBody = document.createElement('div');
      recommendationBody.textContent = buildRecommendations(row.quality, row.targetViolations, row.jsRegressionPages);

      const topUrlsBlock = document.createElement('div');
      topUrlsBlock.className = 'small-muted-inline small-block-gap';
      topUrlsBlock.setAttribute('data-top-urls-target-id', String(target.targetId || ''));
      topUrlsBlock.textContent = 'Top popular URLs: loading...';

      const lighthouseSummary = summarizeLighthouseMetrics(target.pagesScanned);
      const lighthouseBlock = document.createElement('div');
      lighthouseBlock.className = 'small-muted-inline small-block-gap';

      const lighthouseLabel = document.createElement('span');
      lighthouseLabel.textContent = 'Lighthouse: ';
      lighthouseBlock.appendChild(lighthouseLabel);

      const metrics = [
        { label: 'Perf', key: 'performance', value: lighthouseSummary.performance, suffix: '' },
        { label: 'FCP', key: 'fcp', value: lighthouseSummary.fcp, suffix: 'ms' },
        { label: 'LCP', key: 'lcp', value: lighthouseSummary.lcp, suffix: 'ms' },
        { label: 'SI', key: 'speedIndex', value: lighthouseSummary.speedIndex, suffix: 'ms' }
      ];

      metrics.forEach((metric, idx) => {
        const metricSpan = document.createElement('span');
        metricSpan.style.color = metricColor(metric.key, metric.value);
        metricSpan.textContent = metric.label + ' ' + String(metric.value === null ? 'n/a' : metric.value) + metric.suffix;
        lighthouseBlock.appendChild(metricSpan);
        if (idx < metrics.length - 1) {
          lighthouseBlock.appendChild(document.createTextNode(' | '));
        }
      });

      const reportLinks = document.createElement('div');
      reportLinks.className = 'small-muted-inline small-block-gap';
      const reportMdLink = document.createElement('a');
      reportMdLink.href = 'reports/' + target.targetId + '_issues.md';
      reportMdLink.textContent = 'Details';
      const divider = document.createTextNode(' | ');
      const reportCsvLink = document.createElement('a');
      reportCsvLink.href = 'reports/' + target.targetId + '_issues.csv';
      reportCsvLink.textContent = 'Data';
      reportLinks.appendChild(reportMdLink);
      reportLinks.appendChild(divider);
      reportLinks.appendChild(reportCsvLink);

      recommendationsCell.appendChild(recommendationBody);
      recommendationsCell.appendChild(lighthouseBlock);
      recommendationsCell.appendChild(topUrlsBlock);
      recommendationsCell.appendChild(reportLinks);

      tr.appendChild(domainCell);
      tr.appendChild(pagesCell);
      tr.appendChild(scoreCell);
      tr.appendChild(recommendationsCell);
      tbodyEl.appendChild(tr);
    });

  fetchJsonWithRetry('runs/top-task-seeds.json', { retries: 2, timeoutMs: 6000 })
    .then(snapshot => {
      const targets = Array.isArray(snapshot && snapshot.targets) ? snapshot.targets : [];
      targets.forEach(entry => {
        if (entry && typeof entry.targetId === 'string' && typeof entry.estimatedIndexedPages === 'number') {
          sizeEstimateByTarget.set(entry.targetId, entry.estimatedIndexedPages);
        }
        if (entry && typeof entry.targetId === 'string' && Array.isArray(entry.topUrls)) {
          const safeTopUrls = entry.topUrls.filter(url => typeof url === 'string').slice(0, 3);
          topUrlsByTarget.set(entry.targetId, safeTopUrls);
        }
      });

      const estimateNodes = document.querySelectorAll('[data-size-estimate-target-id]');
      estimateNodes.forEach(node => {
        const targetId = node.getAttribute('data-size-estimate-target-id') || '';
        node.textContent = formatEstimatedDomainSize(sizeEstimateByTarget.get(targetId));
      });

      const scannedSummaryNodes = document.querySelectorAll('[data-scanned-summary-target-id]');
      scannedSummaryNodes.forEach(node => {
        const targetId = node.getAttribute('data-scanned-summary-target-id') || '';
        const match = data.find(target => String(target && target.targetId ? target.targetId : '') === targetId);
        const scannedCount = match && Array.isArray(match.pagesScanned) ? match.pagesScanned.length : 0;
        const completion = estimateDomainCompletion(scannedCount, sizeEstimateByTarget.get(targetId), match ? match.scanDurationMs : 0);
        if (completion.estimated && completion.estimated > 0) {
          node.textContent = formatNumber(scannedCount) + ' / ' + formatNumber(completion.estimated) + ' pages scanned';
        } else {
          node.textContent = formatNumber(scannedCount) + ' pages scanned';
        }
      });

      const progressFillNodes = document.querySelectorAll('[data-progress-fill-target-id]');
      progressFillNodes.forEach(node => {
        const targetId = node.getAttribute('data-progress-fill-target-id') || '';
        const match = data.find(target => String(target && target.targetId ? target.targetId : '') === targetId);
        const scannedCount = match && Array.isArray(match.pagesScanned) ? match.pagesScanned.length : 0;
        const completion = estimateDomainCompletion(scannedCount, sizeEstimateByTarget.get(targetId), match ? match.scanDurationMs : 0);
        node.style.width = completion.coverageRatio === null
          ? '0%'
          : String(Math.max(0, Math.min(100, Math.round(completion.coverageRatio * 100)))) + '%';
      });

      const progressMetaNodes = document.querySelectorAll('[data-progress-meta-target-id]');
      progressMetaNodes.forEach(node => {
        const targetId = node.getAttribute('data-progress-meta-target-id') || '';
        const match = data.find(target => String(target && target.targetId ? target.targetId : '') === targetId);
        const scannedCount = match && Array.isArray(match.pagesScanned) ? match.pagesScanned.length : 0;
        const completion = estimateDomainCompletion(scannedCount, sizeEstimateByTarget.get(targetId), match ? match.scanDurationMs : 0);
        node.textContent = buildCoverageMetaText(completion);
      });

      const topUrlNodes = document.querySelectorAll('[data-top-urls-target-id]');
      topUrlNodes.forEach(node => {
        const targetId = node.getAttribute('data-top-urls-target-id') || '';
        const topUrls = topUrlsByTarget.get(targetId) || [];
        while (node.firstChild) {
          node.removeChild(node.firstChild);
        }

        if (!Array.isArray(topUrls) || topUrls.length === 0) {
          node.textContent = 'Top popular URLs: n/a';
          return;
        }

        const label = document.createElement('span');
        label.textContent = 'Top popular URLs: ';
        node.appendChild(label);

        topUrls.forEach((url, index) => {
          const link = document.createElement('a');
          link.href = String(url);
          link.textContent = String(url);
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          node.appendChild(link);

          if (index < topUrls.length - 1) {
            node.appendChild(document.createTextNode(' | '));
          }
        });
      });
    })
    .catch(() => {
      const topUrlNodes = document.querySelectorAll('[data-top-urls-target-id]');
      topUrlNodes.forEach(node => {
        node.textContent = 'Top popular URLs: n/a';
      });
    });

  fetchJsonWithRetry('runs/index.json', { retries: 2, timeoutMs: 6000 })
    .then(async index => {
      if (!index || !Array.isArray(index.runs) || index.runs.length === 0) {
        const emptyRow = document.createElement('tr');
        const emptyCell = document.createElement('td');
        emptyCell.colSpan = 5;
        emptyCell.textContent = 'No historical runs available yet.';
        emptyRow.appendChild(emptyCell);
        historyBodyEl.appendChild(emptyRow);
        return;
      }

      const runCount = index.runs.length;
      const pagesAcrossRetainedRuns = index.runs.reduce((sum, run) => sum + (Number(run && run.pagesScanned ? run.pagesScanned : 0) || 0), 0);
      const todayPrefix = new Date().toISOString().slice(0, 10);
      const runsToday = index.runs.filter(run => String(run && run.generatedAt ? run.generatedAt : '').startsWith(todayPrefix));
      const pagesToday = runsToday.reduce((sum, run) => sum + (Number(run && run.pagesScanned ? run.pagesScanned : 0) || 0), 0);

      appendTrendCard(
        'Runs Recorded Today',
        String(runsToday.length),
        'Cadence: hourly schedule plus any manual runs.',
        ''
      );
      appendTrendCard(
        'Pages Scanned Today',
        formatNumber(pagesToday),
        'Sum across today\'s recorded runs in run history.',
        ''
      );
      appendTrendCard(
        'Pages Scanned (Retained History)',
        formatNumber(pagesAcrossRetainedRuns),
        'Total across latest ' + String(runCount) + ' runs retained in runs/index.json.',
        ''
      );

      index.runs.slice(0, 20).forEach(run => appendHistoryRow(run));
      await updateUniqueCoverageFromHistory(index);
    })
    .catch(() => {
      const errorRow = document.createElement('tr');
      const errorCell = document.createElement('td');
      errorCell.colSpan = 5;
      errorCell.textContent = 'Run history index could not be loaded.';
      errorRow.appendChild(errorCell);
      historyBodyEl.appendChild(errorRow);
    });

  initThemeToggle();
  updateLiveScanTicker();
  setInterval(updateLiveScanTicker, 30000);

  fetchJsonWithRetry('runs/trends.json', { retries: 2, timeoutMs: 6000 })
    .then(trends => {
      if (!trends || !trends.latest) {
        appendTrendCard('Trend Summary', 'Unavailable', 'No trend data available yet.', '');
        return;
      }

      const delta = trends.deltaFromPrevious;
      const deltaLabel = delta
        ? 'Delta vs previous: ' + formatDelta(delta.totalViolations, ' violations')
        : 'Delta vs previous: n/a';

      const vpp = Number(trends.latest.violationsPerPage || 0).toFixed(3);
      const avgVpp = Number((trends.rollingAverage && trends.rollingAverage.violationsPerPage) || 0).toFixed(3);

      appendTrendCard('Current Violations', String(trends.latest.totalViolations || 0), deltaLabel, 'var(--critical-red)');
      appendTrendCard('Violations Per Page', vpp, '7-run rolling average: ' + avgVpp, '');
      appendTrendCard(
        'Average Scan Duration',
        formatDuration((trends.rollingAverage && trends.rollingAverage.scanDurationMs) || 0),
        'Based on last ' + String(trends.windowSize || 0) + ' run(s) • Runtime budget is intensity-based by schedule window.',
        ''
      );

      const qualityScore = Number(trends.latest.qualityIndexScore || 0).toFixed(2);
      const qualityDelta = delta
        ? 'Delta vs previous: ' + formatDelta(Number(Number(delta.qualityIndexScore || 0).toFixed(2)), ' points')
        : 'Delta vs previous: n/a';
      const gate = String(trends.latest.qualityGateStatus || 'WARNING');
      const qualityAccent = gate === 'BLOCKED'
        ? 'var(--critical-red)'
        : gate === 'WARNING'
          ? '#9a6700'
          : '#1a7f37';

      appendTrendCard('Federal Quality Index', qualityScore + ' / 100', 'Gate: ' + gate + ' • ' + qualityDelta, qualityAccent);

      const providers = Array.isArray(trends.latest.providerAttributionTop) ? trends.latest.providerAttributionTop : [];
      const providerSummary = providers.length > 0
        ? providers.slice(0, 3).map(item => item.provider + ' (H:' + String(item.high) + ' M:' + String(item.medium) + ' L:' + String(item.low) + ')').join(' • ')
        : 'No provider attribution signals in latest run.';
      appendTrendCard('Top Third-Party Providers', String(providers.length), providerSummary, '');

      const consensus = trends.latest.consensus || {
        consensusFailure: 0,
        alfaOnlyFailure: 0,
        axeOnlyFailure: 0,
        totalCorrelatedFindings: 0
      };
      appendTrendCard(
        'Consensus Failures',
        String(consensus.consensusFailure || 0),
        'Detected by both Alfa and Axe in latest run.',
        'var(--critical-red)'
      );
      appendTrendCard(
        'Axe-only Failures',
        String(consensus.axeOnlyFailure || 0),
        'Detected only by Axe in latest run.',
        '#005ea2'
      );
      appendTrendCard(
        'Alfa-only Failures',
        String(consensus.alfaOnlyFailure || 0),
        'Detected only by Alfa in latest run.',
        '#9a6700'
      );

      const freshness = trends.latest.urlFreshness || {};
      const newUrlPercent = Number(freshness.newUrlPercent || 0).toFixed(2);
      const newUrls = Number(freshness.newUrls || 0);
      const carriedOverUrls = Number(freshness.carriedOverUrls || 0);
      appendTrendCard('URL Freshness', newUrlPercent + '% new', 'New: ' + String(newUrls) + ' • Carried over: ' + String(carriedOverUrls), '');

      const complianceSeries = Array.isArray(trends.requirementComplianceOverTime) ? trends.requirementComplianceOverTime : [];
      drawComplianceChart(complianceSeries);

      const latestCompliance = complianceSeries.length > 0 ? complianceSeries[complianceSeries.length - 1].compliancePercentages : null;
      const caption = document.getElementById('compliance-caption');
      if (caption && latestCompliance) {
        caption.textContent =
          'Latest run: WCAG 2.0 AA ' + String(Number(latestCompliance.wcag20AALegalBaseline || 0).toFixed(1)) +
          '%, WCAG 2.1 AA ' + String(Number(latestCompliance.wcag21AA || 0).toFixed(1)) +
          '%, WCAG 2.2 AA ' + String(Number(latestCompliance.wcag22AATarget || 0).toFixed(1)) +
          '%, A11y no violations ' + String(Number(latestCompliance.accessibilityNoViolations || 0).toFixed(1)) +
          '%, Performance>=70 ' + String(Number(latestCompliance.performanceThreshold || 0).toFixed(1)) +
          '%, Grade<=8 ' + String(Number(latestCompliance.plainLanguageGrade || 0).toFixed(1)) +
          '%, No ambiguous links ' + String(Number(latestCompliance.plainLanguageLinks || 0).toFixed(1)) +
          '%, Completed ' + String(Number(latestCompliance.completedStatus || 0).toFixed(1)) + '%.';
      }
    })
    .catch(() => {
      appendTrendCard('Trend Summary', 'Unavailable', 'Trend data could not be loaded.', '');
      drawComplianceChart([]);
    });

  fetchJsonWithRetry('runs/domain-ongoing.json', { retries: 2, timeoutMs: 6000 })
    .then(payload => {
      const reports = Array.isArray(payload && payload.reports) ? payload.reports : [];
      if (reports.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 5;
        cell.textContent = 'No ongoing domain reports available yet.';
        row.appendChild(cell);
        ongoingBodyEl.appendChild(row);
        return;
      }

      reports.forEach(report => {
        const row = document.createElement('tr');

        const domainCell = document.createElement('td');
        const strong = document.createElement('strong');
        strong.textContent = String(report.targetId || '').toUpperCase();
        const br = document.createElement('br');
        const small = document.createElement('small');
        small.textContent = String(report.domain || '');
        domainCell.appendChild(strong);
        domainCell.appendChild(br);
        domainCell.appendChild(small);

        const periodCell = document.createElement('td');
        const periodStart = String((report.period && report.period.start) || '').slice(0, 10);
        const periodEnd = String((report.period && report.period.end) || '').slice(0, 10);
        const runCount = Number((report.period && report.period.runCount) || 0);
        periodCell.textContent = periodStart + ' to ' + periodEnd + ' (' + String(runCount) + ' run(s))';

        const indicatorsCell = document.createElement('td');
        const indicators = report.qualityIndicators || {};
        indicatorsCell.textContent =
          'V/Page: ' + String(Number(indicators.violationsPerPage || 0).toFixed(3)) +
          ' | Perf: ' + String(indicators.averagePerformanceScore || 'n/a') +
          ' | Grade: ' + String(indicators.averageFleschKincaidGrade || 'n/a') +
          ' | Completion: ' + String(Number(indicators.completionRate || 0).toFixed(1)) + '%';

        const suggestionsCell = document.createElement('td');
        const suggestions = Array.isArray(report.suggestions) ? report.suggestions : [];
        suggestionsCell.textContent = suggestions.slice(0, 2).join(' ');

        const pagesCell = document.createElement('td');
        const pages = Array.isArray(report.pagesNeedingMostImprovement) ? report.pagesNeedingMostImprovement : [];
        if (pages.length === 0) {
          pagesCell.textContent = 'No high-priority pages identified in latest run.';
        } else {
          pagesCell.textContent = pages.slice(0, 3).map(item => '[score ' + String(item.priorityScore) + '] ' + String(item.url || '')).join(' | ');
        }

        row.appendChild(domainCell);
        row.appendChild(periodCell);
        row.appendChild(indicatorsCell);
        row.appendChild(suggestionsCell);
        row.appendChild(pagesCell);
        ongoingBodyEl.appendChild(row);
      });
    })
    .catch(() => {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = 'Domain ongoing reports could not be loaded.';
      row.appendChild(cell);
      ongoingBodyEl.appendChild(row);
    });
})();`;
  }
}
