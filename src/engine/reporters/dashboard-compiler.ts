import * as fs from 'fs';
import * as path from 'path';
import { TargetScanResult, PageScanReport } from '../../types/site-quality-spec';
import { QualityIndexReporter, TargetQualityIndexEntry } from './quality-index';
import { DiscoveryNonHtmlExclusion } from '../discovery';
import { DomainRatingScorer } from './domain-rating';
import { DomainAccessibilityRating, LetterGrade } from '../../types/domain-rating';
import { PrioritySeedSnapshot } from '../priority-seeds';
import { UniqueErrorsReporter, UniqueErrorEntry } from './unique-errors';

export class DashboardCompiler {
  private static DIST_DIR = path.resolve(process.cwd(), 'dist');
  private static ASSETS_DIR = path.join(this.DIST_DIR, 'assets');

  /**
   * Compiles global scan runs into an interactive, flat HTML single-page app
   */
  public static compileStaticDashboard(
    allResults: TargetScanResult[],
    options: { nonHtmlDiscoveryExclusions?: DiscoveryNonHtmlExclusion[]; prioritySeedSnapshot?: PrioritySeedSnapshot | null } = {}
  ): void {
    if (!fs.existsSync(this.DIST_DIR)) {
      fs.mkdirSync(this.DIST_DIR, { recursive: true });
    }

    if (!fs.existsSync(this.ASSETS_DIR)) {
      fs.mkdirSync(this.ASSETS_DIR, { recursive: true });
    }

    const targetQualityIndex = QualityIndexReporter.buildTargetQualityIndex(allResults);

    const runsDir = path.join(this.DIST_DIR, 'runs');
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true });
    }
    const summaryPayload = this.buildLatestSummary(allResults, targetQualityIndex);
    fs.writeFileSync(path.join(runsDir, 'latest-summary.json'), JSON.stringify(summaryPayload), 'utf8');

    const uniqueErrors = UniqueErrorsReporter.buildUniqueErrors(allResults);
    fs.writeFileSync(path.join(runsDir, 'unique-errors.json'), JSON.stringify(uniqueErrors), 'utf8');

    const domainRatings = DomainRatingScorer.buildAllDomainRatings(
      allResults,
      options.prioritySeedSnapshot ?? null
    );
    const accessibilityGradesHtml = this.buildAccessibilityGradesHtml(domainRatings);

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
        <a href="#blocked_system_issues">Blocked System Issues</a>
        &nbsp;|&nbsp;
        <a href="#domain-accessibility-grades">Domain Accessibility Grades</a>
        &nbsp;|&nbsp;
        <a href="#domain-ongoing-reports">Domain Ongoing Reports</a>
        &nbsp;|&nbsp;
        <a href="unique-errors/index.html">Cross-Domain Unique Errors</a>
      </p>
    </nav>
    <div class="card" id="blocked_issues">
      <h2 id="blocked_system_issues" tabindex="-1">Blocked System Issues (Latest Run)</h2>
      <p class="muted-small">Pages that were blocked, timed out, failed to scan, or returned HTTP errors. Non-HTML resources (PDFs, ZIPs, etc.) are excluded. See the failures view for the full audit trail.</p>
      <p><a href="failures/index.html">Open failures and skips view</a></p>
      <table id="blocked_issues_table">
        <caption>Blocked, timeout, failed, and HTTP-error pages with reasons from the latest run.</caption>
        <thead>
          <tr>
            <th scope="col">Domain</th>
            <th scope="col">URL</th>
            <th scope="col">Status</th>
            <th scope="col">Reason</th>
            <th scope="col">Timestamp</th>
          </tr>
        </thead>
        <tbody id="blocked_issues_body"></tbody>
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
        <a href="runs/unique-errors.json">Cross-Domain Unique Errors JSON</a>
        &nbsp;|&nbsp;
        <a href="unique-errors/index.html">Cross-Domain Unique Errors View</a>
        &nbsp;|&nbsp;
        <a href="failures/index.html">Failures &amp; Skips View</a>
        &nbsp;|&nbsp;
        <a href="#run-history">Jump to Run History</a>
      </p>
    </div>
    <div class="card">
      <h2 id="pages-scanned-latest-run" tabindex="-1">Pages Scanned (Latest Run)</h2>
      <p id="pages-status-summary" class="muted-small">Loading latest page status summary...</p>
      <div id="pages-status-alert" class="status-alert" role="alert" hidden></div>
      <details id="pages-status-guide" class="status-guide">
        <summary>Status guide and latest run breakdown</summary>
        <p><strong>COMPLETED</strong> means the page was fetched and audited in this run.</p>
        <p><strong>SKIPPED_UNCHANGED</strong> means the page was recently scanned and unchanged, so the scanner reused prior evidence to save time and budget.</p>
        <p><strong>SKIPPED_NON_HTML</strong> means the URL points to a non-HTML resource (e.g. PDF, ZIP) that cannot be scanned for accessibility.</p>
        <p><strong>NOT_FOUND</strong> means the server returned an HTTP error response (e.g. 404) and the page could not be loaded.</p>
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
      <h2 id="domain-accessibility-grades" tabindex="-1">Domain Accessibility Grades (WCAG 2.2 AA)</h2>
      <p class="muted-small">Scores reflect severity-weighted penalties for critical, serious, moderate, and minor WCAG 2.2 AA violations. Systemic failures (same rule on ≥3 pages) and violations on high-traffic pages (DuckDuckGo seed list) are penalised more heavily. Sorted best grade first.</p>
      ${accessibilityGradesHtml}
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
  <script defer src="assets/dashboard.js"></script>
</body>
</html>`;

    fs.writeFileSync(path.join(this.DIST_DIR, 'index.html'), htmlContent, 'utf8');
    this.writeFailuresPage(allResults, options.nonHtmlDiscoveryExclusions ?? []);
    this.writeDomainSubpages(allResults, targetQualityIndex);
    this.writeUniqueErrorsPage(uniqueErrors);
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

    // Shared artifact cache: each run artifact JSON is read from disk at most once,
    // regardless of how many domain sub-pages reference it.
    const artifactCache: Map<string, { results: TargetScanResult[] } | null> = new Map();

    // Load the history index once for all domain compilations.
    const { cachedRunsDir, indexRuns } = this.loadHistoryIndex();

    for (const target of allResults) {
      const safeTargetId = this.sanitizePathSegment(target.targetId);
      const domainDir = path.join(domainsRoot, safeTargetId);
      fs.mkdirSync(domainDir, { recursive: true });

      const quality = targetQualityIndex.find(item => String(item.targetId || '') === String(target.targetId || '')) || null;
      const pages = Array.isArray(target.pagesScanned) ? target.pagesScanned : [];

      // Load historical page data from the previous run so that pages skipped as
      // SKIPPED_UNCHANGED (or not queued at all due to runtime budget) still appear
      // with their last-known audit findings.
      const historicalPages = this.loadHistoricalPagesForTarget(
        String(target.targetId), cachedRunsDir, indexRuns, artifactCache
      );

      // Build per-run violation history for this domain from the cached artifacts.
      const domainRunHistory = cachedRunsDir
        ? this.buildDomainRunHistory(String(target.targetId), cachedRunsDir, indexRuns, artifactCache)
        : [];
      const statusSummary = cachedRunsDir
        ? this.buildDomainStatusSummary(String(target.targetId), cachedRunsDir, indexRuns, artifactCache)
        : null;
      const currentPageUrls = new Set(pages.map(p => String(p?.url || '')));
      const historicalByUrl = new Map(historicalPages.map(p => [String(p.url || ''), p]));

      // For pages in the current run that were skipped without audit data, substitute
      // their equivalent from the previous run if available.
      //
      // We also back-fill individual fields (lighthouse, offlineAudits, thirdPartyImpact)
      // when the current run was an accessibility-only scan: those pages have liveAudits
      // set (with axe violations) but the non-accessibility fields are null.  Without this
      // back-fill the performance/content/third-party subpages would always be empty after
      // any accessibility-only run even though a prior full run already collected the data.
      const currentPagesSupplemented: PageScanReport[] = pages.map(page => {
        const hist = historicalByUrl.get(String(page?.url || ''));
        if (page?.liveAudits === null) {
          // Page was SKIPPED_UNCHANGED or otherwise had no live audit – substitute entirely.
          if (hist?.liveAudits) {
            return { ...hist, status: page?.status ?? hist.status, timestamp: page?.timestamp ?? hist.timestamp };
          }
          return page;
        }
        // Page was audited but may be missing non-accessibility data (accessibility-only run).
        // Back-fill individual fields from history so prior full-scan data is preserved.
        if (hist && (!page.liveAudits.lighthouse || page.offlineAudits === null || page.thirdPartyImpact == null)) {
          return {
            ...page,
            liveAudits: {
              ...page.liveAudits,
              lighthouse: page.liveAudits.lighthouse ?? hist.liveAudits?.lighthouse ?? null
            },
            offlineAudits: page.offlineAudits ?? hist.offlineAudits ?? null,
            thirdPartyImpact: page.thirdPartyImpact ?? hist.thirdPartyImpact ?? null
          };
        }
        return page;
      });

      // Add pages from the previous run that did not appear in this run at all.
      const supplementalPages = historicalPages.filter(p => !currentPageUrls.has(String(p?.url || '')));

      // allKnownPages: use for violation stats and the accessibility table so that
      // accumulated findings remain visible across runs where pages are unchanged.
      const allKnownPages: PageScanReport[] = [...currentPagesSupplemented, ...supplementalPages];
      const hasHistoricalData = supplementalPages.length > 0 ||
        currentPagesSupplemented.some((p, i) => p !== pages[i]);

      const completedPages = pages.filter(page => page?.status === 'COMPLETED').length;
      const skippedPages = pages.filter(page => page?.status === 'SKIPPED_UNCHANGED').length;
      const timeoutPages = pages.filter(page => page?.status === 'TIMEOUT').length;
      const failedPages = pages.filter(page => page?.status === 'FAILED').length;
      const wafBlockedPages = pages.filter(page => page?.status === 'WAF_BLOCKED').length;
      const blockedPages = timeoutPages + failedPages + wafBlockedPages;
      const allViolations = allKnownPages.flatMap(page => page?.liveAudits?.accessibilityViolations || []);
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
        allKnownPages
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
      const latestRunStatusCounts = pages.reduce((acc, page) => {
        const status = String(page?.status || 'UNKNOWN');
        acc.set(status, (acc.get(status) || 0) + 1);
        return acc;
      }, new Map<string, number>());
      const statusSummaryText = statusSummary?.summaryText
        || this.formatStatusSummaryText(latestRunStatusCounts, 'No page statuses recorded in current run.');
      const statusSummaryHeading = statusSummary?.heading || 'Status breakdown (current run)';

      // Group violations by rule for the enhanced accessibility report
      const ruleGroupMap = new Map<string, {
        id: string;
        severity: string;
        description: string;
        helpUrl: string;
        wcagVersion: string;
        sourceEngines: Set<string>;
        pageCount: number;
        instanceCount: number;
        pages: Array<{ url: string; instances: Array<{ html: string; target: string[]; failureSummary: string }> }>;
      }>();
      allKnownPages.forEach(page => {
        const violations = page?.liveAudits?.accessibilityViolations || [];
        violations.forEach(v => {
          const wcagVer = v.wcagVersion || this.deriveWcagVersion(v.impactedCriteria || []);
          // Use a composite key so axe and alfa rules with the same ID are kept separate
          const engine = String(v.sourceEngine || 'axe');
          const groupKey = `${engine}:${v.id}`;
          if (!ruleGroupMap.has(groupKey)) {
            ruleGroupMap.set(groupKey, {
              id: String(v.id || ''),
              severity: String(v.severity || 'minor'),
              description: String(v.description || ''),
              helpUrl: String(v.helpUrl || ''),
              wcagVersion: String(wcagVer || 'n/a'),
              sourceEngines: new Set([engine]),
              pageCount: 0,
              instanceCount: 0,
              pages: []
            });
          }
          const group = ruleGroupMap.get(groupKey);
          if (group) {
            group.sourceEngines.add(engine);
            group.pageCount++;
            group.instanceCount += Array.isArray(v.instances) ? v.instances.length : 0;
            group.pages.push({
              url: String(page.url || ''),
              instances: (Array.isArray(v.instances) ? v.instances : []).map(inst => ({
                html: String(inst.html || ''),
                target: Array.isArray(inst.target) ? inst.target.map(t => String(t || '')) : [],
                failureSummary: String(inst.failureSummary || '')
              }))
            });
          }
        });
      });
      const a11ySeverityOrder = ['critical', 'serious', 'moderate', 'minor'];
      const ruleGroupsSorted = Array.from(ruleGroupMap.values()).sort((a, b) => {
        const si = a11ySeverityOrder.indexOf(a.severity) - a11ySeverityOrder.indexOf(b.severity);
        return si !== 0 ? si : b.pageCount - a.pageCount;
      });
      const totalRuleCards = ruleGroupsSorted.length;
      const axeRuleCount = ruleGroupsSorted.filter(r => r.sourceEngines.has('axe')).length;
      const alfaRuleCount = ruleGroupsSorted.filter(r => r.sourceEngines.has('alfa')).length;
      const wcag20RuleCount = ruleGroupsSorted.filter(r => r.wcagVersion === '2.0').length;
      const wcag21RuleCount = ruleGroupsSorted.filter(r => r.wcagVersion === '2.1').length;
      const wcag22RuleCount = ruleGroupsSorted.filter(r => r.wcagVersion === '2.2').length;
      const topPagesByViolations = allKnownPages
        .map(page => ({
          url: String(page?.url || ''),
          count: Array.isArray(page?.liveAudits?.accessibilityViolations)
            ? page.liveAudits.accessibilityViolations.length
            : 0
        }))
        .filter(p => p.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      const wcagBestPracticeCount = allViolations.filter(v => {
        const ver = v.wcagVersion || this.deriveWcagVersion(v.impactedCriteria || []);
        return ver === 'best-practice';
      }).length;
      const wcagSection508Count = allViolations.filter(v => {
        const ver = v.wcagVersion || this.deriveWcagVersion(v.impactedCriteria || []);
        return ver === 'section508';
      }).length;
      const maxSevCount = Math.max(
        severityCounts.get('critical') || 0,
        severityCounts.get('serious') || 0,
        severityCounts.get('moderate') || 0,
        severityCounts.get('minor') || 0,
        1
      );
      const buildSevBarRow = (label: string, sev: string, count: number): string => {
        const pct = Math.round((count / maxSevCount) * 100);
        return `<div class="a11y-bar-row">
          <span class="a11y-bar-label severity-${sev}">${this.escapeHtml(label)}</span>
          <div class="a11y-bar-track" role="img" aria-label="${this.escapeHtml(label)}: ${this.escapeHtml(count)} issue${count !== 1 ? 's' : ''}">
            <div class="a11y-bar-fill a11y-fill-${sev}" style="width:${pct}%"></div>
          </div>
          <span class="a11y-bar-count">${this.escapeHtml(count)}</span>
        </div>`;
      };
      const ruleCardsHtml = ruleGroupsSorted.map(rule => {
        const sev = String(rule.severity || 'minor').toLowerCase();
        const ruleAnchor = `rule-${this.sanitizePathSegment(rule.id)}`;
        const sevLabel = sev.charAt(0).toUpperCase() + sev.slice(1);
        const sourceEnginesArr = Array.from(rule.sourceEngines).sort();
        const sourcesAttr = sourceEnginesArr.join(',');
        const sourcesBadgesHtml = sourceEnginesArr.map(eng => {
          const engLabel = eng === 'axe' ? 'axe' : eng === 'alfa' ? 'alfa' : this.escapeHtml(eng);
          const engClass = eng === 'axe' ? 'source-axe' : eng === 'alfa' ? 'source-alfa' : '';
          return `<span class="badge source-engine-badge ${engClass}" title="${this.escapeHtml(eng === 'axe' ? 'Found by Deque axe-core' : eng === 'alfa' ? 'Found by Siteimprove Alfa' : eng)}">${engLabel}</span>`;
        }).join('');
        const pagesDetailHtml = rule.pages.map(p => {
          const shownInstances = p.instances.slice(0, 5);
          const moreCount = p.instances.length - shownInstances.length;
          const instancesHtml = shownInstances.map(inst => {
            const targetStr = inst.target.join(' → ') || 'element';
            return `<details class="a11y-instance-details">
              <summary>${this.escapeHtml(targetStr)}</summary>
              <div class="a11y-instance-body">
                ${inst.html ? `<code>${this.escapeHtml(inst.html)}</code>` : ''}
                ${inst.failureSummary ? `<p><strong>Fix:</strong> ${this.escapeHtml(inst.failureSummary)}</p>` : ''}
              </div>
            </details>`;
          }).join('');
          return `<div class="a11y-page-entry">
            <p><a href="${this.escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(p.url)}</a>
            <span class="muted-small">(${this.escapeHtml(p.instances.length)} instance${p.instances.length !== 1 ? 's' : ''})</span></p>
            ${instancesHtml}
            ${moreCount > 0 ? `<p class="muted-small">… and ${this.escapeHtml(moreCount)} more instance${moreCount !== 1 ? 's' : ''} not shown</p>` : ''}
          </div>`;
        }).join('');
        const safeHelpUrl = (() => {
          try {
            const parsed = new URL(rule.helpUrl);
            return (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? rule.helpUrl : '';
          } catch {
            return '';
          }
        })();
        return `<div class="a11y-rule-card" id="${this.escapeHtml(ruleAnchor)}" data-severity="${this.escapeHtml(sev)}" data-sources="${this.escapeHtml(sourcesAttr)}" data-wcag="${this.escapeHtml(rule.wcagVersion)}">
          <div class="a11y-rule-header">
            <h3>
              <span class="severity-${sev}">${this.escapeHtml(sevLabel)}</span>
              <code>${this.escapeHtml(rule.id)}</code>
              <span class="badge">WCAG ${this.escapeHtml(rule.wcagVersion)}</span>
              ${sourcesBadgesHtml}
              <span class="muted-small">${this.escapeHtml(rule.pageCount)} page${rule.pageCount !== 1 ? 's' : ''}, ${this.escapeHtml(rule.instanceCount)} instance${rule.instanceCount !== 1 ? 's' : ''}</span>
            </h3>
          </div>
          <div class="a11y-rule-body">
            <p class="a11y-rule-description">${this.escapeHtml(rule.description)}${safeHelpUrl ? ` <a href="${this.escapeHtml(safeHelpUrl)}" target="_blank" rel="noopener noreferrer">Learn more ↗</a>` : ''}</p>
            <details>
              <summary>${this.escapeHtml(rule.pageCount)} affected page${rule.pageCount !== 1 ? 's' : ''} — expand to see details</summary>
              <div class="a11y-pages-list">${pagesDetailHtml}</div>
            </details>
          </div>
        </div>`;
      }).join('');
      const topPagesRows = topPagesByViolations.map(p =>
        `<tr>
          <td><a href="${this.escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(p.url)}</a></td>
          <td>${this.escapeHtml(p.count)}</td>
        </tr>`
      ).join('');

      const performanceRows = allKnownPages
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

      const contentRows = allKnownPages
        .map(page => {
          const content = page?.offlineAudits?.contentMetrics;
          if (!content) {
            return '';
          }
          const imagesDisplay = (content.contentImageCount !== undefined && content.totalImageCount !== undefined)
            ? `${this.escapeHtml(content.contentImageCount)} / ${this.escapeHtml(content.totalImageCount)}`
            : 'n/a';
          const misspellingsDisplay = (content.misspelledWordCount !== undefined && content.misspelledWordCount > 0 && Array.isArray(content.misspelledWords) && content.misspelledWords.length > 0)
            ? `<details><summary>${this.escapeHtml(content.misspelledWordCount)}</summary><p>${content.misspelledWords.map(w => this.escapeHtml(w)).join(', ')}</p></details>`
            : this.escapeHtml(content.misspelledWordCount ?? 'n/a');
          return `
            <tr>
              <td>${this.escapeHtml(page.url)}</td>
              <td>${this.escapeHtml(content?.fleschKincaidGrade ?? 'n/a')}</td>
              <td>${this.escapeHtml(content?.averageSentenceLength ?? 'n/a')}</td>
              <td>${this.escapeHtml(content?.ambiguousLinkTextCount ?? 'n/a')}</td>
              <td>${this.escapeHtml(content?.suspiciousAltTextCount ?? 'n/a')}</td>
              <td>${this.escapeHtml(content?.wordCount ?? 'n/a')}</td>
              <td>${imagesDisplay}</td>
              <td>${misspellingsDisplay}</td>
            </tr>`;
        })
        .join('');

      const thirdPartyRows = allKnownPages
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
      <p><strong>${this.escapeHtml(statusSummaryHeading)}:</strong> ${this.escapeHtml(statusSummaryText)}</p>
      <p><a href="run-history.html">Run history and run-specific details</a></p>
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
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(String(target.targetId).toUpperCase())} — Accessibility Report</title>
  <link rel="stylesheet" href="../../assets/dashboard.css">
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <header>
    <h1>${this.escapeHtml(String(target.targetId).toUpperCase())} — Accessibility Report</h1>
  </header>
  <main id="main-content">
    <div class="card">
      <h2>Accessibility Findings</h2>
      ${sharedNav}
      <p><strong>${this.escapeHtml(statusSummaryHeading)}:</strong> ${this.escapeHtml(statusSummaryText)}</p>
      <p><a href="run-history.html">Open run-specific history details</a></p>
      ${hasHistoricalData ? '<p class="muted-small"><em>Some findings are from a previous scan run. Pages unchanged since the last scan are shown with their most recent known data (up to ~33 hours of history).</em></p>' : ''}
    </div>

    <div class="a11y-stat-grid">
      <div class="card">
        <h2>By Severity</h2>
        <div class="a11y-bar-chart">
          ${buildSevBarRow('Critical', 'critical', severityCounts.get('critical') || 0)}
          ${buildSevBarRow('Serious', 'serious', severityCounts.get('serious') || 0)}
          ${buildSevBarRow('Moderate', 'moderate', severityCounts.get('moderate') || 0)}
          ${buildSevBarRow('Minor', 'minor', severityCounts.get('minor') || 0)}
        </div>
      </div>
      <div class="card">
        <h2>By WCAG Version</h2>
        <ul class="a11y-wcag-list">
          <li><strong>WCAG 2.0 AA</strong> (legal baseline): <span class="badge">${this.escapeHtml(wcag20Count)}</span></li>
          <li><strong>WCAG 2.1 AA</strong> (recommended): <span class="badge">${this.escapeHtml(wcag21Count)}</span></li>
          <li><strong>WCAG 2.2 AA</strong> (target): <span class="badge">${this.escapeHtml(wcag22Count)}</span></li>
          <li><strong>Section 508</strong>: <span class="badge">${this.escapeHtml(wcagSection508Count)}</span></li>
          <li><strong>Best practice</strong>: <span class="badge">${this.escapeHtml(wcagBestPracticeCount)}</span></li>
          <li class="a11y-wcag-total"><strong>Total violations:</strong> <span class="badge${totalViolations > 0 ? ' alert' : ''}">${this.escapeHtml(totalViolations)}</span></li>
        </ul>
      </div>
    </div>

    ${topPagesByViolations.length > 0 ? `<div class="card">
      <h2>Pages with Most Violations</h2>
      <table>
        <thead><tr><th>URL</th><th>Violations</th></tr></thead>
        <tbody>${topPagesRows}</tbody>
      </table>
    </div>` : ''}

    <div class="card">
      <h2 id="issues-heading" tabindex="-1">Issues by Rule</h2>
      <div class="a11y-filter-bar" role="group" aria-label="Filter by severity">
        <span class="a11y-filter-label">Severity:</span>
        <button class="a11y-filter-btn active" type="button" data-filter-sev="all">All (${this.escapeHtml(totalRuleCards)})</button>
        <button class="a11y-filter-btn" type="button" data-filter-sev="critical">Critical (${this.escapeHtml(severityCounts.get('critical') || 0)})</button>
        <button class="a11y-filter-btn" type="button" data-filter-sev="serious">Serious (${this.escapeHtml(severityCounts.get('serious') || 0)})</button>
        <button class="a11y-filter-btn" type="button" data-filter-sev="moderate">Moderate (${this.escapeHtml(severityCounts.get('moderate') || 0)})</button>
        <button class="a11y-filter-btn" type="button" data-filter-sev="minor">Minor (${this.escapeHtml(severityCounts.get('minor') || 0)})</button>
      </div>
      <div class="a11y-filter-bar" role="group" aria-label="Filter by scan tool">
        <span class="a11y-filter-label">Tool:</span>
        <button class="a11y-filter-btn active" type="button" data-filter-tool="all">All tools (${this.escapeHtml(totalRuleCards)})</button>
        <button class="a11y-filter-btn" type="button" data-filter-tool="axe">axe (${this.escapeHtml(axeRuleCount)})</button>
        <button class="a11y-filter-btn" type="button" data-filter-tool="alfa">alfa (${this.escapeHtml(alfaRuleCount)})</button>
      </div>
      <div class="a11y-filter-bar" role="group" aria-label="Filter by WCAG version">
        <span class="a11y-filter-label">WCAG:</span>
        <button class="a11y-filter-btn active" type="button" data-filter-wcag="all">All versions (${this.escapeHtml(totalRuleCards)})</button>
        <button class="a11y-filter-btn" type="button" data-filter-wcag="2.0">2.0 (${this.escapeHtml(wcag20RuleCount)})</button>
        <button class="a11y-filter-btn" type="button" data-filter-wcag="2.1">2.1 (${this.escapeHtml(wcag21RuleCount)})</button>
        <button class="a11y-filter-btn" type="button" data-filter-wcag="2.2">2.2 (${this.escapeHtml(wcag22RuleCount)})</button>
      </div>
      ${ruleCardsHtml || '<p>No accessibility violations found across current and recent runs.</p>'}
    </div>
  </main>
  ${siteFooterHtml}
  <script>
(function () {
  function getInitialTheme() {
    try { var s = localStorage.getItem('vital.theme'); if (s === 'light' || s === 'dark') return s; } catch (e) {}
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) {}
    return 'light';
  }
  document.documentElement.setAttribute('data-theme', getInitialTheme());

  var activeSev = 'all';
  var activeTool = 'all';
  var activeWcag = 'all';

  function applyFilters() {
    document.querySelectorAll('.a11y-rule-card').forEach(function (card) {
      var sev = card.getAttribute('data-severity') || '';
      var sources = card.getAttribute('data-sources') || '';
      var wcag = card.getAttribute('data-wcag') || '';
      var sevMatch = activeSev === 'all' || sev === activeSev;
      var toolMatch = activeTool === 'all' || sources.split(',').indexOf(activeTool) !== -1;
      var wcagMatch = activeWcag === 'all' || wcag === activeWcag;
      card.setAttribute('data-hidden', (sevMatch && toolMatch && wcagMatch) ? 'false' : 'true');
    });
  }

  document.querySelectorAll('[data-filter-sev]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      activeSev = btn.getAttribute('data-filter-sev') || 'all';
      document.querySelectorAll('[data-filter-sev]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      applyFilters();
    });
  });

  document.querySelectorAll('[data-filter-tool]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      activeTool = btn.getAttribute('data-filter-tool') || 'all';
      document.querySelectorAll('[data-filter-tool]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      applyFilters();
    });
  });

  document.querySelectorAll('[data-filter-wcag]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      activeWcag = btn.getAttribute('data-filter-wcag') || 'all';
      document.querySelectorAll('[data-filter-wcag]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      applyFilters();
    });
  });
})();
  </script>
</body>
</html>`;

      const performanceHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${this.escapeHtml(String(target.targetId).toUpperCase())} Performance</title><link rel="stylesheet" href="../../assets/dashboard.css"></head>
<body><header><h1>${this.escapeHtml(String(target.targetId).toUpperCase())} Performance</h1></header><main><div class="card"><h2>Lighthouse Metrics</h2>${sharedNav}
    <p><strong>${this.escapeHtml(statusSummaryHeading)}:</strong> ${this.escapeHtml(statusSummaryText)}</p>
    <table><thead><tr><th>URL</th><th>Perf</th><th>FCP (ms)</th><th>LCP (ms)</th><th>Speed Index (ms)</th></tr></thead><tbody>${performanceRows || '<tr><td colspan="5">No performance data available in the latest run. This usually means pages were skipped unchanged or no full Lighthouse samples were collected.</td></tr>'}</tbody></table>
</div></main>${siteFooterHtml}</body></html>`;

      const contentHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${this.escapeHtml(String(target.targetId).toUpperCase())} Content</title><link rel="stylesheet" href="../../assets/dashboard.css"></head>
<body><header><h1>${this.escapeHtml(String(target.targetId).toUpperCase())} Content Quality</h1></header><main><div class="card"><h2>Content Metrics</h2>${sharedNav}
    <p><strong>${this.escapeHtml(statusSummaryHeading)}:</strong> ${this.escapeHtml(statusSummaryText)}</p>
    <table><thead><tr><th>URL</th><th>Grade</th><th>Avg Sentence Length</th><th>Ambiguous Links</th><th>Suspicious Alt Text</th><th>Word Count</th><th>Content / Total Images</th><th>Misspellings</th></tr></thead><tbody>${contentRows || '<tr><td colspan="8">No content metrics available in the latest run. Grade appears only when pages are completed with offline content analysis.</td></tr>'}</tbody></table>
</div></main>${siteFooterHtml}</body></html>`;

      const thirdPartyHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${this.escapeHtml(String(target.targetId).toUpperCase())} Third-Party Impact</title><link rel="stylesheet" href="../../assets/dashboard.css"></head>
<body><header><h1>${this.escapeHtml(String(target.targetId).toUpperCase())} Third-Party Impact</h1></header><main><div class="card"><h2>JavaScript Regression Signals</h2>${sharedNav}
    <p><strong>${this.escapeHtml(statusSummaryHeading)}:</strong> ${this.escapeHtml(statusSummaryText)}</p>
    <table><thead><tr><th>URL</th><th>Regression Detected</th><th>Added Violations</th><th>Likely Providers</th></tr></thead><tbody>${thirdPartyRows || '<tr><td colspan="4">No third-party impact data available in the latest run.</td></tr>'}</tbody></table>
</div></main>${siteFooterHtml}</body></html>`;

      const runHistoryHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${this.escapeHtml(String(target.targetId).toUpperCase())} Run History</title><link rel="stylesheet" href="../../assets/dashboard.css"></head>
<body><header><h1>${this.escapeHtml(String(target.targetId).toUpperCase())} Run History</h1></header><main><div class="card"><h2>Run History</h2>${sharedNav}
    <p class="muted-small"><em>Per-run violation counts (pages actively scanned in each run; SKIPPED_UNCHANGED pages contribute to the cumulative findings in the other reports but are not recounted here).</em></p>
    ${domainRunHistory.length > 0 ? `<details open>
      <summary>Show / hide run history table (${this.escapeHtml(domainRunHistory.length)} runs)</summary>
      <table>
        <thead>
          <tr>
            <th>Run</th>
            <th>Date/Time (UTC)</th>
            <th>Pages Scanned</th>
            <th>Violations</th>
          </tr>
        </thead>
        <tbody>
          ${domainRunHistory.map((r, i) => `
          <tr>
            <td>${this.escapeHtml(i + 1)}</td>
            <td>${this.escapeHtml(r.generatedAt ? new Date(r.generatedAt).toISOString().replace('T', ' ').slice(0, 19) : r.runId)}</td>
            <td>${this.escapeHtml(r.pagesScanned)}</td>
            <td>${this.escapeHtml(r.totalViolations)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </details>` : '<p>No retained run history was found for this domain.</p>'}
</div></main>${siteFooterHtml}</body></html>`;

      fs.writeFileSync(path.join(domainDir, 'index.html'), overviewHtml, 'utf8');
      fs.writeFileSync(path.join(domainDir, 'accessibility.html'), accessibilityHtml, 'utf8');
      fs.writeFileSync(path.join(domainDir, 'performance.html'), performanceHtml, 'utf8');
      fs.writeFileSync(path.join(domainDir, 'content.html'), contentHtml, 'utf8');
      fs.writeFileSync(path.join(domainDir, 'third-party.html'), thirdPartyHtml, 'utf8');
      fs.writeFileSync(path.join(domainDir, 'run-history.html'), runHistoryHtml, 'utf8');
    }
  }

  /**
   * Loads the best-known page data for a target from the history cache.
   *
   * The history cache (populated by fetch-history.mjs) contains runs/index.json and
   * individual run artifacts (runs/{runId}.json) but NOT runs/latest.json.  This
   * function therefore reads the index and walks up to MAX_HISTORY_LOOKBACK recent
   * run artifacts (newest first) to build a URL → best-page map.
   *
   * For each URL the newest entry with liveAudits is used as the base.  If that
   * entry is missing sub-fields (e.g. lighthouse after an accessibility-only run, or
   * thirdPartyImpact/offlineAudits after a partial run) those are back-filled from
   * the most recent older run that has them.
   *
   * This ensures that pages skipped as SKIPPED_UNCHANGED, and sub-pages that would
   * otherwise appear empty after a run with many timeouts, still show the most
   * recent known data from any of the last MAX_HISTORY_LOOKBACK runs.
   *
   * Falls back to runs/latest.json if no index is found (legacy / local dev).
   *
   * Accepts a shared artifactCache so the same run artifact files are not read
   * from disk more than once across multiple domain compilations in one run.
   */
  private static loadHistoricalPagesForTarget(
    targetId: string,
    cachedRunsDir: string | null,
    indexRuns: Array<{ artifactPath?: unknown }>,
    artifactCache: Map<string, { results: TargetScanResult[] } | null>
  ): PageScanReport[] {
    if (!cachedRunsDir || !fs.existsSync(cachedRunsDir)) {
      return [];
    }

    // Use ALL available run entries (index keeps at most 200, covering ~33 hours
    // at 10-minute scan intervals – far more than the previous 10-run cap).
    const MAX_HISTORY_LOOKBACK = 200;

    // Collect artifact file paths to inspect, newest run first.
    const artifactPaths: string[] = [];

    if (indexRuns.length > 0) {
      for (const run of indexRuns.slice(0, MAX_HISTORY_LOOKBACK)) {
        // artifactPath is relative to the dist root: "runs/{runId}.json"
        const ap = typeof run?.artifactPath === 'string' ? run.artifactPath : '';
        if (ap.startsWith('runs/') && ap.endsWith('.json')) {
          artifactPaths.push(path.join(cachedRunsDir, path.basename(ap)));
        }
      }
    }

    // Legacy fallback: used in local dev and tests that write latest.json directly.
    if (artifactPaths.length === 0) {
      const latestPath = path.join(cachedRunsDir, 'latest.json');
      if (fs.existsSync(latestPath)) {
        artifactPaths.push(latestPath);
      }
    }

    if (artifactPaths.length === 0) {
      return [];
    }

    // Walk artifacts newest-first.  For each URL, keep the first (newest) entry
    // that has liveAudits.  Where a newer entry is missing sub-fields (lighthouse,
    // offlineAudits, thirdPartyImpact) back-fill them from an older run that has
    // those fields.
    const bestByUrl = new Map<string, PageScanReport>();

    for (const artifactPath of artifactPaths) {
      const artifact = this.readCachedArtifact(artifactPath, artifactCache);
      if (!artifact) {
        continue;
      }

      for (const result of artifact.results) {
        if (!result || typeof result !== 'object') {
          continue;
        }
        const r = result as Record<string, unknown>;
        if (String(r.targetId ?? '') !== String(targetId ?? '')) {
          continue;
        }

        const pagesScanned = r.pagesScanned;
        if (!Array.isArray(pagesScanned)) {
          break;
        }

        for (const p of pagesScanned) {
          if (!p || typeof p !== 'object') {
            continue;
          }
          const page = p as PageScanReport;
          if (typeof page.url !== 'string' || !page.url || page.liveAudits == null) {
            continue;
          }

          const url = page.url;
          const existing = bestByUrl.get(url);
          if (!existing) {
            // First time we see this URL with liveAudits – record it.
            bestByUrl.set(url, page);
          } else {
            // We already have a newer entry for this URL.  Back-fill any
            // sub-fields missing from the newer entry using this older run.
            const existingAudits = existing.liveAudits as NonNullable<PageScanReport['liveAudits']>;
            const needsLighthouse = !existingAudits.lighthouse && !!page.liveAudits?.lighthouse;
            const needsOffline = existing.offlineAudits == null && page.offlineAudits != null;
            const needsThirdParty = existing.thirdPartyImpact == null && page.thirdPartyImpact != null;
            if (needsLighthouse || needsOffline || needsThirdParty) {
              bestByUrl.set(url, {
                ...existing,
                liveAudits: {
                  ...existingAudits,
                  lighthouse: existingAudits.lighthouse ?? page.liveAudits?.lighthouse ?? null
                },
                offlineAudits: existing.offlineAudits ?? page.offlineAudits ?? null,
                thirdPartyImpact: existing.thirdPartyImpact ?? page.thirdPartyImpact ?? null
              });
            }
          }
        }
        break; // Found this target; move to the next artifact.
      }
    }

    return Array.from(bestByUrl.values());
  }

  /**
   * Reads and caches a run artifact from disk.  Subsequent calls for the same
   * path return the cached value without touching the filesystem.  This prevents
   * the same (potentially large) artifact from being read N times when N domain
   * sub-pages are compiled in the same run.
   */
  private static readCachedArtifact(
    fullPath: string,
    cache: Map<string, { results: TargetScanResult[] } | null>
  ): { results: TargetScanResult[] } | null {
    if (cache.has(fullPath)) {
      return cache.get(fullPath) ?? null;
    }
    if (!fs.existsSync(fullPath)) {
      cache.set(fullPath, null);
      return null;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object') {
        cache.set(fullPath, null);
        return null;
      }
      const results = (parsed as Record<string, unknown>).results;
      if (!Array.isArray(results)) {
        cache.set(fullPath, null);
        return null;
      }
      const artifact = { results: results as TargetScanResult[] };
      cache.set(fullPath, artifact);
      return artifact;
    } catch {
      cache.set(fullPath, null);
      return null;
    }
  }

  /**
   * Loads the run index from the history cache.  Returns the path to the cached
   * runs directory and the list of run entries (newest first) for shared use
   * across all domain sub-page compilations.
   */
  private static loadHistoryIndex(): {
    cachedRunsDir: string | null;
    indexRuns: Array<{ runId?: unknown; generatedAt?: unknown; artifactPath?: unknown }>;
  } {
    const historyCacheDir = process.env.VITAL_HISTORY_CACHE_DIR;
    if (!historyCacheDir) {
      return { cachedRunsDir: null, indexRuns: [] };
    }

    const cachedRunsDir = path.resolve(process.cwd(), historyCacheDir, 'runs');
    if (!fs.existsSync(cachedRunsDir)) {
      return { cachedRunsDir, indexRuns: [] };
    }

    const indexPath = path.join(cachedRunsDir, 'index.json');
    if (!fs.existsSync(indexPath)) {
      return { cachedRunsDir, indexRuns: [] };
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
        runs?: Array<unknown>;
      };
      const runs = Array.isArray(parsed?.runs)
        ? (parsed.runs as Array<{ runId?: unknown; generatedAt?: unknown; artifactPath?: unknown }>)
        : [];
      return { cachedRunsDir, indexRuns: runs };
    } catch {
      return { cachedRunsDir, indexRuns: [] };
    }
  }

  /**
   * Builds a chronological list of per-run violation counts for a single domain,
   * using cached artifacts so files are not re-read across domains.
   *
   * Each entry reflects pages that were actively scanned in that run.  Pages
   * skipped as SKIPPED_UNCHANGED appear with liveAudits=null and contribute 0
   * violations to the per-run count (their data lives in the accumulated view).
   */
  private static buildDomainRunHistory(
    targetId: string,
    cachedRunsDir: string,
    indexRuns: Array<{ runId?: unknown; generatedAt?: unknown; artifactPath?: unknown }>,
    artifactCache: Map<string, { results: TargetScanResult[] } | null>
  ): Array<{ runId: string; generatedAt: string; pagesScanned: number; totalViolations: number }> {
    const MAX_HISTORY_LOOKBACK = 200;
    const history: Array<{ runId: string; generatedAt: string; pagesScanned: number; totalViolations: number }> = [];

    for (const run of indexRuns.slice(0, MAX_HISTORY_LOOKBACK)) {
      const ap = typeof run?.artifactPath === 'string' ? run.artifactPath : '';
      if (!ap.startsWith('runs/') || !ap.endsWith('.json')) {
        continue;
      }

      const fullPath = path.join(cachedRunsDir, path.basename(ap));
      const artifact = this.readCachedArtifact(fullPath, artifactCache);
      if (!artifact) {
        continue;
      }

      let pagesInRun = 0;
      let violationsInRun = 0;
      let found = false;

      for (const result of artifact.results) {
        if (!result || typeof result !== 'object') {
          continue;
        }
        const r = result as Record<string, unknown>;
        if (String(r.targetId ?? '') !== String(targetId ?? '')) {
          continue;
        }

        const pagesScanned = r.pagesScanned;
        if (!Array.isArray(pagesScanned)) {
          break;
        }

        for (const p of pagesScanned) {
          if (!p || typeof p !== 'object') {
            continue;
          }
          const page = p as PageScanReport;
          pagesInRun++;
          violationsInRun += page.liveAudits?.accessibilityViolations.length ?? 0;
        }
        found = true;
        break;
      }

      if (found) {
        history.push({
          runId: String(run?.runId ?? ''),
          generatedAt: String(run?.generatedAt ?? ''),
          pagesScanned: pagesInRun,
          totalViolations: violationsInRun
        });
      }
    }

    // Return oldest-first for chronological display.
    return history.reverse();
  }

  private static buildDomainStatusSummary(
    targetId: string,
    cachedRunsDir: string,
    indexRuns: Array<{ runId?: unknown; generatedAt?: unknown; artifactPath?: unknown }>,
    artifactCache: Map<string, { results: TargetScanResult[] } | null>
  ): { heading: string; summaryText: string } | null {
    const MAX_HISTORY_LOOKBACK = 200;
    const LAST_WEEK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const weeklyCounts = new Map<string, number>();
    const retainedCounts = new Map<string, number>();
    let weeklyRuns = 0;
    let retainedRuns = 0;

    for (const run of indexRuns.slice(0, MAX_HISTORY_LOOKBACK)) {
      const ap = typeof run?.artifactPath === 'string' ? run.artifactPath : '';
      if (!ap.startsWith('runs/') || !ap.endsWith('.json')) {
        continue;
      }

      const fullPath = path.join(cachedRunsDir, path.basename(ap));
      const artifact = this.readCachedArtifact(fullPath, artifactCache);
      if (!artifact) {
        continue;
      }

      let found = false;
      for (const result of artifact.results) {
        if (!result || typeof result !== 'object') {
          continue;
        }
        const r = result as Record<string, unknown>;
        if (String(r.targetId ?? '') !== String(targetId ?? '')) {
          continue;
        }

        const pagesScanned = r.pagesScanned;
        if (!Array.isArray(pagesScanned)) {
          break;
        }

        retainedRuns++;
        for (const p of pagesScanned) {
          if (!p || typeof p !== 'object') {
            continue;
          }
          const page = p as PageScanReport;
          const status = String(page?.status || 'UNKNOWN');
          retainedCounts.set(status, (retainedCounts.get(status) || 0) + 1);
        }

        const generatedAtMs = Date.parse(String(run?.generatedAt || ''));
        if (Number.isFinite(generatedAtMs) && (now - generatedAtMs) <= LAST_WEEK_WINDOW_MS) {
          weeklyRuns++;
          for (const p of pagesScanned) {
            if (!p || typeof p !== 'object') {
              continue;
            }
            const page = p as PageScanReport;
            const status = String(page?.status || 'UNKNOWN');
            weeklyCounts.set(status, (weeklyCounts.get(status) || 0) + 1);
          }
        }
        found = true;
        break;
      }

      if (!found) {
        continue;
      }
    }

    if (weeklyRuns > 0 && weeklyCounts.size > 0) {
      return {
        heading: 'Status breakdown (last 7 days)',
        summaryText: this.formatStatusSummaryText(weeklyCounts, 'No page statuses recorded in the last 7 days.')
      };
    }

    if (retainedRuns > 0 && retainedCounts.size > 0) {
      return {
        heading: 'Status breakdown (retained history)',
        summaryText: this.formatStatusSummaryText(retainedCounts, 'No page statuses recorded in retained history.')
      };
    }

    return null;
  }

  private static formatStatusSummaryText(
    statusCounts: Map<string, number>,
    fallback: string
  ): string {
    return Array.from(statusCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => `${status}: ${count}`)
      .join(' | ') || fallback;
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

  /** Builds the server-rendered grades table HTML for the dashboard. */
  private static buildAccessibilityGradesHtml(ratings: DomainAccessibilityRating[]): string {
    if (ratings.length === 0) {
      return `<p>No domain ratings available for the latest run.</p>`;
    }

    const rows = ratings.map(r => {
      const gradeClass = this.gradeToColorClass(r.letterGrade);
      const { critical, serious, moderate, minor } = r.breakdown;
      const priorityPagesText = r.priorityPageCoverage.totalPriorityPages > 0
        ? `${r.priorityPageCoverage.pagesWithViolations} / ${r.priorityPageCoverage.totalPriorityPages}`
        : 'n/a';
      const driver = DomainRatingScorer.buildPenaltyDriverSummary(r);

      return `
        <tr>
          <td><a href="domains/${this.sanitizePathSegment(r.targetId)}/accessibility.html">${this.escapeHtml(r.targetId.toUpperCase())}</a></td>
          <td><span class="grade-badge ${this.escapeHtml(gradeClass)}" aria-label="Grade ${this.escapeHtml(r.letterGrade)}">${this.escapeHtml(r.letterGrade)}</span></td>
          <td>${this.escapeHtml(r.numericScore)}</td>
          <td>${this.escapeHtml(critical.rawCount)}</td>
          <td>${this.escapeHtml(serious.rawCount)}</td>
          <td>${this.escapeHtml(moderate.rawCount)}</td>
          <td>${this.escapeHtml(minor.rawCount)}</td>
          <td>${this.escapeHtml(priorityPagesText)}</td>
          <td class="muted-small">${this.escapeHtml(driver)}</td>
        </tr>`;
    }).join('');

    return `
      <table id="accessibility-grades-table">
        <caption>Domain accessibility grades sorted best-first. Grade scale: A+ (97–100) · A (93–96) · A− (90–92) · B+ (87–89) · B (83–86) · B− (80–82) · C+ (77–79) · C (73–76) · C− (70–72) · D+ (67–69) · D (63–66) · D− (&lt;63).</caption>
        <thead>
          <tr>
            <th scope="col">Domain</th>
            <th scope="col">Grade</th>
            <th scope="col">Score</th>
            <th scope="col">Critical</th>
            <th scope="col">Serious</th>
            <th scope="col">Moderate</th>
            <th scope="col">Minor</th>
            <th scope="col">Priority-page violations</th>
            <th scope="col">Main penalty driver</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  /** Maps a letter grade to a CSS class name for colour coding. */
  private static gradeToColorClass(grade: LetterGrade): string {
    if (grade === 'A+' || grade === 'A' || grade === 'A-') return 'grade-a';
    if (grade === 'B+' || grade === 'B' || grade === 'B-') return 'grade-b';
    if (grade === 'C+' || grade === 'C' || grade === 'C-') return 'grade-c';
    return 'grade-d';
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

  /**
   * Generates a dedicated page listing all unique axe-core violations observed
   * across every scanned domain, ranked by severity and cross-domain breadth.
   * Written to `dist/unique-errors/index.html`.
   */
  private static writeUniqueErrorsPage(uniqueErrors: UniqueErrorEntry[]): void {
    const uniqueErrorsDir = path.join(this.DIST_DIR, 'unique-errors');
    fs.mkdirSync(uniqueErrorsDir, { recursive: true });

    const siteFooterHtml = this.buildSiteFooterHtml();

    const systemicErrors = uniqueErrors.filter(e => e.isSystemic);
    const singleDomainErrors = uniqueErrors.filter(e => !e.isSystemic);

    const totalRules = uniqueErrors.length;
    const systemicCount = systemicErrors.length;

    const buildRuleRows = (errors: UniqueErrorEntry[]): string => {
      if (errors.length === 0) {
        return '<tr><td colspan="7">None detected.</td></tr>';
      }
      return errors.map(e => {
        const safeHelpUrl = (() => {
          try {
            const parsed = new URL(e.helpUrl);
            return (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? e.helpUrl : '';
          } catch { return ''; }
        })();
        const domainList = e.domains
          .map(d => `${this.escapeHtml(d.targetId)} (${this.escapeHtml(d.pageCount)} page${d.pageCount !== 1 ? 's' : ''}, ${this.escapeHtml(d.instanceCount)} instance${d.instanceCount !== 1 ? 's' : ''})`)
          .join(', ');
        return `<tr>
          <td><code>${this.escapeHtml(e.ruleId)}</code>${safeHelpUrl ? ` <a href="${this.escapeHtml(safeHelpUrl)}" target="_blank" rel="noopener noreferrer">↗</a>` : ''}</td>
          <td class="severity-${this.escapeHtml(e.severity)}">${this.escapeHtml(e.severity.charAt(0).toUpperCase() + e.severity.slice(1))}</td>
          <td>${this.escapeHtml(e.description)}</td>
          <td>${this.escapeHtml(String(e.wcagVersion || 'n/a'))}</td>
          <td>${this.escapeHtml(e.totalDomainCount)}</td>
          <td>${this.escapeHtml(e.totalPageCount)}</td>
          <td>${this.escapeHtml(domainList)}</td>
        </tr>`;
      }).join('');
    };

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VITAL-Core Cross-Domain Unique Errors</title>
  <link rel="stylesheet" href="../assets/dashboard.css">
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <header>
    <div class="header-main">
      <h1>VITAL-Core Cross-Domain Unique Accessibility Errors</h1>
      <p><a href="../index.html">Back to main dashboard</a></p>
    </div>
  </header>
  <main id="main-content">
    <div class="metric-grid">
      <div class="card"><h2>Unique Rules</h2><p style="font-size:2rem;font-weight:bold">${this.escapeHtml(totalRules)}</p><p class="muted-small">Distinct axe rule IDs across all domains</p></div>
      <div class="card"><h2>Cross-Domain (Systemic)</h2><p style="font-size:2rem;font-weight:bold">${this.escapeHtml(systemicCount)}</p><p class="muted-small">Rules firing on ≥${UniqueErrorsReporter.SYSTEMIC_DOMAIN_THRESHOLD} domains — system-level issues</p></div>
      <div class="card"><h2>Single-Domain</h2><p style="font-size:2rem;font-weight:bold">${this.escapeHtml(singleDomainErrors.length)}</p><p class="muted-small">Rules isolated to one domain</p></div>
    </div>

    <div class="card">
      <h2 id="systemic-errors" tabindex="-1">Cross-Domain (Systemic) Errors</h2>
      <p class="muted-small">These axe-core rules fire on two or more scanned domains. They likely reflect a shared CMS component, shared template, or third-party script — making them high-value targets for system-level remediation.</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Rule ID</th>
            <th scope="col">Severity</th>
            <th scope="col">Description</th>
            <th scope="col">WCAG</th>
            <th scope="col">Domains</th>
            <th scope="col">Pages</th>
            <th scope="col">Domain Breakdown</th>
          </tr>
        </thead>
        <tbody>${buildRuleRows(systemicErrors)}</tbody>
      </table>
    </div>

    <div class="card">
      <h2 id="single-domain-errors" tabindex="-1">Single-Domain Errors</h2>
      <p class="muted-small">These rules were observed on only one scanned domain in the latest run. They may still be high impact — check the domain accessibility page for details.</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Rule ID</th>
            <th scope="col">Severity</th>
            <th scope="col">Description</th>
            <th scope="col">WCAG</th>
            <th scope="col">Domains</th>
            <th scope="col">Pages</th>
            <th scope="col">Domain Breakdown</th>
          </tr>
        </thead>
        <tbody>${buildRuleRows(singleDomainErrors)}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>Data Export</h2>
      <p><a href="../runs/unique-errors.json">Download unique-errors.json</a> — machine-readable full report including CSS selector patterns per page.</p>
    </div>
  </main>
${siteFooterHtml}
</body>
</html>`;

    fs.writeFileSync(path.join(uniqueErrorsDir, 'index.html'), htmlContent, 'utf8');
  }

    /**
   * Builds a compact summary payload for `dist/runs/latest-summary.json`.
   * Strips all large per-violation evidence (HTML snippets, descriptions, instances)
   * and per-page offline/alfa audit data that is only needed in pre-rendered domain
   * subpages. The dashboard JS loads this file asynchronously instead of relying on
   * megabytes of inline JSON embedded in index.html.
   */
  private static buildLatestSummary(
    allResults: TargetScanResult[],
    targetQuality: TargetQualityIndexEntry[]
  ): {
    generatedAt: string;
    targets: Array<{
      targetId: string;
      domain: string;
      scanDurationMs: number;
      pagesScanned: Array<{
        url: string;
        status: string;
        errorMessage: string | null;
        timestamp: string;
        technologyStack: Array<{ name: string; category: string; version: string | null }>;
        liveAudits: {
          lighthouse: {
            performanceScore: number | null;
            firstContentfulPaintMs?: number | null;
            largestContentfulPaintMs?: number | null;
            speedIndexMs?: number | null;
          } | null;
          accessibilityViolations: Array<Record<string, never>>;
        } | null;
        thirdPartyImpact: { regressionDetected: boolean } | null;
      }>;
    }>;
    targetQuality: TargetQualityIndexEntry[];
  } {
    const targets = allResults.map(target => ({
      targetId: target.targetId,
      domain: target.domain,
      scanDurationMs: target.scanDurationMs,
      pagesScanned: target.pagesScanned.map(page => ({
        url: page.url,
        status: page.status,
        errorMessage: page.errorMessage,
        timestamp: page.timestamp,
        technologyStack: page.technologyStack.map(tech => ({
          name: tech.name,
          category: tech.category,
          version: tech.version
        })),
        liveAudits: page.liveAudits
          ? {
              lighthouse: page.liveAudits.lighthouse
                ? {
                    performanceScore: page.liveAudits.lighthouse.performanceScore,
                    firstContentfulPaintMs: page.liveAudits.lighthouse.firstContentfulPaintMs,
                    largestContentfulPaintMs: page.liveAudits.lighthouse.largestContentfulPaintMs,
                    speedIndexMs: page.liveAudits.lighthouse.speedIndexMs
                  }
                : null,
              // Replace full violation objects with empty stubs to preserve array length
              // while eliminating large evidence HTML payloads (description, instances, helpUrl).
              // The dashboard main view only needs the count; detail is in pre-rendered subpages.
              accessibilityViolations: new Array(
                page.liveAudits.accessibilityViolations.length
              ).fill({}) as Array<Record<string, never>>
            }
          : null,
        thirdPartyImpact: page.thirdPartyImpact
          ? { regressionDetected: page.thirdPartyImpact.regressionDetected }
          : null
      }))
    }));

    return {
      generatedAt: new Date().toISOString(),
      targets,
      targetQuality
    };
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
.status-alert {
  margin: 0.6rem 0 0.75rem;
  padding: 0.75rem 1rem;
  border-left: 4px solid #e5a000;
  background: #fef9e7;
  color: #212121;
  border-radius: 3px;
  font-size: 0.95rem;
}
.status-alert p { margin: 0 0 0.4rem; }
.status-alert p:last-child { margin-bottom: 0; }
.status-alert ul { margin: 0.25rem 0 0 1.2rem; padding: 0; }
.status-alert ul li { margin: 0.2rem 0; }
@media (prefers-color-scheme: dark) {
  html:not([data-theme='light']) .status-alert {
    background: #2b2600;
    color: var(--text-color);
    border-left-color: #e5a000;
  }
}
html[data-theme='dark'] .status-alert {
  background: #2b2600;
  color: var(--text-color);
  border-left-color: #e5a000;
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
.source-engine-badge { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; }
.source-axe { background: #e8f5e9; color: #1b5e20; }
.source-alfa { background: #fff3e0; color: #bf360c; }
.grade-badge {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 3px;
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  min-width: 2.4rem;
  text-align: center;
}
.grade-a {
  background: #d4edda;
  color: #155724;
}
.grade-b {
  background: #d1ecf1;
  color: #0c5460;
}
.grade-c {
  background: #fff3cd;
  color: #856404;
}
.grade-d {
  background: #fbeae5;
  color: var(--critical-red);
}
html[data-theme='dark'] .grade-a,
html:not([data-theme='light']) .grade-a {
  background: #1a4a2a;
  color: #a8d5b5;
}
html[data-theme='dark'] .grade-b,
html:not([data-theme='light']) .grade-b {
  background: #0a2d38;
  color: #82c8d8;
}
html[data-theme='dark'] .grade-c,
html:not([data-theme='light']) .grade-c {
  background: #3d2e00;
  color: #f0c04a;
}
html[data-theme='dark'] .grade-d,
html:not([data-theme='light']) .grade-d {
  background: #3d0a0a;
  color: #ff9f9f;
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
/* ── Accessibility report page styles ── */
.skip-link {
  position: absolute;
  top: -100%;
  left: 1rem;
  padding: 0.5rem 1rem;
  background: var(--surface-bg);
  color: var(--link-color);
  font-weight: bold;
  text-decoration: none;
  border: 2px solid var(--link-color);
  border-radius: 4px;
  z-index: 9999;
}
.skip-link:focus { top: 1rem; }
.a11y-stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
  margin-bottom: 2rem;
}
.a11y-bar-chart { margin-top: 0.5rem; }
.a11y-bar-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.4rem 0;
}
.a11y-bar-label {
  width: 5rem;
  font-size: 0.88rem;
  font-weight: 700;
  text-align: right;
  flex-shrink: 0;
}
.a11y-bar-track {
  flex: 1;
  height: 0.65rem;
  background: var(--light-bg);
  border-radius: 999px;
  overflow: hidden;
}
.a11y-bar-fill {
  height: 100%;
  border-radius: 999px;
}
.a11y-bar-count {
  width: 3rem;
  font-size: 0.88rem;
  text-align: right;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.severity-critical { color: #b50909; font-weight: 700; }
.severity-serious  { color: #6b3300; font-weight: 700; }
.severity-moderate { color: #5c4500; font-weight: 700; }
.severity-minor    { color: var(--muted-color); font-weight: 600; }
html[data-theme='dark'] .severity-critical,
html:not([data-theme='light']) .severity-critical { color: #ff9f9f; }
html[data-theme='dark'] .severity-serious,
html:not([data-theme='light']) .severity-serious  { color: #ffb56e; }
html[data-theme='dark'] .severity-moderate,
html:not([data-theme='light']) .severity-moderate { color: #f0c04a; }
.a11y-fill-critical { background: #b50909; }
.a11y-fill-serious  { background: #9c4400; }
.a11y-fill-moderate { background: #7d5e00; }
.a11y-fill-minor    { background: var(--muted-color); }
.a11y-wcag-list {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
}
.a11y-wcag-list li {
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--border-gray);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.92rem;
}
.a11y-wcag-list li:last-child { border-bottom: none; }
.a11y-wcag-total { margin-top: 0.25rem; }
.a11y-rule-card {
  margin-bottom: 1rem;
  border: 1px solid var(--border-gray);
  border-radius: 4px;
  background: var(--surface-bg);
}
.a11y-rule-card[data-hidden="true"] { display: none; }
.a11y-rule-header {
  padding: 0.75rem 1.1rem;
  border-bottom: 1px solid var(--border-gray);
  background: var(--table-header-bg);
  border-radius: 4px 4px 0 0;
}
.a11y-rule-header h3 {
  margin: 0;
  font-size: 0.98rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}
.a11y-rule-header code {
  font-size: 0.9rem;
  background: var(--light-bg);
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  color: var(--link-color);
  font-weight: 700;
}
.a11y-rule-body {
  padding: 0.9rem 1.1rem;
}
.a11y-rule-body > details > summary {
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--link-color);
}
.a11y-rule-description { margin-bottom: 0.6rem; font-size: 0.93rem; }
.a11y-pages-list { margin-top: 0.5rem; }
.a11y-page-entry {
  margin: 0.5rem 0;
  padding: 0.55rem 0.75rem;
  border-left: 3px solid var(--border-gray);
  font-size: 0.9rem;
}
.a11y-page-entry p { margin: 0 0 0.3rem; }
.a11y-instance-details {
  margin: 0.3rem 0;
  border: 1px solid var(--border-gray);
  border-radius: 3px;
}
.a11y-instance-details > summary {
  cursor: pointer;
  padding: 0.3rem 0.55rem;
  font-size: 0.85rem;
  font-weight: 600;
  background: var(--light-bg);
  border-radius: 3px;
  word-break: break-all;
}
.a11y-instance-body {
  padding: 0.5rem 0.6rem;
  font-size: 0.85rem;
}
.a11y-instance-body code {
  display: block;
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--table-header-bg);
  padding: 0.35rem 0.5rem;
  border-radius: 3px;
  margin: 0.2rem 0;
  font-size: 0.8rem;
  color: var(--link-color);
}
.a11y-instance-body p { margin: 0.3rem 0 0; }
.a11y-filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
  margin-bottom: 1rem;
}
.a11y-filter-label {
  font-weight: 600;
  font-size: 0.92rem;
}
.a11y-filter-btn {
  padding: 0.28rem 0.7rem;
  border: 1px solid var(--border-gray);
  border-radius: 999px;
  background: var(--surface-bg);
  color: var(--text-color);
  font-size: 0.85rem;
  cursor: pointer;
  font-weight: 600;
}
.a11y-filter-btn.active {
  background: var(--gov-light-blue);
  color: #ffffff;
  border-color: var(--gov-light-blue);
}
.a11y-filter-btn:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 2px;
}
`;
  }

  private static buildDashboardJs(): string {
    return String.raw`(function () {
  const REQUEST_TIMEOUT_MS = 8000;

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
  const pagesStatusAlertEl = document.getElementById('pages-status-alert');
  const pagesStatusBreakdownEl = document.getElementById('pages-status-breakdown');
  const blockedBodyEl = document.getElementById('blocked_issues_body');
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
  const summarySubtitleById = new Map();
  let pendingConsensusTotalFindings = null;
  let pendingSoftwareFallback = null;

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

  function setSummarySubtitle(id, subtitle) {
    const subtitleEl = summarySubtitleById.get(id);
    if (subtitleEl && subtitle) {
      subtitleEl.textContent = subtitle;
      subtitleEl.hidden = false;
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

    const subtitleEl = document.createElement('p');
    subtitleEl.style.marginTop = '0.4rem';
    subtitleEl.style.fontSize = '0.85rem';
    subtitleEl.hidden = true;

    wrapper.appendChild(heading);
    wrapper.appendChild(valueEl);
    wrapper.appendChild(subtitleEl);
    summaryEl.appendChild(wrapper);
    summaryValueById.set(id, valueEl);
    summarySubtitleById.set(id, subtitleEl);
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
    const skippedNonHtml = Number(counts.get('SKIPPED_NON_HTML') || 0);
    const timedOut = Number(counts.get('TIMEOUT') || 0);
    const failed = Number(counts.get('FAILED') || 0) + Number(counts.get('WAF_BLOCKED') || 0);
    const notFound = Number(counts.get('NOT_FOUND') || 0);

    if (pagesStatusSummaryEl) {
      const parts = [
        'Latest run summary: ' + String(latestPages.length) + ' pages total',
        String(completed) + ' COMPLETED',
        String(skippedUnchanged) + ' SKIPPED_UNCHANGED',
        String(timedOut) + ' TIMEOUT',
        String(failed) + ' FAILED/WAF_BLOCKED'
      ];
      if (notFound > 0) parts.push(String(notFound) + ' NOT_FOUND');
      if (skippedNonHtml > 0) parts.push(String(skippedNonHtml) + ' SKIPPED_NON_HTML');
      pagesStatusSummaryEl.textContent = parts.join(' • ') + '.';
    }

    if (pagesStatusAlertEl) {
      const alerts = [];
      if (timedOut > 2) {
        alerts.push(
          '<p><strong>⚠️ ' + String(timedOut) + ' TIMEOUT pages detected in this run.</strong></p>' +
          '<p>A high number of timeouts may indicate one or more of the following:</p>' +
          '<ul>' +
          '<li>The target site or its CDN is rate-limiting or throttling scanner requests.</li>' +
          '<li>Pages are slow to load — consider increasing <code>maxTimeoutMs</code> in the scan profile.</li>' +
          '<li>Network instability during the scan window.</li>' +
          '<li>The scanner is hitting too many pages too quickly — consider reducing the batch size or adding delay between requests via <code>VITAL_SAME_SITE_DELAY_MS</code>.</li>' +
          '</ul>' +
          '<p>Check the <a href="failures/index.html">Failures &amp; Skips view</a> for per-page details. If timeouts persist, a force-rescan (<code>--force-rescan</code>) after a quiet period may help confirm whether the issue is load-related.</p>'
        );
      }
      if (skippedUnchanged > 2) {
        alerts.push(
          '<p><strong>✅ ' + String(skippedUnchanged) + ' SKIPPED_UNCHANGED pages in this run.</strong></p>' +
          '<p>Pages are skipped when their content hash matches a recent scan. This is expected and correct behavior — with large sitemaps (thousands of URLs across CMS, Medicare, Medicaid, HHS, and other targets), the scanner deliberately avoids re-auditing content that has not changed, saving time and scan budget. A high skip count means the caching strategy is working as intended.</p>' +
          '<p>The rescan cadence is controlled by <code>VITAL_RESCAN_WINDOW_DAYS</code> and <code>VITAL_REVALIDATE_AFTER_DAYS</code>. Pages are automatically re-queued once the configured window expires. To force a full rescan of all pages regardless of change state, set <code>FORCE_RESCAN=true</code>.</p>'
        );
      }
      if (alerts.length > 0) {
        pagesStatusAlertEl.innerHTML = alerts.join('');
        pagesStatusAlertEl.removeAttribute('hidden');
      } else {
        pagesStatusAlertEl.innerHTML = '';
        pagesStatusAlertEl.setAttribute('hidden', '');
      }
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

      // True total = unique findings across all tools (consensus + axe-only + alfa-only).
      // The "Total Accessibility Violations" summary card shows axe-only raw counts by default;
      // update it here with the cross-tool total once trend data is available.
      const trueTotal = (consensus.consensusFailure || 0) + (consensus.axeOnlyFailure || 0) + (consensus.alfaOnlyFailure || 0);
      pendingConsensusTotalFindings = trueTotal;
      setSummaryMetric('violations-total', String(trueTotal));
      setSummarySubtitle(
        'violations-total',
        'By tool: ' + String(consensus.consensusFailure || 0) + ' consensus (both) · ' +
        String(consensus.axeOnlyFailure || 0) + ' axe-only · ' +
        String(consensus.alfaOnlyFailure || 0) + ' alfa-only'
      );

      appendTrendCard(
        'Consensus Failures',
        String(consensus.consensusFailure || 0),
        'Detected by both Alfa and Axe in latest run. Included in Total.',
        'var(--critical-red)'
      );
      appendTrendCard(
        'Axe-only Failures',
        String(consensus.axeOnlyFailure || 0),
        'Detected only by Axe in latest run. Included in Total.',
        '#005ea2'
      );
      appendTrendCard(
        'Alfa-only Failures',
        String(consensus.alfaOnlyFailure || 0),
        'Detected only by Alfa in latest run. Included in Total.',
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

  fetchJsonWithRetry('runs/latest-summary.json', { retries: 2, timeoutMs: 8000 })
    .then(summary => {
      const data = Array.isArray(summary && summary.targets) ? summary.targets : [];
      const targetQuality = Array.isArray(summary && summary.targetQuality) ? summary.targetQuality : [];
      const targetQualityMap = new Map(targetQuality.map(item => [item.targetId, item]));

      data.forEach(target => {
        let targetViolations = 0;
        let jsRegressionPages = 0;
        (Array.isArray(target.pagesScanned) ? target.pagesScanned : []).forEach(p => {
          totalPages += 1;
          if (p && typeof p.url === 'string' && p.url) {
            currentRunUniquePages.add(p.url);
          }
          const pageStatus = String(p && p.status ? p.status : 'UNKNOWN');
          if (pageStatus === 'FAILED' || pageStatus === 'WAF_BLOCKED' || pageStatus === 'TIMEOUT' || pageStatus === 'NOT_FOUND') {
            const fallbackReason = pageStatus === 'WAF_BLOCKED'
              ? 'Blocked by anti-bot or web application firewall controls.'
              : pageStatus === 'TIMEOUT'
                ? 'Scan timed out before audit completion.'
                : pageStatus === 'NOT_FOUND'
                  ? 'Page returned an HTTP error (e.g. 404 Not Found).'
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

      // Apply software fallback from software-by-domain.json if no tech data from latest-summary.json
      if (softwareFound.size === 0 && pendingSoftwareFallback) {
        pendingSoftwareFallback.found.forEach(name => softwareFound.add(name));
        pendingSoftwareFallback.byDomain.forEach((v, k) => softwareByDomain.set(k, v));
      }
      addSummaryCard('software-total', 'Software found', String(softwareFound.size), '');

      addSummaryCard('blocked-total', 'Total Blocked System Issues', String(blockedEntries.length), blockedEntries.length > 0 ? 'var(--critical-red)' : '');

      // Use cross-tool consensus total if already loaded from trends.json, otherwise fall back
      // to the raw axe violation count until trends data arrives.
      const displayViolations = pendingConsensusTotalFindings !== null ? pendingConsensusTotalFindings : totalViolations;
      addSummaryCard('violations-total', 'Total Accessibility Violations', String(displayViolations), displayViolations > 0 ? 'var(--critical-red)' : '');

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
    })
    .catch(() => {
      if (summaryEl) {
        const loadErrCard = document.createElement('div');
        loadErrCard.className = 'card';
        const loadErrMsg = document.createElement('p');
        loadErrMsg.textContent = 'Dashboard summary data could not be loaded. Please try refreshing.';
        loadErrCard.appendChild(loadErrMsg);
        summaryEl.appendChild(loadErrCard);
      }
    });

  // Fetch software-by-domain.json as a fallback when the latest run was accessibility-only
  // (and therefore produced no technology stack data).  The file is preserved across runs in
  // the history cache, so it contains the most-recently detected software even if the
  // most-recent scan skipped technology fingerprinting.
  fetchJsonWithRetry('runs/software-by-domain.json', { retries: 2, timeoutMs: 6000 })
    .then(payload => {
      if (!payload || !Array.isArray(payload.aggregatedByDomain)) {
        return;
      }

      const newFound = new Set();
      const newByDomain = new Map();

      payload.aggregatedByDomain.forEach(domain => {
        if (!domain || !Array.isArray(domain.technologies) || domain.technologies.length === 0) {
          return;
        }
        const domainAggregate = {
          targetId: String(domain.targetId || ''),
          domain: String(domain.domain || ''),
          categories: new Set(),
          versions: new Set(),
          technologies: new Map()
        };
        domain.technologies.forEach(tech => {
          const displayName = String(tech && tech.name ? tech.name : '').trim();
          const name = displayName.toLowerCase();
          if (!name) {
            return;
          }
          newFound.add(name);
          const existing = {
            displayName,
            categories: new Set(Array.isArray(tech.categories) ? tech.categories : []),
            versions: new Set(Array.isArray(tech.versions) ? tech.versions : [])
          };
          (Array.isArray(tech.categories) ? tech.categories : []).forEach(c => domainAggregate.categories.add(c));
          (Array.isArray(tech.versions) ? tech.versions : []).forEach(v => domainAggregate.versions.add(v));
          domainAggregate.technologies.set(name, existing);
        });
        if (domainAggregate.technologies.size > 0) {
          newByDomain.set(domainAggregate.targetId, domainAggregate);
        }
      });

      if (newFound.size === 0) {
        return;
      }

      // Store as pending fallback so the latest-summary.json callback can also use it
      // when it runs after us.
      pendingSoftwareFallback = { found: newFound, byDomain: newByDomain };

      // If latest-summary.json has already run and found no software, apply the fallback now.
      if (softwareFound.size === 0) {
        newFound.forEach(name => softwareFound.add(name));
        newByDomain.forEach((v, k) => softwareByDomain.set(k, v));
        setSummaryMetric('software-total', String(softwareFound.size));
        renderSoftwareDetections();
      }
    })
    .catch(() => {
      // software-by-domain.json is optional; ignore failures silently.
    });
})();`;
  }
}
