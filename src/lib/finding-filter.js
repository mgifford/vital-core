/**
 * Filtering model for the Finding Explorer.
 *
 * These functions are deliberately self-contained (they reference no module
 * scope, no constants and no imports) because the Explorer page reuses them in
 * the browser by stringifying them. Keeping one implementation means the
 * server-rendered static index and the enhanced client view cannot drift.
 *
 * Everything is sample-based: the scanner stores a capped set of examples per
 * rule, so a finding's region/component describes its first stored example.
 */

/** Stable region key: "role|name", "unclassified", or "unknown" without evidence. */
export function findingRegionKey(bug) {
  const context = bug?.semantic_context;
  if (!context) return 'unknown';
  const region = context.nearest_region;
  if (!region?.role) return 'unclassified';
  return `${region.role}|${region.name ?? ''}`;
}

/** Readable region label for the key above. */
export function findingRegionLabel(bug) {
  const context = bug?.semantic_context;
  if (!context) return 'unknown';
  const region = context.nearest_region;
  if (!region?.role) return 'unclassified (no landmark)';
  return region.name ? `${region.role} "${region.name}"` : `${region.role} (unnamed)`;
}

/**
 * Configured shared component only. A widget role is NOT a component: the two
 * are separate dimensions (see findingWidgetKey) so two unrelated dialogs are
 * never presented as one component.
 */
export function findingComponentKey(bug) {
  const scope = bug?.component_scope;
  return scope?.component_id ? `component:${scope.component_id}` : '';
}

/** Readable configured component label, or "unattributed". */
export function findingComponentLabel(bug) {
  const scope = bug?.component_scope;
  return scope?.component_id ? (scope.component_label || scope.component_id) : 'unattributed';
}

/** Nearest structural widget role (dialog, tablist, …), or empty. */
export function findingWidgetKey(bug) {
  const role = bug?.semantic_context?.widget?.role;
  return role ? `widget:${role}` : '';
}

/** Readable widget role, or "no widget". */
export function findingWidgetLabel(bug) {
  return bug?.semantic_context?.widget?.role ?? 'no widget';
}

/**
 * Filter the finding list. Every filter is optional; an empty filter object
 * returns a copy of the input. `query` matches rule id/label, summary, URL and
 * WCAG success criterion, case-insensitively.
 */
export function filterFindings(bugs, filters = {}) {
  const list = Array.isArray(bugs) ? bugs : [];
  const query = String(filters.query ?? '').trim().toLowerCase();
  return list.filter((bug) => {
    if (filters.region && findingRegionKey(bug) !== filters.region) return false;
    if (filters.component && findingComponentKey(bug) !== filters.component) return false;
    if (filters.widget && findingWidgetKey(bug) !== filters.widget) return false;
    if (filters.engine && bug.engine_key !== filters.engine) return false;
    if (filters.severity && bug.severity !== filters.severity) return false;
    if (filters.wcag && (bug.wcag_sc ?? '') !== filters.wcag) return false;
    if (!query) return true;
    const haystack = [
      bug.rule_id, bug.rule_label, bug.summary, bug.url, bug.wcag_sc,
    ].map((value) => String(value ?? '')).join(' ').toLowerCase();
    return haystack.includes(query);
  });
}

/** Distinct filter options with counts, most common first. */
export function filterOptions(bugs) {
  const list = Array.isArray(bugs) ? bugs : [];
  const collect = (keyOf, labelOf) => {
    const byKey = new Map();
    for (const bug of list) {
      const key = keyOf(bug);
      if (!key) continue;
      const entry = byKey.get(key) ?? { key, label: labelOf(bug), count: 0 };
      entry.count++;
      byKey.set(key, entry);
    }
    return [...byKey.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };
  const severities = ['Critical', 'Serious', 'Moderate', 'Minor']
    .map((severity) => ({ key: severity, label: severity, count: list.filter((bug) => bug.severity === severity).length }))
    .filter((entry) => entry.count > 0);
  return {
    regions: collect(findingRegionKey, findingRegionLabel),
    widgets: collect(findingWidgetKey, findingWidgetLabel),
    components: collect(findingComponentKey, findingComponentLabel),
    engines: collect((bug) => bug.engine_key, (bug) => bug.engine_key),
    severities,
  };
}
