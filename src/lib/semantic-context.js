/**
 * Semantic context: where a failing element sits in the page's landmark and
 * widget structure.
 *
 * This is deliberately a pure function over a small "ancestry" array rather
 * than a DOM walk. The scanner serialises each failing element's ancestors in
 * the page (tag, explicit role, accessible name) and this module classifies
 * that list on the Node side, so the rules are unit-testable without a
 * browser and identical for every engine that supplies an ancestry.
 *
 * References: WAI-ARIA 1.2 (landmark roles, region naming), HTML-ARIA
 * (implicit roles for header/footer/main/nav/aside/section/form).
 *
 * What this module must NOT do:
 *  - treat every <header> as the page banner (a header scoped to a sectioning
 *    ancestor is not a banner);
 *  - treat an unnamed <section>/<form> (or role="region"/"form") as a
 *    landmark — ARIA requires a name for those to be exposed as landmarks;
 *  - invent a region when none exists (the result is explicitly unclassified);
 *  - merge landmark classification with widget classification (a dialog is a
 *    widget, not a landmark).
 */

/** ARIA landmark roles (WAI-ARIA 1.2, "Landmark Roles"). */
export const LANDMARK_ROLES = Object.freeze([
  'banner', 'complementary', 'contentinfo', 'form', 'main', 'navigation', 'region', 'search',
]);

/** Container/widget roles worth keeping as separate context from landmarks. */
export const WIDGET_ROLES = Object.freeze([
  'alertdialog', 'combobox', 'dialog', 'grid', 'group', 'listbox', 'menu', 'menubar',
  'tab', 'tablist', 'tabpanel', 'toolbar', 'tree', 'treegrid',
]);

/** Landmark roles that require an accessible name to be exposed as landmarks. */
const NAMED_LANDMARKS = new Set(['region', 'form']);

/** Ancestors that scope a <header>/<footer> so it is not the page banner/footer. */
const SECTIONING_TAGS = new Set(['article', 'aside', 'main', 'nav', 'section']);

const LANDMARKS = new Set(LANDMARK_ROLES);
const WIDGETS = new Set(WIDGET_ROLES);

/** Bounds applied to the serialized ancestry (children before ancestors). */
// The scanner serializes only meaningful boundaries, so this is a safety cap,
// not a traversal limit (layout wrappers no longer consume the budget).
export const MAX_ANCESTRY = 32;
export const MAX_NAME = 80;

/**
 * Classify one element's ancestry.
 *
 * @param {Array<{tag?:string, role?:string|null, name?:string|null, name_source?:string|null}>} ancestry
 *   Ancestors outermost-first, ending with the failing element itself. `role`
 *   is the element's *explicit* role attribute (null when absent); implicit
 *   roles are derived here. `name` is the accessible-name text when the
 *   scanner could resolve one safely.
 * @returns {{
 *   nearest_region: {role:string,name:string|null,unnamed:boolean}|null,
 *   region_ancestry: Array<{role:string,name:string|null,unnamed:boolean}>,
 *   widget: {role:string,name:string|null,unnamed:boolean}|null,
 *   widget_ancestry: Array<{role:string,name:string|null,unnamed:boolean}>,
 *   path: Array<{role:string,name:string|null,unnamed:boolean}>,
 *   in_dialog: boolean,
 *   unnamed_landmarks: Array<{tag:string|null,role:string}>,
 *   unclassified: boolean
 * }}
 */
export function resolveSemanticContext(ancestry) {
  const nodes = Array.isArray(ancestry) ? ancestry.slice(-MAX_ANCESTRY) : [];
  const regions = [];
  const widgets = [];
  const path = [];
  const unnamedLandmarks = [];

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index] ?? {};
    const role = roleFor(node, nodes, index);
    if (!role) continue;
    const name = cleanName(node.name);
    if (NAMED_LANDMARKS.has(role) && !name) {
      // A <section>/<form> (or role="region"/"form") without a name is not a
      // landmark. Record it so reports can show "unnamed" instead of silently
      // pretending the element is outside any structure.
      unnamedLandmarks.push({ tag: tagOf(node), role });
      continue;
    }
    const entry = { role, name, unnamed: !name };
    path.push(entry);
    if (LANDMARKS.has(role)) regions.push(entry);
    else if (WIDGETS.has(role)) widgets.push(entry);
  }

  return {
    nearest_region: regions.length ? regions[regions.length - 1] : null,
    region_ancestry: regions,
    widget: widgets.length ? widgets[widgets.length - 1] : null,
    widget_ancestry: widgets,
    path,
    in_dialog: widgets.some((entry) => entry.role === 'dialog' || entry.role === 'alertdialog'),
    unnamed_landmarks: unnamedLandmarks,
    unclassified: regions.length === 0,
  };
}

/**
 * The explicit role wins; otherwise map the element's native role. Returns
 * null when the element is not a landmark or tracked widget.
 */
export function roleFor(node, nodes = [node], index = nodes.length - 1) {
  const explicit = cleanRole(node.role);
  if (explicit) return LANDMARKS.has(explicit) || WIDGETS.has(explicit) ? explicit : null;

  const tag = tagOf(node);
  switch (tag) {
    case 'main':
      return 'main';
    case 'nav':
      return 'navigation';
    case 'aside':
      return 'complementary';
    case 'header':
      // HTML-AAM: a header scoped to article/aside/main/nav/section is not the
      // page banner, so it is not a landmark.
      return scopedBySectioning(nodes, index) ? null : 'banner';
    case 'footer':
      return scopedBySectioning(nodes, index) ? null : 'contentinfo';
    case 'section':
      // <section> maps to region only when it has an accessible name.
      return 'region';
    case 'form':
      // <form> maps to form only when it has an accessible name; the name
      // requirement is enforced above, which leaves an unnamed form unclassified.
      return 'form';
    default:
      return null;
  }
}

/** True when an ancestor (excluding the node itself) establishes a sectioning context. */
export function scopedBySectioning(nodes, index) {
  for (let i = 0; i < index; i++) {
    const node = nodes[i] ?? {};
    if (SECTIONING_TAGS.has(tagOf(node))) return true;
    const role = cleanRole(node.role);
    if (role === 'article' || role === 'complementary' || role === 'main' || role === 'navigation' || role === 'region') return true;
  }
  return false;
}

function tagOf(node) {
  return String(node?.tag ?? '').trim().toLowerCase();
}

function cleanRole(value) {
  if (value == null) return null;
  const first = String(value).trim().toLowerCase().split(/\s+/)[0];
  return first || null;
}

function cleanName(value) {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim();
  return name ? name.slice(0, MAX_NAME) : null;
}
