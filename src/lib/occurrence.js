import crypto from 'node:crypto';

/**
 * One finding can aggregate many page observations. Each stored example is an
 * occurrence: a specific element on a specific page, captured by a specific
 * run. Reports and reproduction must select one occurrence as a whole — never
 * a URL from one and element evidence from another.
 *
 * `occurrence_id` is content-addressed from pattern + URL + selector so the
 * same element keeps its identity across weeks. It is deliberately separate
 * from `pattern_id` (cross-domain rule identity) and `instance_id` (the
 * report anchor, whose formula is frozen for historical links).
 */

function shortHash(...parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 8);
}

/** Stable identity for one stored occurrence. */
export function occurrenceId(patternId, instance) {
  // Component distinguishes two elements that happen to share a selector on
  // the same page; capture order is deliberately not part of identity.
  return `VO-${shortHash(
    patternId,
    instance?.url ?? '',
    instance?.target ?? instance?.selector ?? '',
    instance?.component ?? ''
  )}`;
}

function completenessOf(element, semantic) {
  if (element?.available === true && semantic) return 'complete';
  if (element?.available === true) return 'partial';
  return 'unavailable';
}

/**
 * Normalize one stored instance into a coherent occurrence. All fields come
 * from that instance only.
 */
export function normalizeOccurrence(instance, index, { patternId, engineKey, engineVersion } = {}) {
  const element = instance?.element ?? null;
  const semantic = instance?.semantic_context ?? null;
  const selector = typeof instance?.target === 'string' ? instance.target : instance?.selector ?? null;
  return {
    occurrence_id: occurrenceId(patternId, instance),
    index,
    url: instance?.url ?? null,
    selector,
    html_snippet: instance?.html ?? null,
    element,
    semantic_context: semantic,
    component: typeof instance?.component === 'string' ? instance.component : null,
    completeness: completenessOf(element, semantic),
    browser_context: instance?.browser_context ?? null,
    observation: {
      page_id: instance?.page_id ?? null,
      run_id: instance?.run_id ?? null,
      scanned_at: instance?.scanned_at ?? null,
      engine_key: engineKey ?? null,
      engine_version: instance?.engine_version ?? engineVersion ?? null,
      consent_state: instance?.consent_state ?? null,
    },
  };
}

/** Every stored occurrence for one aggregated rule, in capture order. */
export function occurrencesFor(rule, { patternId, engineKey, engineVersion } = {}) {
  return (rule?.instances ?? []).map((instance, index) =>
    normalizeOccurrence(instance, index, { patternId, engineKey, engineVersion }));
}

const RANK = { complete: 0, partial: 1, unavailable: 2 };

/**
 * Pick the representative occurrence: the first with the most complete
 * evidence, then capture order. Returns null when there are no occurrences.
 */
export function selectRepresentative(occurrences) {
  if (!Array.isArray(occurrences) || occurrences.length === 0) return null;
  let best = occurrences[0];
  for (const occurrence of occurrences.slice(1)) {
    if (RANK[occurrence.completeness] < RANK[best.completeness]) best = occurrence;
  }
  return best;
}

/** Counts for the evidence-completeness block. */
export function occurrenceSummary(occurrences, representative) {
  const counts = { complete: 0, partial: 0, unavailable: 0 };
  for (const occurrence of occurrences) counts[occurrence.completeness]++;
  return {
    occurrences_total: occurrences.length,
    complete_occurrences: counts.complete,
    partial_occurrences: counts.partial,
    unavailable_occurrences: counts.unavailable,
    representative_occurrence_id: representative?.occurrence_id ?? null,
    representative_completeness: representative?.completeness ?? 'none',
    notes: 'Capped representative examples, not every instance. Each example is one coherent occurrence.',
  };
}
