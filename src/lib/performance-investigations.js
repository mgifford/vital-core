/**
 * Deterministic investigation candidates from stored page/summary evidence.
 * This ranks observations; it does not establish causation or component ownership.
 */
import crypto from 'node:crypto';
import { routeMatches } from './page-families.js';

export const PERFORMANCE_INVESTIGATION_SCHEMA = 'performance-investigation/1';

function pageFor(resource) {
  const url = (resource?.examples ?? []).find((example) => typeof example === 'string' && example.startsWith('https://'));
  return url ? { url } : null;
}

export function buildPerformanceInvestigations(summary, { minPages = 3, limit = 30, previous = null } = {}) {
  const resources = summary?.performanceResources?.resources ?? [];
  const resourceCandidates = resources
    .filter((resource) => resource.pages >= minPages && (resource.transfer_bytes ?? 0) > 0)
    .filter((resource) => !(resource.third_party && resource.pages >= minPages) && !(resource.render_blocking_pages >= 2))
    .map((resource) => ({
      id: `shared-resource:${resource.key}`,
      category: 'shared-expensive-resource',
      evidence_strength: 'direct-observation',
      resource: {
        key: resource.key,
        type: resource.type,
        third_party: resource.third_party,
        pages: resource.pages,
        transfer_bytes: resource.transfer_bytes,
        render_blocking_pages: resource.render_blocking_pages ?? 0,
      },
      ...(pageFor(resource) ? { page: pageFor(resource) } : {}),
      evidence: {
        source: 'performance-resource-inventory/1',
        examples: resource.examples ?? [],
        denominator: summary.performanceResources.pages_with_evidence ?? null,
      },
      hypothesis: `The shared ${resource.type} resource may be adding transfer or render work on ${resource.pages} sampled page(s).`,
      alternatives: ['The association may reflect shared page templates rather than the resource itself.', 'Cached or cross-origin resources may have incomplete size evidence.'],
      proposed_test: 'Compare the same representative pages with this resource deferred, blocked or replaced in a controlled diagnostic run.',
      status: 'investigation-candidate',
    }))
    .sort((a, b) => b.resource.pages - a.resource.pages || b.resource.transfer_bytes - a.resource.transfer_bytes)
    .slice(0, limit);

  const slowPages = (summary?.lighthouse?.pageDetail ?? [])
    .filter((page) => Number.isFinite(page.scores?.performance) && page.scores.performance < 50)
    .map((page) => {
      const metrics = page.metrics ?? {};
      return {
        id: `slow-page:${crypto.createHash('sha256').update(page.url).digest('hex').slice(0, 12)}`,
        category: 'slow-representative-page',
        evidence_strength: 'direct-observation',
        page: { url: page.url, performance: page.scores.performance, metrics: { lcp_ms: metrics.largestContentfulPaintMs ?? null, tbt_ms: metrics.totalBlockingTimeMs ?? null, cls: metrics.cumulativeLayoutShift ?? null } },
        evidence: { source: 'lighthouse lab run', denominator: summary.lighthouse.pagesSampled ?? null, limitations: ['Lighthouse is a synthetic lab measurement, not field Core Web Vitals; INP is unavailable.'] },
        hypothesis: 'This sampled page has a low Lighthouse lab performance score and deserves investigation of its loading and main-thread work.',
        alternatives: ['The run may reflect throttling, third-party variance or a transient network condition.', 'A single lab score is not proof of a user-facing regression.'],
        proposed_test: 'Repeat the Lighthouse run under the same configured conditions and inspect LCP/TBT plus the top recommendations before changing code.',
        status: 'investigation-candidate',
      };
    })
    .sort((a, b) => a.page.performance - b.page.performance)
    .slice(0, Math.max(0, limit - resourceCandidates.length));

  const recommendations = (summary?.lighthouse?.recommendations ?? [])
    .filter((item) => (item.pages ?? 0) >= 3 && ((item.savingsMs ?? 0) >= 50 || (item.savingsBytes ?? 0) >= 1024))
    .map((item) => ({
      id: `lighthouse-recommendation:${item.id}`,
      category: 'repeated-lighthouse-recommendation',
      evidence_strength: 'direct-observation',
      recommendation: { id: item.id, title: item.title, category: item.category, pages: item.pages, savings_ms: item.savingsMs ?? 0, savings_bytes: item.savingsBytes ?? 0 },
      evidence: { source: 'lighthouse lab audit', denominator: summary.lighthouse.pagesSampled ?? null, examples: item.examplePages ?? [] },
      hypothesis: 'This Lighthouse recommendation recurs across sampled pages and may represent a shared optimization opportunity.',
      alternatives: ['Savings estimates are model-based and may not transfer to field users.', 'A recurring audit can reflect shared templates rather than a single component.'],
      proposed_test: 'Select one representative page and test the recommendation in a controlled diagnostic run.',
      status: 'investigation-candidate',
    }))
    .sort((a, b) => b.recommendation.pages - a.recommendation.pages || b.recommendation.savings_ms - a.recommendation.savings_ms)
    .slice(0, Math.max(0, limit - resourceCandidates.length - slowPages.length));

  const familyCandidates = buildPageFamilyCandidates(summary, limit);
  const renderBlocking = buildRenderBlockingCandidates(summary, limit);
  const thirdParty = buildThirdPartyCandidates(summary, minPages, limit);
  const regressions = buildMatchedPageRegressions(summary, previous, limit);
  const candidates = rankPerformanceCandidates([...regressions, ...familyCandidates, ...renderBlocking, ...thirdParty, ...resourceCandidates, ...slowPages, ...recommendations], limit);
  return {
    schema_version: PERFORMANCE_INVESTIGATION_SCHEMA,
    generated_from: 'stored weekly summary; no live browser',
    rank_basis: 'category evidence class, then sampled-page reach, then evidence-estimated savings; ties by stable ID',
    candidates,
    limitations: [
      'Resource presence is correlation, not proof of a performance defect or ownership.',
      'Page counts use sampled pages with Resource Timing evidence, not the whole site.',
      'No energy measurement or causal attribution is included.',
    ],
  };
}


/** Same-URL Lighthouse score regressions; a single drop is only a possible regression. */
export function buildMatchedPageRegressions(summary, previous, limit = 20) {
  if (!previous?.lighthouse?.pageDetail?.length || !summary?.lighthouse?.pageDetail?.length) return [];
  const before = new Map(previous.lighthouse.pageDetail.map((page) => [page.url, page]));
  return summary.lighthouse.pageDetail
    .filter((page) => Number.isFinite(page.scores?.performance))
    .filter((page) => !summary.performanceCohort?.stable_urls?.length || summary.performanceCohort.stable_urls.includes(page.url))
    .map((page) => {
      const prior = before.get(page.url);
      if (!prior || !Number.isFinite(prior.scores?.performance)) return null;
      const delta = page.scores.performance - prior.scores.performance;
      if (delta > -15) return null;
      return {
        id: `matched-page-regression:${crypto.createHash('sha256').update(page.url).digest('hex').slice(0, 12)}`,
        category: 'possible-matched-page-regression',
        evidence_strength: 'direct-observation',
        page: { url: page.url, current_performance: page.scores.performance, previous_performance: prior.scores.performance, delta, current_metrics: page.metrics ?? {}, previous_metrics: prior.metrics ?? {} },
        evidence: {
          source: 'Lighthouse lab runs from two reporting periods',
          previous_week: previous.week ?? null,
          current_week: summary.week ?? null,
          stable_cohort_member: summary.performanceCohort?.stable_urls?.includes(page.url) ?? null,
          confirmation: 'single-observation',
          measurement_context: {
            previous_lighthouse_version: prior.version ?? null,
            current_lighthouse_version: page.version ?? null,
            versions_comparable: prior.version && page.version ? prior.version === page.version : null,
          },
          limitations: ['A single pair of lab runs is not a confirmed field regression; browser, throttling, viewport and network conditions may differ.', 'Repeat under matched conditions before attributing a regression.'],
        },
        hypothesis: 'This stable page may have become materially slower than its previous Lighthouse observation.',
        alternatives: ['The change may be run-to-run variance or a different measurement environment.', 'Page content or a third party may have changed without a code regression.'],
        proposed_test: 'Repeat the same URL under matched Lighthouse conditions and compare the metrics before attributing a regression.',
        status: 'possible-regression',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.page.delta - b.page.delta)
    .slice(0, limit);
}


/** Declared page families with repeated poor Lighthouse results; association, not ownership. */
export function buildPageFamilyCandidates(summary, limit = 20) {
  const pages = summary?.lighthouse?.pageDetail ?? [];
  const domainMedian = summary?.lighthouse?.medianPerformance ?? null;
  return (summary?.pageFamilies?.families ?? []).map((family, index) => {
    if (!family.route) return null;
    const members = pages.filter((page) => { try { return routeMatches(family.route, new URL(page.url).pathname); } catch { return false; } });
    if (members.length < 2) return null;
    const scores = members.map((page) => page.scores?.performance).filter(Number.isFinite);
    if (scores.length < 2) return null;
    const median = scores.sort((a, b) => a - b)[Math.floor(scores.length / 2)];
    const poor = scores.filter((score) => score < 50).length;
    if (median >= 50 && !(domainMedian != null && median <= domainMedian - 10)) return null;
    return {
      id: `page-family:${family.id ?? index}`,
      category: 'page-family-performance-pattern',
      evidence_strength: 'direct-observation',
      page: { family_id: family.id ?? null, label: family.label ?? family.id ?? null, sampled_pages: members.length, median_performance: median, poor_pages: poor, examples: members.map((page) => page.url) },
      evidence: { source: 'declared page family + Lighthouse page detail', denominator: summary.lighthouse?.pagesSampled ?? null, membership_basis: 'configured route', limitations: ['Family association does not establish a shared implementation or component ownership.', 'Lighthouse lab scores are not field Core Web Vitals.'] },
      hypothesis: 'Pages in this declared family repeatedly show weaker Lighthouse performance and may share a template-level issue.',
      alternatives: ['The family may simply contain heavier content or third parties.', 'The sample may be too small to support a family-level conclusion.'],
      proposed_test: 'Repeat the family representative pages under matched Lighthouse conditions and compare with outside-family pages.',
      status: 'investigation-candidate',
    };
  }).filter(Boolean).slice(0, limit);
}


export function buildRenderBlockingCandidates(summary, limit = 30) {
  return (summary?.performanceResources?.resources ?? [])
    .filter((resource) => (resource.render_blocking_pages ?? 0) >= 2)
    .map((resource) => ({
      id: `render-blocking:${resource.key}`,
      category: 'potential-render-blocking-resource',
      evidence_strength: 'direct-observation',
      resource: { key: resource.key, type: resource.type, pages: resource.pages, render_blocking_pages: resource.render_blocking_pages },
      ...(pageFor(resource) ? { page: pageFor(resource) } : {}),
      evidence: { source: 'performance-resource-inventory/1', denominator: summary.performanceResources.pages_with_evidence ?? null, limitations: ['Render-blocking status is browser-reported and does not prove a user-visible delay.'] },
      hypothesis: 'This resource is render-blocking on multiple sampled pages and may delay first paint.',
      alternatives: ['The resource may be required for correct first paint.', 'The browser may no longer treat it as blocking after an implementation change.'],
      proposed_test: 'Compare representative pages with the resource deferred or inlined in a controlled diagnostic run.',
      status: 'investigation-candidate',
    }))
    .sort((a, b) => b.resource.render_blocking_pages - a.resource.render_blocking_pages)
    .slice(0, limit);
}

export function buildThirdPartyCandidates(summary, minPages = 3, limit = 30) {
  return (summary?.performanceResources?.resources ?? [])
    .filter((resource) => resource.third_party && resource.pages >= minPages)
    .map((resource) => ({
      id: `third-party-resource:${resource.key}`,
      category: 'third-party-resource-concern',
      evidence_strength: 'direct-observation',
      resource: { key: resource.key, type: resource.type, origin: resource.origin, pages: resource.pages, transfer_bytes: resource.transfer_bytes },
      ...(pageFor(resource) ? { page: pageFor(resource) } : {}),
      evidence: { source: 'performance-resource-inventory/1', denominator: summary.performanceResources.pages_with_evidence ?? null, limitations: ['Third-party presence and transfer are not proof of a defect or causation.'] },
      hypothesis: 'This third-party resource is loaded on multiple sampled pages and may contribute transfer or blocking cost.',
      alternatives: ['Another first-party or third-party resource may be responsible.', 'The third party may be required for a core service.'],
      proposed_test: 'Measure the representative pages with the third-party resource blocked or deferred under matched conditions.',
      status: 'investigation-candidate',
    }))
    .sort((a, b) => b.resource.pages - a.resource.pages || b.resource.transfer_bytes - a.resource.transfer_bytes)
    .slice(0, limit);
}


const CATEGORY_PRIORITY = {
  'possible-matched-page-regression': 0,
  'page-family-performance-pattern': 1,
  'potential-render-blocking-resource': 2,
  'third-party-resource-concern': 3,
  'shared-expensive-resource': 4,
  'slow-representative-page': 5,
  'repeated-lighthouse-recommendation': 6,
};

function candidateReach(candidate) {
  return candidate.resource?.pages ?? candidate.recommendation?.pages ?? candidate.page?.sampled_pages ?? 1;
}
function candidateSavings(candidate) {
  return candidate.recommendation?.savings_ms ?? 0;
}

/** Deterministic ordering with visible reasons; not an opaque quality score. */
export function rankPerformanceCandidates(candidates, limit = 30) {
  return candidates
    .map((candidate) => {
      const reach = candidateReach(candidate);
      const savings = candidateSavings(candidate);
      return {
        ...candidate,
        priority_reasons: [
          `category: ${candidate.category}`,
          `evidence: ${candidate.evidence_strength ?? 'unknown'}`,
          `reach: ${reach} sampled page(s)`,
          ...(savings ? [`estimated savings: ${savings} ms`] : []),
        ],
      };
    })
    .sort((a, b) => {
      const ca = CATEGORY_PRIORITY[a.category] ?? 99;
      const cb = CATEGORY_PRIORITY[b.category] ?? 99;
      if (ca !== cb) return ca - cb;
      const ra = candidateReach(a), rb = candidateReach(b);
      if (ra !== rb) return rb - ra;
      const sa = candidateSavings(a), sb = candidateSavings(b);
      if (sa !== sb) return sb - sa;
      return String(a.id).localeCompare(String(b.id));
    })
    .slice(0, limit);
}
