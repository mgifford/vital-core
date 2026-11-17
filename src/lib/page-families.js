// Optional page-family classification for URLs that share one implementation.
//
// A family is declared per target, never inferred:
//   page_families:
//     - id: feedback-form
//       label: Page feedback form
//       route: /feedback            # exact path; a trailing * matches a prefix
//       state_params: [rating]      # meaningful test states, counted by value
//       variant_params: [page, title]  # content selectors, counted as distinct values
//
// This does not touch URL identity (normalizeUrl / pageId): every URL stays
// its own page record. Families only add counts to the report, so a reader can
// see "N URLs, M declared implementations" without any evidence being dropped.

const MAX_STATE_VALUES = 20;
const MAX_FAMILIES = 50;

export function resolvePageFamilies(raw, where = 'config') {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error(`${where}: page_families must be a list.`);
  if (raw.length > MAX_FAMILIES) throw new Error(`${where}: at most ${MAX_FAMILIES} page_families are supported.`);
  const errors = [];
  const seen = new Set();
  const out = [];
  raw.forEach((entry, index) => {
    const at = `${where}: page_families[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { errors.push(`${at} must be a mapping.`); return; }
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) errors.push(`${at}: id must be lowercase letters, digits, "-" or "_".`);
    else if (seen.has(id)) errors.push(`${at}: duplicate id "${id}".`);
    seen.add(id);
    const route = typeof entry.route === 'string' ? entry.route.trim() : '';
    if (!route.startsWith('/')) errors.push(`${at}: route must be a path starting with "/".`);
    const lists = {};
    for (const key of ['state_params', 'variant_params']) {
      const value = entry[key] ?? [];
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim())) errors.push(`${at}: ${key} must be a list of parameter names.`);
      else lists[key] = value.map((v) => v.trim());
    }
    out.push({ id, label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim().slice(0, 80) : id, route, ...lists });
  });
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return out;
}

export function routeMatches(route, pathname) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (route.endsWith('*')) return normalized.startsWith(route.slice(0, -1));
  return normalized === route.replace(/\/+$/, '') || normalized === route;
}

export function createPageFamilyTracker(families = []) {
  const list = families ?? [];
  const state = new Map(list.map((family) => [family.id, {
    urls: 0, audited: 0,
    states: Object.fromEntries((family.state_params ?? []).map((name) => [name, new Map()])),
    variants: Object.fromEntries((family.variant_params ?? []).map((name) => [name, new Set()])),
  }]));
  let totalUrls = 0;

  function observe(url, audited = true) {
    totalUrls++;
    if (list.length === 0) return;
    let parsed;
    try { parsed = new URL(url); } catch { return; }
    const family = list.find((candidate) => routeMatches(candidate.route, parsed.pathname));
    if (!family) return;
    const entry = state.get(family.id);
    entry.urls++;
    if (audited) entry.audited++;
    for (const name of family.state_params ?? []) {
      const value = parsed.searchParams.get(name) ?? '(absent)';
      const counts = entry.states[name];
      const key = counts.has(value) || counts.size < MAX_STATE_VALUES ? value : '(other)';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const name of family.variant_params ?? []) {
      const values = entry.variants[name];
      if (parsed.searchParams.has(name) && values.size < 100000) values.add(parsed.searchParams.get(name));
    }
  }

  function finalize() {
    if (list.length === 0) return null;
    const families = list.map((family) => {
      const entry = state.get(family.id);
      return {
        id: family.id,
        label: family.label,
        route: family.route,
        url_count: entry.urls,
        audited_url_count: entry.audited,
        implementation_count: entry.urls > 0 ? 1 : 0,
        implementation_basis: 'configured_route',
        states: Object.fromEntries(Object.entries(entry.states).map(([name, counts]) => [name, Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))) ])),
        variants: Object.fromEntries(Object.entries(entry.variants).map(([name, values]) => [name, { distinct_values: values.size }])),
        representative_sampling: 'not_applied',
      };
    });
    const inFamilies = families.reduce((sum, family) => sum + family.url_count, 0);
    return {
      schema: 1,
      urls_total: totalUrls,
      urls_in_families: inFamilies,
      urls_outside_families: totalUrls - inFamilies,
      known_implementation_count: families.reduce((sum, family) => sum + family.implementation_count, 0),
      basis: 'Implementation counts come from declared routes. URLs outside a declared family have no established implementation count.',
      families,
    };
  }

  return { observe, finalize };
}
