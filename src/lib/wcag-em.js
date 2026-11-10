/**
 * WCAG-EM-aligned automated evaluation report.
 *
 * WCAG-EM is an evaluation methodology and report format for a website, not a
 * procurement conformance document. VITAL's weekly sample is not a WCAG-EM
 * representative sample, and no manual evaluation is performed, so this output
 * is a pre-assessment: it records scope, evidence, limitations and per-criterion
 * outcomes without claiming conformance.
 *
 * The JSON is a VITAL evidence export, not a native W3C WCAG-EM Report Tool
 * import file. A human can use it to complete the tool's scope, sample and
 * audit steps.
 */

import fs from 'node:fs';
import path from 'node:path';
import { buildAcrData } from './acr.js';

const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function uniqueExamples(scMap, limit = 50) {
  const urls = new Set();
  for (const entry of scMap.values()) {
    for (const url of entry.examples ?? []) {
      if (urls.size >= limit) break;
      urls.add(url);
    }
  }
  return [...urls];
}

export function buildWcagEmData(target, summary, week) {
  const acr = buildAcrData(summary);
  const conformance = target.findingPolicy?.conformance ?? { version: '2.2', level: 'AA' };
  const criteria = [...acr.scMap.values()].map((entry) => ({
    sc: entry.sc,
    name: entry.name,
    level: entry.level,
    outcome: entry.pagesAffected > 0 ? 'failed' : 'not_evaluated',
    pages_affected: entry.pagesAffected,
    engines: entry.engines,
    evidence_examples: (entry.examples ?? []).slice(0, 3),
    note: entry.pagesAffected > 0
      ? `Automated evidence found this criterion failing on ${entry.pagesAffected} page(s).`
      : 'No manual conformance outcome was recorded. Absence of an automated failure is not a pass.',
  }));
  const failed = criteria.filter((entry) => entry.outcome === 'failed');
  const notEvaluated = criteria.filter((entry) => entry.outcome === 'not_evaluated');
  const generatedAt = summary.generatedAt ?? new Date().toISOString();
  return {
    schema: 1,
    format: 'vital-wcag-em-draft',
    not_a_conformance_claim: true,
    wcag_em_aligned: true,
    wcag_em_evaluation_complete: false,
    report_tool_native_import: false,
    title: `${target.domain}: draft automated WCAG-EM-aligned evaluation (${week})`,
    website: {
      name: target.domain,
      scope: `Public web pages reached by the weekly crawl of ${target.domain}. Authenticated content, complete user journeys and content outside the crawl are not established.`,
    },
    evaluation: {
      date: String(generatedAt).slice(0, 10),
      evaluator: 'VITAL automated scan (unreviewed draft; no human evaluator assigned)',
      commissioner: null,
      conformance_target: {
        standard: conformance.standard ?? 'WCAG',
        version: String(conformance.version ?? '2.2'),
        level: conformance.level ?? 'AA',
      },
      methods: 'Automated weekly sample: axe-core and Siteimprove Alfa in headless Chromium (Playwright). No manual assistive-technology, keyboard or user testing was performed.',
      tools: [
        { name: 'axe-core', version: summary.axe?.version ?? null },
        { name: 'Siteimprove Alfa', version: summary.alfa?.version ?? null },
      ],
    },
    sample: {
      pages_scanned: acr.pagesScanned,
      pages_audited: summary.pagesAudited ?? Math.max(acr.axePages, acr.alfaPages),
      structured_sample: [],
      random_sample: [],
      not_wcag_em_sample: true,
      basis: 'VITAL weekly crawl sample. It is not a WCAG-EM structured or random sample and does not establish coverage of page types, templates or user journeys.',
      evidence_examples: uniqueExamples(acr.scMap),
      evidence_examples_note: 'Examples cited by stored findings, not a complete sample list.',
    },
    results: {
      criteria_total: criteria.length,
      failed: failed.length,
      not_evaluated: notEvaluated.length,
      criteria,
    },
    wcag_em_steps: [
      { step: 1, name: 'Define the scope of the evaluation', status: 'partial_automated', note: 'Website and conformance target come from config; the commissioner and additional requirements are not confirmed.' },
      { step: 2, name: 'Explore the target website', status: 'not_performed', note: 'VITAL detects technologies and crawls links; it does not establish essential functionality, page-type variety or relied-upon technologies with a human evaluator.' },
      { step: 3, name: 'Select a representative sample', status: 'not_wcag_em', note: 'The weekly crawl sample is deterministic per week but is not a WCAG-EM structured/random sample.' },
      { step: 4, name: 'Audit the selected sample', status: 'automated_only', note: 'Automated checks only; manual checks for criteria that need human judgement are incomplete.' },
      { step: 5, name: 'Report the findings', status: 'draft', note: 'This automated draft records evidence and gaps; it is not a conformance report.' },
    ],
    limitations: [
      'The sample is not a WCAG-EM representative sample and pages are not selected for page-type or functionality coverage.',
      'Automated tools find only a subset of accessibility barriers; no manual AT, keyboard or user testing was performed.',
      'A criterion with no automated failure is not evaluated, not passed.',
      'No commissioner, evaluator sign-off, accessibility support baseline or additional evaluation requirements are established.',
      'The JSON is a VITAL evidence export, not a native W3C WCAG-EM Report Tool import file.',
    ],
  };
}

export function buildWcagEmJson(target, summary, week) {
  return JSON.stringify(buildWcagEmData(target, summary, week), null, 2);
}

export function renderWcagEmHtml(target, summary, week, data = buildWcagEmData(target, summary, week)) {
  const rows = data.results.criteria.map((criterion) => `<tr>
  <td><a href="https://www.w3.org/WAI/WCAG22/Understanding/${criterion.name.toLowerCase().replace(/[(),.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}/">${esc(criterion.sc)}</a> ${esc(criterion.name)}</td>
  <td>${esc(criterion.level)}</td>
  <td><span class="outcome ${esc(criterion.outcome)}">${criterion.outcome === 'failed' ? 'Failure found' : 'Not evaluated'}</span></td>
  <td>${criterion.pages_affected ? `${criterion.pages_affected} page(s)` : '—'}</td>
  <td>${esc(criterion.note)}</td>
</tr>`).join('\n');
  const steps = data.wcag_em_steps.map((step) => `<li><strong>Step ${step.step}: ${esc(step.name)}</strong> — ${esc(step.status)}. ${esc(step.note)}</li>`).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)}</title>
<style>
 :root{--ink:#142326;--paper:#fbfaf7;--accent:#00585c;--rule:#c9c4b8;--warn:#8a5c00;--bad:#8c2f1b}
 body{font-family:system-ui,sans-serif;line-height:1.55;max-width:78rem;margin:2rem auto;padding:0 1.25rem;color:var(--ink);background:var(--paper)}
 h1{font-size:1.7rem;line-height:1.2} h2{border-bottom:2px solid var(--accent);padding-bottom:.2rem;margin-top:2.2rem}
 a{color:var(--accent)}
 .draft{background:#fff3cd;border:2px solid var(--warn);padding:1rem;margin:1rem 0}
 .draft strong{display:block;font-size:1.1rem}
 table{width:100%;border-collapse:collapse;margin:1rem 0} th,td{border:1px solid var(--rule);padding:.45rem;text-align:left;vertical-align:top}
 th{background:#e9f0ef} .outcome{font-weight:700}.outcome.failed{color:var(--bad)}.outcome.not_evaluated{color:var(--warn)}
 .meta{color:#555;font-size:.9rem} ul{padding-left:1.4rem}
</style>
</head>
<body>
<h1>${esc(data.website.name)}: draft WCAG-EM-aligned evaluation</h1>
<div class="draft" role="note"><strong>DRAFT — automated evidence only. This is not a WCAG-EM conformance evaluation.</strong>
The weekly sample is not a WCAG-EM representative sample, and no manual assistive-technology, keyboard or user testing was performed. Do not use this document to claim conformance.</div>
<p>Week: <strong>${esc(week)}</strong> · Evaluation date: <strong>${esc(data.evaluation.date)}</strong> · Evaluator: ${esc(data.evaluation.evaluator)}</p>
<p class="meta">${esc(data.website.scope)}</p>

<h2>1. Scope of the evaluation</h2>
<dl>
<dt>Website</dt><dd>${esc(data.website.name)}</dd>
<dt>Conformance target</dt><dd>${esc(data.evaluation.conformance_target.standard)} ${esc(data.evaluation.conformance_target.version)} ${esc(data.evaluation.conformance_target.level)}</dd>
<dt>Pages scanned / audited</dt><dd>${data.sample.pages_scanned} / ${data.sample.pages_audited}</dd>
<dt>Commissioner</dt><dd>Not established</dd>
</dl>

<h2>2. Sample</h2>
<p><strong>Not a WCAG-EM sample.</strong> ${esc(data.sample.basis)}</p>
<p class="meta">${esc(data.sample.evidence_examples_note)} ${data.sample.evidence_examples.length} evidence example(s): ${data.sample.evidence_examples.slice(0, 10).map((url) => `<a href="${esc(url)}">${esc(url)}</a>`).join(', ') || 'none captured'}.</p>

<h2>3. Evaluation methods</h2>
<p>${esc(data.evaluation.methods)}</p>
<p class="meta">Tools: ${data.evaluation.tools.map((tool) => `${esc(tool.name)} ${esc(tool.version ?? 'version not recorded')}`).join('; ')}.</p>

<h2>4. Results by success criterion</h2>
<p>${data.results.failed} criterion/criteria with automated failures; ${data.results.not_evaluated} not evaluated. "Not evaluated" is not a pass.</p>
<div style="overflow-x:auto"><table>
<caption>Automated evidence by WCAG success criterion (${data.results.criteria_total} A/AA criteria)</caption>
<thead><tr><th scope="col">Criterion</th><th scope="col">Level</th><th scope="col">Outcome</th><th scope="col">Pages affected</th><th scope="col">Evidence / limitation</th></tr></thead>
<tbody>${rows}</tbody>
</table></div>
<p class="meta">Download the structured evidence: <a href="wcag-em.json">wcag-em.json</a>. It is a VITAL evidence export, not a native W3C Report Tool import file.</p>

<h2>5. WCAG-EM steps</h2>
<ol>${steps}</ol>

<h2>6. Limitations</h2>
<ul>${data.limitations.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
<p class="meta">WCAG-EM is a W3C evaluation methodology: <a href="https://www.w3.org/WAI/test-evaluate/conformance/wcag-em/">https://www.w3.org/WAI/test-evaluate/conformance/wcag-em/</a>. Complete the evaluation with the W3C WCAG-EM Report Tool.</p>
</body>
</html>
`;
}

export function writeWcagEmReport(repDir, target, summary, week) {
  const data = buildWcagEmData(target, summary, week);
  fs.writeFileSync(path.join(repDir, 'wcag-em.json'), JSON.stringify(data, null, 2));
  fs.writeFileSync(path.join(repDir, 'wcag-em.html'), renderWcagEmHtml(target, summary, week, data));
  return { path: 'wcag-em.html', json: 'wcag-em.json', data };
}
