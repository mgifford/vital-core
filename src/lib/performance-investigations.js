/**
 * Deterministic investigation candidates from stored page/summary evidence.
 * This ranks observations; it does not establish causation or component ownership.
 */
import crypto from 'node:crypto';

export const PERFORMANCE_INVESTIGATION_SCHEMA = 'performance-investigation/1';

export function buildPerformanceInvestigations(summary, { minPages = 3, limit = 20, previous = null } = {}) {
  const resources = summary?.performanceResources?.resources ?? [];
  const resourceCandidates = resources
    .filter((resource) => resource.pages >= minPages && (resource.transfer_bytes ?? 0) > 0)
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

  const regressions = buildMatchedPageRegressions(summary, previous, limit);
  const candidates = [...regressions, ...resourceCandidates, ...slowPages, ...recommendations].slice(0, limit);
  return {
    schema_version: PERFORMANCE_INVESTIGATION_SCHEMA,
    generated_from: 'stored weekly summary; no live browser',
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
        evidence: { source: 'Lighthouse lab runs from two reporting periods', previous_week: previous.week ?? null, current_week: summary.week ?? null, limitations: ['A single pair of lab runs is not a confirmed field regression; browser, throttling and network conditions may differ.'] },
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
