/**
 * Tech ↔ finding association analysis.
 *
 * Every page record co-locates the technologies detected on the page
 * (record.tech) with the accessibility findings on that same page
 * (record.axe / record.alfa). This module joins those two streams to answer
 * a systemic question the per-page and per-rule views can't:
 *
 *   "Are pages running technology X disproportionately likely to have
 *    finding Y?"  — i.e. a bug that travels with a CMS/theme/widget rather
 *    than living in any one page's content.
 *
 * The signal is association (lift), not causation. A high-lift pair is a
 * candidate worth a human's attention, surfaced as "associated with", never
 * "caused by".
 *
 * Only pages where BOTH the tech engine and the finding's engine ran are
 * counted — otherwise differing per-engine sampling rates would skew the
 * denominator. Callers pass per-page rows that already reflect that overlap.
 */

/**
 * Build a co-occurrence model from per-page observations.
 *
 * `pages` is an array of { techs: string[], findings: string[] } where each
 * page contributes the set of technologies on it and the set of finding keys
 * (e.g. "axe:color-contrast") on it. Sets are deduplicated per page so a
 * finding that appears 30 times on one page still counts as one page.
 *
 * Returns:
 *   {
 *     pages,                       // total pages considered
 *     tech:   { [name]:  pagesWithTech },
 *     finding:{ [key]:   pagesWithFinding },
 *     pair:   { [name]: { [key]: pagesWithBoth } },
 *   }
 */
export function buildCooccurrence(pages) {
  const model = { pages: 0, tech: {}, finding: {}, pair: {} };
  for (const p of pages) {
    model.pages++;
    const techs = [...new Set(p.techs ?? [])];
    const findings = [...new Set(p.findings ?? [])];
    for (const t of techs) {
      model.tech[t] = (model.tech[t] ?? 0) + 1;
      model.pair[t] ??= {};
    }
    for (const f of findings) {
      model.finding[f] = (model.finding[f] ?? 0) + 1;
    }
    for (const t of techs) {
      for (const f of findings) {
        model.pair[t][f] = (model.pair[t][f] ?? 0) + 1;
      }
    }
  }
  return model;
}

/**
 * Lift of a (tech, finding) pair: how much more (or less) likely the finding
 * is on pages with the tech, versus the finding's overall page rate.
 *
 *   lift = P(finding | tech) / P(finding)
 *        = (pairPages / techPages) / (findingPages / totalPages)
 *
 * lift > 1  → finding over-represented on pages with this tech (suspicious)
 * lift = 1  → independent
 * lift < 1  → finding under-represented
 *
 * Returns null when support is below `minPages` on either side, or when any
 * denominator is zero — low-support pairs are noise, not signal.
 */
export function lift(model, tech, finding, minPages = 5) {
  const totalPages = model.pages;
  const techPages = model.tech[tech] ?? 0;
  const findingPages = model.finding[finding] ?? 0;
  const pairPages = model.pair[tech]?.[finding] ?? 0;
  if (totalPages === 0 || techPages === 0 || findingPages === 0) return null;
  if (techPages < minPages || pairPages < minPages) return null;
  const pFindingGivenTech = pairPages / techPages;
  const pFinding = findingPages / totalPages;
  if (pFinding === 0) return null;
  return pFindingGivenTech / pFinding;
}

/**
 * Rank all (tech, finding) pairs in a model by lift, keeping only pairs that
 * clear the support threshold. Returns
 *   [{ tech, finding, lift, pairPages, techPages, findingPages }]
 * sorted by lift desc, then pairPages desc. `limit` caps the result.
 */
export function rankAssociations(model, { minPages = 5, limit = 50 } = {}) {
  const out = [];
  for (const tech of Object.keys(model.pair)) {
    for (const finding of Object.keys(model.pair[tech])) {
      const l = lift(model, tech, finding, minPages);
      if (l == null) continue;
      out.push({
        tech,
        finding,
        lift: Math.round(l * 100) / 100,
        pairPages: model.pair[tech][finding],
        techPages: model.tech[tech],
        findingPages: model.finding[finding],
      });
    }
  }
  out.sort((a, b) => b.lift - a.lift || b.pairPages - a.pairPages);
  return out.slice(0, limit);
}

/**
 * Merge several per-domain co-occurrence models into one fleet model, while
 * tracking how many distinct domains each tech, finding, and pair appears on.
 * A pair seen with the same tech across many independent sites is the
 * strongest systemic signal — almost certainly a bug in the technology, not
 * in any single site.
 *
 * `entries` is [{ domain, model }]. Returns a model with the same shape as
 * buildCooccurrence plus parallel `*Sites` maps counting distinct domains.
 */
export function mergeFleet(entries) {
  const fleet = { pages: 0, tech: {}, finding: {}, pair: {}, techSites: {}, findingSites: {}, pairSites: {} };
  for (const { model } of entries) {
    fleet.pages += model.pages;
    for (const [t, n] of Object.entries(model.tech)) {
      fleet.tech[t] = (fleet.tech[t] ?? 0) + n;
      fleet.techSites[t] = (fleet.techSites[t] ?? 0) + 1;
      fleet.pair[t] ??= {};
    }
    for (const [f, n] of Object.entries(model.finding)) {
      fleet.finding[f] = (fleet.finding[f] ?? 0) + n;
      fleet.findingSites[f] = (fleet.findingSites[f] ?? 0) + 1;
    }
    for (const [t, byFinding] of Object.entries(model.pair)) {
      fleet.pair[t] ??= {};
      fleet.pairSites[t] ??= {};
      for (const [f, n] of Object.entries(byFinding)) {
        fleet.pair[t][f] = (fleet.pair[t][f] ?? 0) + n;
        fleet.pairSites[t][f] = (fleet.pairSites[t][f] ?? 0) + 1;
      }
    }
  }
  return fleet;
}

/**
 * Rank fleet pairs by a systemic score that rewards both strong association
 * (lift) and breadth across sites: score = lift × sitesAffected. Only pairs
 * present on >= minSites distinct domains are returned, so single-site
 * coincidences don't dominate. Returns
 *   [{ tech, finding, lift, sites, pairPages, score }]
 */
export function rankFleetAssociations(fleet, { minPages = 5, minSites = 2, limit = 50 } = {}) {
  const out = [];
  for (const tech of Object.keys(fleet.pair)) {
    for (const finding of Object.keys(fleet.pair[tech])) {
      const sites = fleet.pairSites[tech]?.[finding] ?? 0;
      if (sites < minSites) continue;
      const l = lift(fleet, tech, finding, minPages);
      if (l == null) continue;
      out.push({
        tech,
        finding,
        lift: Math.round(l * 100) / 100,
        sites,
        pairPages: fleet.pair[tech][finding],
        score: Math.round(l * sites * 100) / 100,
      });
    }
  }
  out.sort((a, b) => b.score - a.score || b.sites - a.sites);
  return out.slice(0, limit);
}
