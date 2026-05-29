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

    const jsonPayload = JSON.stringify(allResults, null, 2);

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
  </main>
  <script>
    const data = ${jsonPayload};
    const summaryEl = document.getElementById('summary');
    const tbodyEl = document.getElementById('target-body');

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
      tr.innerHTML = \`
        <td><strong>\${target.targetId.toUpperCase()}</strong><br><small>\${target.domain}</small></td>
        <td>\${target.pagesScanned.length} paths</td>
        <td>
          <span class="badge \${targetViolations > 0 ? 'alert' : ''}">
            \${targetViolations} Active Failures
          </span>
        </td>
        <td><a href="reports/\${target.targetId}_issues.md">View Markdown Ticket System ↗</a></td>
      \`;
      tbodyEl.appendChild(tr);
    });

    summaryEl.innerHTML = \`
      <div class="card"><h3>Ecosystem Targets Evaluated</h3><p style="font-size:2rem; margin:0; font-weight:bold;">\${data.length}</p></div>
      <div class="card"><h3>Total Endpoint Footprints Checked</h3><p style="font-size:2rem; margin:0; font-weight:bold;">\${totalPages}</p></div>
      <div class="card"><h3>Total Blocked System Issues</h3><p style="font-size:2rem; margin:0; font-weight:bold; color:var(--critical-red);">\${totalViolations}</p></div>
    \`;
  </script>
</body>
</html>`;

    fs.writeFileSync(path.join(this.DIST_DIR, 'index.html'), htmlContent, 'utf8');
    console.log(`📊 Static dashboard assets successfully compiled to dist/index.html`);
  }
}
