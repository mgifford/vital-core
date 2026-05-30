import * as fs from 'fs';
import * as path from 'path';
import { TargetScanResult } from '../../types/site-quality-spec';

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
      </p>
    </div>
    <div class="card">
      <h2>Target Operational Vectors</h2>
      <table id="target-table">
        <thead>
          <tr>
            <th>Ecosystem Domain</th>
            <th>Pages Monitored</th>
            <th>Accessibility Health</th>
            <th>Remediation Blueprint</th>
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
  </main>
  <script>
    const data = ${jsonPayload};
    const summaryEl = document.getElementById('summary');
    const trendSummaryEl = document.getElementById('trend-summary');
    const tbodyEl = document.getElementById('target-body');
    const historyBodyEl = document.getElementById('history-body');

    let totalPages = 0;
    let totalViolations = 0;

    data.forEach(target => {
      let targetViolations = 0;
      target.pagesScanned.forEach(p => {
        totalPages++;
        targetViolations += p.liveAudits?.accessibilityViolations.length || 0;
      });
      totalViolations += targetViolations;

      const tr = document.createElement('tr');

      const domainCell = document.createElement('td');
      const domainStrong = document.createElement('strong');
      domainStrong.textContent = String(target.targetId || '').toUpperCase();
      const domainBreak = document.createElement('br');
      const domainSmall = document.createElement('small');
      domainSmall.textContent = String(target.domain || '');
      domainCell.appendChild(domainStrong);
      domainCell.appendChild(domainBreak);
      domainCell.appendChild(domainSmall);

      const pagesCell = document.createElement('td');
      pagesCell.textContent = String(target.pagesScanned.length) + ' paths';

      const healthCell = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = ('badge ' + (targetViolations > 0 ? 'alert' : '')).trim();
      badge.textContent = String(targetViolations) + ' Active Failures';
      healthCell.appendChild(badge);

      const reportCell = document.createElement('td');
      const reportMdLink = document.createElement('a');
      reportMdLink.href = 'reports/' + target.targetId + '_issues.md';
      reportMdLink.textContent = 'Markdown';

      const divider = document.createTextNode(' | ');

      const reportCsvLink = document.createElement('a');
      reportCsvLink.href = 'reports/' + target.targetId + '_issues.csv';
      reportCsvLink.textContent = 'CSV';

      reportCell.appendChild(reportMdLink);
      reportCell.appendChild(divider);
      reportCell.appendChild(reportCsvLink);

      tr.appendChild(domainCell);
      tr.appendChild(pagesCell);
      tr.appendChild(healthCell);
      tr.appendChild(reportCell);
      tbodyEl.appendChild(tr);
    });

    const summaryCards = [
      { title: 'Ecosystem Targets Evaluated', value: String(data.length), color: '' },
      { title: 'Total Endpoint Footprints Checked', value: String(totalPages), color: '' },
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

    function formatDelta(value, suffix) {
      const sign = value > 0 ? '+' : '';
      return sign + String(value) + suffix;
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
          (Number(trends.rollingAverage?.scanDurationMs || 0) / 1000).toFixed(2) + 's',
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
      })
      .catch(() => {
        appendTrendCard('Trend Summary', 'Unavailable', 'Trend data could not be loaded.', '');
      });
  </script>
</body>
</html>`;

    fs.writeFileSync(path.join(this.DIST_DIR, 'index.html'), htmlContent, 'utf8');
    console.log(`📊 Static dashboard assets successfully compiled to dist/index.html`);
  }
}
