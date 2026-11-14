import { occurrencesFor, selectRepresentative } from './occurrence.js';

/**
 * Finding-level evidence coverage for a week.
 *
 * Counts findings (rules), never "engine findings" as if they were element
 * occurrences. Exact denominators are exposed so the report cannot imply that
 * unavailable evidence means a missing landmark.
 */
export function summarizeEvidenceCoverage(summary) {
  const engines = [
    ['axe-core', summary?.axe?.rules, summary?.axe?.version],
    ['alfa', summary?.alfa?.rules, summary?.alfa?.version],
    ['deprecated-html', summary?.deprecatedHtml?.rules, null],
  ];
  const out = {
    basis: 'findings',
    findings_total: 0,
    occurrences_stored: 0,
    element_evidence: { captured: 0, not_captured: 0, not_applicable: 0, unsupported_dom_boundary: 0, no_stored_examples: 0 },
    usable_locator: { captured: 0, unavailable: 0 },
    semantic_region: { captured: 0, no_containing_landmark: 0, unavailable: 0 },
    widget: { captured: 0, no_widget: 0, unavailable: 0 },
    component: { attributed: 0, unattributed: 0 },
    screenshot: { available: 0, unavailable: 0 },
    reproduction: { eligible: 0, unavailable: 0 },
    findings_with_detailed_evidence: 0,
    findings_without_detailed_evidence: 0,
    by_engine: {},
    notes: 'Finding-level sample coverage. Counts are not element-occurrence totals; screenshots and page detail follow retention.',
  };

  for (const [engine, rules, version] of engines) {
    const byEngine = out.by_engine[engine] = { findings: 0, element_captured: 0, locator_captured: 0, reproduction_eligible: 0 };
    for (const [ruleId, rule] of Object.entries(rules ?? {})) {
      out.findings_total++;
      byEngine.findings++;
      const instances = Array.isArray(rule?.instances) ? rule.instances : [];
      out.occurrences_stored += instances.length;
      const representative = selectRepresentative(occurrencesFor(rule, { patternId: `${engine}:${ruleId}`, engineKey: engine, engineVersion: version }));
      const element = representative?.element ?? null;
      const hasElement = element?.available === true;
      const unsupportedBoundary = element?.reason === 'frame-or-shadow-path' || element?.shadow === true || element?.iframe === true;
      if (unsupportedBoundary) {
        out.element_evidence.unsupported_dom_boundary++;
      } else if (hasElement) {
        out.element_evidence.captured++;
        byEngine.element_captured++;
        out.findings_with_detailed_evidence++;
        if (representative.selector) { out.usable_locator.captured++; byEngine.locator_captured++; }
        else out.usable_locator.unavailable++;
      } else if (engine === 'alfa') {
        // Alfa reports serialized node descriptions, not a DOM selector. This is
        // not a failed classification and not a missing page landmark.
        out.element_evidence.not_applicable++;
      } else if (instances.length === 0) {
        out.element_evidence.no_stored_examples++;
      } else {
        out.element_evidence.not_captured++;
      }

      if (representative?.semantic_context) {
        const region = representative.semantic_context.nearest_region;
        if (region?.role) out.semantic_region.captured++;
        else out.semantic_region.no_containing_landmark++;
        if (representative.semantic_context.widget?.role) out.widget.captured++;
        else out.widget.no_widget++;
      } else {
        out.semantic_region.unavailable++;
        out.widget.unavailable++;
      }

      if (representative?.component) out.component.attributed++;
      else out.component.unattributed++;

      if (representative?.screenshot?.available === true) out.screenshot.available++;
      else out.screenshot.unavailable++;

      const httpUrl = typeof representative?.url === 'string' && /^https?:\/\//i.test(representative.url);
      const replayable = engine === 'axe-core' && hasElement && Boolean(representative.selector) && !element.shadow && !element.iframe && httpUrl;
      if (replayable) { out.reproduction.eligible++; byEngine.reproduction_eligible++; }
      else out.reproduction.unavailable++;
    }
  }

  out.usable_locator.unavailable = out.findings_total - out.usable_locator.captured;
  out.findings_without_detailed_evidence = out.findings_total - out.findings_with_detailed_evidence;
  return out;
}
