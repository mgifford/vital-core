/**
 * Weekly Accessibility Conformance Report (ACR) generator.
 *
 * Produces three outputs from a week's summary data:
 *
 *   acr.yaml  — OpenACR 0.1.0 YAML, machine-readable and editable.
 *               Compatible with https://github.com/GSA/openacr tooling.
 *               Can be committed to source control and updated manually to
 *               add context automated tools cannot provide (AT testing,
 *               user research, exception tracking).
 *   acr.html  — Self-contained HTML view (inline CSS; no external deps).
 *               VPAT-style Level A + Level AA tables with adherence labels.
 *   acr.zip   — Bundle of the above two files for easy download.
 *
 * Adherence level mapping (OpenACR vocabulary):
 *   does-not-support  — automated scan found failures for this SC on ≥1 page
 *   partially-supports — failures on a small fraction of scanned pages (<5%)
 *   not-evaluated     — no manual conformance outcome exists (including every
 *                       criterion where automation found no failure)
 *
 * This is an *incomplete automated evidence draft*, not an ACR. Absence of an
 * automated failure is not support. Every A/AA criterion without a manual
 * outcome is marked not-evaluated and listed in the incomplete note. Human
 * testers must complete and sign the document before publication.
 *
 * Only the web component is populated (electronic-docs, software, and
 * authoring-tool are marked not-applicable — this tool scans public web pages).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveWcag } from './wcag.js';
import { FAVICON_DATA_URI } from './brand.js';

// All WCAG 2.2 Success Criteria in catalog order, with level and version.
// This is the complete set for a WCAG 2.2 A+AA conformance target.
const WCAG_CATALOG = [
  // Level A
  { sc: '1.1.1', name: 'Non-text Content',                              level: 'A',  ver: '2.0' },
  { sc: '1.2.1', name: 'Audio-only and Video-only (Prerecorded)',        level: 'A',  ver: '2.0' },
  { sc: '1.2.2', name: 'Captions (Prerecorded)',                         level: 'A',  ver: '2.0' },
  { sc: '1.2.3', name: 'Audio Description or Media Alternative (Prerecorded)', level: 'A', ver: '2.0' },
  { sc: '1.3.1', name: 'Info and Relationships',                         level: 'A',  ver: '2.0' },
  { sc: '1.3.2', name: 'Meaningful Sequence',                            level: 'A',  ver: '2.0' },
  { sc: '1.3.3', name: 'Sensory Characteristics',                        level: 'A',  ver: '2.0' },
  { sc: '1.4.1', name: 'Use of Color',                                   level: 'A',  ver: '2.0' },
  { sc: '1.4.2', name: 'Audio Control',                                  level: 'A',  ver: '2.0' },
  { sc: '2.1.1', name: 'Keyboard',                                       level: 'A',  ver: '2.0' },
  { sc: '2.1.2', name: 'No Keyboard Trap',                               level: 'A',  ver: '2.0' },
  { sc: '2.1.4', name: 'Character Key Shortcuts',                        level: 'A',  ver: '2.1' },
  { sc: '2.2.1', name: 'Timing Adjustable',                              level: 'A',  ver: '2.0' },
  { sc: '2.2.2', name: 'Pause, Stop, Hide',                              level: 'A',  ver: '2.0' },
  { sc: '2.3.1', name: 'Three Flashes or Below Threshold',               level: 'A',  ver: '2.0' },
  { sc: '2.4.1', name: 'Bypass Blocks',                                  level: 'A',  ver: '2.0' },
  { sc: '2.4.2', name: 'Page Titled',                                    level: 'A',  ver: '2.0' },
  { sc: '2.4.3', name: 'Focus Order',                                    level: 'A',  ver: '2.0' },
  { sc: '2.4.4', name: 'Link Purpose (In Context)',                      level: 'A',  ver: '2.0' },
  { sc: '2.5.1', name: 'Pointer Gestures',                               level: 'A',  ver: '2.1' },
  { sc: '2.5.2', name: 'Pointer Cancellation',                           level: 'A',  ver: '2.1' },
  { sc: '2.5.3', name: 'Label in Name',                                  level: 'A',  ver: '2.1' },
  { sc: '2.5.4', name: 'Motion Actuation',                               level: 'A',  ver: '2.1' },
  { sc: '3.1.1', name: 'Language of Page',                               level: 'A',  ver: '2.0' },
  { sc: '3.2.1', name: 'On Focus',                                       level: 'A',  ver: '2.0' },
  { sc: '3.2.2', name: 'On Input',                                       level: 'A',  ver: '2.0' },
  { sc: '3.2.6', name: 'Consistent Help',                                level: 'A',  ver: '2.2' },
  { sc: '3.3.1', name: 'Error Identification',                           level: 'A',  ver: '2.0' },
  { sc: '3.3.2', name: 'Labels or Instructions',                         level: 'A',  ver: '2.0' },
  { sc: '3.3.7', name: 'Redundant Entry',                                level: 'A',  ver: '2.2' },
  { sc: '4.1.2', name: 'Name, Role, Value',                              level: 'A',  ver: '2.0' },
  // Level AA
  { sc: '1.2.4', name: 'Captions (Live)',                                level: 'AA', ver: '2.0' },
  { sc: '1.2.5', name: 'Audio Description (Prerecorded)',                level: 'AA', ver: '2.0' },
  { sc: '1.3.4', name: 'Orientation',                                    level: 'AA', ver: '2.1' },
  { sc: '1.3.5', name: 'Identify Input Purpose',                         level: 'AA', ver: '2.1' },
  { sc: '1.4.3', name: 'Contrast (Minimum)',                             level: 'AA', ver: '2.0' },
  { sc: '1.4.4', name: 'Resize Text',                                    level: 'AA', ver: '2.0' },
  { sc: '1.4.5', name: 'Images of Text',                                 level: 'AA', ver: '2.0' },
  { sc: '1.4.10', name: 'Reflow',                                        level: 'AA', ver: '2.1' },
  { sc: '1.4.11', name: 'Non-text Contrast',                             level: 'AA', ver: '2.1' },
  { sc: '1.4.12', name: 'Text Spacing',                                  level: 'AA', ver: '2.1' },
  { sc: '1.4.13', name: 'Content on Hover or Focus',                     level: 'AA', ver: '2.1' },
  { sc: '2.4.5', name: 'Multiple Ways',                                  level: 'AA', ver: '2.0' },
  { sc: '2.4.6', name: 'Headings and Labels',                            level: 'AA', ver: '2.0' },
  { sc: '2.4.7', name: 'Focus Visible',                                  level: 'AA', ver: '2.0' },
  { sc: '2.4.11', name: 'Focus Not Obscured (Minimum)',                  level: 'AA', ver: '2.2' },
  { sc: '2.5.7', name: 'Dragging Movements',                             level: 'AA', ver: '2.2' },
  { sc: '2.5.8', name: 'Target Size (Minimum)',                          level: 'AA', ver: '2.2' },
  { sc: '3.1.2', name: 'Language of Parts',                              level: 'AA', ver: '2.0' },
  { sc: '3.2.3', name: 'Consistent Navigation',                          level: 'AA', ver: '2.0' },
  { sc: '3.2.4', name: 'Consistent Identification',                      level: 'AA', ver: '2.0' },
  { sc: '3.3.3', name: 'Error Suggestion',                               level: 'AA', ver: '2.0' },
  { sc: '3.3.4', name: 'Error Prevention (Legal, Financial, Data)',       level: 'AA', ver: '2.0' },
  { sc: '3.3.8', name: 'Accessible Authentication (Minimum)',             level: 'AA', ver: '2.2' },
  { sc: '4.1.3', name: 'Status Messages',                                level: 'AA', ver: '2.0' },
];

/**
 * Derive per-SC status from the week's summary.
 * Returns a Map: sc -> { level, name, ver, adherence, pagesAffected, totalTested, engines, examples }
 */
export function buildAcrData(summary) {
  const pagesScanned = summary.pagesScanned ?? 0;
  const axePages     = summary.axe?.pagesScanned ?? 0;
  const alfaPages    = summary.alfa?.pagesScanned ?? 0;

  // Collect failures per SC across both engines.
  // scFailures: sc -> { pages: max pages affected across engines, engines: Set, examples: Set }
  const scFailures = new Map();

  const addFailure = (sc, pages, engine, examplePages) => {
    const e = scFailures.get(sc) ?? { pages: 0, engines: new Set(), examples: new Set() };
    e.pages = Math.max(e.pages, pages);
    e.engines.add(engine);
    for (const u of (examplePages ?? []).slice(0, 3)) e.examples.add(u);
    scFailures.set(sc, e);
  };

  for (const [ruleId, rule] of Object.entries(summary.axe?.rules ?? {})) {
    const w = resolveWcag('axe-core', { tags: rule.tags ?? [], ruleId });
    if (w?.sc) addFailure(w.sc, rule.pages, 'axe-core', rule.examplePages);
  }
  for (const [ruleId, rule] of Object.entries(summary.alfa?.rules ?? {})) {
    const w = resolveWcag('alfa', { tags: rule.tags ?? [], ruleId });
    if (w?.sc) addFailure(w.sc, rule.pages, 'Alfa', rule.examplePages);
  }

  // Automation cannot enumerate passes. A failure maps to an evidence term;
  // everything else stays unknown until a human records an outcome.

  const scMap = new Map();
  const incomplete = [];
  for (const entry of WCAG_CATALOG) {
    const fail = scFailures.get(entry.sc);
    let adherence, pagesAffected = 0, engines = [], examples = [];
    let automatedNoFailure = false;

    if (fail) {
      pagesAffected = fail.pages;
      engines = [...fail.engines];
      examples = [...fail.examples];
      const failRate = fail.pages / Math.max(axePages, alfaPages, 1);
      // Failures on some tested pages and none on others are still only
      // sample-scoped evidence, never a whole-product claim.
      adherence = failRate < 0.05 ? 'partially-supports' : 'does-not-support';
    } else {
      // Automation cannot establish support. No failure is not a pass: leave
      // the criterion unknown and name it in the incomplete-draft list.
      adherence = 'not-evaluated';
      automatedNoFailure = true;
      incomplete.push(entry.sc);
    }

    scMap.set(entry.sc, { ...entry, adherence, pagesAffected, engines, examples, automatedNoFailure });
  }

  return { scMap, pagesScanned, axePages, alfaPages, incomplete };
}

/** YAML serialization — minimal hand-rolled YAML to avoid a dependency. */
function yamlStr(s) {
  if (!s) return '""';
  // Multi-line: use literal block scalar
  if (s.includes('\n')) return `|-\n${s.split('\n').map((l) => `    ${l}`).join('\n')}`;
  // Single-line: quote if needed
  if (/[:#\[\]{}&*!|>'"%@`]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

/**
 * Generate a valid OpenACR 0.1.0 YAML string from the ACR data.
 */
export function buildAcrYaml(target, summary, week, acrData) {
  const { scMap, pagesScanned, axePages, alfaPages } = acrData;
  const reportDate = new Date().toISOString().slice(0, 10);
  const weekLabel = week ?? summary.week;

  const incomplete = acrData.incomplete ?? [];
  const header = `title: ${yamlStr(`${target.domain}: draft automated accessibility evidence (not a conformance report)`)}
author:
  name: "VITAL Core automated scan (unreviewed draft — no accountable author assigned)"
  email: "vital-core@users.noreply.github.com"
product:
  name: ${yamlStr(target.domain)}
  version: ${yamlStr(weekLabel)}
  description: ${yamlStr(`DRAFT automated evidence for public web pages at ${target.domain}, week ${weekLabel}. Generated by vital-scans using axe-core and Siteimprove Alfa; no manual assistive-technology evaluation was performed.`)}
report_date: "${reportDate}"
last_modified_date: "${reportDate}"
version: 1
catalog: 2.5-edition-wcag-2.2-en
notes: ${yamlStr(
  `INCOMPLETE DRAFT — A/AA criteria without a manual outcome: ${incomplete.join(', ') || 'none'}. ` +
  `This is automated evidence only, not an Accessibility Conformance Report and not a conformance claim. ` +
  `It covers ${pagesScanned} scanned pages; axe-core ran on ${axePages} pages and Siteimprove Alfa on ${alfaPages} pages. ` +
  `No accountable author or reviewer has signed this document. Manual AT testing, keyboard testing and user research have not been performed. ` +
  `A criterion marked not-evaluated may still have no automated failure; absence of a detected failure is not evidence of support.`
)}
evaluation_methods_used: ${yamlStr(
  `Automated weekly sample only: axe-core ${summary.axe?.version ?? ''} and Siteimprove Alfa in headless Chromium (Playwright), mapped to WCAG 2.2 success criteria. ` +
  `This is not a WCAG-EM evaluation and no manual AT testing was conducted. Add manual findings directly to this YAML file before relying on it.`
)}
legal_disclaimer: "DRAFT — automated evidence only; not a conformance claim. Manual testing is incomplete. A qualified human must review, complete and sign this document before publication."
license: CC-BY-4.0
feedback: https://github.com/mgifford/vital-core/issues
repository: https://github.com/mgifford/vital-core
`;

  // Separate A and AA criteria
  const levelA  = WCAG_CATALOG.filter((e) => e.level === 'A');
  const levelAA = WCAG_CATALOG.filter((e) => e.level === 'AA');

  const renderCriteria = (entries) =>
    entries.map((e) => {
      const d = scMap.get(e.sc);
      if (!d) return '';
      let notes = '';
      if (d.pagesAffected > 0) {
        notes = `Automated scan found failures on ${d.pagesAffected} of ${Math.max(axePages, alfaPages)} tested pages (engines: ${d.engines.join(', ')}).`;
        if (d.examples.length > 0) notes += ` Example: ${d.examples[0]}`;
      } else if (d.automatedNoFailure) {
        notes = `Automated scan detected no failure on ${Math.max(axePages, alfaPages)} tested pages this week, but absence of a detected failure is not evidence that the criterion is met. Manual testing required.`;
      } else {
        notes = 'Not evaluated by automated engines this week. Manual testing required.';
      }
      return `      - num: "${e.sc}"
        components:
          - name: web
            adherence:
              level: ${d.adherence}
              notes: ${yamlStr(notes)}
          - name: electronic-docs
            adherence:
              level: not-applicable
          - name: software
            adherence:
              level: not-applicable
          - name: authoring-tool
            adherence:
              level: not-applicable`;
    }).filter(Boolean).join('\n');

  return `${header}
chapters:
  success_criteria_level_a:
    notes: ${yamlStr(`Level A criteria. Automated coverage is partial. "not-evaluated" means no manual conformance outcome exists; it is not a pass.`)}
    criteria:
${renderCriteria(levelA)}
  success_criteria_level_aa:
    notes: ${yamlStr(`Level AA criteria. Same caveats as Level A.`)}
    criteria:
${renderCriteria(levelAA)}
  success_criteria_level_aaa:
    disabled: true
    notes: "AAA criteria not included in automated scan scope."
  functional_performance_criteria:
    disabled: true
    notes: "FPC not in scope for this automated web scan."
`;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scUnderstandingSlug(name) {
  return name.toLowerCase().replace(/[(),.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const ADHERENCE_LABEL = {
  'does-not-support':   'Does Not Support',
  'partially-supports': 'Partially Supports',
  'supports':           'Supports',
  'not-evaluated':      'Not Evaluated',
};

/**
 * Generate a self-contained HTML Accessibility Conformance Report.
 * No external CSS, JS, or design system required.
 */
export function renderAcrHtml(target, summary, week, acrData) {
  const { scMap, pagesScanned, axePages, alfaPages, incomplete = [] } = acrData;
  const reportDate = summary.generatedAt ? String(summary.generatedAt).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const weekLabel = week ?? summary.week;
  const domain = escHtml(target.domain);
  const tested = summary.pagesAudited ?? Math.max(axePages, alfaPages);
  const renderRow = (e) => {
    const d = scMap.get(e.sc);
    if (!d) return '';
    const slug = scUnderstandingSlug(e.name);
    const scLink = `https://www.w3.org/WAI/WCAG22/Understanding/${slug}/`;
    const label = ADHERENCE_LABEL[d.adherence] ?? d.adherence;
    let notes;
    if (d.pagesAffected > 0) {
      notes = `Automated scan found failures on ${d.pagesAffected} of ${tested} tested pages (engines: ${escHtml(d.engines.join(', '))}).`;
      if (d.examples.length > 0) notes += ` Example: <a href="${escHtml(d.examples[0])}">${escHtml(d.examples[0])}</a>`;
    } else if (d.automatedNoFailure) {
      notes = `Automated scan detected no failure on ${tested} tested pages this week, but absence of a detected failure is not evidence that the criterion is met. Manual testing required.`;
    } else {
      notes = 'Not evaluated by automated engines this week. Manual testing required.';
    }
    return `    <tr>
      <td class="sc-num"><a href="${escHtml(scLink)}">${escHtml(e.sc)}</a> ${escHtml(e.name)}</td>
      <td><span class="adherence ${escHtml(d.adherence)}">${escHtml(label)}</span></td>
      <td>${notes}</td>
    </tr>`;
  };

  const renderTable = (entries, heading) => {
    const rows = entries.map(renderRow).filter(Boolean).join('\n');
    return `<h2>${heading}</h2>
<table>
  <thead><tr><th>Criteria</th><th>Conformance Level</th><th>Remarks and Explanations</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>`;
  };

  const levelA  = WCAG_CATALOG.filter((e) => e.level === 'A');
  const levelAA = WCAG_CATALOG.filter((e) => e.level === 'AA');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="${FAVICON_DATA_URI}" type="image/svg+xml">
  <title>${domain}: DRAFT automated accessibility evidence — ${escHtml(weekLabel)}</title>
  <style>
    body{font-family:system-ui,sans-serif;margin:2rem auto;max-width:1200px;color:#1b1b1b}
    h1{color:#005ea2}
    h2{border-bottom:2px solid #005ea2;padding-bottom:.25rem;margin-top:2rem}
    p.note{background:#f0f4f9;border-left:4px solid #005ea2;padding:.75rem 1rem}
    table{width:100%;border-collapse:collapse;margin-bottom:2rem}
    thead th{background:#005ea2;color:#fff;padding:.5rem;text-align:left}
    td{padding:.5rem;border:1px solid #ddd;vertical-align:top}
    tr:nth-child(even) td{background:#f6f8fb}
    .sc-num{white-space:nowrap}
    .adherence{font-weight:700}
    .does-not-support{color:#b50909}
    .partially-supports{color:#8a5c00}
    .supports{color:#1a7a3e}
    .not-evaluated{color:#555}
    .footer{font-size:.85em;color:#555;margin-top:3rem;border-top:1px solid #ddd;padding-top:1rem}
    .draft-banner{background:#fff3cd;border:2px solid #8a5c00;padding:1rem;margin:1rem 0}
    .draft-banner strong{display:block;font-size:1.15rem}
    a{color:#005ea2}
  </style>
</head>
<body>
<h1>${domain}: DRAFT automated accessibility evidence</h1>
<div class="draft-banner" role="note">
<strong>DRAFT — not an Accessibility Conformance Report.</strong>
Automated evidence only. No manual assistive-technology testing, keyboard testing or user research was performed. Do not use this document to claim conformance or award a contract.
</div>
<p>Week: <strong>${escHtml(weekLabel)}</strong> &nbsp;&middot;&nbsp; Report date: <strong>${escHtml(reportDate)}</strong></p>
<p>${escHtml(String(pagesScanned))} pages scanned; axe-core ran on ${escHtml(String(axePages))} pages, Siteimprove Alfa on ${escHtml(String(alfaPages))} pages.</p>
<p class="note"><strong>INCOMPLETE DRAFT.</strong> ${escHtml(String(incomplete.length))} Level A/AA criteria have no manual conformance outcome and are marked <strong>Not Evaluated</strong>: ${escHtml(incomplete.join(', ') || 'none')}. A criterion with no automated failure is still not evaluated: absence of a detected failure is not evidence of support. Complete a WCAG-EM or equivalent manual evaluation before publishing an ACR.</p>

${renderTable(levelA,  'Level A Success Criteria')}

${renderTable(levelAA, 'Level AA Success Criteria')}

<div class="footer">
  <p>Generated by <a href="https://github.com/mgifford/vital-core">vital-core</a> using axe-core and Siteimprove Alfa.
  Catalog: WCAG 2.2 A+AA (2.5-edition-wcag-2.2-en).
  <a href="acr.yaml">Download acr.yaml</a>. This file is a draft automated baseline, not a signed ACR.</p>
</div>
</body>
</html>`;
}

/**
 * Write acr.yaml and acr.html to the report directory, then zip them.
 * Returns { path, acrData } where path is 'acr.zip' if zip succeeded, else 'acr.yaml'.
 */
export function writeAcrYaml(repDir, target, summary, week) {
  const acrData = buildAcrData(summary);

  const yaml = buildAcrYaml(target, summary, week, acrData);
  fs.writeFileSync(path.join(repDir, 'acr.yaml'), yaml, 'utf8');

  const html = renderAcrHtml(target, summary, week, acrData);
  fs.writeFileSync(path.join(repDir, 'acr.html'), html, 'utf8');

  let outputPath = 'acr.yaml';
  try {
    execFileSync('zip', ['-j', 'acr.zip', 'acr.yaml', 'acr.html'], { cwd: repDir, stdio: 'ignore' });
    outputPath = 'acr.zip';
  } catch {
    // zip not available — yaml and html still written individually
  }

  return { path: outputPath, acrData };
}
