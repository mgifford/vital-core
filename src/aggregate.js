#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, DIRS } from './lib/config.js';
import { compareWeeks } from './lib/week.js';
import { renderDomainReport, renderIndex, writeAsset, setSustainabilityMetric, renderLighthousePage, renderReadabilityPage, renderTechPage, renderArchivePage, renderAccessibilityPage, renderStandardsPage, renderErrorsPage, renderImagesPage } from './report-html.js';
import { buildBugReports, bugReportsMarkdown } from './lib/bug-report.js';
import { loadFindings, saveFindings, updateFindings } from './lib/findings.js';
import { writeCsvs, writeBugsCsv, writeErrorsCsv, writeResourceCsv, writeLighthouseCsv, writeReadabilityCsv, writeSpellingCsv, writeImagesCsv } from './lib/csv.js';
import { buildConsensus } from './lib/consensus.js';
import { loadInventory, saveInventory, updateInventory, inventorySummary } from './lib/inventory.js';
import { scoreFor } from './lib/score.js';
import { loadResourceLedger, saveResourceLedger, updateResourceLedger } from './lib/resource-ledger.js';
import { loadLinkLedger, saveLinkLedger, updateLinkLedger } from './lib/link-ledger.js';

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
const MAX_AFFECTED_PAGES = 5000; // full affected-page list cap per rule (for CSV)

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
      // The full per-page lists are large and reconstructable; keep them
      // in memory for CSV generation but don't commit them to summary.json.
      const omit = new Set(['pagesWithAxeList', 'pagesWithAlfaList', 'pageDetail', 'pageRows', 'bytesList', 'imageRows']);
      fs.writeFileSync(
        path.join(domainDir, week, 'summary.json'),
        JSON.stringify(summary, (k, v) => (omit.has(k) ? undefined : v), 1)
      );
    }
  }
  if (series.length === 0) continue;

  // Rolling site inventory: last-known status for every URL ever scanned.
  // Updated incrementally from each retained week's page records (older
  // weeks may already be pruned, but their results persist in inventory).
  const inventory = loadInventory(target.key, target.domain);
  for (const week of weeks) {
    const pagesDir = path.join(domainDir, week, 'pages');
    if (!fs.existsSync(pagesDir)) continue;
    const records = fs.readdirSync(pagesDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(pagesDir, f), 'utf8')));
    updateInventory(inventory, week, records);
  }
  saveInventory(target.key, inventory);
  const invSummary = inventorySummary(inventory, series[series.length - 1].week);

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
  // Resource inventory ledger (PDFs, docs, iframes, media) — same pattern.
  const resLedger = loadResourceLedger(target.key, target.domain);
  resLedger.resources = {};
  // Broken-link ledger — accumulated across whole history.
  const linkLedger = loadLinkLedger(target.key, target.domain);
  linkLedger.links = {};

  // Human reports + structured bug reports (Markdown, JSON, and inline HTML).
  let latestBugs = []; // latest week's bugs, for the fleet-wide worst-offenders view
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

    // CSVs of affected pages, then link each bug to its per-rule CSV.
    const csvLinks = writeCsvs(repDir, summary);
    for (const b of bugs) {
      b.affected_pages_csv = csvLinks.byRule[`${b.engine_key}:${b.rule_id}`] ?? null;
    }

    // Flat bugs.csv: all findings in one spreadsheet-friendly file.
    // Written after affected_pages_csv is set on each bug so the links are included.
    csvLinks.bugsAll = writeBugsCsv(repDir, bugs);
    // Broken-link ledger: track first/last-seen and weeks-broken per URL,
    // then annotate summary entries so the errors page can show history.
    if (summary.linkCheck?.broken?.length) {
      const annotated = updateLinkLedger(linkLedger, summary.week, summary.linkCheck.broken);
      summary.linkCheck.broken = annotated;
    }

    // Broken links + error pages CSV.
    csvLinks.errorsAll = writeErrorsCsv(repDir, summary);

    // Resource inventory: update the ledger, mark which are new this week,
    // and write a resources CSV.
    const newResources = summary.resources
      ? updateResourceLedger(resLedger, summary.week, summary.resources.list)
      : [];
    if (summary.resources) {
      summary.resources.newThisWeek = newResources;
      summary.resources.csv = writeResourceCsv(repDir, summary.resources, resLedger);
    }

    // Evidence CSVs: Lighthouse per-page, readability per-page, spelling.
    const lhCsv = writeLighthouseCsv(repDir, summary.lighthouse);
    const readabilityCsv = writeReadabilityCsv(repDir, summary.plainLanguage?.pageRows);
    const spellingCsv = writeSpellingCsv(repDir, summary.plainLanguage?.topMisspellings);
    if (summary.lighthouse) summary.lighthouse.csv = lhCsv;
    if (summary.plainLanguage) {
      summary.plainLanguage.readabilityCsv = readabilityCsv;
      summary.plainLanguage.spellingCsv = spellingCsv;
    }

    // Which standalone sub-pages this week has (drives the shared subnav).
    // Accessibility page is always present (even if empty — shows "no findings").
    const available = ['accessibility'];
    if (summary.lighthouse?.pageDetail?.length) available.push('lighthouse');
    if (summary.plainLanguage?.pageRows?.length) available.push('readability');
    if (summary.tech?.length) available.push('tech');
    if (summary.images) available.push('images');
    // Standards and errors pages only exist when there's data.
    const hasStandards = !!(summary.security || summary.standards);
    const hasErrors = !!(summary.linkCheck?.broken?.length || summary.errorPages?.some((e) => Number(e.status) !== 404));
    if (hasStandards) available.push('standards');
    if (hasErrors) available.push('errors');

    // Standalone Accessibility page (bug reports + axe/alfa rule tables + consensus).
    const a11yHtml = renderAccessibilityPage(target, summary, bugs, csvLinks, available);
    fs.writeFileSync(path.join(repDir, 'accessibility.html'), a11yHtml);
    // Standalone Standards & Security page.
    const stdHtml = renderStandardsPage(target, summary, available);
    if (stdHtml) fs.writeFileSync(path.join(repDir, 'standards.html'), stdHtml);
    // Standalone Broken Links & Errors page.
    const errHtml = renderErrorsPage(target, summary, csvLinks.errorsAll ?? null, available);
    if (errHtml) fs.writeFileSync(path.join(repDir, 'errors.html'), errHtml);
    // Standalone Lighthouse page (per-sampled-page scores + metrics + perf impact).
    const lhHtml = renderLighthousePage(target, summary, lhCsv, available);
    if (lhHtml) fs.writeFileSync(path.join(repDir, 'lighthouse.html'), lhHtml);
    // Standalone Readability page (per-page reading metrics + acronyms + spelling).
    const readHtml = renderReadabilityPage(target, summary, readabilityCsv, available);
    if (readHtml) fs.writeFileSync(path.join(repDir, 'readability.html'), readHtml);
    const techHtml = renderTechPage(target, summary, available);
    if (techHtml) fs.writeFileSync(path.join(repDir, 'tech.html'), techHtml);
    const imagesCsv = summary.images?.imageRows?.length ? writeImagesCsv(repDir, summary) : null;
    const imagesHtml = renderImagesPage(target, summary, imagesCsv, available);
    if (imagesHtml) fs.writeFileSync(path.join(repDir, 'images.html'), imagesHtml);
    // Archive page (all weeks). Written in each week folder so the subnav
    // "Archive" link resolves from any week's report.
    const archiveHtml = renderArchivePage(target, series, series[series.length - 1].week);
    if (archiveHtml) fs.writeFileSync(path.join(repDir, 'archive.html'), archiveHtml);

    // inventory totals only make sense on the latest week's report.
    const isLatest = i === series.length - 1;
    if (isLatest) latestBugs = bugs.map((b) => ({ ...b, _week: summary.week }));
    const html = renderDomainReport(target, summary, prev, diffs[summary.week] ?? null, series, bugs, csvLinks, isLatest ? invSummary : null, available);
    fs.writeFileSync(path.join(repDir, 'index.html'), html);
    fs.writeFileSync(path.join(repDir, 'bugs.md'), bugReportsMarkdown(target, summary, bugs));
    fs.writeFileSync(
      path.join(repDir, 'bugs.json'),
      JSON.stringify({ domain: target.domain, week: summary.week, generatedAt: summary.generatedAt, reports: bugs }, null, 1)
    );
  }

  saveFindings(target.key, ledger);
  saveResourceLedger(target.key, resLedger);
  saveLinkLedger(target.key, linkLedger);

  // Single downloadable snapshot of everything known about the domain:
  // every scanned URL's latest status, current known findings (with
  // first/last-seen), the weekly trend series, and the latest score.
  const latest = series[series.length - 1];
  fs.writeFileSync(
    path.join(dataOut, 'domain.json'),
    JSON.stringify(
      {
        domain: target.domain,
        generatedAt: new Date().toISOString(),
        latestWeek: latest.week,
        latestScore: scoreFor(latest),
        inventorySummary: invSummary,
        // Last-known result for every URL ever scanned (survives pruning).
        pages: Object.entries(inventory.pages).map(([url, p]) => ({ url, ...p })),
        // Every unique finding with first/last-seen history.
        findings: ledger.findings,
        // Week-over-week trend series + diffs.
        weekly: { series, diffs },
      },
      null,
      1
    )
  );

  // Trailing-7-day rolling summary for the dashboard (and the latest
  // report's headline), so the headline isn't a partial ISO week measured
  // against full historic weeks. Falls back to the latest week if the
  // window is empty (e.g. old data only).
  const windowSummary = summarizeWindow(target, 7) ?? series[series.length - 1];

  dashboard.push({ target, series, diffs, inventory: invSummary, bugs: latestBugs, windowSummary });
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

  const records = fs.readdirSync(pagesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(pagesDir, f), 'utf8')));
  if (records.length === 0) return null;

  // Broken links from this week's run logs.
  const broken = readBrokenLinks(path.join(DIRS.data, target.key, week, 'runs'));
  return summarizeRecords(target, week, records, broken);
}

/**
 * Trailing-window summary: aggregate all page records across retained
 * weeks whose scannedAt falls within the last `days` days. This is the
 * default "last 7 days" view, so the headline numbers aren't a partial
 * ISO week compared against full historic weeks.
 */
function summarizeWindow(target, days = 7) {
  const domainDir = path.join(DIRS.data, target.key);
  if (!fs.existsSync(domainDir)) return null;
  const cutoff = Date.now() - days * 86400000;
  const records = [];
  const runDirs = [];
  for (const week of fs.readdirSync(domainDir).filter((w) => /^\d{4}-W\d{2}$/.test(w))) {
    const pagesDir = path.join(domainDir, week, 'pages');
    if (!fs.existsSync(pagesDir)) continue;
    for (const f of fs.readdirSync(pagesDir).filter((x) => x.endsWith('.json'))) {
      const rec = JSON.parse(fs.readFileSync(path.join(pagesDir, f), 'utf8'));
      if (rec.scannedAt && Date.parse(rec.scannedAt) >= cutoff) records.push(rec);
    }
    runDirs.push(path.join(domainDir, week, 'runs'));
  }
  if (records.length === 0) return null;
  // Broken links from run logs whose finishedAt is within the window.
  const broken = readBrokenLinks(runDirs, cutoff);
  const s = summarizeRecords(target, 'last-7-days', records, broken);
  if (s) s.windowDays = days;
  return s;
}

/** Fold broken links from one or more runs dirs (optionally since cutoff ms). */
function readBrokenLinks(runsDirOrDirs, sinceMs = null) {
  const dirs = Array.isArray(runsDirOrDirs) ? runsDirOrDirs : [runsDirOrDirs];
  const brokenLinks = new Map();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const rf of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const run = JSON.parse(fs.readFileSync(path.join(dir, rf), 'utf8'));
      if (sinceMs && run.finishedAt && Date.parse(run.finishedAt) < sinceMs) continue;
      for (const b of run.linkCheck?.broken ?? []) {
        const existing = brokenLinks.get(b.url);
        if (!existing) brokenLinks.set(b.url, { ...b, foundOn: new Set(b.foundOn ?? []) });
        else for (const s of b.foundOn ?? []) existing.foundOn.add(s);
      }
    }
  }
  return brokenLinks;
}

/** Aggregate a set of page records into a summary (shared by week + window). */
function summarizeRecords(target, week, records, brokenLinks) {
  const files = records; // loop below iterates parsed records directly
  const axeRules = {}; // ruleId -> { count, pages, impact, help, helpUrl, examples }
  const alfaRules = {};
  const deprecatedRules = {}; // ruleId -> { count, pages, help, examplePages, instances }
  const enginePageCounts = {}; // engine -> unique pages it ran on (coverage)
  const resourceMap = new Map(); // resource url -> { url, type, foundOn:Set }
  // Standards (per-page): checkId -> { label, pass, total } pass counts.
  const standardsChecks = {};
  let standardsPages = 0;
  const socialSeen = new Map(); // platform -> example href
  // Security (per-origin): keep the latest result seen this week.
  let securityLatest = null;
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
  const pagesWithAxe = []; // URLs with >=1 axe violation (for the CSV behind "37 of 598")
  const pagesWithAlfa = []; // URLs with >=1 alfa failure
  const bytesList = [];
  const requestsList = [];
  let co2Total = 0;
  let energyTotal = 0;
  let pagesWithAudit = 0;
  const errorPages = [];
  const blockedStatuses = {}; // status code -> count, for the blocked callout
  const techDetections = new Map(); // name -> detection (merged across pages)
  // Plain-language: collect scored pages' readability for medians.
  const freList = [];
  const gradeList = [];
  let plPagesScored = 0;
  const acronymCounts = {}; // acronym -> pages it was unexplained on
  const misspellingCounts = {}; // word -> { pages, examplePages[] }
  const plRows = []; // per-page readability rows (for CSV)
  let plPagesChecked = 0; // pages plain-language ran on (for words/page)
  const wordCounts = []; // per-page main-content word counts
  // Lighthouse: collect sampled scores + Core Web Vitals metrics for
  // medians, and keep per-sampled-page detail for the Lighthouse page.
  const lhScores = { performance: [], accessibility: [], bestPractices: [], seo: [], agentic: [] };
  const lhMetrics = { firstContentfulPaintMs: [], largestContentfulPaintMs: [], speedIndexMs: [], totalBlockingTimeMs: [], cumulativeLayoutShift: [] };
  const lhPages = []; // { url, scores, metrics }
  // Images: per-page flat list for CSV + aggregate alt-text metrics.
  const imageRows = []; // { pageUrl, src, alt, hasAlt, isDecorative, isMissingAlt, width, height, loading, bytes }
  let imagePagesScanned = 0;
  let imagesTotalCount = 0;
  let imagesMissingAlt = 0;
  let imagesDecorative = 0;

  // brokenLinks is supplied by the caller (folded from run logs).

  for (const rec of files) {
    pagesScanned++;
    if (rec.axe || rec.alfa || rec.sustainability || rec.plainLanguage || rec.lighthouse) pagesWithAudit++;
    if (typeof rec.status === 'number' && rec.status >= 400) {
      errorPages.push({ url: rec.url, status: rec.status });
      blockedStatuses[rec.status] = (blockedStatuses[rec.status] ?? 0) + 1;
    }

    if (rec.axe) {
      auditedPageIds.add(rec.pageId ?? rec.url);
      axeCountsPerPage.push(rec.axe.violationCount);
      if (rec.axe.violationCount > 0) { pagesWithAxeViolations++; pagesWithAxe.push(rec.url); }
      axeViolationTotal += rec.axe.violationCount;
      for (const [id, v] of Object.entries(rec.axe.violations)) {
        const r = (axeRules[id] ??= { count: 0, pages: 0, impact: v.impact, help: v.help, helpUrl: v.helpUrl, tags: v.tags ?? [], examplePages: [], affectedPages: [], instances: [] });
        r.count += v.count;
        r.pages++;
        if (r.examplePages.length < 3) r.examplePages.push(rec.url);
        if (r.affectedPages.length < MAX_AFFECTED_PAGES) r.affectedPages.push({ url: rec.url, instances: v.count });
        addInstances(r, rec.url, v.examples);
      }
    }
    if (rec.alfa) {
      auditedPageIds.add(rec.pageId ?? rec.url);
      alfaCountsPerPage.push(rec.alfa.failedCount);
      if (rec.alfa.failedCount > 0) { pagesWithAlfaFailures++; pagesWithAlfa.push(rec.url); }
      alfaFailedTotal += rec.alfa.failedCount;
      for (const [id, v] of Object.entries(rec.alfa.failed)) {
        const r = (alfaRules[id] ??= { count: 0, pages: 0, ruleUrl: v.ruleUrl, examplePages: [], affectedPages: [], instances: [] });
        r.count += v.count;
        r.pages++;
        if (r.examplePages.length < 3) r.examplePages.push(rec.url);
        if (r.affectedPages.length < MAX_AFFECTED_PAGES) r.affectedPages.push({ url: rec.url, instances: v.count });
        addInstances(r, rec.url, v.examples);
      }
    }
    if (rec.deprecatedHtml) {
      for (const [id, v] of Object.entries(rec.deprecatedHtml.findings)) {
        const r = (deprecatedRules[id] ??= { count: 0, pages: 0, help: v.help, examplePages: [], affectedPages: [], instances: [] });
        r.count += v.count;
        r.pages++;
        if (r.examplePages.length < 3) r.examplePages.push(rec.url);
        if (r.affectedPages.length < MAX_AFFECTED_PAGES) r.affectedPages.push({ url: rec.url, instances: v.count });
        addInstances(r, rec.url, v.examples);
      }
    }
    if (rec.resources) {
      for (const res of rec.resources.resources ?? []) {
        const entry = resourceMap.get(res.url) ?? { url: res.url, type: res.type, foundOn: new Set() };
        entry.foundOn.add(rec.url);
        resourceMap.set(res.url, entry);
      }
    }
    if (rec.standards) {
      standardsPages++;
      for (const c of rec.standards.checks ?? []) {
        const s = (standardsChecks[c.id] ??= { label: c.label, pass: 0, total: 0 });
        s.total++;
        if (c.pass) s.pass++;
        s.label = c.label; // keep latest label (counts may be embedded)
      }
      for (const soc of rec.standards.social ?? []) {
        if (!socialSeen.has(soc.platform)) socialSeen.set(soc.platform, soc.href);
      }
    }
    if (rec.security) securityLatest = rec.security; // per-origin; latest wins
    if (rec.tech) {
      for (const d of rec.tech) {
        const existing = techDetections.get(d.name);
        // Merge: keep highest-confidence detection; track how many pages confirmed it.
        // confidence is 0–100 (Wappalyzer's scale), higher is better.
        if (!existing || d.confidence > existing.confidence) {
          techDetections.set(d.name, { ...d, pagesConfirmed: (existing?.pagesConfirmed ?? 0) + 1 });
        } else {
          existing.pagesConfirmed++;
        }
      }
    }
    if (rec.images) {
      imagePagesScanned++;
      imagesTotalCount += rec.images.count;
      for (const img of rec.images.images ?? []) {
        if (img.isMissingAlt) imagesMissingAlt++;
        if (img.isDecorative) imagesDecorative++;
        imageRows.push({ pageUrl: rec.url, ...img });
      }
    }
    if (rec.sustainability) {
      bytesList.push(rec.sustainability.bytes);
      requestsList.push(rec.sustainability.requests);
      co2Total += rec.sustainability.co2g;
      energyTotal += rec.sustainability.energyWh ?? 0;
    }

    // Per-engine coverage: which engines actually ran on this page.
    for (const e of ['axe', 'alfa', 'plain-language', 'deprecated-html', 'resources', 'standards', 'security', 'lighthouse', 'sustainability', 'tech']) {
      const key = { 'plain-language': 'plainLanguage', 'deprecated-html': 'deprecatedHtml' }[e] ?? e;
      if (rec[key]) enginePageCounts[e] = (enginePageCounts[e] ?? 0) + 1;
    }
    if (rec.plainLanguage) {
      plPagesChecked++;
      if (typeof rec.plainLanguage.wordCount === 'number') wordCounts.push(rec.plainLanguage.wordCount);
      // Per-page readability row (for the readability CSV).
      plRows.push({
        url: rec.url,
        wordCount: rec.plainLanguage.wordCount ?? 0,
        fleschReadingEase: rec.plainLanguage.fleschReadingEase ?? '',
        fleschKincaidGrade: rec.plainLanguage.fleschKincaidGrade ?? '',
        scored: rec.plainLanguage.scored ?? false,
      });
      if (rec.plainLanguage.scored) {
        plPagesScored++;
        if (rec.plainLanguage.fleschReadingEase != null) freList.push(rec.plainLanguage.fleschReadingEase);
        if (rec.plainLanguage.fleschKincaidGrade != null) gradeList.push(rec.plainLanguage.fleschKincaidGrade);
      }
      for (const a of rec.plainLanguage.unexplainedAcronyms ?? []) {
        acronymCounts[a] = (acronymCounts[a] ?? 0) + 1;
      }
      for (const w of rec.plainLanguage.misspelled ?? []) {
        const m = (misspellingCounts[w] ??= { pages: 0, examplePages: [] });
        m.pages++;
        if (m.examplePages.length < 5) m.examplePages.push(rec.url);
      }
    }
    if (rec.lighthouse?.scores) {
      for (const k of Object.keys(lhScores)) {
        const v = rec.lighthouse.scores[k];
        if (typeof v === 'number') lhScores[k].push(v);
      }
      for (const k of Object.keys(lhMetrics)) {
        const v = rec.lighthouse.metrics?.[k];
        if (typeof v === 'number') lhMetrics[k].push(v);
      }
      lhPages.push({ url: rec.url, scores: rec.lighthouse.scores, metrics: rec.lighthouse.metrics ?? {} });
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
    // Full lists of pages with any axe/alfa finding — used to write the
    // CSVs behind the "N of M" report numbers. Omitted from the committed
    // summary.json (see the JSON replacer at write time); kept in memory.
    pagesWithAxeList: pagesWithAxe,
    pagesWithAlfaList: pagesWithAlfa,
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
    // Cross-engine consolidation via W3C ACT rules: how many unique issues
    // there really are (not axe + alfa double-counted), and how many both
    // engines agree on.
    consensus: buildConsensus(axeRules, alfaRules),
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
          // Per-page byte sizes for the performance-impact estimate
          // (omitted from committed summary.json — see the JSON replacer).
          bytesList,
        }
      : null,
    deprecatedHtml: Object.keys(deprecatedRules).length
      ? {
          findingTotal: Object.values(deprecatedRules).reduce((s, r) => s + r.count, 0),
          rules: deprecatedRules,
        }
      : null,
    resources: resourceMap.size
      ? {
          total: resourceMap.size,
          byType: countBy([...resourceMap.values()], (r) => r.type),
          // Full list (url, type, count of pages it appears on) for the
          // ledger, inventory, and CSV. foundOn Set -> count.
          list: [...resourceMap.values()].map((r) => ({ url: r.url, type: r.type, pages: r.foundOn.size })),
        }
      : null,
    standards: standardsPages
      ? {
          pagesChecked: standardsPages,
          // Per-check pass rate across the checked pages.
          checks: Object.entries(standardsChecks).map(([id, s]) => ({
            id, label: s.label, pass: s.pass, total: s.total,
            rate: Math.round((s.pass / s.total) * 100),
          })).sort((a, b) => a.rate - b.rate),
          social: [...socialSeen.entries()].map(([platform, href]) => ({ platform, href })),
        }
      : null,
    security: securityLatest
      ? { checks: securityLatest.checks, passed: securityLatest.passed, total: securityLatest.total }
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
          // Most common misspellings, by pages affected (with examples).
          topMisspellings: Object.entries(misspellingCounts)
            .sort((a, b) => b[1].pages - a[1].pages)
            .slice(0, 25)
            .map(([word, m]) => ({ word, pages: m.pages, examplePages: m.examplePages })),
          // Per-page rows for the readability CSV (omitted from committed summary.json).
          pageRows: plRows,
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
          metrics: {
            firstContentfulPaintMs: lhMetrics.firstContentfulPaintMs.length ? median(lhMetrics.firstContentfulPaintMs) : null,
            largestContentfulPaintMs: lhMetrics.largestContentfulPaintMs.length ? median(lhMetrics.largestContentfulPaintMs) : null,
            speedIndexMs: lhMetrics.speedIndexMs.length ? median(lhMetrics.speedIndexMs) : null,
            totalBlockingTimeMs: lhMetrics.totalBlockingTimeMs.length ? median(lhMetrics.totalBlockingTimeMs) : null,
            cumulativeLayoutShift: lhMetrics.cumulativeLayoutShift.length ? median(lhMetrics.cumulativeLayoutShift) : null,
          },
          pageDetail: lhPages, // per-sampled-page detail for the Lighthouse page (omitted from committed summary.json)
        }
      : null,
    linkCheck: brokenLinks.size
      ? {
          brokenCount: brokenLinks.size,
          broken: [...brokenLinks.values()].slice(0, 50).map((b) => ({
            url: b.url,
            status: b.status,
            reason: b.reason,
            foundOn: [...(b.foundOn ?? [])], // pages that link to this broken URL
          })),
        }
      : null,
    errorPages: errorPages.slice(0, 25),
    tech: techDetections.size
      ? [...techDetections.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
      : null,
    images: imagePagesScanned
      ? {
          pagesScanned: imagePagesScanned,
          totalImages: imagesTotalCount,
          missingAlt: imagesMissingAlt,
          decorative: imagesDecorative,
          withAlt: imagesTotalCount - imagesMissingAlt - imagesDecorative,
          // Per-image rows for the CSV and images.html page (omitted from committed summary.json).
          imageRows,
        }
      : null,
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

function countBy(items, keyFn) {
  const out = {};
  for (const it of items) {
    const k = keyFn(it);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function median(list) {
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
