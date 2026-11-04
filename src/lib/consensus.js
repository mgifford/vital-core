import { canonicalRuleKey, actRuleIdsFor } from './act.js';

/**
 * Cross-engine ACT-rule/page grouping. This is a compact summary of mapping
 * overlap, not a finding-level duplicate judgment. Same-element conclusions
 * belong to finding-correlation.js, which has sampled selectors and snippets.
 * Grouping by canonical ACT rule and page:
 *
 *   primary:   the shared ACT rule (axe "image-alt" and Alfa "sia-r2"
 *              are ACT 23a2a8 -> one canonical issue), and
 *   secondary: the affected page URL.
 *
 * A bucket = (canonical rule, page). It is "consensus" when both engines
 * map a finding to that rule on the page, else axe-only or alfa-only.
 * Unmapped rules keep their own key, so they're never wrongly merged.
 *
 * Selectors and element identities are not available in the rule/page summary,
 * so a shared bucket does not imply the same tested element.
 */

/**
 * Build a consensus summary from the per-rule affectedPages already
 * collected in the weekly summary.
 *
 *   axeRules / alfaRules: { ruleId: { affectedPages: [{url, instances}], ... } }
 *
 * Returns:
 *   {
 *     uniqueIssues,        // compatibility field: distinct canonical rule/page buckets
 *     consensus,           // buckets mapped by BOTH engines, not confirmed duplicates
 *     axeOnly, alfaOnly,
 *     rawAxe, rawAlfa,     // naive per-engine (rule,page) counts, for contrast
 *     byKey: { canonicalKey: { actRuleId, axeRules:Set, alfaRules:Set, pages:Set, engines } }
 *   }
 */
export function buildConsensus(axeRules = {}, alfaRules = {}) {
  // canonicalKey -> { actRuleId, axeRules:Set, alfaRules:Set,
  //                   pagesAxe:Set, pagesAlfa:Set }
  const groups = new Map();
  let rawAxe = 0;
  let rawAlfa = 0;

  const ingest = (rules, engineKey) => {
    for (const [ruleId, rule] of Object.entries(rules)) {
      const key = canonicalRuleKey(engineKey, ruleId);
      const act = actRuleIdsFor(engineKey, ruleId)[0] ?? null;
      let g = groups.get(key);
      if (!g) {
        g = { actRuleId: act, axeRules: new Set(), alfaRules: new Set(), pagesAxe: new Set(), pagesAlfa: new Set() };
        groups.set(key, g);
      }
      if (engineKey === 'axe-core') g.axeRules.add(ruleId);
      else g.alfaRules.add(ruleId);
      for (const p of rule.affectedPages ?? []) {
        if (engineKey === 'axe-core') { g.pagesAxe.add(p.url); rawAxe++; }
        else { g.pagesAlfa.add(p.url); rawAlfa++; }
      }
    }
  };
  ingest(axeRules, 'axe-core');
  ingest(alfaRules, 'alfa');

  let consensus = 0;
  let axeOnly = 0;
  let alfaOnly = 0;
  let uniqueIssues = 0;
  const byKey = {};

  for (const [key, g] of groups) {
    const allPages = new Set([...g.pagesAxe, ...g.pagesAlfa]);
    for (const page of allPages) {
      uniqueIssues++;
      const inAxe = g.pagesAxe.has(page);
      const inAlfa = g.pagesAlfa.has(page);
      if (inAxe && inAlfa) consensus++;
      else if (inAxe) axeOnly++;
      else alfaOnly++;
    }
    byKey[key] = {
      actRuleId: g.actRuleId,
      axeRules: [...g.axeRules],
      alfaRules: [...g.alfaRules],
      pages: allPages.size,
      engines: g.axeRules.size && g.alfaRules.size ? 'both' : g.axeRules.size ? 'axe' : 'alfa',
    };
  }

  return {
    uniqueIssues,
    consensus,
    axeOnly,
    alfaOnly,
    rawAxe,
    rawAlfa,
    byKey,
  };
}
