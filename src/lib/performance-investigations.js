/**
 * Deterministic investigation candidates from stored page/summary evidence.
 * This ranks observations; it does not establish causation or component ownership.
 */
export const PERFORMANCE_INVESTIGATION_SCHEMA = 'performance-investigation/1';

export function buildPerformanceInvestigations(summary, { minPages = 3, limit = 20 } = {}) {
  const resources = summary?.performanceResources?.resources ?? [];
  const candidates = resources
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
