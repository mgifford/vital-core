(function () {
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
  const blockedSummaryEl = document.getElementById('blocked-issues-summary');
  const blockedBreakdownEl = document.getElementById('blocked-issues-breakdown');
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
  const summaryGuidanceById = new Map([
    ['targets-total', {
      description: 'Count of domains evaluated in the latest run.',
      actionLabel: 'Review domain leaderboard',
      actionHref: '#domains-leaderboard'
    }],
    ['software-total', {
      description: 'Unique technologies detected across scanned pages in the latest run.',
      actionLabel: 'Review detected software by domain',
      actionHref: '#detected-software-latest-run'
    }],
    ['blocked-total', {
      description: 'Pages that were blocked, timed out, failed, or returned HTTP errors in the latest run.',
      actionLabel: 'Review blocked issue details and reasons',
      actionHref: '#blocked_system_issues'
    }],
    ['violations-total', {
      description: 'Cross-tool accessibility findings in the latest run (consensus + axe-only + alfa-only).',
      actionLabel: 'Inspect page-level violations and statuses',
      actionHref: '#pages-scanned-latest-run'
    }],
    ['unique-pages-total', {
      description: 'Distinct URLs scanned in retained run history.',
      actionLabel: 'Review run history',
      actionHref: '#run-history'
    }],
    ['unique-pages-week', {
      description: 'Distinct URLs scanned in the latest weekly window.',
      actionLabel: 'Review run history',
      actionHref: '#run-history'
    }]
  ]);
  const trendGuidanceByTitle = new Map([
    ['Current Violations', {
      description: 'Accessibility violations found in the latest run.',
      actionLabel: 'Open page-level scan details',
      actionHref: '#pages-scanned-latest-run'
    }],
    ['Violations Per Page', {
      description: 'Average violations per scanned page for this run.',
      actionLabel: 'Compare against run history',
      actionHref: '#run-history'
    }],
    ['Average Scan Duration', {
      description: 'How long full scans are taking, compared against recent runs.',
      actionLabel: 'Open run history details',
      actionHref: '#run-history'
    }],
    ['Federal Quality Index', {
      description: 'Composite quality score (0-100) for accessibility, content, and scan reliability.',
      actionLabel: 'Review domain quality recommendations',
      actionHref: '#domains-leaderboard'
    }],
    ['Consensus Failures', {
      description: 'Violations detected by both Axe and Alfa engines.',
      actionLabel: 'Open accessibility failure details',
      actionHref: '#pages-scanned-latest-run'
    }],
    ['Axe-only Failures', {
      description: 'Violations detected only by Axe in the latest run.',
      actionLabel: 'Open accessibility failure details',
      actionHref: '#pages-scanned-latest-run'
    }],
    ['Alfa-only Failures', {
      description: 'Violations detected only by Alfa in the latest run.',
      actionLabel: 'Open accessibility failure details',
      actionHref: '#pages-scanned-latest-run'
    }],
    ['Top Third-Party Providers', {
      description: 'Providers most associated with accessibility findings in this run.',
      actionLabel: 'Review software and provider context',
      actionHref: '#detected-software-latest-run'
    }],
    ['URL Freshness', {
      description: 'Share of newly discovered URLs versus carried-over URLs from previous runs.'
    }]
  ]);
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
    subtitleEl.className = 'muted-small';
    subtitleEl.hidden = true;

    const guidance = summaryGuidanceById.get(id);
    const helpEl = document.createElement('p');
    helpEl.className = 'muted-small metric-help';
    helpEl.textContent = guidance && guidance.description
      ? String(guidance.description)
      : 'Metric summary from the latest available run data.';

    const actionEl = document.createElement('p');
    actionEl.className = 'metric-action';
    if (guidance && guidance.actionHref && guidance.actionLabel) {
      const actionLink = document.createElement('a');
      actionLink.href = String(guidance.actionHref);
      actionLink.textContent = String(guidance.actionLabel);
      actionEl.appendChild(actionLink);
    } else {
      actionEl.hidden = true;
    }

    wrapper.appendChild(heading);
    wrapper.appendChild(valueEl);
    wrapper.appendChild(subtitleEl);
    wrapper.appendChild(helpEl);
    wrapper.appendChild(actionEl);
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
    subtitleEl.className = 'muted-small';
    subtitleEl.textContent = subtitle;

    const guidance = trendGuidanceByTitle.get(title);
    const helpEl = document.createElement('p');
    helpEl.className = 'muted-small metric-help';
    helpEl.textContent = guidance && guidance.description
      ? String(guidance.description)
      : 'Trend metric from latest run history.';

    const actionEl = document.createElement('p');
    actionEl.className = 'metric-action';
    if (guidance && guidance.actionHref && guidance.actionLabel) {
      const actionLink = document.createElement('a');
      actionLink.href = String(guidance.actionHref);
      actionLink.textContent = String(guidance.actionLabel);
      actionEl.appendChild(actionLink);
    } else {
      actionEl.hidden = true;
    }

    wrapper.appendChild(heading);
    wrapper.appendChild(valueEl);
    wrapper.appendChild(helpEl);
    wrapper.appendChild(subtitleEl);
    wrapper.appendChild(actionEl);
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
    if (run.runId) {
      const sep = document.createTextNode(' | ');
      const detailLink = document.createElement('a');
      detailLink.href = 'runs/' + String(run.runId) + '/index.html';
      detailLink.textContent = 'Details';
      dataCell.appendChild(sep);
      dataCell.appendChild(detailLink);
    }

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
    const violationsValue = document.createElement('div');
    violationsValue.textContent = String(violations) + ' findings';
    violationsCell.appendChild(violationsValue);

    const consensusSummary = page && page.consensusSummary ? page.consensusSummary : null;
    if (consensusSummary) {
      const consensusValue = document.createElement('div');
      consensusValue.className = 'muted-small';
      consensusValue.textContent =
        String(consensusSummary.totalCorrelatedFindings || 0) + ' unique patterns • ' +
        String(consensusSummary.consensusFailure || 0) + ' shared • ' +
        String(consensusSummary.axeOnlyFailure || 0) + ' axe-only • ' +
        String(consensusSummary.alfaOnlyFailure || 0) + ' alfa-only';
      violationsCell.appendChild(consensusValue);
    }

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
    if (blockedBreakdownEl) {
      blockedBreakdownEl.innerHTML = '';
    }

    if (blockedEntries.length === 0) {
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = 5;
      emptyCell.textContent = 'No blocked, timeout, or failed pages in the latest run.';
      emptyRow.appendChild(emptyCell);
      blockedBodyEl.appendChild(emptyRow);
      if (blockedSummaryEl) {
        blockedSummaryEl.textContent = 'No blocked system issues were recorded in the latest run.';
      }
      return;
    }

    const statusCounts = new Map();
    blockedEntries.forEach(entry => {
      const status = String(entry.status || 'UNKNOWN');
      statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    });
    if (blockedSummaryEl) {
      blockedSummaryEl.textContent =
        String(blockedEntries.length) + ' blocked system issue(s) were recorded in the latest run. Use the breakdown and table below to identify root causes.';
    }
    if (blockedBreakdownEl) {
      Array.from(statusCounts.entries())
        .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
        .forEach(([status, count]) => {
          const item = document.createElement('li');
          item.textContent = String(status) + ': ' + String(count);
          blockedBreakdownEl.appendChild(item);
        });
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
})();