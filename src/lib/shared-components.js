// Vendor-neutral shared-component attribution for engine findings.
//
// A target may declare `component_signatures`: small, data-only descriptions
// of a recurring component (a consent dialog, a chat widget, a design-system
// header). This module counts how stored failing-element evidence matches
// those signatures. It never creates a component from one CSS prefix alone
// and never hides, merges or re-scores a finding: it only labels evidence.
//
// Signal types (a component is "verified" only with >= min_signals distinct
// types, at least one of them about the element itself):
//   class         the failing element's own class matches a class_names/class_prefixes entry
//   id            the failing element's id matches ids/id_prefixes
//   attribute     an attribute on the failing element matches attributes[]
//   ancestry      a class/id in an ancestor part of the stored selector matches
//   script_origin the component's script origin was observed loading on the site
//
// Evidence limits: the scanner stores a few capped examples per rule and
// page, so classification is "sample-based". Counts say so.

const ELEMENT_SIGNALS = ['class', 'id', 'attribute', 'ancestry'];
const ALL_SIGNALS = [...ELEMENT_SIGNALS, 'script_origin'];
const LIST_KEYS = ['class_names', 'class_prefixes', 'ids', 'id_prefixes', 'script_origins'];
const MAX_SIGNATURES = 50;

export const SCOPE_CLASSIFICATIONS = ['shared_component', 'mixed', 'candidate_shared_component', 'not_attributed', 'undetermined'];

function stringList(value, where, key, errors) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim())) {
    errors.push(`${where}: ${key} must be a list of non-empty strings.`);
    return [];
  }
  return value.map((v) => v.trim());
}

/**
 * Validate and normalize a `component_signatures` list. Throws one error
 * listing every problem so a config author can fix them in one pass.
 */
export function resolveComponentSignatures(raw, where = 'config') {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error(`${where}: component_signatures must be a list.`);
  if (raw.length > MAX_SIGNATURES) throw new Error(`${where}: at most ${MAX_SIGNATURES} component_signatures are supported.`);
  const errors = [];
  const seen = new Set();
  const out = [];
  raw.forEach((entry, index) => {
    const at = `${where}: component_signatures[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${at} must be a mapping.`);
      return;
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) errors.push(`${at}: id must be lowercase letters, digits, "-" or "_".`);
    else if (seen.has(id)) errors.push(`${at}: duplicate id "${id}".`);
    seen.add(id);
    const lists = Object.fromEntries(LIST_KEYS.map((key) => [key, stringList(entry[key], at, key, errors)]));
    const attributes = [];
    for (const attr of entry.attributes ?? []) {
      if (!attr || typeof attr.name !== 'string' || !attr.name.trim()) {
        errors.push(`${at}: each attributes entry needs a name.`);
        continue;
      }
      attributes.push({
        name: attr.name.trim().toLowerCase(),
        value: typeof attr.value === 'string' ? attr.value : null,
        value_prefix: typeof attr.value_prefix === 'string' ? attr.value_prefix : null,
      });
    }
    const elementSignals = lists.class_names.length + lists.class_prefixes.length + lists.ids.length + lists.id_prefixes.length + attributes.length;
    if (elementSignals === 0) errors.push(`${at}: needs at least one of class_names, class_prefixes, ids, id_prefixes or attributes.`);
    const minSignals = entry.min_signals == null ? 2 : entry.min_signals;
    if (!Number.isInteger(minSignals) || minSignals < 1 || minSignals > ALL_SIGNALS.length) {
      errors.push(`${at}: min_signals must be an integer from 1 to ${ALL_SIGNALS.length}.`);
    }
    out.push({
      id,
      label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim().slice(0, 80) : id,
      ...lists,
      attributes,
      min_signals: minSignals,
    });
  });
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return out;
}

// Split a CSS selector into compounds, honouring escapes, brackets, parens
// and quotes so `#Google\ Basic` and `[aria-label="a > b"]` stay whole.
function selectorParts(selector) {
  const parts = [];
  let current = '';
  let combinator = ' ';
  let depth = 0;
  let quote = '';
  const src = String(selector ?? '');
  const flush = (next) => {
    if (current) parts.push({ compound: current, combinator });
    current = '';
    combinator = next;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') { current += ch + (src[i + 1] ?? ''); i++; continue; }
    if (quote) { current += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '[' || ch === '(') depth++;
    if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) {
      if (ch === ' ') { if (current) flush(' '); continue; }
      if (current) flush(ch); else combinator = ch;
      continue;
    }
    current += ch;
  }
  if (current) parts.push({ compound: current, combinator });
  return parts;
}

function compoundTokens(compound) {
  const classes = [];
  const ids = [];
  for (const match of compound.matchAll(/\.((?:\\.|[^\s.#:[\]()>+~\\])+)/g)) classes.push(match[1].replace(/\\(.)/g, '$1'));
  for (const match of compound.matchAll(/#((?:\\.|[^\s.#:[\]()>+~\\])+)/g)) ids.push(match[1].replace(/\\(.)/g, '$1'));
  return { classes, ids };
}

// Only the first start tag describes the failing element; classes on its
// children must not attribute the element to a component.
function firstTag(html) {
  const match = String(html ?? '').match(/^\s*<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>?/);
  if (!match) return null;
  const attributes = new Map();
  for (const attr of match[2].matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attributes.set(attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4] ?? '');
  }
  return { tag: match[1].toLowerCase(), attributes };
}

function boundaryPrefix(token, prefix) {
  if (!token.startsWith(prefix)) return false;
  if (token.length === prefix.length) return true;
  return /[^a-z0-9]$/i.test(prefix) || /[^a-z0-9]/i.test(token[prefix.length]);
}

function matchesClass(token, signature) {
  return signature.class_names.includes(token) || signature.class_prefixes.some((prefix) => boundaryPrefix(token, prefix));
}

function matchesId(token, signature) {
  return signature.ids.includes(token) || signature.id_prefixes.some((prefix) => boundaryPrefix(token, prefix));
}

/**
 * Describe the structure available in one stored example. `structured` is
 * false for text-only targets, which cannot support attribution either way.
 */
export function describeExample(example) {
  const selector = typeof example?.target === 'string' ? example.target : typeof example?.xpath === 'string' ? example.xpath : '';
  const html = typeof example?.html === 'string' ? example.html : typeof example?.html_snippet === 'string' ? example.html_snippet : '';
  const selectorIsMarkup = selector.trimStart().startsWith('<');
  const tag = firstTag(html) ?? (selectorIsMarkup ? firstTag(selector) : null);
  const parts = selectorIsMarkup || /^\s*text:/i.test(selector) ? [] : selectorParts(selector);
  const ancestors = [];
  for (let i = parts.length - 1; i > 0; i--) {
    if (parts[i].combinator === '+' || parts[i].combinator === '~') break;
    ancestors.push(parts[i - 1]);
  }
  const ownCompound = parts.length ? compoundTokens(parts[parts.length - 1].compound) : { classes: [], ids: [] };
  const attributes = tag?.attributes ?? new Map();
  const classes = new Set([
    ...String(attributes.get('class') ?? '').split(/\s+/).filter(Boolean),
    ...(tag ? [] : ownCompound.classes),
  ]);
  const ids = new Set([attributes.get('id'), ...(tag ? [] : ownCompound.ids)].filter(Boolean));
  const ancestorTokens = ancestors.map((part) => compoundTokens(part.compound));
  return {
    structured: Boolean(tag) || parts.length > 0,
    classes: [...classes],
    ids: [...ids],
    attributes,
    ancestorClasses: ancestorTokens.flatMap((entry) => entry.classes),
    ancestorIds: ancestorTokens.flatMap((entry) => entry.ids),
  };
}

/** Element-level signals one signature finds in one example. */
export function matchSignature(example, signature) {
  const described = example.classes ? example : describeExample(example);
  const signals = new Set();
  if (described.classes.some((token) => matchesClass(token, signature))) signals.add('class');
  if (described.ids.some((token) => matchesId(token, signature))) signals.add('id');
  for (const attr of signature.attributes) {
    if (!described.attributes.has(attr.name)) continue;
    const value = described.attributes.get(attr.name);
    if ((attr.value == null && attr.value_prefix == null) || attr.value === value || (attr.value_prefix != null && value.startsWith(attr.value_prefix))) signals.add('attribute');
  }
  if (described.ancestorClasses.some((token) => matchesClass(token, signature)) || described.ancestorIds.some((token) => matchesId(token, signature))) signals.add('ancestry');
  return signals;
}

function originMatches(vendorOrigin, signatureOrigin) {
  const a = String(vendorOrigin ?? '').toLowerCase();
  const b = signatureOrigin.toLowerCase();
  return a === b || a.endsWith(`.${b}`);
}

/**
 * Accumulates observations while aggregate walks page records, mirroring the
 * cluster tracker: call observe() once per page and rule, then finalize().
 */
export function createSharedComponentTracker(signatures = []) {
  const list = signatures ?? [];
  const rules = new Map();
  const pagesBySignature = new Map(list.map((s) => [s.id, new Set()]));
  const signalsBySignature = new Map(list.map((s) => [s.id, Object.fromEntries(ELEMENT_SIGNALS.map((k) => [k, { examples: 0 }]))]));

  function observe(engineKey, ruleId, url, examples, instanceCount = null) {
    if (list.length === 0) return;
    const key = `${engineKey}:${ruleId}`;
    const rule = rules.get(key) ?? {
      engine_key: engineKey, rule_id: ruleId, pages: 0, instances_total: 0, examples_total: 0,
      examples_outside: 0, examples_undetermined: 0, bySignature: new Map(), pagesOutside: 0,
    };
    rules.set(key, rule);
    rule.pages++;
    if (Number.isInteger(instanceCount)) rule.instances_total += instanceCount;
    let pageOutside = false;
    const pageInside = new Map();
    for (const example of examples ?? []) {
      rule.examples_total++;
      const described = describeExample(example);
      let best = null;
      for (const signature of list) {
        const signals = matchSignature(described, signature);
        if (signals.size > 0 && (!best || signals.size > best.signals.size)) best = { signature, signals };
      }
      if (!best) {
        if (described.structured) { rule.examples_outside++; pageOutside = true; } else rule.examples_undetermined++;
        continue;
      }
      const entry = rule.bySignature.get(best.signature.id) ?? { examples: 0, pages: 0, signals: new Set() };
      entry.examples++;
      for (const signal of best.signals) {
        entry.signals.add(signal);
        signalsBySignature.get(best.signature.id)[signal].examples++;
      }
      rule.bySignature.set(best.signature.id, entry);
      pageInside.set(best.signature.id, entry);
      pagesBySignature.get(best.signature.id).add(url);
    }
    for (const entry of pageInside.values()) entry.pages++;
    if (pageOutside) rule.pagesOutside++;
  }

  function finalize({ thirdParty = null, pagesAudited = 0 } = {}) {
    if (list.length === 0) return null;
    const vendors = thirdParty?.vendors ?? [];
    const components = list.map((signature) => {
      const origins = signature.script_origins
        .map((origin) => {
          const hits = vendors.filter((vendor) => originMatches(vendor.origin, origin));
          return { origin, observed: hits.length > 0, pages_observed: hits.reduce((max, vendor) => Math.max(max, vendor.pages ?? 0), 0) };
        });
      return { signature, origins, originObserved: origins.some((entry) => entry.observed) };
    });
    const byId = new Map(components.map((component) => [component.signature.id, component]));
    const ruleModels = {};
    const counts = { engine_findings: 0, shared_component: 0, mixed: 0, candidate_shared_component: 0, not_attributed: 0, undetermined: 0 };
    for (const rule of rules.values()) {
      counts.engine_findings++;
      const entries = [...rule.bySignature.entries()].sort((a, b) => b[1].examples - a[1].examples);
      const [componentId, matched] = entries[0] ?? [null, null];
      const component = componentId ? byId.get(componentId) : null;
      const inside = matched?.examples ?? 0;
      const elementSignals = matched ? ELEMENT_SIGNALS.filter((signal) => matched.signals.has(signal)) : [];
      const signalTypes = component?.originObserved ? [...elementSignals, 'script_origin'] : elementSignals;
      const verified = Boolean(component) && elementSignals.length > 0 && signalTypes.length >= component.signature.min_signals;
      let classification;
      if (rule.examples_total === 0) classification = 'undetermined';
      else if (inside === 0) classification = rule.examples_outside > 0 ? 'not_attributed' : 'undetermined';
      else if (rule.examples_outside > 0) classification = 'mixed';
      else classification = verified ? 'shared_component' : 'candidate_shared_component';
      counts[classification]++;
      ruleModels[`${rule.engine_key}:${rule.rule_id}`] = {
        classification,
        component_id: component?.signature.id ?? null,
        component_label: component?.signature.label ?? null,
        confidence: !component ? null : signalTypes.length >= 3 ? 'high' : signalTypes.length === 2 ? 'medium' : 'low',
        verified: classification === 'shared_component' || (classification === 'mixed' && verified),
        signals: signalTypes,
        pages: rule.pages,
        pages_in_component: matched?.pages ?? 0,
        pages_with_outside_examples: rule.pagesOutside,
        examples_total: rule.examples_total,
        examples_in_component: inside,
        examples_outside_component: rule.examples_outside,
        examples_undetermined: rule.examples_undetermined,
        instances_total: rule.instances_total,
        sample_complete: rule.instances_total > 0 && rule.instances_total <= rule.examples_total,
        basis: 'stored_examples',
      };
    }
    const componentModels = components.map(({ signature, origins, originObserved }) => {
      const findings = Object.entries(ruleModels)
        .filter(([, model]) => model.component_id === signature.id)
        .map(([key, model]) => ({ finding: key, classification: model.classification, pages: model.pages, pages_in_component: model.pages_in_component, verified: model.verified }));
      const signalCounts = signalsBySignature.get(signature.id);
      const observed = ELEMENT_SIGNALS.filter((signal) => signalCounts[signal].examples > 0);
      const types = originObserved ? [...observed, 'script_origin'] : observed;
      return {
        id: signature.id,
        label: signature.label,
        min_signals: signature.min_signals,
        verified: observed.length > 0 && types.length >= signature.min_signals,
        confidence: types.length === 0 ? null : types.length >= 3 ? 'high' : types.length === 2 ? 'medium' : 'low',
        signals_observed: types,
        signal_examples: Object.fromEntries(observed.map((signal) => [signal, signalCounts[signal].examples])),
        script_origins: origins,
        pages_with_component_evidence: pagesBySignature.get(signature.id).size,
        pages_audited: pagesAudited,
        findings,
      };
    });
    return {
      schema: 1,
      basis: 'Capped examples stored per rule and page. Attribution describes the stored examples, not every instance.',
      counts,
      components: componentModels,
      rules: ruleModels,
    };
  }

  return { observe, finalize };
}

/** Add an additive `component_scope` to bug reports. No-op without a model. */
export function attachComponentScope(bugs, model) {
  if (!model?.rules) return bugs;
  for (const bug of bugs) {
    const scope = model.rules[`${bug.engine_key}:${bug.rule_id}`];
    if (scope) bug.component_scope = scope;
  }
  return bugs;
}

/**
 * Which diagnostic views list a finding. Full-page lists everything. Only a
 * verified shared-component finding leaves the page-specific view; a mixed
 * finding appears in both because it has observations outside the component.
 */
export function scopeViewsFor(bug) {
  const scope = bug?.component_scope;
  const verifiedShared = scope?.classification === 'shared_component' && scope.verified === true;
  const inComponent = scope && ['shared_component', 'mixed', 'candidate_shared_component'].includes(scope.classification);
  return { fullPage: true, pageSpecific: !verifiedShared, sharedComponent: Boolean(inComponent) };
}
