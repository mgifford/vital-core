#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, DIRS } from './lib/config.js';
import { compareWeeks } from './lib/week.js';
import { renderDomainReport, renderIndex, writeAsset, setSustainabilityMetric } from './report-html.js';
import { buildBugReports, bugReportsMarkdown } from './lib/bug-report.js';
import { loadFindings, saveFindings, updateFindings } from './lib/findings.js';

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

const MAX_RULE_INSTANCES = 5; // representative failing instances kept per rule

const config = loadConfig();
setSustainabilityMetric(config.sustainabilityMetric);
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

  // Findings ledger: first/last-seen per unique finding (pattern_id),
  // accumulated across the domain's whole history. Rebuilt from scratch
  // each aggregate run (idempotent) by replaying weeks oldest-first.
  const ledger = loadFindings(target.key, target.domain);
  ledger.findings = {}; // recompute deterministically from retained weeks

  // Human reports + structured bug reports (Markdown, JSON, and inline HTML).
  for (let i = 0; i < series.length; i++) {
    const summary = series[i];
    const prev = i > 0 ? series[i - 1] : null;
    const bugs = buildBugReports(target, summary);
    // Update the ledger for this week and annotate each bug with its
    // first/last-seen history.
    const history = updateFindings(ledger, summary.week, bugs);
    for (const b of bugs) {
      const h = history[b.pattern_id];
      if (h) {
        b.first_seen = h.firstSeen;
        b.last_seen = h.lastSeen;
        b.weeks_seen = h.weeksSeen;
      }
    }
    const repDir = path.join(DIRS.docs, 'reports', target.key, summary.week);
    fs.mkdirSync(repDir, { recursive: true });

    const html = renderDomainReport(target, summary, prev, diffs[summary.week] ?? null, series, bugs);
    fs.writeFileSync(path.join(repDir, 'index.html'), html);
    fs.writeFileSync(path.join(repDir, 'bugs.md'), bugReportsMarkdown(target, summary, bugs));
    fs.writeFileSync(
      path.join(repDir, 'bugs.json'),
      JSON.stringify({ domain: target.domain, week: summary.week, generatedAt: summary.generatedAt, reports: bugs }, null, 1)
    );
  }

  saveFindings(target.key, ledger);

  dashboard.push({ target, series, diffs });
  console.log(`${target.key}: ${series.length} week(s) aggregated, ${Object.keys(ledger.findings).length} tracked findings`);
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
  const deprecatedRules = {}; // ruleId -> { count, pages, help, examplePages, instances }
  const enginePageCounts = {}; // engine -> unique pages it ran on (coverage)
  let pagesScanned = 0;
  let pagesWithAxeViolations = 0;
  let pagesWithAlfaFailures = 0;
  let axeViolationTotal = 0;
  let alfaFailedTotal = 0;
  // Per-page failure counts (one entry per page the engine ran on, zeros
  // included) for medians, and unique-page counts per engine. Each page
  // record is one unique URL (file keyed by pageId), so counting records
  // is inherently deduplicated.
  const axeCountsPerPage = [];
  const alfaCountsPerPage = [];
  const auditedPageIds = new Set(); // pages scanned by axe and/or alfa
  const bytesList = [];
  const requestsList = [];
  let co2Total = 0;
  let energyTotal = 0;
  let pagesWithAudit = 0;
  const errorPages = [];
  const blockedStatuses = {}; // status code -> count, for the blocked callout
  // Plain-language: collect scored pages' readability for medians.
  const freList = [];
  const gradeList = [];
  let plPagesScored = 0;
  const acronymCounts = {}; // acronym -> pages it was unexplained on
  const misspellingCounts = {}; // word -> pages it was misspelled on
  let plPagesChecked = 0; // pages plain-language ran on (for words/page)
  const wordCounts = []; // per-page main-content word counts
  // Lighthouse: collect sampled scores for medians.
  const lhScores = { performance: [], accessibility: [], bestPractices: [], seo: [], agentic: [] };
  // Link check: union broken links across the week's runs (deduped).
  const brokenLinks = new Map(); // url -> { url, status, reason, foundOn }

  for (const f of files) {
    const rec = JSON.parse(fs.readFileSync(path.join(pagesDir, f), 'utf8'));
    pagesScanned++;
    if (rec.axe || rec.alfa || rec.sustainability || rec.plainLanguage || rec.lighthouse) pagesWithAudit++;
    if (typeof rec.status === 'number' && rec.status >= 400) {
      errorPages.push({ url: rec.url, status: rec.status });
      blockedStatuses[rec.status] = (blockedStatuses[rec.status] ?? 0) + 1;
    }

    if (rec.axe) {
      auditedPageIds.add(rec.pageId ?? rec.url);
      axeCountsPerPage.push(rec.axe.violationCount);
      if (rec.axe.violationCount > 0) pagesWithAxeViolations++;
      axeViolationTotal += rec.axe.violationCount;
      for (const [id, v] of Object.entries(rec.axe.violations)) {
        const r = (axeRules[id] ??= { count: 0, pages: 0, impact: v.impact, help: v.help, helpUrl: v.helpUrl, tags: v.tags ?? [], examplePages: [], instances: [] });
        r.count += v.count;
        r.pages++;
        if (r.examplePages.length < 3) r.examplePages.push(rec.url);
        addInstances(r, rec.url, v.examples);
      }
    }
    if (rec.alfa) {
      auditedPageIds.add(rec.pageId ?? rec.url);
      alfaCountsPerPage.push(rec.alfa.failedCount);
      if (rec.alfa.failedCount > 0) pagesWithAlfaFailures++;
      alfaFailedTotal += rec.alfa.failedCount;
      for (const [id, v] of Object.entries(rec.alfa.failed)) {
        const r = (alfaRules[id] ??= { count: 0, pages: 0, ruleUrl: v.ruleUrl, examplePages: [], instances: [] });
        r.count += v.count;
        r.pages++;
        if (r.examplePages.length < 3) r.examplePages.push(rec.url);
        addInstances(r, rec.url, v.examples);
      }
    }
    if (rec.deprecatedHtml) {
      for (const [id, v] of Object.entries(rec.deprecatedHtml.findings)) {
        const r = (deprecatedRules[id] ??= { count: 0, pages: 0, help: v.help, examplePages: [], instances: [] });
        r.count += v.count;
        r.pages++;
        if (r.examplePages.length < 3) r.examplePages.push(rec.url);
        addInstances(r, rec.url, v.examples);
      }
    }
    if (rec.sustainability) {
      bytesList.push(rec.sustainability.bytes);
      requestsList.push(rec.sustainability.requests);
      co2Total += rec.sustainability.co2g;
      energyTotal += rec.sustainability.energyWh ?? 0;
    }

    // Per-engine coverage: which engines actually ran on this page.
    for (const e of ['axe', 'alfa', 'plain-language', 'deprecated-html', 'lighthouse', 'sustainability']) {
      const key = { 'plain-language': 'plainLanguage', 'deprecated-html': 'deprecatedHtml' }[e] ?? e;
      if (rec[key]) enginePageCounts[e] = (enginePageCounts[e] ?? 0) + 1;
    }
    if (rec.plainLanguage) {
      plPagesChecked++;
      if (typeof rec.plainLanguage.wordCount === 'number') wordCounts.push(rec.plainLanguage.wordCount);
      if (rec.plainLanguage.scored) {
        plPagesScored++;
        if (rec.plainLanguage.fleschReadingEase != null) freList.push(rec.plainLanguage.fleschReadingEase);
        if (rec.plainLanguage.fleschKincaidGrade != null) gradeList.push(rec.plainLanguage.fleschKincaidGrade);
      }
      for (const a of rec.plainLanguage.unexplainedAcronyms ?? []) {
        acronymCounts[a] = (acronymCounts[a] ?? 0) + 1;
      }
      for (const w of rec.plainLanguage.misspelled ?? []) {
        misspellingCounts[w] = (misspellingCounts[w] ?? 0) + 1;
      }
    }
    if (rec.lighthouse?.scores) {
      for (const k of Object.keys(lhScores)) {
        const v = rec.lighthouse.scores[k];
        if (typeof v === 'number') lhScores[k].push(v);
      }
    }
  }

  // Link check: fold this week's run logs (deduped broken links).
  const runsDirPath = path.join(DIRS.data, target.key, week, 'runs');
  if (fs.existsSync(runsDirPath)) {
    for (const rf of fs.readdirSync(runsDirPath).filter((f) => f.endsWith('.json'))) {
      const run = JSON.parse(fs.readFileSync(path.join(runsDirPath, rf), 'utf8'));
      for (const b of run.linkCheck?.broken ?? []) {
        if (!brokenLinks.has(b.url)) brokenLinks.set(b.url, b);
      }
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
    // Unique pages scanned by axe and/or alfa this week (deduped by page).
    pagesAudited: auditedPageIds.size,
    // Per-engine coverage: unique pages each engine ran on, vs pages
    // scanned. Reflects the configured weekly sampling rates.
    coverage: enginePageCounts,
    blocked,
    axe: {
      violationTotal: axeViolationTotal,
      pagesWithViolations: pagesWithAxeViolations,
      pagesScanned: axeCountsPerPage.length,
      medianViolations: axeCountsPerPage.length ? median(axeCountsPerPage) : null,
      rules: axeRules,
    },
    alfa: {
      failedTotal: alfaFailedTotal,
      pagesWithFailures: pagesWithAlfaFailures,
      pagesScanned: alfaCountsPerPage.length,
      medianFailures: alfaCountsPerPage.length ? median(alfaCountsPerPage) : null,
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
          totalEnergyWh: Math.round(energyTotal * 100) / 100,
          meanEnergyWh: Math.round((energyTotal / bytesList.length) * 10000) / 10000,
        }
      : null,
    deprecatedHtml: Object.keys(deprecatedRules).length
      ? {
          findingTotal: Object.values(deprecatedRules).reduce((s, r) => s + r.count, 0),
          rules: deprecatedRules,
        }
      : null,
    plainLanguage: plPagesChecked
      ? {
          pagesChecked: plPagesChecked,
          pagesScored: plPagesScored,
          medianWordsPerPage: wordCounts.length ? median(wordCounts) : null,
          // Readability only over pages with enough prose to score.
          medianReadingEase: freList.length ? median(freList) : null,
          medianGrade: gradeList.length ? median(gradeList) : null,
          // Most common unexplained acronyms, by pages affected.
          topUnexplainedAcronyms: Object.entries(acronymCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([acronym, pages]) => ({ acronym, pages })),
          // Most common misspellings, by pages affected.
          topMisspellings: Object.entries(misspellingCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 25)
            .map(([word, pages]) => ({ word, pages })),
        }
      : null,
    lighthouse: lhScores.performance.length
      ? {
          pagesSampled: lhScores.performance.length,
          medianPerformance: median(lhScores.performance),
          medianAccessibility: lhScores.accessibility.length ? median(lhScores.accessibility) : null,
          medianBestPractices: lhScores.bestPractices.length ? median(lhScores.bestPractices) : null,
          medianSeo: lhScores.seo.length ? median(lhScores.seo) : null,
          medianAgentic: lhScores.agentic.length ? median(lhScores.agentic) : null,
        }
      : null,
    linkCheck: brokenLinks.size
      ? {
          brokenCount: brokenLinks.size,
          broken: [...brokenLinks.values()].slice(0, 50),
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

// Keep a small, capped set of representative failing instances per rule
// (page URL + element selector/snippet) so bug reports carry real DOM
// context. Caps total per rule to keep summary.json small.
function addInstances(rule, url, examples) {
  if (!Array.isArray(examples)) return;
  for (const ex of examples) {
    if (rule.instances.length >= MAX_RULE_INSTANCES) break;
    rule.instances.push({
      url,
      target: ex.target ?? null, // CSS selector (axe) / element description (alfa)
      html: ex.html ?? null, // minimal failing markup (axe only)
    });
  }
}

function median(list) {
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
