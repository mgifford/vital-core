import { MAX_ANCESTRY, MAX_NAME, resolveSemanticContext } from './semantic-context.js';

/**
 * Structured element evidence for engine findings.
 *
 * The engines report *that* a rule failed and a few example nodes. For a
 * finding to be inspectable and reproducible we also need to know what the
 * failing element was (tag, explicit role, name attributes, match count,
 * rendering state) and where it sat in the page's landmark/widget structure.
 *
 * This is collected once, while the page is already open, right after the
 * audit, and attached to the same capped examples that reports, the JSON API,
 * the CSVs and future reproduction scripts read. Nothing here scans again.
 *
 * Honesty limits (documented rather than papered over):
 *  - `role` is the element's EXPLICIT role attribute. The computed
 *    accessibility role needs a browser accessibility tree; it is not recorded.
 *  - `name` is only the text of name-bearing attributes (aria-label, alt,
 *    title, placeholder), plus aria-labelledby *references* (never their
 *    text) for the failing element itself. Text content is not collected.
 *  - An axe target that is a frame/shadow path (an array with more than one
 *    selector) is not a CSS selector for the top document. Those examples are
 *    left explicitly unavailable rather than resolved against the wrong node.
 */

/** Representative failing instances kept per rule (matches aggregate.js). */
export const MAX_RULE_INSTANCES = 5;

/** Bounds for stored element evidence. */
export const MAX_SELECTOR = 500;
export const MAX_ATTR = 100;
const MAX_WALK = 200;

/**
 * Runs inside the page (stringified by attachElementEvidence). Returns the
 * render context once plus one evidence record per selector. Must stay
 * self-contained: it cannot close over module scope.
 */
function collectElementEvidenceInPage({ selectors, maxAncestry, maxWalk, maxName, maxSelector }) {
  const clip = (value, max) => {
    if (typeof value !== 'string') return null;
    const text = value.replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, max) : null;
  };
  const explicitRole = (el) => {
    const raw = el.getAttribute('role');
    if (!raw) return null;
    const first = raw.trim().toLowerCase().split(/\s+/)[0];
    return first || null;
  };
  // Landmark names are page chrome; resolving aria-labelledby text here is
  // low-risk and needed to tell "Primary" from "Footer" navigation apart.
  const landmarkName = (el) => {
    const aria = clip(el.getAttribute('aria-label'), maxName);
    if (aria) return { name: aria, name_source: 'aria-label' };
    const refs = clip(el.getAttribute('aria-labelledby'), 200);
    if (refs) {
      const text = refs.split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => node.textContent ?? '')
        .join(' ');
      const resolved = clip(text, maxName);
      return resolved
        ? { name: resolved, name_source: 'aria-labelledby' }
        : { name: null, name_source: 'aria-labelledby-unresolved' };
    }
    const title = clip(el.getAttribute('title'), maxName);
    if (title) return { name: title, name_source: 'title' };
    return { name: null, name_source: 'none' };
  };
  // The failing element's own name comes only from attributes: page text can
  // contain personal content, so it is never read.
  const elementName = (el) => {
    const out = { name: null, name_source: 'none', labelledby_ids: [] };
    for (const [attr, source] of [['aria-label', 'aria-label'], ['alt', 'alt'], ['title', 'title'], ['placeholder', 'placeholder']]) {
      const value = clip(el.getAttribute(attr), maxName);
      if (value) {
        out.name = value;
        out.name_source = source;
        return out;
      }
    }
    const refs = clip(el.getAttribute('aria-labelledby'), 200);
    if (refs) {
      out.name_source = 'aria-labelledby';
      out.labelledby_ids = refs.split(/\s+/).slice(0, 4);
    }
    return out;
  };
  const isFramed = () => {
    try {
      return window.top !== window;
    } catch {
      return true; // cross-origin parent: we are framed but cannot inspect it
    }
  };
  // Cross a shadow boundary via its host; stop at the document otherwise.
  const parentOf = (node) => {
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode?.();
    if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) return root.host ?? null;
    return null;
  };
  const MEANINGFUL_TAGS = ['header', 'footer', 'main', 'nav', 'aside', 'section', 'form', 'article', 'dialog', 'search'];
  const media = (query) => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  };
  const context = {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    device_scale_factor: window.devicePixelRatio || 1,
    color_scheme: media('(prefers-color-scheme: dark)') ? 'dark' : media('(prefers-color-scheme: light)') ? 'light' : 'no-preference',
    forced_colors: media('(forced-colors: active)') ? 'active' : 'none',
    reduced_motion: media('(prefers-reduced-motion: reduce)') ? 'reduce' : 'no-preference',
    locale: document.documentElement.getAttribute('lang') || null,
    final_url: location.href,
    user_agent: navigator.userAgent,
    screenshot_captured: false,
  };

  const evidence = selectors.map((selector) => {
    let matches;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      return { available: false, reason: 'invalid-selector', selector: clip(selector, maxSelector) };
    }
    if (matches.length === 0) return { available: false, reason: 'not-found', selector: clip(selector, maxSelector) };
    const el = matches[0];
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const name = elementName(el);
    // Walk the complete chain (crossing shadow hosts) but serialize only
    // meaningful boundaries: landmarks, sectioning elements, widgets and the
    // target. Layout wrappers would otherwise consume the ancestry budget and
    // hide `main` behind eight <div>s.
    const ancestry = [];
    let depth = 0;
    let complete = false;
    let node = el;
    while (node && depth < maxWalk) {
      const isTarget = node === el;
      const tag = node.localName;
      const role = explicitRole(node);
      if (isTarget || role || MEANINGFUL_TAGS.includes(tag)) {
        ancestry.unshift({
          tag,
          role,
          // Only compute a landmark name when the node could be one; this
          // keeps the walk cheap and avoids resolving text for wrappers.
          ...(node.matches('header,footer,main,nav,aside,section,form,article,dialog,search,[role]')
            ? landmarkName(node)
            : { name: null, name_source: 'none' }),
        });
      }
      depth++;
      if (node === document.documentElement) { complete = true; break; }
      node = parentOf(node);
    }
    const root = el.getRootNode?.();
    return {
      available: true,
      selector: clip(selector, maxSelector),
      selector_matches: matches.length,
      tag: el.localName,
      role: explicitRole(el),
      name: name.name,
      name_source: name.name_source,
      labelledby_ids: name.labelledby_ids,
      id: clip(el.getAttribute('id'), 100),
      shadow: typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot,
      iframe: isFramed(),
      visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      ancestry: ancestry.slice(-maxAncestry),
      ancestry_depth: depth,
      ancestry_complete: complete,
    };
  });
  return { context, evidence };
}

/**
 * Attach element + semantic evidence to an axe record's capped examples.
 * Best-effort: the caller treats a throw as "evidence unavailable" and the
 * page scan continues. Mutates `axeRecord` (the per-page record) only.
 */
export async function attachElementEvidence(page, axeRecord) {
  const slots = [];
  for (const [ruleId, violation] of Object.entries(axeRecord?.violations ?? {})) {
    for (const [index, example] of (violation.examples ?? []).entries()) {
      // A frame/shadow path is not a selector for the top document. Record it
      // as explicitly unavailable rather than resolving the wrong node.
      if (Array.isArray(example.target_path) && example.target_path.length > 1) {
        example.element = { available: false, reason: 'frame-or-shadow-path', selector: example.target ?? null };
        continue;
      }
      if (typeof example.target !== 'string' || !example.target) continue;
      slots.push({ ruleId, index, selector: example.target });
    }
  }

  const args = JSON.stringify({
    selectors: slots.map((slot) => slot.selector),
    maxAncestry: MAX_ANCESTRY,
    maxWalk: MAX_WALK,
    maxName: MAX_NAME,
    maxSelector: MAX_SELECTOR,
  });
  // Stringified (not a function) so a page's CSP cannot block the evaluation,
  // matching component-observation.js's in-page pattern.
  const result = await page.evaluate(`(${collectElementEvidenceInPage.toString()})(${args})`);

  axeRecord.context = boundedContext(result?.context);
  const evidence = Array.isArray(result?.evidence) ? result.evidence : [];
  slots.forEach((slot, i) => {
    const example = axeRecord.violations[slot.ruleId].examples[slot.index];
    const record = boundedElement(evidence[i], slot.selector);
    example.element = record;
    if (record.available && Array.isArray(evidence[i].ancestry)) {
      const semantic = resolveSemanticContext(evidence[i].ancestry);
      semantic.ancestry_complete = evidence[i].ancestry_complete === true;
      semantic.ancestry_depth = Number.isInteger(evidence[i].ancestry_depth) ? evidence[i].ancestry_depth : null;
      example.semantic_context = semantic;
    }
  });
}

/** Copy an axe example into the bounded instance shape summary.json carries. */
export function condenseInstance(example) {
  const out = {
    url: example.url ?? null,
    target: example.target ?? null,
    html: example.html ?? null,
  };
  if (example.element) out.element = cloneElement(example.element);
  if (example.semantic_context) out.semantic_context = cloneSemantic(example.semantic_context);
  if (example.component) out.component = example.component;
  for (const key of ['page_id', 'run_id', 'scanned_at', 'engine_version', 'consent_state']) {
    if (example[key] != null) out[key] = String(example[key]).slice(0, 100);
  }
  if (example.browser_context) out.browser_context = pickBrowserContext(example.browser_context);
  return out;
}

/** The compact, per-occurrence render context (no UA or final URL). */
export function pickBrowserContext(context) {
  if (!context || typeof context !== 'object') return null;
  return {
    viewport: context.viewport ?? null,
    device_scale_factor: context.device_scale_factor ?? null,
    color_scheme: context.color_scheme ?? null,
    forced_colors: context.forced_colors ?? null,
    reduced_motion: context.reduced_motion ?? null,
    locale: context.locale ?? null,
  };
}

/** Public-safe element evidence: no ids, no ancestry, bounded strings. */
export function sanitizeElementEvidence(element) {
  if (!element) return null;
  if (element.available !== true) {
    return { available: false, reason: element.reason ?? 'unknown' };
  }
  return {
    available: true,
    selector: safeSelector(element.selector),
    selector_matches: Number.isInteger(element.selector_matches) ? element.selector_matches : null,
    tag: element.tag ?? null,
    role: element.role ?? null,
    name: typeof element.name === 'string' ? element.name.slice(0, MAX_NAME) : null,
    name_source: element.name_source ?? 'none',
    labelledby_ids: (element.labelledby_ids ?? []).slice(0, 4),
    shadow: element.shadow === true,
    iframe: element.iframe === true,
    visible: element.visible === true,
    rect: element.rect ?? null,
  };
}

/** Public-safe semantic context: bounded, no page text beyond landmark names. */
export function sanitizeSemanticContext(semantic) {
  return semantic ? cloneSemantic(semantic) : null;
}

/** A selector is publishable only when it is plain CSS on a real element. */
export function safeSelector(value) {
  if (typeof value !== 'string' || !value) return null;
  if (/^\s*text:/i.test(value) || /[<>]/.test(value)) return null;
  if (/\[\s*(?:value|data-|.*(?:token|secret|password|session))/i.test(value)) return null;
  return value.slice(0, 1000);
}

function boundedElement(evidence, fallbackSelector) {
  if (!evidence || evidence.available !== true) {
    return { available: false, reason: evidence?.reason ?? 'unavailable', selector: evidence?.selector ?? fallbackSelector ?? null };
  }
  return {
    available: true,
    selector: String(evidence.selector ?? fallbackSelector ?? '').slice(0, MAX_SELECTOR),
    selector_matches: Number.isInteger(evidence.selector_matches) ? evidence.selector_matches : null,
    tag: typeof evidence.tag === 'string' ? evidence.tag : null,
    role: typeof evidence.role === 'string' ? evidence.role.slice(0, MAX_ATTR) : null,
    name: typeof evidence.name === 'string' ? evidence.name.slice(0, MAX_NAME) : null,
    name_source: typeof evidence.name_source === 'string' ? evidence.name_source : 'none',
    labelledby_ids: Array.isArray(evidence.labelledby_ids) ? evidence.labelledby_ids.slice(0, 4).map(String) : [],
    id: typeof evidence.id === 'string' ? evidence.id.slice(0, MAX_ATTR) : null,
    shadow: evidence.shadow === true,
    iframe: evidence.iframe === true,
    visible: evidence.visible === true,
    rect: boundedRect(evidence.rect),
  };
}

function boundedRect(rect) {
  if (!rect || typeof rect !== 'object') return null;
  const nums = ['x', 'y', 'width', 'height'].map((key) => (Number.isFinite(rect[key]) ? Math.round(rect[key]) : null));
  return nums.every((n) => n !== null) ? { x: nums[0], y: nums[1], width: nums[2], height: nums[3] } : null;
}

function boundedContext(context) {
  if (!context || typeof context !== 'object') return null;
  return {
    viewport: context.viewport ?? null,
    device_scale_factor: context.device_scale_factor ?? null,
    color_scheme: context.color_scheme ?? null,
    forced_colors: context.forced_colors ?? null,
    reduced_motion: context.reduced_motion ?? null,
    locale: context.locale ?? null,
    // Origin + path only: the context can reach the public API, and a final
    // URL's query string may carry tokens or personal data.
    final_url: pathOnly(context.final_url),
    user_agent: typeof context.user_agent === 'string' ? context.user_agent.slice(0, 300) : null,
    screenshot_captured: context.screenshot_captured === true,
  };
}

function pathOnly(url) {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    // Only http(s) has a meaningful published origin; file: and data: would
    // otherwise produce "null/path" in the public summary.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.origin}${parsed.pathname}`.slice(0, 2000);
  } catch {
    return null;
  }
}

function cloneElement(element) {
  if (element.available !== true) {
    return { available: false, reason: element.reason ?? 'unknown', selector: element.selector ?? null };
  }
  // Allowlist, not a spread: the raw ancestry is needed only to classify the
  // element, and must never reach the long-lived summary.
  return {
    available: true,
    selector: element.selector ?? null,
    selector_matches: element.selector_matches ?? null,
    tag: element.tag ?? null,
    role: element.role ?? null,
    name: element.name ?? null,
    name_source: element.name_source ?? 'none',
    labelledby_ids: [...(element.labelledby_ids ?? [])],
    id: element.id ?? null,
    shadow: element.shadow === true,
    iframe: element.iframe === true,
    visible: element.visible === true,
    rect: element.rect ? { ...element.rect } : null,
  };
}

function cloneSemantic(semantic) {
  return {
    nearest_region: semantic.nearest_region ? { ...semantic.nearest_region } : null,
    region_ancestry: (semantic.region_ancestry ?? []).map((entry) => ({ ...entry })),
    widget: semantic.widget ? { ...semantic.widget } : null,
    widget_ancestry: (semantic.widget_ancestry ?? []).map((entry) => ({ ...entry })),
    path: (semantic.path ?? []).map((entry) => ({ ...entry })),
    in_dialog: semantic.in_dialog === true,
    unnamed_landmarks: (semantic.unnamed_landmarks ?? []).map((entry) => ({ ...entry })),
    unclassified: semantic.unclassified === true,
    ancestry_complete: semantic.ancestry_complete === true,
    ancestry_depth: Number.isInteger(semantic.ancestry_depth) ? semantic.ancestry_depth : null,
  };
}
