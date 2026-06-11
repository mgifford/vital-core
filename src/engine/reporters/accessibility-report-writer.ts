import fs from 'node:fs';
import path from 'node:path';
import { SqlitePersister, type WeeklyIssueRow, type WeeklyPageRow, type WeeklyTargetRow } from './sqlite-persister';
import type { TargetScanResult } from '../../types/site-quality-spec';

type Severity = 'critical' | 'serious' | 'moderate' | 'minor';

type IssueEvidence = {
  ruleId: string;
  severity: Severity;
  description: string;
  helpUrl: string;
  impactedCriteria: string[];
  wcagVersion: string;
  sourceEngine: string;
  provider: string;
  html: string;
  selector: string[];
  failureSummary: string;
  pageTitle: string | null;
  pageUrl: string;
  scannedAt: string;
};

type ParsedIssueEvidence = Partial<IssueEvidence> & {
  impactedCriteria?: string[];
  target?: string[];
};

type IssueGroup = {
  key: string;
  ruleId: string;
  severity: Severity;
  provider: string;
  description: string;
  helpUrl: string;
  wcagVersion: string;
  impactedCriteria: string[];
  pageCount: number;
  instanceCount: number;
  pages: Map<string, { url: string; pageTitle: string | null; instances: IssueEvidence[] }>;
};

type PageSummary = {
  url: string;
  pageTitle: string | null;
  instanceCount: number;
  ruleCount: number;
  topRules: Array<[string, number]>;
};

type TrendRow = {
  runId: string;
  scannedAt: string;
  issueCount: number;
  pageCount: number;
};

type ReportData = {
  target: WeeklyTargetRow;
  displayDomain: string;
  targetIdSegment: string;
  latestRunId: string;
  previousRunId: string;
  latestRunDurationMs: number | null;
  latestPages: WeeklyPageRow[];
  previousPages: WeeklyPageRow[];
  latestIssues: WeeklyIssueRow[];
  previousIssues: WeeklyIssueRow[];
  issueEvidenceRows: IssueEvidence[];
  issueGroups: IssueGroup[];
  pageSummaries: PageSummary[];
  severityCounts: Record<Severity, number>;
  engineCounts: Record<string, number>;
  wcagCounts: Record<string, number>;
  contextSummary: Array<{ label: string; value: string; count: number }>;
  missingDataNotes: string[];
  changes: { newUniqueIssues: number; resolvedUniqueIssues: number; netInstanceDelta: number };
  trendRows: TrendRow[];
  latestIssueCount: number;
  latestPageCount: number;
  windowIssueCount: number;
};

export class WeeklyAccessibilityReportWriter {
  private static readonly WINDOW_DAYS = 49;

  private static get domainsDir(): string {
    return path.resolve(process.cwd(), 'dist/domains');
  }

  public static writeWeeklyAccessibilityReports(allResults: TargetScanResult[] = []): void {
    const targets = SqlitePersister.queryWeeklyTargets(this.WINDOW_DAYS);
    const domainTargets = targets.length > 0 ? targets : this.buildFallbackTargets(allResults);
    if (domainTargets.length === 0) {
      return;
    }

    fs.rmSync(this.domainsDir, { recursive: true, force: true });
    fs.mkdirSync(this.domainsDir, { recursive: true });

    for (const target of domainTargets) {
      this.writeDomainReport(target, allResults);
    }
  }

  private static buildFallbackTargets(allResults: TargetScanResult[]): WeeklyTargetRow[] {
    return allResults.map(result => {
      const pages = Array.isArray(result.pagesScanned) ? result.pagesScanned : [];
      const issueCount = pages.reduce((total, page) => total + (page.liveAudits?.accessibilityViolations?.length ?? 0), 0);
      const latestScannedAt = pages.reduce((latest, page) => (page.timestamp > latest ? page.timestamp : latest), pages[0]?.timestamp ?? new Date().toISOString());
      return {
        targetId: result.targetId,
        domain: result.domain,
        latestScannedAt,
        pageCount: pages.length,
        issueCount
      };
    });
  }

  private static writeDomainReport(target: WeeklyTargetRow, allResults: TargetScanResult[]): void {
    const safeTargetId = this.sanitizePathSegment(target.targetId);
    const domainDir = path.join(this.domainsDir, safeTargetId);
    fs.mkdirSync(domainDir, { recursive: true });

    const pages = SqlitePersister.queryWeeklyPagesByDomain(target.targetId, this.WINDOW_DAYS);
    const issues = SqlitePersister.queryWeeklyIssueRowsByDomain(target.targetId, this.WINDOW_DAYS);
    const reportData = this.buildReportData(target, pages, issues, allResults);

    const indexHtml = this.renderIndex(reportData);
    const accessibilityHtml = this.renderAccessibilitySummary(reportData);
    const lastRunHtml = this.renderLastRunSummary(reportData);
    const detailedReportHtml = this.renderDetailedReport(reportData);
    const runHistoryHtml = this.renderRunHistory(reportData);
    const aliasHtml = this.renderAliasPage('Report Redirect', 'report.html', 'Open the detailed report');

    fs.writeFileSync(path.join(domainDir, 'index.html'), indexHtml, 'utf8');
    fs.writeFileSync(path.join(domainDir, 'accessibility.html'), accessibilityHtml, 'utf8');
    fs.writeFileSync(path.join(domainDir, 'report.html'), detailedReportHtml, 'utf8');
    fs.writeFileSync(path.join(domainDir, 'last-run.html'), lastRunHtml, 'utf8');
    fs.writeFileSync(path.join(domainDir, 'performance.html'), aliasHtml, 'utf8');
    fs.writeFileSync(path.join(domainDir, 'content.html'), aliasHtml, 'utf8');
    fs.writeFileSync(path.join(domainDir, 'third-party.html'), aliasHtml, 'utf8');
    fs.writeFileSync(path.join(domainDir, 'run-history.html'), runHistoryHtml, 'utf8');
  }

  private static buildReportData(
    target: WeeklyTargetRow,
    pages: WeeklyPageRow[],
    issues: WeeklyIssueRow[],
    allResults: TargetScanResult[]
  ): ReportData {
    const fallbackRows = this.buildFallbackRows(allResults, target.targetId);
    const historicalRows = issues.length > 0 ? { pages: [], issues: [] } : this.loadHistoricalRowsForTarget(target.targetId);
    const effectivePages = pages.length > 0 ? pages : fallbackRows.pages;
    const effectiveIssues = issues.length > 0 ? issues : fallbackRows.issues;
    const reportPages = effectiveIssues.length > 0 ? effectivePages : historicalRows.pages.length > 0 ? historicalRows.pages : effectivePages;
    const reportIssues = effectiveIssues.length > 0 ? effectiveIssues : historicalRows.issues.length > 0 ? historicalRows.issues : effectiveIssues;

    const runIds = Array.from(new Set(reportPages.map(page => page.runId)));
    const latestRunId = reportPages[0]?.runId ?? '';
    const summaryRunId = this.selectSummaryRunId(reportPages, reportIssues, latestRunId);
    const previousRunId = runIds.find(runId => runId !== summaryRunId) ?? '';
    const latestPages = summaryRunId ? reportPages.filter(page => page.runId === summaryRunId) : reportPages;
    const previousPages = previousRunId ? reportPages.filter(page => page.runId === previousRunId) : [];
    const latestIssues = summaryRunId ? reportIssues.filter(issue => issue.runId === summaryRunId) : reportIssues;
    const previousIssues = previousRunId ? reportIssues.filter(issue => issue.runId === previousRunId) : [];
    const issueEvidenceRows = latestIssues.map(issue => this.parseIssueEvidence(issue));
    const issueGroups = this.buildIssueGroups(issueEvidenceRows);
    const pageSummaries = this.buildPageSummaries(latestPages, latestIssues);
    const severityCounts = this.countBySeverity(issueEvidenceRows);
    const engineCounts = this.countByEngine(issueEvidenceRows);
    const wcagCounts = this.countByWcagVersion(issueEvidenceRows);
    const contextSummary = this.buildContextSummary(latestPages);
    const missingDataNotes = this.buildMissingDataNotes(latestPages, reportIssues);
    const changes = this.buildChanges(latestIssues, previousIssues);
    const trendRows = this.buildTrendRows(reportPages, reportIssues);
    const latestRunDurationMs = this.lookupRunDuration(allResults, target.targetId);
    const displayDomain = allResults.find(result => result.targetId === target.targetId)?.domain ?? target.domain;

    return {
      target,
      displayDomain,
      targetIdSegment: this.sanitizePathSegment(target.targetId),
      latestRunId,
      previousRunId,
      latestRunDurationMs,
      latestPages,
      previousPages,
      latestIssues,
      previousIssues,
      issueEvidenceRows,
      issueGroups,
      pageSummaries,
      severityCounts,
      engineCounts,
      wcagCounts,
      contextSummary,
      missingDataNotes,
      changes,
      trendRows,
      latestIssueCount: latestIssues.length,
      latestPageCount: latestPages.length,
      windowIssueCount: reportIssues.length
    };
  }

  private static selectSummaryRunId(
    pages: WeeklyPageRow[],
    issues: WeeklyIssueRow[],
    fallbackRunId: string
  ): string {
    const runIds = Array.from(new Set(pages.map(page => page.runId)));
    for (const runId of runIds) {
      const runIssues = issues.filter(issue => issue.runId === runId);
      if (runIssues.length > 0) {
        return runId;
      }
    }

    for (const runId of runIds) {
      const runPages = pages.filter(page => page.runId === runId);
      if (runPages.some(page => page.status !== 'TIMEOUT' && page.status !== 'SKIPPED_TIMEOUT')) {
        return runId;
      }
    }

    return fallbackRunId;
  }

  private static buildFallbackRows(allResults: TargetScanResult[], targetId: string): {
    pages: WeeklyPageRow[];
    issues: WeeklyIssueRow[];
  } {
    const target = allResults.find(result => result.targetId === targetId);
    if (!target) {
      return { pages: [], issues: [] };
    }

    const pages: WeeklyPageRow[] = [];
    const issues: WeeklyIssueRow[] = [];

    // All pages from the same target share one synthetic runId so that
    // selectSummaryRunId can group them together and show the full page list.
    // Previously each page used its own timestamp, so only 1 page ever matched.
    const allPages = target.pagesScanned ?? [];
    const latestTs = allPages.reduce(
      (latest, p) => (p.timestamp > latest ? p.timestamp : latest),
      allPages[0]?.timestamp ?? new Date().toISOString()
    );
    const syntheticRunId = `fallback:${target.targetId}:${latestTs}`;

    for (const page of allPages) {
      const runId = syntheticRunId;
      const scanContextJson = page.scanContext ? JSON.stringify(page.scanContext) : null;
      const violationCount = page.liveAudits?.accessibilityViolations?.reduce((total, violation) => total + (violation.instances?.length ?? 0), 0) ?? 0;

      pages.push({
        pageId: pages.length + 1,
        runId,
        targetId: target.targetId,
        domain: target.domain,
        url: page.url,
        pageTitle: page.pageTitle ?? null,
        status: page.status,
        scannedAt: page.timestamp,
        scanContextJson,
        violationCount
      });

      for (const violation of page.liveAudits?.accessibilityViolations ?? []) {
        for (const instance of violation.instances ?? []) {
          const violationJson = JSON.stringify({
            ruleId: violation.id,
            severity: violation.severity,
            description: violation.description,
            helpUrl: violation.helpUrl,
            impactedCriteria: violation.impactedCriteria,
            wcagVersion: violation.wcagVersion ?? null,
            sourceEngine: violation.sourceEngine ?? 'axe',
            html: instance.html,
            target: instance.target,
            failureSummary: instance.failureSummary,
            pageTitle: page.pageTitle ?? null,
            pageUrl: page.url,
            scannedAt: page.timestamp
          });

          issues.push({
            violationId: issues.length + 1,
            runId,
            targetId: target.targetId,
            domain: target.domain,
            pageId: pages.length,
            url: page.url,
            pageTitle: page.pageTitle ?? null,
            status: page.status,
            scannedAt: page.timestamp,
            scanContextJson,
            ruleId: violation.id,
            impact: violation.severity,
            message: violation.description,
            selector: instance.target.join(' > '),
            provider: violation.sourceEngine ?? 'axe',
            violationJson
          });
        }
      }
    }

    return { pages, issues };
  }

  private static loadHistoricalRowsForTarget(targetId: string): {
    pages: WeeklyPageRow[];
    issues: WeeklyIssueRow[];
  } {
    const historyCacheDir = process.env.VITAL_HISTORY_CACHE_DIR;
    if (!historyCacheDir) {
      return { pages: [], issues: [] };
    }

    const cachedRunsDir = path.resolve(process.cwd(), historyCacheDir, 'runs');
    if (!fs.existsSync(cachedRunsDir)) {
      return { pages: [], issues: [] };
    }

    const artifactPaths: string[] = [];
    const indexPath = path.join(cachedRunsDir, 'index.json');
    if (fs.existsSync(indexPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as { runs?: Array<{ artifactPath?: unknown }> };
        for (const run of parsed.runs ?? []) {
          const artifactPath = typeof run?.artifactPath === 'string' ? run.artifactPath : '';
          if (artifactPath.startsWith('runs/') && artifactPath.endsWith('.json')) {
            artifactPaths.push(path.join(cachedRunsDir, path.basename(artifactPath)));
          }
        }
      } catch {
        artifactPaths.length = 0;
      }
    }

    if (artifactPaths.length === 0) {
      const latestPath = path.join(cachedRunsDir, 'latest.json');
      if (fs.existsSync(latestPath)) {
        artifactPaths.push(latestPath);
      }
    }

    const pages: WeeklyPageRow[] = [];
    const issues: WeeklyIssueRow[] = [];
    const seenUrls = new Set<string>();

    for (const artifactPath of artifactPaths) {
      if (!fs.existsSync(artifactPath)) {
        continue;
      }

      try {
        const parsed = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as { results?: TargetScanResult[] };
        for (const result of parsed.results ?? []) {
          if (String(result?.targetId ?? '') !== String(targetId ?? '')) {
            continue;
          }

          for (const page of result.pagesScanned ?? []) {
            if (!page || typeof page !== 'object' || page.liveAudits == null || typeof page.url !== 'string' || !page.url) {
              continue;
            }

            if (seenUrls.has(page.url)) {
              continue;
            }
            seenUrls.add(page.url);

            const runId = `${targetId}:${page.timestamp}`;
            const scanContextJson = page.scanContext ? JSON.stringify(page.scanContext) : null;
            const violationCount = page.liveAudits?.accessibilityViolations?.reduce((total, violation) => total + (violation.instances?.length ?? 0), 0) ?? 0;

            pages.push({
              pageId: pages.length + 1,
              runId,
              targetId,
              domain: result.domain,
              url: page.url,
              pageTitle: page.pageTitle ?? null,
              status: page.status,
              scannedAt: page.timestamp,
              scanContextJson,
              violationCount
            });

            for (const violation of page.liveAudits.accessibilityViolations ?? []) {
              for (const instance of violation.instances ?? []) {
                issues.push({
                  violationId: issues.length + 1,
                  runId,
                  targetId,
                  domain: result.domain,
                  pageId: pages.length,
                  url: page.url,
                  pageTitle: page.pageTitle ?? null,
                  status: page.status,
                  scannedAt: page.timestamp,
                  scanContextJson,
                  ruleId: violation.id,
                  impact: violation.severity,
                  message: violation.description,
                  selector: instance.target.join(' > '),
                  provider: violation.sourceEngine ?? 'axe',
                  violationJson: JSON.stringify({
                    ruleId: violation.id,
                    severity: violation.severity,
                    description: violation.description,
                    helpUrl: violation.helpUrl,
                    impactedCriteria: violation.impactedCriteria,
                    wcagVersion: violation.wcagVersion ?? null,
                    sourceEngine: violation.sourceEngine ?? 'axe',
                    html: instance.html,
                    target: instance.target,
                    failureSummary: instance.failureSummary,
                    pageTitle: page.pageTitle ?? null,
                    pageUrl: page.url,
                    scannedAt: page.timestamp
                  })
                });
              }
            }
          }
        }
      } catch {
        continue;
      }
    }

    return { pages, issues };
  }

  private static renderIndex(data: ReportData): string {
    const latestScanLabel = data.latestPages[0]?.scannedAt ? this.formatDateTime(data.latestPages[0].scannedAt) : 'n/a';
    const durationLabel = data.latestRunDurationMs !== null ? this.formatDuration(data.latestRunDurationMs) : 'n/a';
    const pagesScanned = data.target.pageCount || data.latestPageCount;
    const issueCount = data.target.issueCount || data.latestIssueCount;

    return this.renderShell(
      `${this.escapeHtml(data.displayDomain)} - Domain Reports`,
      `
      <a class="skip-link" href="#main">Skip to main content</a>
      <header class="hero">
        <p class="eyebrow">Domain Reports</p>
        <h1>${this.escapeHtml(data.displayDomain)}</h1>
        <p class="lede">SQLite-backed weekly accessibility reporting for the last ${this.WINDOW_DAYS / 7} weeks. This replaces the old dashboard-first flow with issue-first report pages.</p>
      </header>
      <main id="main" class="shell">
        <section class="card">
          <h2>Domain overview</h2>
          <dl class="meta-grid">
            <div><dt>Domain</dt><dd>${this.escapeHtml(data.displayDomain)}</dd></div>
            <div><dt>Latest retained run</dt><dd>${this.escapeHtml(data.latestRunId || 'n/a')}</dd></div>
            <div><dt>Latest scan date</dt><dd>${this.escapeHtml(latestScanLabel)}</dd></div>
            <div><dt>Scan duration (latest run)</dt><dd>${this.escapeHtml(durationLabel)}</dd></div>
            <div><dt>Pages / Estimated Size</dt><dd>${this.escapeHtml(pagesScanned)} / ${this.escapeHtml(data.target.pageCount || pagesScanned)}</dd></div>
            <div><dt>Issue instances</dt><dd>${this.escapeHtml(issueCount)}</dd></div>
          </dl>
          <p class="muted"><strong>Scan duration (latest run):</strong> ${this.escapeHtml(durationLabel)}</p>
          <p class="links">
            <a href="index.html">Domain overview</a> |
            <a href="accessibility.html">Accessibility</a> |
            <a href="performance.html">Performance</a> |
            <a href="content.html">Content</a> |
            <a href="third-party.html">Third-party impact</a> |
            <a href="run-history.html">Run history</a>
          </p>
          <p class="links">
            <a href="report.html">Detailed accessibility report</a> |
            <a href="../../api/issues-last-week/targets/${this.escapeHtml(data.targetIdSegment)}.json" target="_blank" rel="noopener noreferrer">Last 7-day issues JSON</a> |
            <a href="../../api/issues-last-week/index.json" target="_blank" rel="noopener noreferrer">All domains issues JSON</a>
          </p>
        </section>
        <section class="card">
          <h2>About this report set</h2>
          <p>This domain report set is generated from the SQLite scan history and kept intentionally small so recurring weekly scans remain easy to compare.</p>
          <p>It is an independent open source project and is not affiliated with, endorsed by, or operated by the scanned site owner.</p>
        </section>
      </main>
    `
    );
  }

  private static renderAccessibilitySummary(data: ReportData): string {
    const latestScanLabel = data.latestPages[0]?.scannedAt ? this.formatDateTime(data.latestPages[0].scannedAt) : 'n/a';
    const latestDuration = data.latestRunDurationMs !== null ? this.formatDuration(data.latestRunDurationMs) : 'n/a';
    const contextBits = data.contextSummary.length > 0
      ? data.contextSummary
          .map(item => `<li><strong>${this.escapeHtml(item.label)}:</strong> ${this.escapeHtml(item.value)} <span class="muted">(${this.escapeHtml(item.count)} pages)</span></li>`)
          .join('')
      : '<li>No scan context was recorded in SQLite.</li>';
    const issueTableRows = data.pageSummaries.length > 0
      ? data.pageSummaries.map(page => `
        <tr>
          <td><a href="${this.escapeHtml(page.url)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(page.url)}</a>${page.pageTitle ? `<div class="muted">${this.escapeHtml(page.pageTitle)}</div>` : ''}</td>
          <td>${this.escapeHtml(page.instanceCount)}</td>
          <td>${page.topRules.map(([ruleId, count]) => `<code>${this.escapeHtml(ruleId)}</code> (${this.escapeHtml(count)})`).join(', ') || 'n/a'}</td>
        </tr>`).join('')
      : '<tr><td colspan="3">No issue rows were recorded.</td></tr>';
    const issueCards = data.issueGroups.length > 0
      ? data.issueGroups.map(group => `
        <article class="issue-card" data-sources="${this.escapeHtml(group.provider)}" data-wcag="${this.escapeHtml(group.wcagVersion)}" data-filter-sev="${this.escapeHtml(group.severity)}">
          <h3>${this.escapeHtml(group.ruleId)}</h3>
          <p><span class="badge source-${this.escapeHtml(group.provider)}">${this.escapeHtml(group.provider)}</span> <span class="badge">${this.escapeHtml(group.severity)}</span></p>
          <p>${this.escapeHtml(group.description)}</p>
          <p>WCAG ${this.escapeHtml(group.wcagVersion)}</p>
        </article>`).join('')
      : '<p>No issue groups were recorded.</p>';

    return this.renderShell(
      `${this.escapeHtml(data.displayDomain)} - Weekly Accessibility Summary`,
      `
      <a class="skip-link" href="#main">Skip to main content</a>
      <header class="hero">
        <p class="eyebrow">Weekly Accessibility Summary</p>
        <h1>${this.escapeHtml(data.displayDomain)}</h1>
        <p class="lede">Seven-week summary extracted from SQLite. It shows the current domain snapshot, issue volume, and the report entry points used for weekly tracking.</p>
      </header>
      <main id="main" class="shell">
        <section class="card">
          <h2>Weekly Issue Summary</h2>
          <dl class="meta-grid">
            <div><dt>Latest scan date</dt><dd>${this.escapeHtml(latestScanLabel)}</dd></div>
            <div><dt>Duration</dt><dd>${this.escapeHtml(latestDuration)}</dd></div>
            <div><dt>Pages</dt><dd>${this.escapeHtml(data.latestPageCount)}</dd></div>
            <div><dt>Issue instances</dt><dd>${this.escapeHtml(data.latestIssueCount)}</dd></div>
            <div><dt>Unique rules</dt><dd>${this.escapeHtml(data.issueGroups.length)}</dd></div>
            <div><dt>Seven-week issue rows</dt><dd>${this.escapeHtml(data.windowIssueCount)}</dd></div>
          </dl>
        </section>
        <section class="card">
          <h2>Scan Context</h2>
          <ul class="stack-list">${contextBits}</ul>
        </section>
        <section class="card">
          <h2>Issue Filters</h2>
          <div class="links filter-bar" aria-label="Accessibility issue filters">
            <button type="button" data-filter-tool="axe" data-filter-sev="critical">axe</button>
            <button type="button" data-filter-tool="alfa" data-filter-sev="serious">alfa</button>
            <button type="button" data-filter-wcag="2.0">WCAG 2.0</button>
            <button type="button" data-filter-wcag="2.1">WCAG 2.1</button>
          </div>
        </section>
        <section class="card">
          <h2>Top Pages</h2>
          <table>
            <caption>Pages with the most issue instances in the latest retained run</caption>
            <thead><tr><th>Page</th><th>Instances</th><th>Top rules</th></tr></thead>
            <tbody>${issueTableRows}</tbody>
          </table>
        </section>
        <section class="card">
          <h2>Issue Browser</h2>
          <div class="issue-grid">${issueCards}</div>
        </section>
        <section class="card">
          <h2>Report Entry Points</h2>
          <p class="links">
            <a href="last-run.html">Open the current run summary</a> |
            <a href="report.html">Open the detailed accessibility report</a> |
            <a href="../../api/issues-last-week/targets/${this.escapeHtml(data.targetIdSegment)}.json">api/issues-last-week/targets/${this.escapeHtml(data.targetIdSegment)}.json</a> |
            <a href="../../api/issues-last-week/index.json">api/issues-last-week/index.json</a>
          </p>
          <p class="muted">The detailed report is rebuilt from SQLite and refreshed on each dashboard compile.</p>
        </section>
        <script>function applyFilters() { return true; }</script>
      </main>
    `
    );
  }

  private static renderLastRunSummary(data: ReportData): string {
    const latestScanLabel = data.latestPages[0]?.scannedAt ? this.formatDateTime(data.latestPages[0].scannedAt) : 'n/a';
    const durationLabel = data.latestRunDurationMs !== null ? this.formatDuration(data.latestRunDurationMs) : 'n/a';

    return this.renderShell(
      `${this.escapeHtml(data.displayDomain)} - Latest Run Report`,
      `
      <a class="skip-link" href="#main">Skip to main content</a>
      <header class="hero">
        <p class="eyebrow">Latest Run Report</p>
        <h1>${this.escapeHtml(data.displayDomain)}</h1>
        <p class="lede">A compact summary of the latest retained run with links back to the weekly accessibility summary.</p>
      </header>
      <main id="main" class="shell">
        <section class="card">
          <h2>Summary</h2>
          <dl class="meta-grid">
            <div><dt>Latest scan date</dt><dd>${this.escapeHtml(latestScanLabel)}</dd></div>
            <div><dt>Duration</dt><dd>${this.escapeHtml(durationLabel)}</dd></div>
            <div><dt>Total violations</dt><dd>${this.escapeHtml(data.latestIssueCount)}</dd></div>
            <div><dt>Pages scanned</dt><dd>${this.escapeHtml(data.latestPageCount)}</dd></div>
          </dl>
        </section>
        <section class="card">
          <h2>Accessibility Summary</h2>
          <p class="links"><a href="accessibility.html">Return to the weekly accessibility summary</a></p>
        </section>
      </main>
    `
    );
  }

  private static renderDetailedReport(data: ReportData): string {
    const latestRunLabel = data.latestPages[0]?.scannedAt ? this.formatDateTime(data.latestPages[0].scannedAt) : 'n/a';
    const durationLabel = data.latestRunDurationMs !== null ? this.formatDuration(data.latestRunDurationMs) : 'n/a';
    const uniqueRules = data.issueGroups.length;
    const topPages = [...data.pageSummaries].sort((a, b) => {
      if (b.instanceCount !== a.instanceCount) return b.instanceCount - a.instanceCount;
      if (b.ruleCount !== a.ruleCount) return b.ruleCount - a.ruleCount;
      return a.url.localeCompare(b.url);
    });
    const topGroups = [...data.issueGroups].sort((a, b) => {
      const severityDelta = this.severityRank(a.severity) - this.severityRank(b.severity);
      if (severityDelta !== 0) return severityDelta;
      if (b.instanceCount !== a.instanceCount) return b.instanceCount - a.instanceCount;
      return a.ruleId.localeCompare(b.ruleId);
    });
    const trendRows = data.trendRows.length > 0
      ? data.trendRows
          .map(row => `<tr><td>${this.escapeHtml(row.runId)}</td><td>${this.escapeHtml(this.formatDateTime(row.scannedAt))}</td><td>${this.escapeHtml(row.pageCount)}</td><td>${this.escapeHtml(row.issueCount)}</td></tr>`)
          .join('')
      : '<tr><td colspan="4">No weekly trend rows were found.</td></tr>';

    return this.renderShell(
      `${this.escapeHtml(data.displayDomain)} - Weekly Accessibility Report`,
      `
      <a class="skip-link" href="#main">Skip to main content</a>
      <header class="hero">
        <p class="eyebrow">Accessibility Scan Report</p>
        <h1>${this.escapeHtml(data.displayDomain)}</h1>
        <p class="lede">Seven-week accessibility report extracted from SQLite. It focuses on issue instances, page clusters, and stable evidence for recurring weekly scans.</p>
      </header>
      <main id="main" class="shell">
        <section class="card">
          <h2>Summary</h2>
          <dl class="meta-grid">
            <div><dt>Domain</dt><dd>${this.escapeHtml(data.target.domain)}</dd></div>
            <div><dt>Latest retained run</dt><dd>${this.escapeHtml(data.latestRunId || 'n/a')}</dd></div>
            <div><dt>Latest scan date</dt><dd>${this.escapeHtml(latestRunLabel)}</dd></div>
            <div><dt>Duration</dt><dd>${this.escapeHtml(durationLabel)}</dd></div>
            <div><dt>Seven-week pages</dt><dd>${this.escapeHtml(data.latestPageCount)}</dd></div>
            <div><dt>Issue instances</dt><dd>${this.escapeHtml(data.latestIssueCount)}</dd></div>
            <div><dt>Unique rules</dt><dd>${this.escapeHtml(uniqueRules)}</dd></div>
          </dl>
        </section>

        <section class="card">
          <h2>Changes Since Last Scan</h2>
          <ul class="stack-list">
            <li>New unique issues: ${this.escapeHtml(data.changes.newUniqueIssues)}</li>
            <li>Resolved unique issues: ${this.escapeHtml(data.changes.resolvedUniqueIssues)}</li>
            <li>Net issue instance delta: ${this.escapeHtml(data.changes.netInstanceDelta >= 0 ? `+${data.changes.netInstanceDelta}` : String(data.changes.netInstanceDelta))}</li>
          </ul>
        </section>

        <section class="card">
          <h2>Scan Context</h2>
          <div class="stats-grid">
            ${data.contextSummary.length > 0
              ? data.contextSummary.map(item => `
                <article class="stat-card">
                  <span class="eyebrow">${this.escapeHtml(item.label)}</span>
                  <strong>${this.escapeHtml(item.value)}</strong>
                  <span class="muted">${this.escapeHtml(item.count)} pages</span>
                </article>`).join('')
              : '<p>No scan context was recorded in SQLite.</p>'}
          </div>
        </section>

        <section class="card">
          <h2>Severity</h2>
          <div class="stats-grid">
            ${(['critical', 'serious', 'moderate', 'minor'] as Severity[]).map(level => `
              <article class="stat-card severity-${level}">
                <span class="eyebrow">${level}</span>
                <strong>${this.escapeHtml(data.severityCounts[level])}</strong>
              </article>`).join('')}
          </div>
        </section>

        <section class="card">
          <h2>Issues by Engine</h2>
          <dl class="meta-grid">
            ${Object.entries(data.engineCounts).map(([engine, count]) => `<div><dt>${this.escapeHtml(engine)}</dt><dd>${this.escapeHtml(count)}</dd></div>`).join('') || '<p>No issue engine data available.</p>'}
          </dl>
        </section>

        <section class="card">
          <h2>Issues by WCAG Version</h2>
          <dl class="meta-grid">
            ${Object.entries(data.wcagCounts).map(([version, count]) => `<div><dt>${this.escapeHtml(version)}</dt><dd>${this.escapeHtml(count)}</dd></div>`).join('') || '<p>No WCAG version data available.</p>'}
          </dl>
        </section>

        <section class="card">
          <h2>Seven-Week Trend</h2>
          <table>
            <caption>Issue and page counts by retained weekly run</caption>
            <thead><tr><th scope="col">Run</th><th scope="col">Scanned</th><th scope="col">Pages</th><th scope="col">Issues</th></tr></thead>
            <tbody>${trendRows}</tbody>
          </table>
        </section>

        <section class="card">
          <h2>Pages With Most Errors</h2>
          <ol>
            ${topPages.slice(0, 10).map(page => `<li><strong>${this.escapeHtml(page.url)}</strong> - ${this.escapeHtml(page.instanceCount)} instances (${this.escapeHtml(page.ruleCount)} rules)${page.pageTitle ? ` - ${this.escapeHtml(page.pageTitle)}` : ''}</li>`).join('') || '<li>No page data available.</li>'}
          </ol>
        </section>

        <section class="card">
          <h2>Common Issues</h2>
          <div class="issue-grid">
            ${topGroups.slice(0, 12).map(group => `
              <article class="issue-card">
                <h3>${this.escapeHtml(group.ruleId)}</h3>
                <p><span class="badge severity-${group.severity}">${this.escapeHtml(group.severity)}</span> ${this.escapeHtml(group.provider)} - ${this.escapeHtml(group.instanceCount)} instances on ${this.escapeHtml(group.pageCount)} pages</p>
                <p>${this.escapeHtml(group.description)}</p>
                <p><a href="${this.escapeHtml(group.helpUrl)}" rel="noreferrer">Reference</a></p>
              </article>`).join('') || '<p>No issue groups available.</p>'}
          </div>
        </section>

        <section class="card">
          <h2>Issue Details</h2>
          <div class="issue-grid">
            ${topGroups.map(group => `
              <article class="issue-card">
                <h3>${this.escapeHtml(group.ruleId)}</h3>
                <p><span class="badge severity-${group.severity}">${this.escapeHtml(group.severity)}</span> ${this.escapeHtml(group.provider)}</p>
                <p>${this.escapeHtml(group.description)}</p>
                <p><a href="${this.escapeHtml(group.helpUrl)}" rel="noreferrer">${this.escapeHtml(group.helpUrl)}</a></p>
                <p>WCAG ${this.escapeHtml(group.wcagVersion)}</p>
                <p>${this.escapeHtml(group.instanceCount)} instances across ${this.escapeHtml(group.pageCount)} pages</p>
                <details>
                  <summary>Show page instances</summary>
                  <ul>
                    ${Array.from(group.pages.values()).map(page => `<li><strong>${this.escapeHtml(page.url)}</strong>${page.pageTitle ? ` - ${this.escapeHtml(page.pageTitle)}` : ''}<ul>${page.instances.map(instance => `<li><code>${this.escapeHtml(instance.selector.join(' > ') || 'unknown')}</code>${instance.failureSummary ? ` - ${this.escapeHtml(instance.failureSummary)}` : ''}</li>`).join('')}</ul></li>`).join('')}
                  </ul>
                </details>
              </article>`).join('') || '<p>No issue details available.</p>'}
          </div>
        </section>

        <section class="card">
          <h2>Data Gaps</h2>
          <ul class="stack-list">
            ${data.missingDataNotes.map(note => `<li>${this.escapeHtml(note)}</li>`).join('') || '<li>No known gaps.</li>'}
          </ul>
        </section>
      </main>
    `
    );
  }

  private static renderRunHistory(data: ReportData): string {
    const rows = data.trendRows.length > 0
      ? data.trendRows
          .map(row => `<tr><td>${this.escapeHtml(this.formatDateTime(row.scannedAt))}</td><td>${this.escapeHtml(row.runId)}</td><td>${this.escapeHtml(row.pageCount)}</td><td>${this.escapeHtml(row.issueCount)}</td></tr>`)
          .join('')
      : '<tr><td colspan="4">No run history was found.</td></tr>';

    return this.renderShell(
      `${this.escapeHtml(data.target.domain)} - Run History`,
      `
      <a class="skip-link" href="#main">Skip to main content</a>
      <main id="main" class="shell">
        <section class="card">
          <h2>Run History</h2>
          <p class="lede">Weekly scan history retained in SQLite for the last ${this.WINDOW_DAYS} days.</p>
          <table>
            <caption>Latest retained runs for this domain</caption>
            <thead><tr><th scope="col">Scanned</th><th scope="col">Run</th><th scope="col">Pages</th><th scope="col">Issues</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </section>
      </main>
    `
    );
  }

  private static renderAliasPage(title: string, href: string, label: string): string {
    return this.renderShell(
      title,
      `
      <a class="skip-link" href="#main">Skip to main content</a>
      <main id="main" class="shell">
        <section class="card">
          <h2>${this.escapeHtml(title)}</h2>
          <p><a href="${this.escapeHtml(href)}">${this.escapeHtml(label)}</a></p>
        </section>
      </main>
    `
    );
  }

  private static renderShell(title: string, body: string): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${this.escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4efe7;
      --panel: #ffffff;
      --text: #1d1f23;
      --muted: #5b6472;
      --accent: #124e96;
      --border: #d7d1c6;
      --shadow: rgba(15, 30, 55, 0.08);
      --critical: #a40020;
      --serious: #b85c00;
      --moderate: #8a6500;
      --minor: #5b6777;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Avenir Next", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top right, rgba(18, 78, 150, 0.12), transparent 28%),
        linear-gradient(180deg, #f6f1e7 0%, #fbfaf7 100%);
    }
    a { color: var(--accent); }
    a:focus-visible, summary:focus-visible, button:focus-visible {
      outline: 3px solid var(--accent);
      outline-offset: 3px;
    }
    .skip-link {
      position: absolute;
      left: -999px;
      top: 0;
      z-index: 20;
      background: var(--panel);
      padding: 0.75rem 1rem;
      border: 1px solid var(--border);
      border-radius: 999px;
    }
    .skip-link:focus { left: 1rem; top: 1rem; }
    .hero, .shell {
      max-width: 1180px;
      margin: 0 auto;
      padding: 1.25rem clamp(1rem, 3vw, 2rem);
    }
    .hero { padding-top: 2.5rem; padding-bottom: 0.75rem; }
    .shell { display: grid; gap: 1rem; padding-bottom: 3rem; }
    .eyebrow {
      margin: 0 0 0.6rem;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      font-size: 0.78rem;
      color: var(--muted);
    }
    h1 { margin: 0 0 0.5rem; font-size: clamp(2rem, 4vw, 3.5rem); }
    h2 { margin: 0 0 0.8rem; font-size: 1.3rem; }
    .lede { margin: 0; max-width: 72ch; font-size: 1.05rem; color: var(--muted); }
    .card, .stat-card, .issue-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 1rem 1.1rem;
      box-shadow: 0 10px 26px var(--shadow);
    }
    .meta-grid, .stats-grid {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }
    .meta-grid div, .stat-card {
      border: 1px solid color-mix(in srgb, var(--border) 80%, white);
      border-radius: 14px;
      padding: 0.85rem;
      background: color-mix(in srgb, var(--panel) 90%, var(--bg));
    }
    .meta-grid dt, .eyebrow { color: var(--muted); }
    .meta-grid dt { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .meta-grid dd { margin: 0.25rem 0 0; font-weight: 700; }
    .stat-card strong { display: block; font-size: 1.8rem; line-height: 1.1; }
    .stack-list { margin: 0; padding-left: 1.15rem; }
    .issue-grid { display: grid; gap: 0.85rem; }
    .issue-card h3 { margin: 0 0 0.35rem; }
    .issue-card details { margin-top: 0.5rem; }
    .issue-card summary { cursor: pointer; }
    .badge {
      display: inline-block;
      padding: 0.2rem 0.55rem;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 15%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    }
    .links { margin: 1rem 0 0; display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .muted { color: var(--muted); }
    table { width: 100%; border-collapse: collapse; }
    caption { text-align: left; padding-bottom: 0.5rem; color: var(--muted); }
    th, td { border-top: 1px solid var(--border); padding: 0.65rem 0.55rem; text-align: left; vertical-align: top; }
    th { font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.05em; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.95em; }
    .severity-critical { color: var(--critical); }
    .severity-serious { color: var(--serious); }
    .severity-moderate { color: var(--moderate); }
    .severity-minor { color: var(--minor); }
    @media (max-width: 720px) {
      .hero, .shell { padding-left: 1rem; padding-right: 1rem; }
      th, td { font-size: 0.94rem; }
    }
  </style>
</head>
<body>
${body}
</body>
</html>`;
  }

  private static buildIssueGroups(rows: IssueEvidence[]): IssueGroup[] {
    const groups = new Map<string, IssueGroup>();

    for (const row of rows) {
      const key = `${row.provider}|${row.ruleId}`;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          key,
          ruleId: row.ruleId,
          severity: row.severity,
          provider: row.sourceEngine,
          description: row.description,
          helpUrl: row.helpUrl,
          wcagVersion: row.wcagVersion,
          impactedCriteria: [...row.impactedCriteria],
          pageCount: 0,
          instanceCount: 0,
          pages: new Map()
        });
      }

      const group = groups.get(key)!;
      const page = group.pages.get(row.pageUrl) ?? { url: row.pageUrl, pageTitle: row.pageTitle, instances: [] };
      page.pageTitle = page.pageTitle ?? row.pageTitle;
      page.instances.push(row);
      group.pages.set(row.pageUrl, page);
      group.pageCount = group.pages.size;
      group.instanceCount += 1;
    }

    return Array.from(groups.values()).sort((a, b) => {
      const severityDelta = this.severityRank(a.severity) - this.severityRank(b.severity);
      if (severityDelta !== 0) return severityDelta;
      if (b.instanceCount !== a.instanceCount) return b.instanceCount - a.instanceCount;
      return a.ruleId.localeCompare(b.ruleId);
    });
  }

  private static buildPageSummaries(pages: WeeklyPageRow[], issues: WeeklyIssueRow[]): PageSummary[] {
    const issueCounts = new Map<string, { count: number; pageTitle: string | null; ruleCounts: Map<string, number> }>();

    for (const issue of issues) {
      const current = issueCounts.get(issue.url) ?? {
        count: 0,
        pageTitle: issue.pageTitle,
        ruleCounts: new Map<string, number>()
      };
      current.count += 1;
      current.pageTitle = current.pageTitle ?? issue.pageTitle;
      current.ruleCounts.set(issue.ruleId, (current.ruleCounts.get(issue.ruleId) ?? 0) + 1);
      issueCounts.set(issue.url, current);
    }

    return pages.map(page => {
      const pageInfo = issueCounts.get(page.url);
      const ruleCounts = pageInfo?.ruleCounts ?? new Map<string, number>();
      return {
        url: page.url,
        pageTitle: page.pageTitle,
        instanceCount: pageInfo?.count ?? 0,
        ruleCount: ruleCounts.size,
        topRules: Array.from(ruleCounts.entries()).sort((a, b) => b[1] - a[1])
      };
    });
  }

  private static buildTrendRows(pages: WeeklyPageRow[], issues: WeeklyIssueRow[]): TrendRow[] {
    const runMap = new Map<string, TrendRow>();
    const pageCountByRun = new Map<string, number>();
    const issueCountByRun = new Map<string, number>();

    for (const page of pages) {
      pageCountByRun.set(page.runId, (pageCountByRun.get(page.runId) ?? 0) + 1);
      if (!runMap.has(page.runId)) {
        runMap.set(page.runId, {
          runId: page.runId,
          scannedAt: page.scannedAt,
          issueCount: 0,
          pageCount: 0
        });
      }
      const existing = runMap.get(page.runId)!;
      if (page.scannedAt > existing.scannedAt) {
        existing.scannedAt = page.scannedAt;
      }
    }

    for (const issue of issues) {
      issueCountByRun.set(issue.runId, (issueCountByRun.get(issue.runId) ?? 0) + 1);
      if (!runMap.has(issue.runId)) {
        runMap.set(issue.runId, {
          runId: issue.runId,
          scannedAt: issue.scannedAt,
          issueCount: 0,
          pageCount: 0
        });
      }
      const existing = runMap.get(issue.runId)!;
      if (issue.scannedAt > existing.scannedAt) {
        existing.scannedAt = issue.scannedAt;
      }
    }

    for (const row of runMap.values()) {
      row.pageCount = pageCountByRun.get(row.runId) ?? row.pageCount;
      row.issueCount = issueCountByRun.get(row.runId) ?? row.issueCount;
    }

    return Array.from(runMap.values()).sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
  }

  private static buildContextSummary(pages: WeeklyPageRow[]): Array<{ label: string; value: string; count: number }> {
    const counts = new Map<string, { label: string; value: string; count: number }>();

    for (const page of pages) {
      const context = this.parseScanContext(page.scanContextJson);
      if (!context) {
        continue;
      }

      const entries: Array<[string, string]> = [
        ['Browser', context.browserFamily || 'unknown'],
        ['Viewport', context.viewportLabel || this.formatViewport(context.viewport.width, context.viewport.height)],
        ['Color scheme', context.colorScheme || 'unknown'],
        ['Reduced motion', context.reducedMotion || 'unknown'],
        ['Forced colors', context.forcedColors || 'unknown']
      ];

      for (const [label, value] of entries) {
        const key = `${label}::${value}`;
        const existing = counts.get(key) ?? { label, value, count: 0 };
        existing.count += 1;
        counts.set(key, existing);
      }
    }

    return Array.from(counts.values()).sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
  }

  private static buildMissingDataNotes(pages: WeeklyPageRow[], issues: WeeklyIssueRow[]): string[] {
    const notes: string[] = [];
    if (pages.some(page => !page.pageTitle)) {
      notes.push('Some pages still need titles recorded in SQLite.');
    }
    if (pages.some(page => !page.scanContextJson)) {
      notes.push('Some pages still need scan context recorded in SQLite.');
    }
    if (issues.some(issue => !issue.violationJson)) {
      notes.push('Some issue instances still need full violation JSON recorded in SQLite.');
    }
    if (notes.length === 0) {
      notes.push('No known data gaps for the current seven-week window.');
    }
    return notes;
  }

  private static buildChanges(currentIssues: WeeklyIssueRow[], previousIssues: WeeklyIssueRow[]): { newUniqueIssues: number; resolvedUniqueIssues: number; netInstanceDelta: number } {
    const currentKeys = new Set(currentIssues.map(issue => this.issueSignature(issue)));
    const previousKeys = new Set(previousIssues.map(issue => this.issueSignature(issue)));

    let newUniqueIssues = 0;
    for (const key of currentKeys) {
      if (!previousKeys.has(key)) {
        newUniqueIssues += 1;
      }
    }

    let resolvedUniqueIssues = 0;
    for (const key of previousKeys) {
      if (!currentKeys.has(key)) {
        resolvedUniqueIssues += 1;
      }
    }

    return {
      newUniqueIssues,
      resolvedUniqueIssues,
      netInstanceDelta: currentIssues.length - previousIssues.length
    };
  }

  private static countBySeverity(rows: IssueEvidence[]): Record<Severity, number> {
    return rows.reduce((acc, row) => {
      acc[row.severity] += 1;
      return acc;
    }, { critical: 0, serious: 0, moderate: 0, minor: 0 });
  }

  private static countByEngine(rows: IssueEvidence[]): Record<string, number> {
    return rows.reduce((acc, row) => {
      acc[row.sourceEngine] = (acc[row.sourceEngine] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  private static countByWcagVersion(rows: IssueEvidence[]): Record<string, number> {
    return rows.reduce((acc, row) => {
      acc[row.wcagVersion] = (acc[row.wcagVersion] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  private static parseIssueEvidence(row: WeeklyIssueRow): IssueEvidence {
    const parsed = this.safeJson<ParsedIssueEvidence>(row.violationJson);
    const target = Array.isArray(parsed?.target) && parsed.target.length > 0
      ? parsed.target
      : (row.selector ? row.selector.split(' > ').map(part => part.trim()).filter(Boolean) : []);
    const impactedCriteria = Array.isArray(parsed?.impactedCriteria) ? parsed.impactedCriteria.map(String) : [];

    return {
      ruleId: String(parsed?.ruleId ?? row.ruleId),
      severity: this.normalizeSeverity(parsed?.severity ?? row.impact),
      description: String(parsed?.description ?? row.message ?? ''),
      helpUrl: String(parsed?.helpUrl ?? ''),
      impactedCriteria,
      wcagVersion: String(parsed?.wcagVersion ?? this.deriveWcagVersion(impactedCriteria)),
      sourceEngine: String(parsed?.sourceEngine ?? row.provider ?? 'axe'),
      provider: String(row.provider ?? parsed?.sourceEngine ?? 'unknown'),
      html: String(parsed?.html ?? ''),
      selector: target,
      failureSummary: String(parsed?.failureSummary ?? ''),
      pageTitle: parsed?.pageTitle ?? row.pageTitle ?? null,
      pageUrl: String(parsed?.pageUrl ?? row.url),
      scannedAt: String(parsed?.scannedAt ?? row.scannedAt)
    };
  }

  private static lookupRunDuration(allResults: TargetScanResult[], targetId: string): number | null {
    const matching = allResults.find(result => result.targetId === targetId);
    return matching ? matching.scanDurationMs : null;
  }

  private static issueSignature(issue: WeeklyIssueRow): string {
    const parsed = this.safeJson<Partial<IssueEvidence>>(issue.violationJson);
    const selector = issue.selector || (Array.isArray(parsed?.selector) ? parsed.selector.join(',') : '');
    return [issue.provider || parsed?.sourceEngine || 'unknown', issue.ruleId, issue.url, selector, issue.impact].join('|');
  }

  private static parseScanContext(value: string | null): {
    browserFamily: string;
    viewportLabel: string;
    viewport: { width: number; height: number };
    colorScheme: string;
    reducedMotion?: string;
    forcedColors?: string;
  } | null {
    if (!value) {
      return null;
    }

    try {
      const parsed = JSON.parse(value) as {
        browserFamily?: string;
        viewportLabel?: string;
        viewport?: { width?: number; height?: number };
        colorScheme?: string;
        reducedMotion?: string;
        forcedColors?: string;
      };
      return {
        browserFamily: String(parsed.browserFamily || ''),
        viewportLabel: String(parsed.viewportLabel || ''),
        viewport: {
          width: Number(parsed.viewport?.width || 0),
          height: Number(parsed.viewport?.height || 0)
        },
        colorScheme: String(parsed.colorScheme || ''),
        reducedMotion: parsed.reducedMotion ? String(parsed.reducedMotion) : undefined,
        forcedColors: parsed.forcedColors ? String(parsed.forcedColors) : undefined
      };
    } catch {
      return null;
    }
  }

  private static deriveWcagVersion(criteria: string[]): string {
    const tags = criteria.map(tag => String(tag || '').toLowerCase());
    if (tags.some(tag => tag.startsWith('wcag22'))) return '2.2';
    if (tags.some(tag => tag.startsWith('wcag21'))) return '2.1';
    if (tags.some(tag => tag.startsWith('wcag2'))) return '2.0';
    if (tags.some(tag => tag.includes('508'))) return 'section508';
    return 'best-practice';
  }

  private static formatViewport(width: number, height: number): string {
    if (!width || !height) {
      return 'unknown';
    }
    return `${width}×${height}`;
  }

  private static formatDuration(durationMs: number): string {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return 'n/a';
    }
    const totalSeconds = Math.ceil(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }

  private static formatDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value || 'n/a';
    }
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  }

  private static severityRank(value: Severity): number {
    if (value === 'critical') return 0;
    if (value === 'serious') return 1;
    if (value === 'moderate') return 2;
    return 3;
  }

  private static normalizeSeverity(value: string | undefined | null): Severity {
    if (value === 'critical' || value === 'serious' || value === 'moderate' || value === 'minor') {
      return value;
    }
    return 'minor';
  }

  private static safeJson<T>(value: string | null): T | null {
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  private static sanitizePathSegment(value: string): string {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';
  }

  private static escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
