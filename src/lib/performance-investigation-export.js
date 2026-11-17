import { toCsv } from './csv.js';

function subject(candidate) {
  return candidate.resource?.key ?? candidate.recommendation?.title ?? candidate.page?.url ?? candidate.id;
}
function reach(candidate) {
  return candidate.resource?.pages ?? candidate.recommendation?.pages ?? candidate.page?.sampled_pages ?? 1;
}
function savings(candidate) {
  return candidate.recommendation?.savings_ms ?? '';
}

/** One generic CSV row per candidate, regardless of evidence category. */
export function investigationsToCsv(queue) {
  const rows = (queue?.candidates ?? []).map((candidate) => [
    candidate.id,
    candidate.category,
    candidate.status ?? '',
    candidate.evidence_strength ?? '',
    subject(candidate),
    reach(candidate),
    candidate.evidence?.denominator ?? '',
    candidate.page?.current_performance ?? candidate.page?.performance ?? candidate.page?.median_performance ?? '',
    savings(candidate),
    (candidate.priority_reasons ?? []).join('; '),
    candidate.hypothesis ?? '',
    (candidate.alternatives ?? []).join('; '),
    candidate.proposed_test ?? '',
    (candidate.evidence?.limitations ?? []).join('; '),
  ]);
  return toCsv([
    'id', 'category', 'status', 'evidence_strength', 'subject', 'reach', 'denominator',
    'performance_score', 'estimated_savings_ms', 'priority_reasons', 'hypothesis',
    'alternatives', 'proposed_test', 'limitations',
  ], rows);
}
