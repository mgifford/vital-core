import * as fs from 'fs';
import * as path from 'path';
import { TargetScanResult } from '../../types/site-quality-spec';
import { QualityIndexReporter } from './quality-index';

export class DashboardCompiler {
  private static DIST_DIR = path.resolve(process.cwd(), 'dist');

  /**
   * Compiles global scan runs into an interactive, flat HTML single-page app
   */
  public static compileStaticDashboard(allResults: TargetScanResult[]): void {
    if (!fs.existsSync(this.DIST_DIR)) {
      fs.mkdirSync(this.DIST_DIR, { recursive: true });
    }

    const jsonPayload = JSON.stringify(allResults)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

    const targetQualityPayload = JSON.stringify(QualityIndexReporter.buildTargetQualityIndex(allResults))
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VITAL-Core System Compliance Dashboard</title>
  <style>
    :root {
      --gov-blue: #112e51;
      --gov-light-blue: #005ea2;
      --dark-gray: #212121;
      --light-bg: #f0f4f8;
      --critical-red: #b50909;
      --border-gray: #d6d7d9;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0; padding: 0; background: var(--light-bg); color: var(--dark-gray); line-height: 1.5;
    }
    header {
      background: var(--gov-blue); color: white; padding: 1.5rem 2rem; border-bottom: 4px solid var(--gov-light-blue);
    }
    h1 { margin: 0; font-size: 1.8rem; font-weight: 700; letter-spacing: -0.03em; }
    main { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; }
    .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
    .card { background: white; border-radius: 4px; border: 1px solid var(--border-gray); padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .card h2 { margin-top: 0; font-size: 1.3rem; border-bottom: 2px solid var(--light-bg); padding-bottom: 0.5rem; }
    .badge { display: inline-block; padding: 0.2rem 0.5rem; border-radius: 3px; font-size: 0.85rem; font-weight: bold; background: #e1f3ff; color: #005ea2; }
    .badge.alert { background: #fbeae5; color: var(--critical-red); }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; text-align: left; }
    th, td { padding: 0.75rem; border-bottom: 1px solid var(--border-gray); font-size: 0.95rem; }
    th { background: var(--light-bg); font-weight: 600; }
    a { color: var(--gov-light-blue); text-decoration: none; font-weight: 600; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <header>
    <h1>🩺 VITAL-Core // Federal Quality &amp; Accessibility Registry</h1>
  </header>
  <main>
    <div id="summary" class="metric-grid"></div>
    <div id="trend-summary" class="metric-grid"></div>
    <div class="card">
      <h2>Run Data Exports</h2>
      <p>
        <a href="runs/latest.json">Latest Full Run JSON</a>
        &nbsp;|&nbsp;
        <a href="runs/index.json">Historical Run Index JSON</a>
        &nbsp;|&nbsp;
        <a href="runs/trends.json">Trend Summary JSON</a>
        &nbsp;|&nbsp;
        <a href="runs/domain-ongoing.json">Domain Ongoing Reports JSON</a>
      </p>
    </div>
    <div class="card">
      <h2>Domains Leaderboard</h2>
      <table id="target-table">
        <thead>
          <tr>
            <th>Domains</th>
            <th>Pages (recent pages)</th>
            <th>Score</th>
            <th>Recommendations</th>
          </tr>
        </thead>
        <tbody id="target-body"></tbody>
      </table>
    </div>
    <div class="card">
      <h2>Run History</h2>
      <table id="history-table">
        <thead>
          <tr>
            <th>Run Timestamp</th>
            <th>Targets</th>
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
      <h2>Requirement Compliance Over Time</h2>
      <svg id="compliance-chart" viewBox="0 0 900 260" role="img" aria-label="Requirement compliance percentages across recent runs" style="width:100%; height:auto; border:1px solid var(--border-gray); background:#fff;"></svg>
      <p id="compliance-caption" style="font-size:0.9rem; margin-top:0.75rem; color:#4d4d4d;">Compliance percentages by requirement across recent runs.</p>
    </div>
    <div class="card">
      <h2>Domain Ongoing Reports</h2>
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
    </div>
  </main>
  <script>
    const data = ${jsonPayload};
    const targetQuality = ${targetQualityPayload};
    const targetQualityMap = new Map(targetQuality.map(item => [item.targetId, item]));
    const summaryEl = document.getElementById('summary');
    const trendSummaryEl = document.getElementById('trend-summary');
    const tbodyEl = document.getElementById('target-body');
    const historyBodyEl = document.getElementById('history-body');
    const ongoingBodyEl = document.getElementById('ongoing-body');

    let totalPages = 0;
    let totalViolations = 0;
    const softwareFound = new Set();
    const leaderboardRows = [];

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

    data.forEach(target => {
      let targetViolations = 0;
      let jsRegressionPages = 0;
      target.pagesScanned.forEach(p => {
        totalPages++;
        targetViolations += p.liveAudits?.accessibilityViolations.length || 0;
        if (p.thirdPartyImpact?.regressionDetected) {
          jsRegressionPages += 1;
        }
        const stack = Array.isArray(p.technologyStack) ? p.technologyStack : [];
        stack.forEach(tech => {
          const name = String(tech?.name || '').trim().toLowerCase();
          if (name) {
            softwareFound.add(name);
          }
        });
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
      domainCell.appendChild(domainStrong);
      domainCell.appendChild(domainBreak);
      domainCell.appendChild(domainSmall);

      const pagesCell = document.createElement('td');
      pagesCell.textContent = String(target.pagesScanned.length) + ' pages';

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
      const recommendationText = buildRecommendations(row.quality, row.targetViolations, row.jsRegressionPages);
      const recommendationBody = document.createElement('div');
      recommendationBody.textContent = recommendationText;

      const reportLinks = document.createElement('div');
      reportLinks.style.marginTop = '0.45rem';
      reportLinks.style.fontSize = '0.85rem';
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
      recommendationsCell.appendChild(reportLinks);

      tr.appendChild(domainCell);
      tr.appendChild(pagesCell);
      tr.appendChild(scoreCell);
      tr.appendChild(recommendationsCell);
      tbodyEl.appendChild(tr);
    });

    const summaryCards = [
      { title: 'Ecosystem Targets Evaluated', value: String(data.length), color: '' },
      { title: 'Software found', value: String(softwareFound.size), color: '' },
      { title: 'Total Blocked System Issues', value: String(totalViolations), color: 'var(--critical-red)' }
    ];

    summaryCards.forEach(card => {
      const wrapper = document.createElement('div');
      wrapper.className = 'card';

      const heading = document.createElement('h3');
      heading.textContent = card.title;

      const value = document.createElement('p');
      value.style.fontSize = '2rem';
      value.style.margin = '0';
      value.style.fontWeight = 'bold';
      if (card.color) {
        value.style.color = card.color;
      }
      value.textContent = card.value;

      wrapper.appendChild(heading);
      wrapper.appendChild(value);
      summaryEl.appendChild(wrapper);
    });

    fetch('runs/index.json')
      .then(response => (response.ok ? response.json() : null))
      .then(index => {
        if (!index || !Array.isArray(index.runs) || index.runs.length === 0) {
          const emptyRow = document.createElement('tr');
          const emptyCell = document.createElement('td');
          emptyCell.colSpan = 6;
          emptyCell.textContent = 'No historical runs available yet.';
          emptyRow.appendChild(emptyCell);
          historyBodyEl.appendChild(emptyRow);
          return;
        }

        index.runs.slice(0, 20).forEach(run => {
          const tr = document.createElement('tr');

          const tsCell = document.createElement('td');
          const ts = new Date(run.generatedAt);
          tsCell.textContent = Number.isNaN(ts.getTime()) ? String(run.generatedAt || '') : ts.toISOString();

          const targetsCell = document.createElement('td');
          targetsCell.textContent = String(run.targetsScanned ?? 0);

          const pagesCell = document.createElement('td');
          pagesCell.textContent = String(run.pagesScanned ?? 0);

          const violationsCell = document.createElement('td');
          violationsCell.textContent = String(run.totalViolations ?? 0);

          const durationCell = document.createElement('td');
          const durationMs = Number(run.scanDurationMs ?? 0);
          durationCell.textContent = Number.isFinite(durationMs) ? (durationMs / 1000).toFixed(2) + 's' : 'n/a';

          const dataCell = document.createElement('td');
          const link = document.createElement('a');
          link.href = String(run.artifactPath || '#');
          link.textContent = 'View JSON';
          dataCell.appendChild(link);

          tr.appendChild(tsCell);
          tr.appendChild(targetsCell);
          tr.appendChild(pagesCell);
          tr.appendChild(violationsCell);
          tr.appendChild(durationCell);
          tr.appendChild(dataCell);

          historyBodyEl.appendChild(tr);
        });
      })
      .catch(() => {
        const errorRow = document.createElement('tr');
        const errorCell = document.createElement('td');
          errorCell.colSpan = 6;
        errorCell.textContent = 'Run history index could not be loaded.';
        errorRow.appendChild(errorCell);
        historyBodyEl.appendChild(errorRow);
      });

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
        { key: 'accessibilityNoViolations', label: 'A11y no violations', color: '#b50909' },
        { key: 'performanceThreshold', label: 'Performance >= 70', color: '#005ea2' },
        { key: 'plainLanguageGrade', label: 'Plain language grade <= 8', color: '#1a7f37' },
        { key: 'plainLanguageLinks', label: 'No ambiguous links', color: '#9a6700' },
        { key: 'completedStatus', label: 'Completed status', color: '#6f42c1' }
      ];

      const xForIndex = (index) => {
        if (series.length === 1) {
          return margin.left + (plotWidth / 2);
        }
        return margin.left + ((index / (series.length - 1)) * plotWidth);
      };

      const yForPercent = (percent) => margin.top + plotHeight - ((Math.max(0, Math.min(100, Number(percent) || 0)) / 100) * plotHeight);

      metrics.forEach(metric => {
        const points = series.map((entry, index) => {
          const value = entry.compliancePercentages?.[metric.key];
          return String(xForIndex(index)) + ',' + String(yForPercent(value));
        }).join(' ');

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        line.setAttribute('fill', 'none');
        line.setAttribute('stroke', metric.color);
        line.setAttribute('stroke-width', '2.5');
        line.setAttribute('points', points);
        chart.appendChild(line);
      });

      const legendStartX = margin.left;
      metrics.forEach((metric, index) => {
        const y = margin.top + 10 + (index * 16);
        const swatch = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        swatch.setAttribute('x1', String(legendStartX));
        swatch.setAttribute('y1', String(y));
        swatch.setAttribute('x2', String(legendStartX + 14));
        swatch.setAttribute('y2', String(y));
        swatch.setAttribute('stroke', metric.color);
        swatch.setAttribute('stroke-width', '3');
        chart.appendChild(swatch);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(legendStartX + 20));
        text.setAttribute('y', String(y + 4));
        text.setAttribute('fill', '#333');
        text.setAttribute('font-size', '12');
        text.textContent = metric.label;
        chart.appendChild(text);
      });
    }

    function formatDelta(value, suffix) {
      const sign = value > 0 ? '+' : '';
      return sign + String(value) + suffix;
    }

    function formatDuration(ms) {
      const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      if (hours > 0) {
        return String(hours) + 'h ' + String(minutes) + 'm ' + String(seconds) + 's';
      }
      if (minutes > 0) {
        return String(minutes) + 'm ' + String(seconds) + 's';
      }
      return String(seconds) + 's';
    }

    fetch('runs/trends.json')
      .then(response => (response.ok ? response.json() : null))
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
        const avgVpp = Number(trends.rollingAverage?.violationsPerPage || 0).toFixed(3);

        appendTrendCard(
          'Current Violations',
          String(trends.latest.totalViolations || 0),
          deltaLabel,
          'var(--critical-red)'
        );

        appendTrendCard(
          'Violations Per Page',
          vpp,
          '7-run rolling average: ' + avgVpp,
          ''
        );

        appendTrendCard(
          'Average Scan Duration',
          formatDuration(trends.rollingAverage?.scanDurationMs || 0),
          'Based on last ' + String(trends.windowSize || 0) + ' run(s)',
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

        appendTrendCard(
          'Federal Quality Index',
          qualityScore + ' / 100',
          'Gate: ' + gate + ' • ' + qualityDelta,
          qualityAccent
        );

        const providers = Array.isArray(trends.latest.providerAttributionTop)
          ? trends.latest.providerAttributionTop
          : [];
        const providerSummary = providers.length > 0
          ? providers
              .slice(0, 3)
              .map(item => item.provider + ' (H:' + String(item.high) + ' M:' + String(item.medium) + ' L:' + String(item.low) + ')')
              .join(' • ')
          : 'No provider attribution signals in latest run.';

        appendTrendCard(
          'Top Third-Party Providers',
          String(providers.length),
          providerSummary,
          ''
        );

        const complianceSeries = Array.isArray(trends.requirementComplianceOverTime)
          ? trends.requirementComplianceOverTime
          : [];
        drawComplianceChart(complianceSeries);

        const latestCompliance = complianceSeries.length > 0
          ? complianceSeries[complianceSeries.length - 1].compliancePercentages
          : null;
        const caption = document.getElementById('compliance-caption');
        if (caption && latestCompliance) {
          caption.textContent =
            'Latest run: A11y no violations ' + String(Number(latestCompliance.accessibilityNoViolations || 0).toFixed(1)) +
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

    fetch('runs/domain-ongoing.json')
      .then(response => (response.ok ? response.json() : null))
      .then(payload => {
        const reports = Array.isArray(payload?.reports) ? payload.reports : [];
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
          const periodStart = String(report.period?.start || '').slice(0, 10);
          const periodEnd = String(report.period?.end || '').slice(0, 10);
          const runCount = Number(report.period?.runCount || 0);
          periodCell.textContent = periodStart + ' to ' + periodEnd + ' (' + String(runCount) + ' run(s))';

          const indicatorsCell = document.createElement('td');
          const indicators = report.qualityIndicators || {};
          indicatorsCell.textContent =
            'V/Page: ' + String(Number(indicators.violationsPerPage || 0).toFixed(3)) +
            ' | Perf: ' + String(indicators.averagePerformanceScore ?? 'n/a') +
            ' | Grade: ' + String(indicators.averageFleschKincaidGrade ?? 'n/a') +
            ' | Completion: ' + String(Number(indicators.completionRate || 0).toFixed(1)) + '%';

          const suggestionsCell = document.createElement('td');
          const suggestions = Array.isArray(report.suggestions) ? report.suggestions : [];
          suggestionsCell.textContent = suggestions.slice(0, 2).join(' ');

          const pagesCell = document.createElement('td');
          const pages = Array.isArray(report.pagesNeedingMostImprovement) ? report.pagesNeedingMostImprovement : [];
          if (pages.length === 0) {
            pagesCell.textContent = 'No high-priority pages identified in latest run.';
          } else {
            pagesCell.textContent = pages
              .slice(0, 3)
              .map(item => '[score ' + String(item.priorityScore) + '] ' + String(item.url || ''))
              .join(' | ');
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
  </script>
</body>
</html>`;

    fs.writeFileSync(path.join(this.DIST_DIR, 'index.html'), htmlContent, 'utf8');
    console.log(`📊 Static dashboard assets successfully compiled to dist/index.html`);
  }
}
