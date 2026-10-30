/**
 * The weekly trend series published in weekly.json, domain.json and the API
 * snapshot. A week's summary also carries that week's evidence: which pages
 * each failure is on, every resource, every component cluster. The latest
 * week's findings, CSVs and engine pages publish that evidence, and each
 * week's summary.json keeps it in the data repo. Repeating it for every
 * retained week made www.medicaid.gov's trend files ~400 MB each, growing
 * ~20 MB a week. The trend keeps what failed each week, as numbers, and
 * drops what passed and the repeated evidence.
 */

/** Per-page lists kept in memory for the CSVs; never written to any JSON. */
export const HEAVY_SUMMARY_KEYS = new Set(['pagesWithAxeList', 'pagesWithAlfaList', 'pageDetail', 'pageRows', 'bytesList', 'imageRows', 'uniqueImageList']);

/** JSON.stringify replacer that leaves the per-page lists out. */
export const omitHeavyLists = (key, value) => (HEAVY_SUMMARY_KEYS.has(key) ? undefined : value);

const RULE_EVIDENCE = ['examplePages', 'affectedPages', 'instances'];

function without(obj, keys) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

function rulesWithoutEvidence(rules) {
  if (!rules) return rules;
  return Object.fromEntries(Object.entries(rules).map(([id, r]) => [id, without(r, RULE_EVIDENCE)]));
}

/** Checks that fail somewhere: a pass rate under 100%, or pass === false. */
function failingChecks(section) {
  if (!section?.checks) return section;
  const failing = section.checks.filter((c) => (typeof c.pass === 'boolean' ? !c.pass : (c.rate ?? 100) < 100));
  return { ...section, checks: failing, checksPassing: section.checks.length - failing.length };
}

/** One week's summary as it appears in the trend series. */
export function trendSummary(summary) {
  const s = without(summary, ['pagesWithAxeList', 'pagesWithAlfaList']);
  if (s.axe) s.axe = { ...s.axe, rules: rulesWithoutEvidence(s.axe.rules) };
  if (s.alfa) s.alfa = { ...s.alfa, rules: rulesWithoutEvidence(s.alfa.rules) };
  if (s.deprecatedHtml) s.deprecatedHtml = { ...s.deprecatedHtml, rules: rulesWithoutEvidence(s.deprecatedHtml.rules) };
  if (s.componentClusters) {
    s.componentClusters = {
      ...without(s.componentClusters, ['clusters']),
      top_actions: (s.componentClusters.top_actions ?? []).map((a) => without(a, ['affected_pages'])),
    };
  }
  if (s.resources) s.resources = without(s.resources, ['list']);
  if (s.linkCheck) s.linkCheck = { ...without(s.linkCheck, ['broken']), brokenCount: s.linkCheck.brokenCount ?? s.linkCheck.broken?.length ?? 0 };
  if (Array.isArray(s.errorPages)) {
    s.errorStatuses = {};
    for (const p of s.errorPages) s.errorStatuses[p.status] = (s.errorStatuses[p.status] ?? 0) + 1;
    delete s.errorPages;
  }
  if (s.images) s.images = without(s.images, ['imageRows', 'uniqueImageList']);
  if (s.plainLanguage) s.plainLanguage = without(s.plainLanguage, ['pageRows']);
  if (s.sustainability) s.sustainability = without(s.sustainability, ['bytesList']);
  if (s.lighthouse) {
    s.lighthouse = {
      ...without(s.lighthouse, ['pageDetail']),
      recommendations: s.lighthouse.recommendations?.map((r) => without(r, ['examplePages'])),
    };
  }
  for (const k of ['standards', 'resilience', 'security']) if (s[k]) s[k] = failingChecks(s[k]);
  return s;
}

export function trendSeries(series) {
  return series.map(trendSummary);
}
