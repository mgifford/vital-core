/**
 * Region and component grouping for the week's stored finding evidence.
 *
 * PR 1 records, for the first stored example of each rule, where the failing
 * element sits (nearest landmark region, containing widget) and which
 * configured component it belongs to. This module turns that per-finding
 * evidence into the two groupings a reader asks for:
 *
 *   "Which parts of the page carry the findings?"      -> regions
 *   "Which component or widget carries the findings?"  -> component groups
 *
 * Both are sample-based: the scanner stores a capped set of examples per rule,
 * so counts describe the stored evidence, never every instance. A grouping is
 * not a fix count and never establishes ownership: configured signatures
 * describe a component the site owner declared, and a widget role is a
 * candidate attribution only.
 */

export const REGION_BASIS = 'stored_examples';
export const MAX_GROUP_REPRESENTATIVES = 3;

/**
 * Normalize summarizeRecords()' per-rule models into the flat finding list
 * these builders consume. `instances` carries the bounded stored examples.
 */
export function findingsFromRules({ axe = {}, alfa = {}, deprecatedHtml = {} } = {}) {
  const build = (engineKey, rules) => Object.entries(rules ?? {}).map(([ruleId, rule]) => ({
    engine_key: engineKey,
    rule_id: ruleId,
    pages: rule.pages ?? 0,
    instances_total: rule.count ?? 0,
    instances: Array.isArray(rule.instances) ? rule.instances : [],
  }));
  return [
    ...build('axe-core', axe),
    ...build('alfa', alfa),
    ...build('deprecated-html', deprecatedHtml),
  ];
}

function instancesOf(finding) {
  return Array.isArray(finding?.instances) ? finding.instances : [];
}

/**
 * The semantic region a stored instance was found in, or null when no evidence
 * was captured (for example an Alfa finding). An element with evidence but no
 * landmark is `unclassified` — never assigned an invented region.
 */
export function regionOf(instance) {
  const context = instance?.semantic_context;
  if (!context) return null;
  const region = context.nearest_region;
  if (!region?.role) {
    return { key: 'unclassified', role: null, name: null, label: 'unclassified (no landmark)', unclassified: true };
  }
  const name = typeof region.name === 'string' && region.name.trim() ? region.name.trim() : null;
  return {
    key: `${region.role}|${name ?? ''}`,
    role: region.role,
    name,
    label: name ? `${region.role} "${name}"` : `${region.role} (unnamed)`,
    unclassified: false,
  };
}

/** The first stored example that carries region evidence, if any. */
function primaryInstanceWith(finding, predicate) {
  return instancesOf(finding).find(predicate) ?? null;
}

/** The configured component id on a stored example, if any. */
function componentOf(finding) {
  const instance = primaryInstanceWith(finding, (candidate) => typeof candidate?.component === 'string' && candidate.component);
  return instance?.component ?? null;
}

/** The nearest widget role (dialog, tablist, …) on a stored example, if any. */
function widgetOf(finding) {
  const instance = primaryInstanceWith(finding, (candidate) => candidate?.semantic_context?.widget?.role);
  return instance?.semantic_context?.widget?.role ?? null;
}

function addRepresentative(entry, instance) {
  if (!instance || typeof instance.url !== 'string' || !instance.url) return;
  if (entry.representative.length >= MAX_GROUP_REPRESENTATIVES) return;
  const selector = typeof instance.target === 'string' ? instance.target : null;
  if (entry.representative.some((item) => item.url === instance.url && item.selector === selector)) return;
  entry.representative.push({ url: instance.url, selector });
}

/**
 * Group findings by their nearest landmark region.
 *
 * Returns counts over stored evidence plus an explicit
 * `findings_without_evidence` count, so a finding that could not be located is
 * never silently folded into "unclassified".
 */
export function buildRegionGroups(findings = []) {
  const groups = new Map();
  let withoutEvidence = 0;
  let withRegion = 0;
  let unclassified = 0;

  for (const finding of findings) {
    const instance = primaryInstanceWith(finding, (candidate) => candidate?.semantic_context);
    const region = regionOf(instance);
    if (!region) {
      withoutEvidence++;
      continue;
    }
    withRegion++;
    if (region.unclassified) unclassified++;
    const entry = groups.get(region.key) ?? {
      ...region,
      findings: 0,
      instances_total: 0,
      stored_instances: 0,
      pages_affected_sum: 0,
      engines: {},
      components: new Map(),
      representative: [],
    };
    entry.findings++;
    entry.instances_total += Number.isFinite(finding.instances_total) ? finding.instances_total : 0;
    entry.stored_instances += instancesOf(finding).filter((candidate) => regionOf(candidate)?.key === region.key).length;
    entry.pages_affected_sum += Number.isFinite(finding.pages) ? finding.pages : 0;
    const engine = finding.engine_key ?? 'unknown';
    entry.engines[engine] = (entry.engines[engine] ?? 0) + 1;
    const component = componentOf(finding);
    if (component) entry.components.set(component, (entry.components.get(component) ?? 0) + 1);
    addRepresentative(entry, instance);
    groups.set(region.key, entry);
  }

  const regions = [...groups.values()]
    .map((entry) => ({
      ...entry,
      components: [...entry.components.entries()]
        .map(([id, count]) => ({ id, findings: count }))
        .sort((a, b) => b.findings - a.findings || a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => Number(a.unclassified) - Number(b.unclassified) || b.findings - a.findings || a.label.localeCompare(b.label));

  return {
    basis: REGION_BASIS,
    findings_total: findings.length,
    findings_with_region: withRegion,
    findings_unclassified: unclassified,
    findings_without_evidence: withoutEvidence,
    regions,
  };
}

/**
 * Group findings by a configured component or, failing that, by the nearest
 * widget role as a candidate.
 *
 * Identity is explicit: `type` is the grouping key, `implementation` is only a
 * configured component id (never a structural guess), and
 * `ownership_established` is always false. Verification of a configured
 * component still lives in summarizeRecords()' `sharedComponents` model; this
 * grouping does not upgrade a candidate into a verified component.
 */
export function buildComponentGroups(findings = [], { signatures = [] } = {}) {
  const labels = new Map((signatures ?? []).map((signature) => [signature.id, signature.label || signature.id]));
  const groups = new Map();
  let attributed = 0;

  for (const finding of findings) {
    const component = componentOf(finding);
    const widget = widgetOf(finding);
    let identity = null;
    if (component) {
      identity = {
        key: `component:${component}`,
        type: `component:${component}`,
        label: labels.get(component) ?? component,
        attribution: 'configured',
        implementation: component,
      };
    } else if (widget) {
      identity = {
        key: `widget:${widget}`,
        type: `widget:${widget}`,
        label: widget,
        attribution: 'candidate',
        implementation: null,
      };
    }
    if (!identity) continue;
    attributed++;
    const entry = groups.get(identity.key) ?? {
      ...identity,
      ownership_established: false,
      instance_identity: 'page_url_and_selector_of_stored_examples',
      findings: 0,
      instances_total: 0,
      stored_instances: 0,
      pages_affected_sum: 0,
      regions: new Map(),
      representative: [],
    };
    entry.findings++;
    entry.instances_total += Number.isFinite(finding.instances_total) ? finding.instances_total : 0;
    entry.stored_instances += instancesOf(finding).filter((candidate) => (identity.implementation
      ? candidate?.component === identity.implementation
      : candidate?.semantic_context?.widget?.role === widget)).length;
    entry.pages_affected_sum += Number.isFinite(finding.pages) ? finding.pages : 0;
    const region = regionOf(primaryInstanceWith(finding, (candidate) => candidate?.semantic_context));
    if (region) entry.regions.set(region.key, (entry.regions.get(region.key) ?? 0) + 1);
    addRepresentative(entry, primaryInstanceWith(finding, (candidate) => candidate?.semantic_context));
    groups.set(identity.key, entry);
  }

  const grouped = [...groups.values()]
    .map((entry) => ({
      ...entry,
      regions: [...entry.regions.entries()]
        .map(([key, count]) => ({ key, findings: count }))
        .sort((a, b) => b.findings - a.findings || a.key.localeCompare(b.key)),
    }))
    .sort((a, b) => b.findings - a.findings || a.label.localeCompare(b.label));

  return {
    basis: REGION_BASIS,
    findings_total: findings.length,
    attributed,
    unattributed: findings.length - attributed,
    ownership_basis: 'Configured signatures and widget roles only. Grouping never establishes ownership or a fix count.',
    groups: grouped,
  };
}
