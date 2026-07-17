#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, loadProfile, applyProfile, DIRS } from './lib/config.js';
import { isoWeek, compareWeeks, weekToDateStamp } from './lib/week.js';
const filePfx = (domain, week) => `${domain}_${weekToDateStamp(week)}`;
import { renderDomainReport, renderIndex, writeAsset, setSustainabilityMetric, setLocale, setReportLanguages, renderLighthousePage, renderReadabilityPage, renderTechPage, renderArchivePage, renderAccessibilityPage, renderStandardsPage, renderSecurityPage, renderErrorsPage, renderImagesPage, renderTechFindingsPage, renderThirdPartyPage, renderUrlLookup, renderHistoryPage, redirectStub, PAGE_REDIRECTS } from './report-html.js';
import { buildBugReports, bugReportsMarkdown } from './lib/bug-report.js';
import { loadPriorityUrls } from './lib/top-tasks.js';
import { loadFindings, saveFindings, updateFindings } from './lib/findings.js';
import { weekDeltas, severityBurndown, streaks, deltaSeries } from './lib/progress.js';
import { writeCsvs, writeBugsCsv, writeErrorsCsv, writeResourceCsv, writeLighthouseCsv, writeLighthouseJson, writeReadabilityCsv, writeSpellingCsv, writeAcronymsCsv, writeTechCsv, writeImagesCsv, writeThirdPartyCsv, writePriorityPages, writeComponentClusterCsvs, writeTrendsCsv } from './lib/csv.js';
import { buildConsensus } from './lib/consensus.js';
import { loadInventory, saveInventory, updateInventory, inventorySummary } from './lib/inventory.js';
import { resolvePageRecord } from './lib/page-records.js';
import { scoreFor } from './lib/score.js';
import { loadResourceLedger, saveResourceLedger, updateResourceLedger } from './lib/resource-ledger.js';
import { loadLinkLedger, saveLinkLedger, updateLinkLedger } from './lib/link-ledger.js';
import { buildCooccurrence, rankAssociations } from './lib/tech-findings.js';
import { rollupThirdParty } from './lib/third-party-rollup.js';
import { loadThirdPartyLedger, saveThirdPartyLedger, updateThirdPartyLedger } from './lib/third-party-ledger.js';
import { buildAiFindings } from './lib/ai-findings.js';
import { buildIndexEntry, buildSnapshot, buildWeekFindings, writeApiFiles } from './lib/api-writer.js';
import { filterBugsByExclusion } from './report-html.js';
import { redactBugs } from './lib/api-redact.js';
import { buildUrlIndex, writeUrlIndex } from './lib/url-index.js';
import { buildLlmsTxt } from './lib/llms-txt.js';
import { writeAcrYaml } from './lib/acr.js';
import { computeTrainingPriorities } from './lib/training-priorities.js';
import { isAvailable as ollamaAvailable, chat as ollamaChat, detectModel as ollamaDetectModel } from './lib/ollama.js';
import { createClusterTracker } from './lib/component-clusters.js';

// Fixed tolerance band (in percentage points) for rate-based diff comparisons.
// Same value used by deriveTrend() in ai-findings.js so the two views agree.
const DIFF_TOLERANCE_PP = 0.02;

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

// VITAL_PROFILE (optional) scopes the build to one deployment profile —
// a subset of targets + report branding (config/profiles/<name>.yml). Unset
// means the full site with default branding: the GitHub Pages behavior,
// unchanged. See config/profiles/README.md.
const profile = loadProfile(process.env.VITAL_PROFILE);
const config = applyProfile(loadConfig(), profile);
if (profile) console.log(`Building profile "${profile.name}" (${config.targets.length} targets).`);
setSustainabilityMetric(config.sustainabilityMetric);
fs.mkdirSync(DIRS.docs, { recursive: true });

// Bugs fed into the static JSON API must honor the same render-time
// url_exclude_patterns baseline the HTML report applies (parity), and must have
// their URLs redacted before publication (fragments stripped, sensitive query
// values [REDACTED]) — issue #136. The scan-time url_exclude filter already
// dropped whole excluded pages before fetch; this is the second and third
// layers for the API surface.
function apiBugsFor(target, bugs) {
  const filtered = filterBugsByExclusion(bugs, target.url_exclude_patterns ?? []);
  return redactBugs(filtered, { denyParams: target.api_redact_params ?? [] });
}

const dashboard = [];
const apiIndexEntries = [];
const apiSnapshots = [];
const apiWeekFindings = [];
const urlLookupDomains = [];

for (const target of config.targets) {
  const domainDir = path.join(DIRS.data, target.key);
  if (!fs.existsSync(domainDir)) continue;
  const reporting = target.reporting ?? {};
  const keyPages = reporting.include_key_page_issues ? loadPriorityUrls(target) : [];

  const weeks = fs.readdirSync(domainDir).filter((w) => /^\d{4}-W\d{2}$/.test(w)).sort(compareWeeks);
  const series = [];

  for (const week of weeks) {
    const summary = summarizeWeek(target, week);
    if (summary) {
      series.push(summary);
      // The full per-page lists are large and reconstructable; keep them
      // in memory for CSV generation but don't commit them to summary.json.
      const omit = new Set(['pagesWithAxeList', 'pagesWithAlfaList', 'pageDetail', 'pageRows', 'bytesList', 'imageRows', 'uniqueImageList']);
      const summaryPath = path.join(domainDir, week, 'summary.json');
      // summarizeRecords() stamps a fresh generatedAt on every call, even
      // for weeks whose underlying page data hasn't changed since the last
      // run (aggregate.js recomputes ALL retained weeks every run, not just
      // the current one). Committing that unconditionally re-writes every
      // retained week's summary.json daily forever, even when nothing else
      // differs — compare content ignoring generatedAt and skip the write
      // (and the timestamp bump) when nothing real changed.
      const nextJson = JSON.stringify(summary, (k, v) => (omit.has(k) || k === 'generatedAt' ? undefined : v), 1);
      const prevJson = fs.existsSync(summaryPath)
        ? JSON.stringify(JSON.parse(fs.readFileSync(summaryPath, 'utf8')), (k, v) => (omit.has(k) || k === 'generatedAt' ? undefined : v), 1)
        : null;
      if (nextJson !== prevJson) {
        fs.writeFileSync(
          summaryPath,
          JSON.stringify(summary, (k, v) => (omit.has(k) ? undefined : v), 1)
        );
      }
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
      .map((f) => resolvePageRecord(domainDir, JSON.parse(fs.readFileSync(path.join(pagesDir, f), 'utf8'))));
    updateInventory(inventory, week, records);
  }
  saveInventory(target.key, inventory);
  const invSummary = inventorySummary(inventory, series[series.length - 1].week);

  // Week-over-week diffs between consecutive summaries.
  const diffs = {};
  for (let i = 1; i < series.length; i++) {
    diffs[series[i].week] = diffWeeks(series[i - 1], series[i]);
  }

  // Machine-readable trend series (JSON + a flat CSV counterpart for the
  // History & Trends page).
  const dataOut = path.join(DIRS.docs, 'data', target.key);
  fs.mkdirSync(dataOut, { recursive: true });
  fs.writeFileSync(path.join(dataOut, 'weekly.json'), JSON.stringify({ domain: target.domain, series, diffs }, null, 1));
  writeTrendsCsv(dataOut, series);

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
  // Third-party vendor ledger — first/last-seen per vendor across history.
  const tpLedger = loadThirdPartyLedger(target.key, target.domain);
  tpLedger.vendors = {}; // recompute deterministically from retained weeks

  // Human reports + structured bug reports (Markdown, JSON, and inline HTML).
  let latestBugs = []; // latest week's bugs, for the fleet-wide worst-offenders view
  for (let i = 0; i < series.length; i++) {
    const summary = series[i];
    const prev = i > 0 ? series[i - 1] : null;
    const bugs = buildBugReports(target, summary);

    // Build the set of page URLs covered by any engine in the PREVIOUS week.
    // Used by updateFindings() to detect coverage-expansion false positives: a
    // finding that only appears on pages not present in the previous sample is
    // not genuinely new.  We use the union of all per-rule affectedPages arrays
    // (pages with ≥1 violation) plus the in-memory pagesWithAxe/AlfaList (only
    // available for non-pruned weeks).  This is a conservative subset of "all
    // pages checked" — pages the engine ran on but found clean won't be here —
    // so we only suppress "new" when we can positively confirm coverage expansion.
    let prevCoveredUrls = null;
    if (prev) {
      const urlSet = new Set();
      for (const rules of [prev.axe?.rules, prev.alfa?.rules]) {
        for (const rule of Object.values(rules ?? {})) {
          for (const p of rule.affectedPages ?? []) urlSet.add(p.url);
        }
      }
      for (const url of prev.pagesWithAxeList ?? []) urlSet.add(url);
      for (const url of prev.pagesWithAlfaList ?? []) urlSet.add(url);
      if (urlSet.size > 0) prevCoveredUrls = urlSet;
    }

    // Symmetric case (issue #222): the set of page URLs covered by any engine
    // THIS week. Used by updateFindings() to detect coverage-lost false
    // "fixed" signals — a finding that disappears only because its pages were
    // never re-checked this week is not a confirmed fix. Same conservative
    // subset logic as prevCoveredUrls above, just read from the current week.
    let thisWeekCoveredUrls = null;
    {
      const urlSet = new Set();
      for (const rules of [summary.axe?.rules, summary.alfa?.rules]) {
        for (const rule of Object.values(rules ?? {})) {
          for (const p of rule.affectedPages ?? []) urlSet.add(p.url);
        }
      }
      for (const url of summary.pagesWithAxeList ?? []) urlSet.add(url);
      for (const url of summary.pagesWithAlfaList ?? []) urlSet.add(url);
      if (urlSet.size > 0) thisWeekCoveredUrls = urlSet;
    }

    // Update the ledger for this week and annotate each bug with its
    // first/last-seen history.
    const history = updateFindings(ledger, summary.week, bugs, { prevCoveredUrls, thisWeekCoveredUrls, prevWeek: prev?.week ?? null });
    for (const b of bugs) {
      const h = history[b.pattern_id];
      if (h) {
        b.first_seen = h.firstSeen;
        b.last_seen = h.lastSeen;
        b.weeks_seen = h.weeksSeen;
      }
    }
    // Finding-level new/fixed/regressed for the Layer-1 landing page. Computed
    // after updateFindings so the ledger reflects state through this week.
    const progress = weekDeltas(ledger, summary.week, prev?.week ?? null);
    // Progress panel: open-finding burndown over the weeks known so far (the
    // ledger has no future weeks yet), and clean-week streaks from it.
    const weeksSoFar = series.slice(0, i + 1).map((s) => s.week);
    progress.burndown = severityBurndown(ledger, weeksSoFar);
    progress.streaks = streaks(progress.burndown);
    progress.deltaSeries = deltaSeries(ledger, weeksSoFar);
    if (bugs.length) {
      const apiBugs = apiBugsFor(target, bugs);
      if (apiBugs.length) {
        apiWeekFindings.push({ key: target.key, week: summary.week, data: buildWeekFindings(target, summary, apiBugs, ledger.findings) });
      }
    }

    const repDir = path.join(DIRS.docs, 'reports', target.key, summary.week);
    fs.mkdirSync(repDir, { recursive: true });

    // CSVs of affected pages, then link each bug to its per-rule CSV.
    const csvLinks = writeCsvs(repDir, summary);
    const clusterCsvLinks = writeComponentClusterCsvs(repDir, summary);
    for (const b of bugs) {
      b.affected_pages_csv = csvLinks.byRule[`${b.engine_key}:${b.rule_id}`] ?? null;
    }

    // Flat bugs.csv: all findings in one spreadsheet-friendly file.
    // Written after affected_pages_csv is set on each bug so the links are included.
    csvLinks.bugsAll = writeBugsCsv(repDir, target.domain, summary.week, bugs);
    // Broken-link ledger: track first/last-seen and weeks-broken per URL,
    // then annotate summary entries so the errors page can show history.
    if (summary.linkCheck?.broken?.length) {
      const annotated = updateLinkLedger(linkLedger, summary.week, summary.linkCheck.broken);
      summary.linkCheck.broken = annotated;
    }
    // Third-party vendor ledger: annotate vendors with first/last-seen so the
    // report can flag ones new this week.
    if (summary.thirdParty?.vendors?.length) {
      summary.thirdParty.vendors = updateThirdPartyLedger(tpLedger, summary.week, summary.thirdParty.vendors);
    }

    // Broken links + error pages CSV.
    csvLinks.errorsAll = writeErrorsCsv(repDir, target.domain, summary.week, summary);

    // Resource inventory: update the ledger, mark which are new this week,
    // and write a resources CSV.
    const newResources = summary.resources
      ? updateResourceLedger(resLedger, summary.week, summary.resources.list)
      : [];
    if (summary.resources) {
      summary.resources.newThisWeek = newResources;
      summary.resources.csv = writeResourceCsv(repDir, target.domain, summary.week, summary.resources, resLedger);
    }

    // Evidence CSVs: Lighthouse per-page, readability per-page, spelling.
    const lhCsv = writeLighthouseCsv(repDir, target.domain, summary.week, summary.lighthouse);
    const lhJson = writeLighthouseJson(repDir, target.domain, summary.week, summary.generatedAt, summary.lighthouse);
    const readabilityCsv = writeReadabilityCsv(repDir, target.domain, summary.week, summary.plainLanguage?.pageRows);
    const spellingCsv = writeSpellingCsv(repDir, target.domain, summary.week, summary.plainLanguage?.topMisspellings);
    const acronymsCsv = writeAcronymsCsv(repDir, target.domain, summary.week, summary.plainLanguage?.topUnexplainedAcronyms);
    if (summary.lighthouse) {
      summary.lighthouse.csv = lhCsv;
      summary.lighthouse.json = lhJson;
    }

    // Priority pages: cross-engine view ranked by composite a11y+perf score.
    const priorityPages = writePriorityPages(
      repDir, target.domain, summary.week, summary.generatedAt,
      bugs, summary.lighthouse?.pageDetail ?? [], summary.pagesScanned
    );
    if (priorityPages.csv) summary.priorityPagesCsv = priorityPages.csv;
    if (priorityPages.json) summary.priorityPagesJson = priorityPages.json;
    if (summary.plainLanguage) {
      summary.plainLanguage.readabilityCsv = readabilityCsv;
      summary.plainLanguage.spellingCsv = spellingCsv;
      summary.plainLanguage.acronymsCsv = acronymsCsv;
      // JSON downloads for spelling + acronyms (word/acronym, pages, examples).
      const pl = summary.plainLanguage;
      const pfx = filePfx(target.domain, summary.week);
      if (pl.topMisspellings?.length) {
        const spellingJsonName = `${pfx}_spelling.json`;
        fs.writeFileSync(path.join(repDir, spellingJsonName),
          JSON.stringify({ domain: target.domain, week: summary.week, generatedAt: summary.generatedAt, misspellings: pl.topMisspellings }, null, 1));
        pl.spellingJson = spellingJsonName;
      }
      if (pl.topUnexplainedAcronyms?.length) {
        const acronymsJsonName = `${pfx}_acronyms.json`;
        fs.writeFileSync(path.join(repDir, acronymsJsonName),
          JSON.stringify({ domain: target.domain, week: summary.week, generatedAt: summary.generatedAt, acronyms: pl.topUnexplainedAcronyms }, null, 1));
        pl.acronymsJson = acronymsJsonName;
      }
    }

    // Every sub-page is written for every week, so the shared subnav is
    // identical on every domain and every week — no missing tabs, no 404s. A
    // criterion with no data this week renders a clear empty-state page. CSV/
    // JSON downloads are still only written when there's data to put in them.

    // Pre-compute prefixed filenames so HTML links are correct before the files are written.
    const pfx2 = filePfx(target.domain, summary.week);
    const bugsJsonName = `${pfx2}_bugs.json`;
    const aiJsonName = `${pfx2}_ai-findings.json`;

    // OpenACR YAML — written before the accessibility page so the path is available for the download link.
    const acrResult = writeAcrYaml(repDir, target, summary, summary.week);

    // Training priorities: top WCAG SCs by pages affected, with optional Ollama advice.
    const trainingPriorities = computeTrainingPriorities(bugs);
    let trainingAdvice = null;
    if (trainingPriorities.length > 0 && await ollamaAvailable()) {
      const model = await ollamaDetectModel();
      const topList = trainingPriorities.map((p, i) =>
        `${i + 1}. ${p.label} (SC ${p.wcag_sc})${p.component_inconsistency ? ' — component inconsistency across multiple elements' : ''}`
      ).join('\n');
      trainingAdvice = await ollamaChat(
        `You are helping an accessibility trainer at a government agency. The top WCAG issues found on the site are:\n${topList}\n\nWrite a short (3–5 sentence) training recommendation for the web team, focusing on practical steps for the most impactful issue. Plain English, no jargon.`,
        model
      );
    }

    // Locale-independent artifacts (CSVs, side JSON) — computed once, then the
    // HTML pages below are rendered per configured language.
    const techCsv = summary.tech?.length ? writeTechCsv(repDir, target.domain, summary.week, summary.tech) : null;
    if (summary.tech?.length) {
      const techJsonName = `${pfx2}_tech.json`;
      fs.writeFileSync(path.join(repDir, techJsonName),
        JSON.stringify({ domain: target.domain, week: summary.week, generatedAt: summary.generatedAt, pagesScanned: summary.pagesScanned, technologies: summary.tech }, null, 1));
      summary.techJson = techJsonName;
    }
    const tpCsv = summary.thirdParty?.vendors?.length ? writeThirdPartyCsv(repDir, target.domain, summary.week, summary) : null;
    const imagesCsv = summary.images?.imageRows?.length ? writeImagesCsv(repDir, target.domain, summary.week, summary) : null;
    // Deduplicated image inventory as JSON (src, alt, bytes, occurrences,
    // alt-text verdict, example pages).
    if (summary.images?.uniqueImageList?.length) {
      const imagesJsonName = `${pfx2}_images.json`;
      fs.writeFileSync(
        path.join(repDir, imagesJsonName),
        JSON.stringify({ domain: target.domain, week: summary.week, generatedAt: summary.generatedAt, images: summary.images.uniqueImageList }, null, 1)
      );
      summary.imagesJson = imagesJsonName;
    }

    // inventory totals only make sense on the latest week's report.
    const isLatest = i === series.length - 1;
    if (isLatest) latestBugs = bugs.map((b) => ({ ...b, _week: summary.week }));

    // Render the configured languages. Sustainability (sustainable-web-output):
    // non-default languages are built only for the LATEST week — the most-viewed
    // one — so archived weeks aren't multiplied N× on disk and in the Pages
    // artifact for pages almost nobody revisits. Older weeks stay English at the
    // canonical paths; a non-English reader who navigates back simply sees
    // English there (graceful fallback, and — being single-language — those
    // pages emit no ?lang/hreflang runtime, so nothing redirects to a missing
    // sibling). The default language owns the unsuffixed paths; others are
    // <page>-<loc>.html.
    const weekLanguages = isLatest ? target.languages : [target.defaultLanguage];
    for (const locale of weekLanguages) {
      setLocale(locale);
      setReportLanguages(weekLanguages, target.defaultLanguage, target.showLanguageSwitcher);
      const sfx = locale === target.defaultLanguage ? '' : `-${locale}`;
      // Accessibility (always has content — shows "no findings" when clean).
      const actions = summary.componentClusters?.top_actions ?? [];
      for (const a of actions) {
        a.affected_pages_csv = clusterCsvLinks[a.id] ?? null;
      }
      // Filenames are outcome-aligned (accessible/fast/findable/third-parties);
      // a redirect stub is written at each old basename below so existing deep
      // links keep working.
      fs.writeFileSync(path.join(repDir, `accessible${sfx}.html`), renderAccessibilityPage(target, summary, bugs, csvLinks, {
        ...reporting, keyPages,
        priorityPagesCsv: priorityPages.csv,
        priorityPagesJson: priorityPages.json,
        bugsJson: bugsJsonName,
        aiJson: aiJsonName,
        clusterCsvLinks,
        acrYaml: acrResult.path,
        trainingPriorities,
        trainingAdvice,
      }, target.url_exclude_patterns ?? []));
      fs.writeFileSync(path.join(repDir, `standards${sfx}.html`), renderStandardsPage(target, summary));
      fs.writeFileSync(path.join(repDir, `security${sfx}.html`), renderSecurityPage(target, summary));
      fs.writeFileSync(path.join(repDir, `errors${sfx}.html`), renderErrorsPage(target, summary, csvLinks.errorsAll ?? null));
      fs.writeFileSync(path.join(repDir, `fast${sfx}.html`), renderLighthousePage(target, summary, lhCsv, lhJson));
      fs.writeFileSync(path.join(repDir, `findable${sfx}.html`), renderReadabilityPage(target, summary, readabilityCsv));
      fs.writeFileSync(path.join(repDir, `tech${sfx}.html`), renderTechPage(target, summary, techCsv));
      fs.writeFileSync(path.join(repDir, `tech-findings${sfx}.html`), renderTechFindingsPage(target, summary));
      fs.writeFileSync(path.join(repDir, `third-parties${sfx}.html`), renderThirdPartyPage(target, summary, tpCsv));
      fs.writeFileSync(path.join(repDir, `images${sfx}.html`), renderImagesPage(target, summary, imagesCsv));
      // History & Trends page (issue #180). Written for every week so the
      // subnav link resolves from any week's report.
      fs.writeFileSync(path.join(repDir, `history${sfx}.html`), renderHistoryPage(target, series, summary.week));
      // Archive page (all weeks). Written in each week folder so the subnav
      // "Archive" link resolves from any week's report.
      const archiveHtml = renderArchivePage(target, series, series[series.length - 1].week);
      if (archiveHtml) fs.writeFileSync(path.join(repDir, `archive${sfx}.html`), archiveHtml);
      fs.writeFileSync(path.join(repDir, `index${sfx}.html`),
        renderDomainReport(target, summary, prev, diffs[summary.week] ?? null, series, bugs, csvLinks, isLatest ? invSummary : null, progress));
      // Redirect stubs at the pre-rename basenames (hash-preserving), for this
      // locale's suffix, so old bookmarks/pinned-issue links resolve.
      for (const [oldName, newName] of Object.entries(PAGE_REDIRECTS)) {
        fs.writeFileSync(path.join(repDir, `${oldName}${sfx}.html`), redirectStub(`${newName}${sfx}`, locale));
      }
    }
    setLocale(target.defaultLanguage);
    fs.writeFileSync(path.join(repDir, 'bugs.md'), bugReportsMarkdown(target, summary, bugs));
    fs.writeFileSync(
      path.join(repDir, bugsJsonName),
      JSON.stringify({ domain: target.domain, week: summary.week, generatedAt: summary.generatedAt, reports: bugs }, null, 1)
    );

    // AI-oriented findings summary: compact, problem-focused, LLM-ready.
    // Intentionally excludes healthy pages; uses representative examples rather
    // than exhaustive lists. The existing bugs.json and domain.json are the
    // archival sources of truth and are not replaced.
    const aiDoc = await buildAiFindings(target, summary, bugs, ledger, series, invSummary, repDir);
    if (aiDoc) {
      const aiJson = JSON.stringify(aiDoc, null, 1);
      fs.writeFileSync(path.join(repDir, aiJsonName), aiJson);
      // Warn in the build log if the file is large (context-limit concern for LLMs).
      const kbSize = Math.round(aiJson.length / 1024);
      if (kbSize > 500) console.warn(`  [ai-findings] ${target.key} ${summary.week}: ${kbSize}KB — may exceed LLM context limits`);
    }
  }

  saveFindings(target.key, ledger);
  saveResourceLedger(target.key, resLedger);
  saveLinkLedger(target.key, linkLedger);
  saveThirdPartyLedger(target.key, tpLedger);

  const latestSummary = series[series.length - 1];
  const latestBugsOnly = apiBugsFor(target, latestBugs.map(({ _week, ...b }) => b));
  apiIndexEntries.push(buildIndexEntry(target, latestSummary, latestBugsOnly));
  apiSnapshots.push({ key: target.key, data: buildSnapshot(target, series, diffs, ledger, invSummary, latestBugsOnly) });

  const urlIdx = buildUrlIndex(domainDir, target.domain, latestSummary.week);
  if (urlIdx) {
    writeUrlIndex(path.join(DIRS.docs, 'api', 'v1'), target.key, urlIdx);
    urlLookupDomains.push({ key: target.key, domain: target.domain, week: latestSummary.week });
  }

  // Single downloadable snapshot of everything known about the domain:
  // every URL with known issues (repro evidence), current known findings
  // (with first/last-seen), the weekly trend series, and the latest score.
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
        // Last-known result for every URL with known issues (survives
        // pruning). Clean pages aren't listed individually — see
        // inventorySummary for aggregate counts, and `fixed` for pages
        // that recently had issues and no longer do.
        pages: Object.entries(inventory.pages).map(([url, p]) => ({ url, ...p })),
        fixed: Object.entries(inventory.fixed ?? {}).map(([url, f]) => ({ url, ...f })),
        // Every unique finding with first/last-seen history.
        findings: ledger.findings,
        // Latest week's tech↔finding associations (lift-ranked), for anyone
        // building cross-site analyses. The full model lives in weekly.series.
        techFindings: latest.techFindings?.associations ?? null,
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

// The fleet dashboard and URL-lookup tool are site-wide, so they render in the
// global languages (default -> canonical path, others suffixed).
for (const locale of config.languages) {
  setLocale(locale);
  setReportLanguages(config.languages, config.defaultLanguage, config.showLanguageSwitcher);
  const sfx = locale === config.defaultLanguage ? '' : `-${locale}`;
  fs.writeFileSync(path.join(DIRS.docs, `index${sfx}.html`), renderIndex(dashboard, { branding: profile?.branding }));
  if (urlLookupDomains.length) {
    fs.writeFileSync(path.join(DIRS.docs, `url-lookup${sfx}.html`), renderUrlLookup(urlLookupDomains));
  }
}
setLocale(config.defaultLanguage);
writeAsset(DIRS.docs);
writeApiFiles(DIRS.docs, apiIndexEntries, apiSnapshots, apiWeekFindings);
fs.writeFileSync(path.join(DIRS.docs, 'llms.txt'), buildLlmsTxt(config, apiIndexEntries));
console.log('docs/ written');

// ---------------------------------------------------------------------

function summarizeWeek(target, week) {
  const domainDir = path.join(DIRS.data, target.key);
  const pagesDir = path.join(domainDir, week, 'pages');
  const summaryPath = path.join(domainDir, week, 'summary.json');

  // If page detail was pruned, reuse the committed summary verbatim.
  if (!fs.existsSync(pagesDir)) {
    return fs.existsSync(summaryPath) ? JSON.parse(fs.readFileSync(summaryPath, 'utf8')) : null;
  }

  const records = fs.readdirSync(pagesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => resolvePageRecord(domainDir, JSON.parse(fs.readFileSync(path.join(pagesDir, f), 'utf8'))));
  if (records.length === 0) return null;

  const runsDir = path.join(DIRS.data, target.key, week, 'runs');
  const broken = readBrokenLinks(runsDir);
  const tally = readTallyTotals(runsDir);
  const summary = summarizeRecords(target, week, records, broken);
  if (summary && tally) {
    summary.pagesAttempted = tally.attempted;
    summary.pagesSucceeded = tally.succeeded;
  }
  return summary;
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
      if (rec.scannedAt && Date.parse(rec.scannedAt) >= cutoff) records.push(resolvePageRecord(domainDir, rec));
    }
    runDirs.push(path.join(domainDir, week, 'runs'));
  }
  if (records.length === 0) return null;
  const broken = readBrokenLinks(runDirs, cutoff);
  const tally = readTallyTotals(runDirs, cutoff);
  const s = summarizeRecords(target, 'last-7-days', records, broken);
  if (s) {
    s.windowDays = days;
    if (tally) { s.pagesAttempted = tally.attempted; s.pagesSucceeded = tally.succeeded; }
  }
  return s;
}

/**
 * Sum tally fields across all run logs in one or more runs directories.
 * Returns { attempted, succeeded } where attempted = ok+blocked+timeout+error
 * and succeeded = ok (status < 400, non-redirect HTML responses).
 * Returns null when no run logs with a tally are found.
 */
function readTallyTotals(runsDirOrDirs, sinceMs = null) {
  const dirs = Array.isArray(runsDirOrDirs) ? runsDirOrDirs : [runsDirOrDirs];
  let attempted = 0, succeeded = 0, found = false;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const rf of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const run = JSON.parse(fs.readFileSync(path.join(dir, rf), 'utf8'));
      if (sinceMs && run.finishedAt && Date.parse(run.finishedAt) < sinceMs) continue;
      if (!run.tally) continue;
      found = true;
      const t = run.tally;
      attempted += (t.ok ?? 0) + (t.blocked ?? 0) + (t.timeout ?? 0) + (t.error ?? 0);
      succeeded += (t.ok ?? 0);
    }
  }
  return found ? { attempted, succeeded } : null;
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
  // Progressive Web Resilience (per-page): checkId -> { label, pass, total, why, evidenceExamples }.
  const resilienceChecks = {};
  let resiliencePages = 0;
  // Security (per-origin): keep the latest result seen this week.
  let securityLatest = null;
  // Public-interest checks (per-origin): keep the latest result seen this week.
  let publicInterestLatest = null;
  // Offline/network resilience (per-origin): keep the latest result seen this week.
  let offlineResilienceLatest = null;
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
  const acronymCounts = {}; // acronym -> { pages, examplePages[] }
  const misspellingCounts = {}; // word -> { pages, examplePages[] }
  const plRows = []; // per-page readability rows (for CSV)
  let plPagesChecked = 0; // pages plain-language ran on (for words/page)
  const wordCounts = []; // per-page main-content word counts
  // Lighthouse: collect sampled scores + Core Web Vitals metrics for
  // medians, and keep per-sampled-page detail for the Lighthouse page.
  const lhScores = { performance: [], accessibility: [], bestPractices: [], seo: [], agentic: [] };
  const lhMetrics = { firstContentfulPaintMs: [], largestContentfulPaintMs: [], speedIndexMs: [], totalBlockingTimeMs: [], cumulativeLayoutShift: [] };
  const lhPages = []; // { url, scores, metrics }
  // Lighthouse recommendations (non-a11y audits) rolled up across sampled pages.
  const lhReco = {}; // auditId -> { id, category, title, pages, examplePages[], savingsBytes, savingsMs }
  // Images: per-page flat list for CSV + aggregate alt-text metrics.
  const imageRows = []; // { pageUrl, src, alt, hasAlt, isDecorative, isMissingAlt, width, height, loading, bytes }
  let imagePagesScanned = 0;
  let imagesTotalCount = 0;
  let imagesMissingAlt = 0;
  let imagesDecorative = 0;
  // Deduplicated by src: the same image reused across pages collapses to one
  // entry with an occurrence count, so the page table isn't full of repeats.
  const imageBySrc = new Map(); // src -> { src, alt, bytes, occurrences, pages:Set, altVerdict, altReason, alts:Set }
  const altVerdictCounts = {}; // verdict -> unique-image count (for the quality summary)
  // Tech↔finding join: one row per page where the tech engine ran, listing
  // the technologies on it and the accessibility findings on it. Only pages
  // with tech detection contribute, so the co-occurrence denominator is the
  // set of pages we actually have technology data for.
  const techFindingPages = []; // { techs: string[], findings: string[] }
  // Third-party rollup: one row per page the third-party engine ran on.
  const thirdPartyPages = []; // { pageUrl, hasFindings, origins[] }
  const clusterTracker = createClusterTracker(target);

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
        clusterTracker.observe('axe-core', id, v.impact ?? null, rec.url, v.examples);
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
        clusterTracker.observe('alfa', id, null, rec.url, v.examples);
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
        clusterTracker.observe('deprecated-html', id, null, rec.url, v.examples);
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
      if (rec.standards.resilience) {
        resiliencePages++;
        for (const c of rec.standards.resilience.checks ?? []) {
          const s = (resilienceChecks[c.id] ??= { label: c.label, pass: 0, total: 0, why: c.why, evidenceExamples: [] });
          s.total++;
          if (c.status === 'pass') s.pass++;
          if (c.evidence && s.evidenceExamples.length < 3) s.evidenceExamples.push({ evidence: c.evidence, url: c.exampleUrl ?? rec.url });
          s.label = c.label;
          s.why = c.why;
        }
      }
    }
    if (rec.security) securityLatest = rec.security; // per-origin; latest wins
    if (rec.offlineResilience) offlineResilienceLatest = rec.offlineResilience; // per-origin; latest wins
    if (rec.publicInterest) publicInterestLatest = rec.publicInterest; // per-origin; latest wins
    if (rec.tech) {
      for (const d of rec.tech) {
        const existing = techDetections.get(d.name);
        // Merge: keep highest-confidence detection; track how many pages
        // confirmed it and a few example pages where it was found.
        // confidence is 0–100 (Wappalyzer's scale), higher is better.
        if (!existing) {
          techDetections.set(d.name, { ...d, pagesConfirmed: 1, examplePages: [rec.url] });
        } else {
          existing.pagesConfirmed++;
          if (existing.examplePages.length < 10) existing.examplePages.push(rec.url);
          if (d.confidence > existing.confidence) {
            // Adopt the higher-confidence detection's fields but keep the
            // accumulated count + example pages.
            Object.assign(existing, d, { pagesConfirmed: existing.pagesConfirmed, examplePages: existing.examplePages });
          }
        }
      }
      // Tech↔finding row for this page: the technologies on it paired with the
      // accessibility findings on it. Keyed engine:ruleId. Only built for pages
      // with tech data so the co-occurrence denominator is well-defined.
      const findings = [
        ...Object.keys(rec.axe?.violations ?? {}).map((id) => `axe:${id}`),
        ...Object.keys(rec.alfa?.failed ?? {}).map((id) => `alfa:${id}`),
      ];
      techFindingPages.push({ techs: rec.tech.map((d) => d.name), findings });
    }
    if (rec.thirdParty) {
      // hasFindings: did this page have any accessibility finding? Used to
      // correlate third-party presence with findings (association only).
      const hasFindings = !!(rec.axe?.violationCount || rec.alfa?.failedCount);
      thirdPartyPages.push({ pageUrl: rec.url, hasFindings, origins: rec.thirdParty.origins ?? [] });
    }
    if (rec.images) {
      imagePagesScanned++;
      imagesTotalCount += rec.images.count;
      for (const img of rec.images.images ?? []) {
        if (img.isMissingAlt) imagesMissingAlt++;
        if (img.isDecorative) imagesDecorative++;
        imageRows.push({ pageUrl: rec.url, ...img });
        // Deduplicate by src and alt for the page view.
        const key = `${img.src}|${img.alt ?? ''}`;
        let e = imageBySrc.get(key);
        if (!e) {
          e = {
            src: img.src,
            alt: img.alt,
            bytes: img.bytes ?? null,
            occurrences: 0,
            pages: new Set(),
            loadings: new Set(),
            altVerdict: img.altVerdict,
            altReason: img.altReason
          };
          imageBySrc.set(key, e);
        }
        e.occurrences++;
        e.pages.add(rec.url);
        if (img.loading) e.loadings.add(img.loading);
        if (e.bytes == null && img.bytes != null) e.bytes = img.bytes;
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
        scoreSkipReason: rec.plainLanguage.scoreSkipReason ?? null,
      });
      if (rec.plainLanguage.scored) {
        plPagesScored++;
        if (rec.plainLanguage.fleschReadingEase != null) freList.push(rec.plainLanguage.fleschReadingEase);
        if (rec.plainLanguage.fleschKincaidGrade != null) gradeList.push(rec.plainLanguage.fleschKincaidGrade);
      }
      for (const a of rec.plainLanguage.unexplainedAcronyms ?? []) {
        const e = (acronymCounts[a] ??= { pages: 0, examplePages: [] });
        e.pages++;
        if (e.examplePages.length < 5) e.examplePages.push(rec.url);
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
      // Roll up failing audits into recommendations (like axe rules): one
      // entry per audit id, counting pages affected and summing savings.
      for (const a of rec.lighthouse.audits ?? []) {
        const r = (lhReco[a.id] ??= { id: a.id, category: a.category, title: a.title, pages: 0, examplePages: [], savingsBytes: 0, savingsMs: 0 });
        r.pages++;
        if (r.examplePages.length < 10) r.examplePages.push(rec.url);
        r.savingsBytes += a.savingsBytes ?? 0;
        r.savingsMs += a.savingsMs ?? 0;
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
    // Progressive Web Resilience (issue #145): per-page checks (manifest,
    // service worker, installability) roll up like `standards` above;
    // offline/network checks are per-origin, "latest wins" like security.
    resilience: resiliencePages
      ? {
          pagesChecked: resiliencePages,
          checks: Object.entries(resilienceChecks).map(([id, s]) => ({
            id, label: s.label, pass: s.pass, total: s.total,
            rate: Math.round((s.pass / s.total) * 100),
            why: s.why,
            evidenceExamples: s.evidenceExamples,
          })).sort((a, b) => a.rate - b.rate),
          offline: offlineResilienceLatest,
        }
      : null,
    security: securityLatest
      ? { checks: securityLatest.checks, passed: securityLatest.passed, total: securityLatest.total }
      : null,
    publicInterest: publicInterestLatest ?? null,
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
            .sort((a, b) => b[1].pages - a[1].pages)
            .slice(0, 15)
            .map(([acronym, e]) => ({ acronym, pages: e.pages, examplePages: e.examplePages })),
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
          medianPwa: null,
          medianAgentic: lhScores.agentic.length ? median(lhScores.agentic) : null,
          metrics: {
            firstContentfulPaintMs: lhMetrics.firstContentfulPaintMs.length ? median(lhMetrics.firstContentfulPaintMs) : null,
            largestContentfulPaintMs: lhMetrics.largestContentfulPaintMs.length ? median(lhMetrics.largestContentfulPaintMs) : null,
            speedIndexMs: lhMetrics.speedIndexMs.length ? median(lhMetrics.speedIndexMs) : null,
            totalBlockingTimeMs: lhMetrics.totalBlockingTimeMs.length ? median(lhMetrics.totalBlockingTimeMs) : null,
            cumulativeLayoutShift: lhMetrics.cumulativeLayoutShift.length ? median(lhMetrics.cumulativeLayoutShift) : null,
          },
          pwaSignals: [],
          pageDetail: lhPages, // per-sampled-page detail for the Lighthouse page (omitted from committed summary.json)
          // Aggregated non-accessibility recommendations, ranked by reach then
          // impact. Stored in the committed summary (compact, like axe rules).
          recommendations: Object.values(lhReco).sort(
            (a, b) => b.pages - a.pages || (b.savingsBytes + b.savingsMs * 1000) - (a.savingsBytes + a.savingsMs * 1000)
          ),
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
      ? (() => {
          const srcAltCounts = {};
          for (const e of imageBySrc.values()) {
            srcAltCounts[e.src] = (srcAltCounts[e.src] ?? 0) + 1;
          }
          // Deduplicated, occurrence-counted unique images for the page table,
          // plus the alt-text quality verdict tally (counted per unique image).
          const uniqueImages = [...imageBySrc.values()]
            .map((e) => ({
              src: e.src,
              alt: e.alt,
              bytes: e.bytes,
              occurrences: e.occurrences,
              pages: e.pages.size,
              loading: e.loadings.size > 0 ? [...e.loadings].sort().join(', ') : null,
              altCount: srcAltCounts[e.src], // >1 means inconsistent alt across uses
              altVerdict: e.altVerdict,
              altReason: e.altReason,
              examplePages: [...e.pages].slice(0, 10),
            }))
            .sort((a, b) => b.occurrences - a.occurrences || (b.bytes ?? 0) - (a.bytes ?? 0));
          for (const u of uniqueImages) altVerdictCounts[u.altVerdict] = (altVerdictCounts[u.altVerdict] ?? 0) + 1;
          return {
            pagesScanned: imagePagesScanned,
            totalImages: imagesTotalCount,
            uniqueImages: uniqueImages.length,
            missingAlt: imagesMissingAlt,
            decorative: imagesDecorative,
            withAlt: imagesTotalCount - imagesMissingAlt - imagesDecorative,
            // Alt-text quality verdict counts over unique images.
            altVerdicts: altVerdictCounts,
            // Deduplicated unique-image list (committed; bounded by site image variety).
            uniqueImageList: uniqueImages,
            // Per-occurrence rows for the CSV (omitted from committed summary.json).
            imageRows,
          };
        })()
      : null,
    // Tech↔finding association: the compact co-occurrence model (for the
    // fleet merge on the dashboard) plus this week's ranked associations.
    // Null when no page had both tech detection and the join is meaningless.
    techFindings: techFindingPages.length
      ? (() => {
          const model = buildCooccurrence(techFindingPages);
          return { model, associations: rankAssociations(model, { minPages: 5, limit: 50 }) };
        })()
      : null,
    // Third-party resource/JS cost rolled up per vendor across the pages the
    // third-party engine ran on. Page-resolved (3rd-party JS varies per page).
    thirdParty: thirdPartyPages.length ? rollupThirdParty(thirdPartyPages) : null,
    componentClusters: clusterTracker.finalize(
      pagesScanned,
      target.reporting?.template_page_threshold ?? 10
    ),
  };
}

function diffWeeks(prev, curr) {
  const diffEngine = (prevRules, currRules, prevScanned, currScanned) => {
    const useRates = prevScanned > 0 && currScanned > 0;

    // A rule "appeared" if it's in curr but not in prev.  With rate awareness,
    // we only report it as a genuine new rule when it would have shown up in
    // the previous-sized sample — i.e., its rate × prevScanned ≥ 1 page.
    // Rules that only appear because entirely new pages were added to the
    // sample are suppressed (rate × prevScanned < 1 means prev sample was
    // too small to catch even one occurrence).
    const appeared = Object.keys(currRules).filter((id) => {
      if (id in prevRules) return false;
      if (useRates) {
        const expectedInPrevSample = (currRules[id].pages / currScanned) * prevScanned;
        return expectedInPrevSample >= 1;
      }
      return true;
    });

    const resolved = Object.keys(prevRules).filter((id) => !(id in currRules));

    // A rule "changed" only when its rate of occurrence shifted by more than
    // the tolerance band.  Raw-count changes that merely reflect a larger
    // sample (same rate, more pages) are treated as stable.
    const changed = Object.keys(currRules)
      .filter((id) => {
        if (!(id in prevRules)) return false;
        if (useRates) {
          const currRate = currRules[id].pages / currScanned;
          const prevRate = prevRules[id].pages / prevScanned;
          return Math.abs(currRate - prevRate) > DIFF_TOLERANCE_PP;
        }
        return currRules[id].pages !== prevRules[id].pages;
      })
      .map((id) => ({
        id,
        pagesBefore: prevRules[id].pages,
        pagesAfter: currRules[id].pages,
        prevScanned: useRates ? prevScanned : undefined,
        currScanned: useRates ? currScanned : undefined,
      }));

    return { appeared, resolved, changed };
  };

  return {
    prevWeek: prev.week,
    pagesDelta: curr.pagesScanned - prev.pagesScanned,
    axe: {
      violationDelta: curr.axe.violationTotal - prev.axe.violationTotal,
      ...diffEngine(prev.axe.rules, curr.axe.rules, prev.axe.pagesScanned, curr.axe.pagesScanned),
    },
    alfa: {
      failedDelta: curr.alfa.failedTotal - prev.alfa.failedTotal,
      ...diffEngine(prev.alfa.rules, curr.alfa.rules, prev.alfa.pagesScanned, curr.alfa.pagesScanned),
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
