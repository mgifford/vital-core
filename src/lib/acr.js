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
 *   supports          — SC was tested (SC is in scope of a running engine) and
 *                       no failures were found this week
 *   not-evaluated     — no engine covers this SC; cannot make a claim
 *
 * This is an *automated baseline*, not a complete manual audit. The YAML
 * includes an explicit note on every criterion about the scanning context and
 * pages tested. Human testers should layer on top of this output.
 *
 * Only the web component is populated (electronic-docs, software, and
 * authoring-tool are marked not-applicable — this tool scans public web pages).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveWcag } from './wcag.js';

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

  // Which SCs are "in scope" for each engine (engine tests at least something for them).
  // We approximate this by the union of SCs we have axe rules or alfa rules for in
  // the static mappings — rather than introspecting the live run, which avoids false
  // "supports" claims for criteria where the engine ran but never fired.
  // A more conservative approach: only claim "supports" for SCs where we observed
  // a rule firing or have a known mapping. We use the observed-failures set + the
  // SCs that the engines are *known* to cover via wcag.js tags.
  // For this implementation: if an engine ran this week AND the SC is in our failure
  // map (it was tested and passed OR failed), we mark it evaluated.
  // SCs not covered by either engine -> not-evaluated.

  // Build "tested SC" set: any SC that appeared in *any* rule result (pass or fail)
  // We can't enumerate passes directly, so we use the running heuristic:
  //   axe tested -> all SCs in axe rule tags that axe actually ran on (approximated by
  //   SCs we know axe covers per the WCAG_CRITERIA + axe tag convention).
  // Conservative: mark as "not-evaluated" unless we saw a failure. The exception is
  // well-known SCs that have dedicated rules — those we can claim "supports" for.
  //
  // For Week-over-week value: the most important signal is which SCs have *failures*.
  // For SCs with no failure data we say "not-evaluated" unless the engine positively
  // ran a rule for it (which we track via the tags seen in the rules object).
  const testedSCs = new Set();
  for (const [, rule] of Object.entries(summary.axe?.rules ?? {})) {
    for (const tag of rule.tags ?? []) {
      const m = /^wcag(\d)(\d)(\d+)$/.exec(tag);
      if (m) testedSCs.add(`${m[1]}.${m[2]}.${m[3]}`);
    }
  }
  // Alfa rules: use the resolveWcag mapping
  for (const [ruleId, rule] of Object.entries(summary.alfa?.rules ?? {})) {
    const w = resolveWcag('alfa', { tags: rule.tags ?? [], ruleId });
    if (w?.sc) testedSCs.add(w.sc);
  }

  const scMap = new Map();
  for (const entry of WCAG_CATALOG) {
    const fail = scFailures.get(entry.sc);
    let adherence, pagesAffected = 0, engines = [], examples = [];

    if (fail) {
      pagesAffected = fail.pages;
      engines = [...fail.engines];
      examples = [...fail.examples];
      const failRate = fail.pages / Math.max(axePages, alfaPages, 1);
      // Partially-supports when failures affect <5% of tested pages
      adherence = failRate < 0.05 ? 'partially-supports' : 'does-not-support';
    } else if (testedSCs.has(entry.sc)) {
      adherence = 'supports';
    } else {
      adherence = 'not-evaluated';
    }

    scMap.set(entry.sc, { ...entry, adherence, pagesAffected, engines, examples });
  }

  return { scMap, pagesScanned, axePages, alfaPages };
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

  const header = `title: ${yamlStr(`${target.domain} Accessibility Conformance Report`)}
product:
  name: ${yamlStr(target.domain)}
  version: ${yamlStr(weekLabel)}
  description: ${yamlStr(`Public web pages at ${target.domain}, week ${weekLabel}. Automated scan by vital-scans using axe-core and Siteimprove Alfa.`)}
report_date: ${reportDate}
last_modified_date: ${reportDate}
version: "1"
catalog: 2.5-edition-wcag-2.2-en
notes: ${yamlStr(
  `This ACR is generated automatically from weekly accessibility scans of ${target.domain} ` +
  `(week ${weekLabel}). It covers ${pagesScanned} scanned pages; axe-core ran on ${axePages} pages ` +
  `and Siteimprove Alfa on ${alfaPages} pages. ` +
  `Automated tools find roughly a third of real barriers — this report should be ` +
  `supplemented with manual AT testing and user research before making conformance claims. ` +
  `"supports" means no automated failure was detected this week, not that the criterion is fully met.`
)}
evaluation_methods_used: ${yamlStr(
  `Automated: axe-core ${summary.axe?.version ?? ''} and Siteimprove Alfa, running in headless Chromium (Playwright). ` +
  `Rules are mapped to WCAG 2.2 success criteria. Manual AT testing has not been conducted — ` +
  `add manual findings directly to this YAML file.`
)}
legal_disclaimer: ""
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
      } else if (d.adherence === 'supports') {
        notes = `No automated failures detected on ${Math.max(axePages, alfaPages)} tested pages this week.`;
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
    notes: ${yamlStr(`Level A criteria. Automated coverage is partial — only criteria covered by axe-core or Alfa rules can be evaluated automatically. "not-evaluated" criteria require manual testing.`)}
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
  const { scMap, pagesScanned, axePages, alfaPages } = acrData;
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
    } else if (d.adherence === 'supports') {
      notes = `No automated failures detected on ${tested} tested pages this week.`;
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
  <title>${domain}: Accessibility Conformance Report — ${escHtml(weekLabel)}</title>
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
    a{color:#005ea2}
  </style>
</head>
<body>
<h1>${domain}: Accessibility Conformance Report</h1>
<p>Week: <strong>${escHtml(weekLabel)}</strong> &nbsp;&middot;&nbsp; Report date: <strong>${escHtml(reportDate)}</strong></p>
<p>${escHtml(String(pagesScanned))} pages scanned; axe-core ran on ${escHtml(String(axePages))} pages, Siteimprove Alfa on ${escHtml(String(alfaPages))} pages.</p>
<p class="note"><strong>Note:</strong> Automated tools find roughly a third of real barriers. This report must be supplemented with manual AT testing and user research before making conformance claims. &ldquo;Supports&rdquo; means no automated failure was detected this week, not that the criterion is fully met.</p>

${renderTable(levelA,  'Level A Success Criteria')}

${renderTable(levelAA, 'Level AA Success Criteria')}

<div class="footer">
  <p>Generated by <a href="https://github.com/mgifford/vital-core">vital-core</a> using axe-core and Siteimprove Alfa.
  Catalog: WCAG 2.2 A+AA (2.5-edition-wcag-2.2-en).
  <a href="acr.yaml">Download acr.yaml</a>.</p>
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
