#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, DIRS } from './lib/config.js';
import { compareWeeks } from './lib/week.js';
import { renderDomainReport, renderIndex, writeAsset } from './report-html.js';

/**
 * Pure function of the data/ directory. Idempotent: run it as many
 * times as you like, the output is the same. No database, no cache,
 * no fallback path that can diverge.
 *
 * Produces:
 *   data/<domain>/<week>/summary.json   (committed; survives page-detail pruning)
 *   docs/index.html                     (dashboard)
 *   docs/reports/<domain>/<week>/index.html
 *   docs/data/<domain>/weekly.json      (trend series for anyone to reuse)
 */

const config = loadConfig();
fs.mkdirSync(DIRS.docs, { recursive: true });

const dashboard = [];

for (const target of config.targets) {
  const domainDir = path.join(DIRS.data, target.key);
  if (!fs.existsSync(domainDir)) continue;

  const weeks = fs.readdirSync(domainDir).filter((w) => /^\d{4}-W\d{2}$/.test(w)).sort(compareWeeks);
  const series = [];

  for (const week of weeks) {
    const summary = summarizeWeek(target, week);
    if (summary) {
      series.push(summary);
      fs.writeFileSync(path.join(domainDir, week, 'summary.json'), JSON.stringify(summary, null, 1));
    }
  }
  if (series.length === 0) continue;

  // Week-over-week diffs between consecutive summaries.
  const diffs = {};
  for (let i = 1; i < series.length; i++) {
    diffs[series[i].week] = diffWeeks(series[i - 1], series[i]);
  }

  // Machine-readable trend series.
  const dataOut = path.join(DIRS.docs, 'data', target.key);
  fs.mkdirSync(dataOut, { recursive: true });
  fs.writeFileSync(path.join(dataOut, 'weekly.json'), JSON.stringify({ domain: target.domain, series, diffs }, null, 1));

  // Human reports.
  for (let i = 0; i < series.length; i++) {
    const summary = series[i];
    const prev = i > 0 ? series[i - 1] : null;
    const html = renderDomainReport(target, summary, prev, diffs[summary.week] ?? null, series);
    const repDir = path.join(DIRS.docs, 'reports', target.key, summary.week);
    fs.mkdirSync(repDir, { recursive: true });
    fs.writeFileSync(path.join(repDir, 'index.html'), html);
  }

  dashboard.push({ target, series, diffs });
  console.log(`${target.key}: ${series.length} week(s) aggregated`);
}

fs.writeFileSync(path.join(DIRS.docs, 'index.html'), renderIndex(dashboard));
writeAsset(DIRS.docs);
console.log('docs/ written');

// ---------------------------------------------------------------------

function summarizeWeek(target, week) {
  const pagesDir = path.join(DIRS.data, target.key, week, 'pages');
  const summaryPath = path.join(DIRS.data, target.key, week, 'summary.json');

  // If page detail was pruned, reuse the committed summary verbatim.
  if (!fs.existsSync(pagesDir)) {
    return fs.existsSync(summaryPath) ? JSON.parse(fs.readFileSync(summaryPath, 'utf8')) : null;
  }

  const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) return null;

  const axeRules = {}; // ruleId -> { count, pages, impact, help, helpUrl, examples }
  const alfaRules = {};
  let pagesScanned = 0;
  let pagesWithAxeViolations = 0;
  let pagesWithAlfaFailures = 0;
  let axeViolationTotal = 0;
  let alfaFailedTotal = 0;
  const bytesList = [];
  const requestsList = [];
  let co2Total = 0;
  let pagesWithAudit = 0;
  const errorPages = [];
  const blockedStatuses = {}; // status code -> count, for the blocked callout

  for (const f of files) {
    const rec = JSON.parse(fs.readFileSync(path.join(pagesDir, f), 'utf8'));
    pagesScanned++;
    if (rec.axe || rec.alfa || rec.sustainability) pagesWithAudit++;
    if (typeof rec.status === 'number' && rec.status >= 400) {
      errorPages.push({ url: rec.url, status: rec.status });
      blockedStatuses[rec.status] = (blockedStatuses[rec.status] ?? 0) + 1;
    }

    if (rec.axe) {
      if (rec.axe.violationCount > 0) pagesWithAxeViolations++;
      axeViolationTotal += rec.axe.violationCount;
      for (const [id, v] of Object.entries(rec.axe.violations)) {
        const r = (axeRules[id] ??= { count: 0, pages: 0, impact: v.impact, help: v.help, helpUrl: v.helpUrl, examplePages: [] });
        r.count += v.count;
        r.pages++;
        if (r.examplePages.length < 3) r.examplePages.push(rec.url);
      }
    }
    if (rec.alfa) {
      if (rec.alfa.failedCount > 0) pagesWithAlfaFailures++;
      alfaFailedTotal += rec.alfa.failedCount;
      for (const [id, v] of Object.entries(rec.alfa.failed)) {
        const r = (alfaRules[id] ??= { count: 0, pages: 0, ruleUrl: v.ruleUrl, examplePages: [] });
        r.count += v.count;
        r.pages++;
        if (r.examplePages.length < 3) r.examplePages.push(rec.url);
      }
    }
    if (rec.sustainability) {
      bytesList.push(rec.sustainability.bytes);
      requestsList.push(rec.sustainability.requests);
      co2Total += rec.sustainability.co2g;
    }
  }

  // A target is "blocked" when it returned only error responses (e.g. a
  // WAF answering 403 to the scanner) and produced no audit data at all.
  // The dominant error status is surfaced in the dashboard callout.
  const dominantStatus = Object.entries(blockedStatuses).sort((a, b) => b[1] - a[1])[0]?.[0];
  const blocked =
    pagesScanned > 0 && pagesWithAudit === 0 && dominantStatus
      ? { status: Number(dominantStatus) }
      : null;

  return {
    domain: target.domain,
    week,
    generatedAt: new Date().toISOString(),
    pagesScanned,
    blocked,
    axe: {
      violationTotal: axeViolationTotal,
      pagesWithViolations: pagesWithAxeViolations,
      rules: axeRules,
    },
    alfa: {
      failedTotal: alfaFailedTotal,
      pagesWithFailures: pagesWithAlfaFailures,
      rules: alfaRules,
    },
    sustainability: bytesList.length
      ? {
          pages: bytesList.length,
          medianBytes: median(bytesList),
          meanBytes: Math.round(bytesList.reduce((a, b) => a + b, 0) / bytesList.length),
          medianRequests: median(requestsList),
          totalCo2g: Math.round(co2Total * 100) / 100,
          meanCo2g: Math.round((co2Total / bytesList.length) * 10000) / 10000,
        }
      : null,
    errorPages: errorPages.slice(0, 25),
  };
}

function diffWeeks(prev, curr) {
  const diffEngine = (prevRules, currRules) => {
    const appeared = Object.keys(currRules).filter((id) => !(id in prevRules));
    const resolved = Object.keys(prevRules).filter((id) => !(id in currRules));
    const changed = Object.keys(currRules)
      .filter((id) => id in prevRules && currRules[id].pages !== prevRules[id].pages)
      .map((id) => ({ id, pagesBefore: prevRules[id].pages, pagesAfter: currRules[id].pages }));
    return { appeared, resolved, changed };
  };
  return {
    prevWeek: prev.week,
    pagesDelta: curr.pagesScanned - prev.pagesScanned,
    axe: {
      violationDelta: curr.axe.violationTotal - prev.axe.violationTotal,
      ...diffEngine(prev.axe.rules, curr.axe.rules),
    },
    alfa: {
      failedDelta: curr.alfa.failedTotal - prev.alfa.failedTotal,
      ...diffEngine(prev.alfa.rules, curr.alfa.rules),
    },
    sustainability:
      prev.sustainability && curr.sustainability
        ? {
            medianBytesDelta: curr.sustainability.medianBytes - prev.sustainability.medianBytes,
            meanCo2gDelta: Math.round((curr.sustainability.meanCo2g - prev.sustainability.meanCo2g) * 10000) / 10000,
          }
        : null,
  };
}

function median(list) {
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
