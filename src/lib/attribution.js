import { registrableDomain } from './urls.js';

/**
 * Finding attribution: where did a failing element come from?
 *
 * Layers (one primary attribution per finding, evidence retained):
 *   content      — authored page content; content editors act
 *   site-custom  — the site's own theme/templates/first-party JS; dev team acts
 *   platform     — CMS core, contrib module/plugin, or design system; report upstream
 *   third-party  — injected/hosted by a different registrable domain; vendor acts
 *   undetermined — evidence insufficient or conflicting; triage manually
 *
 * Everything here is evidence, not proof: report language is "evidence
 * points to", never "caused by". `undetermined` is a first-class answer —
 * every other layer must cite at least one evidence entry a human can check.
 * Evidence `detail` strings stay English by design (data, not UI chrome).
 *
 * The render-origin matcher compares an element snippet from the audited
 * (JS-hydrated) DOM against the raw pre-JavaScript HTML response. It is
 * deliberately conservative: JS routinely mutates server-rendered elements
 * (adds classes, ids, swaps data-src for src), so a failed exact match must
 * never flip a server-rendered element to 'js-injected'. Anything ambiguous
 * is 'unknown'.
 */

export const RAW_HTML_MAX_CHARS = 500_000;
const MAX_TAG_CANDIDATES = 3000;
const DISTINCTIVE_MIN_LENGTH = 8;
const STRONG = 3;
const MEDIUM = 2;
const WEAK = 1;

const URL_ATTRS = ['href', 'src', 'srcset', 'action', 'poster', 'data-src'];
// Tags where an attribute-less runtime snippet still identifies one element.
const SINGLETON_TAGS = new Set(['html', 'body', 'head', 'main', 'header', 'footer', 'nav', 'h1', 'title']);

const ASSET_PATH_RULES = [
  { re: /(^|\/)wp-includes\//, layer: 'platform', product: 'WordPress', detail: () => 'WordPress core asset path (/wp-includes/)' },
  { re: /(^|\/)wp-content\/plugins\/([^/]+)/, layer: 'platform', product: 'WordPress', detail: (m) => `WordPress plugin asset path (/wp-content/plugins/${m[2]}/)` },
  { re: /(^|\/)wp-content\/themes\/([^/]+)/, layer: 'site-custom', product: 'WordPress', detail: (m) => `WordPress theme asset path (/wp-content/themes/${m[2]}/)` },
  { re: /(^|\/)core\/(misc|themes|modules|assets)\//, layer: 'platform', product: 'Drupal', detail: () => 'Drupal core asset path (/core/)' },
  { re: /(^|\/)modules\/contrib\/([^/]+)/, layer: 'platform', product: 'Drupal', detail: (m) => `Drupal contrib module asset path (/modules/contrib/${m[2]}/)` },
  { re: /(^|\/)modules\/custom\/([^/]+)/, layer: 'site-custom', product: 'Drupal', detail: (m) => `Drupal custom module asset path (/modules/custom/${m[2]}/)` },
  { re: /(^|\/)themes\/contrib\/([^/]+)/, layer: 'platform', product: 'Drupal', detail: (m) => `Drupal contrib theme asset path (/themes/contrib/${m[2]}/)` },
  { re: /(^|\/)themes\/custom\/([^/]+)/, layer: 'site-custom', product: 'Drupal', detail: (m) => `Drupal custom theme asset path (/themes/custom/${m[2]}/)` },
];

const CLASS_NAMESPACE_RULES = [
  { prefix: 'views-', product: 'Drupal' },
  { prefix: 'field--', product: 'Drupal' },
  { prefix: 'block-', product: 'Drupal' },
  { prefix: 'node--', product: 'Drupal' },
  { prefix: 'paragraph--', product: 'Drupal' },
  { prefix: 'wp-block-', product: 'WordPress' },
  { prefix: 'usa-', product: 'USWDS' },
  { prefix: 'ds-c-', product: 'CMS Design System' },
];

// Wappalyzer detection names that confirm a product for FR-05 tech agreement.
const PRODUCT_TECH_NEEDLES = {
  Drupal: ['drupal'],
  WordPress: ['wordpress'],
  USWDS: ['uswds', 'web design system'],
  'CMS Design System': ['cms design system'],
};

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function normalize(s) {
  return decodeEntities(String(s ?? '')).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Build a searchable index over the raw pre-JS HTML response. The raw body
 * is normalized once here so per-instance matching is cheap; callers must
 * hold this in memory only for the page being processed (the raw HTML is
 * never persisted — data/ is committed and raw bodies can embed tokens).
 */
export function createRawHtmlIndex(rawHtml, { maxChars = RAW_HTML_MAX_CHARS } = {}) {
  if (typeof rawHtml !== 'string' || rawHtml.length === 0) return null;
  const truncated = rawHtml.length > maxChars;
  return {
    text: normalize(truncated ? rawHtml.slice(0, maxChars) : rawHtml),
    truncated,
    tagCache: new Map(),
  };
}

/**
 * Parse the opening tag of an element snippet: works on serialized DOM
 * (axe's `html`), raw server HTML, and Alfa's pseudo-HTML target
 * descriptions. A snippet cut off mid-attribute (the 200-char example cap)
 * drops its final, possibly-truncated attribute.
 */
export function parseOpeningTag(snippet) {
  const s = String(snippet ?? '').trim();
  const tagMatch = s.match(/^<\s*([a-zA-Z][a-zA-Z0-9-]*)/);
  if (!tagMatch) return null;
  const closed = s.indexOf('>') !== -1;
  let attrText = s.slice(tagMatch[0].length, closed ? s.indexOf('>') : undefined);
  if (!closed) {
    const dq = (attrText.match(/"/g) ?? []).length;
    const sq = (attrText.match(/'/g) ?? []).length;
    if (dq % 2) attrText = attrText.slice(0, attrText.lastIndexOf('"'));
    else if (sq % 2) attrText = attrText.slice(0, attrText.lastIndexOf("'"));
  }
  const attrs = {};
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  const names = [];
  let m;
  while ((m = attrRe.exec(attrText))) {
    const name = m[1].toLowerCase();
    if (name === '/') continue;
    attrs[name] = normalize(m[2] ?? m[3] ?? m[4] ?? '');
    names.push(name);
  }
  if (!closed && names.length) delete attrs[names[names.length - 1]];
  return {
    tag: tagMatch[1].toLowerCase(),
    attrs,
    classTokens: (attrs.class ?? '').split(/\s+/).filter(Boolean),
  };
}

function getTagCandidates(index, tag) {
  let entry = index.tagCache.get(tag);
  if (entry) return entry;
  const re = new RegExp(`<${tag}(?=[\\s>/])[^>]*>?`, 'g');
  const candidates = [];
  let capped = false;
  let m;
  while ((m = re.exec(index.text))) {
    if (candidates.length >= MAX_TAG_CANDIDATES) { capped = true; break; }
    candidates.push(parseOpeningTag(m[0]));
  }
  entry = { candidates: candidates.filter(Boolean), capped };
  index.tagCache.set(tag, entry);
  return entry;
}

function looksDynamic(value) {
  return /[0-9a-f]{16,}/i.test(value) || /\d{8,}/.test(value) || /^[0-9a-f][0-9a-f-]{18,}$/i.test(value);
}

function distinctiveValues(attrs) {
  const out = [];
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'class' || name === 'style') continue;
    if (!(name === 'id' || name === 'name' || name === 'for' || URL_ATTRS.includes(name) || name.startsWith('data-'))) continue;
    if (value.length < DISTINCTIVE_MIN_LENGTH) continue;
    if (/^(https?:)?\/\/[^/]+\/?$/.test(value)) continue;
    out.push({ name, value });
    // Absolute URLs may be root-relative in the raw HTML — search the path too.
    if (/^https?:\/\//.test(value)) {
      try {
        const u = new URL(value);
        const pathPart = u.pathname + u.search;
        if (pathPart.length >= DISTINCTIVE_MIN_LENGTH) out.push({ name, value: pathPart });
      } catch { /* not a URL after all */ }
    }
  }
  return out;
}

function classTokensMatch(snippetTokens, candidateTokens) {
  if (!snippetTokens.length || !candidateTokens.length) return false;
  const snip = new Set(snippetTokens);
  // Runtime = server + JS-added classes, so the raw candidate's tokens
  // being a subset of the snippet's is the expected direction.
  const shared = candidateTokens.filter((c) => snip.has(c));
  if (!shared.length) return false;
  if (shared.length === candidateTokens.length || shared.length === snippetTokens.length) return true;
  return shared.length >= 2 || shared.some((c) => c.length >= DISTINCTIVE_MIN_LENGTH);
}

function candidateMatches(snippet, candidate) {
  if (snippet.attrs.id && candidate.attrs.id === snippet.attrs.id) return true;
  let matches = 0;
  let mismatches = 0;
  const names = Object.keys(snippet.attrs).filter((n) => n !== 'style');
  for (const name of names) {
    if (!(name in candidate.attrs)) continue;
    if (name === 'class') {
      if (classTokensMatch(snippet.classTokens, candidate.classTokens)) matches++;
      else mismatches++;
    } else if (candidate.attrs[name] === snippet.attrs[name]) matches++;
    else mismatches++;
  }
  if (mismatches > 0) return false;
  return matches >= 2 || (matches === 1 && names.length === 1);
}

/**
 * Classify one element snippet against the raw pre-JS HTML:
 * 'server' (confidently present), 'js-injected' (confidently absent), or
 * 'unknown'. A truncated raw body can still prove presence, never absence.
 */
export function classifyRenderOrigin(snippet, index) {
  if (!index) return 'unknown';
  const parsed = parseOpeningTag(snippet);
  if (!parsed) return 'unknown';

  const s = String(snippet).trim();
  const gt = s.indexOf('>');
  if (gt !== -1) {
    const openTag = normalize(s.slice(0, gt + 1));
    if (openTag.length > 3 && index.text.includes(openTag)) return 'server';
  }

  const distinctive = distinctiveValues(parsed.attrs);
  for (const { value } of distinctive) {
    if (index.text.includes(value)) return 'server';
  }

  const { candidates, capped } = getTagCandidates(index, parsed.tag);
  if (candidates.length === 0) return index.truncated ? 'unknown' : 'js-injected';

  const attrNames = Object.keys(parsed.attrs).filter((n) => n !== 'style');
  if (attrNames.length === 0) return SINGLETON_TAGS.has(parsed.tag) ? 'server' : 'unknown';

  for (const c of candidates) {
    if (candidateMatches(parsed, c)) return 'server';
  }

  if (index.truncated || capped) return 'unknown';
  const stable = distinctive.filter((d) => !looksDynamic(d.value));
  if (stable.length > 0) return 'js-injected';
  return 'unknown';
}

/**
 * Annotate every kept a11y example on a page record with its render origin.
 * Called at scan time while the raw HTML is still in memory; a null index
 * (capture failed) marks every instance 'unknown' rather than skipping, so
 * downstream can tell "not classified" from "engine predates this field".
 */
export function annotateRenderOrigins(record, index) {
  const groups = [
    ...Object.values(record.axe?.violations ?? {}),
    ...Object.values(record.alfa?.failed ?? {}),
    ...Object.values(record.deprecatedHtml?.findings ?? {}),
  ];
  for (const g of groups) {
    for (const ex of g.examples ?? []) {
      ex.render_origin = index ? classifyRenderOrigin(ex.html ?? ex.target ?? '', index) : 'unknown';
    }
  }
}

/** Map a URL path to a platform/site-custom layer via CMS file-layout conventions. */
export function classifyAssetPath(urlOrPath) {
  let path = String(urlOrPath ?? '');
  if (/^https?:\/\//.test(path)) {
    try { path = new URL(path).pathname; } catch { return null; }
  }
  path = path.toLowerCase();
  for (const rule of ASSET_PATH_RULES) {
    const m = path.match(rule.re);
    if (m) return { layer: rule.layer, product: rule.product, detail: rule.detail(m) };
  }
  return null;
}

/** Class-token prefixes that mark platform/design-system generated markup. */
export function classifyClassTokens(tokens) {
  const seen = new Set();
  const out = [];
  for (const token of tokens ?? []) {
    for (const rule of CLASS_NAMESPACE_RULES) {
      if (token.startsWith(rule.prefix) && !seen.has(rule.prefix)) {
        seen.add(rule.prefix);
        out.push({ prefix: rule.prefix, product: rule.product });
      }
    }
  }
  return out;
}

function techConfirms(siteTech, product) {
  const needles = PRODUCT_TECH_NEEDLES[product] ?? [product.toLowerCase()];
  return (siteTech ?? []).some((name) => {
    const n = String(name).toLowerCase();
    return needles.some((needle) => n.includes(needle));
  });
}

function urlValues(parsed) {
  const out = [];
  for (const attr of URL_ATTRS) {
    const value = parsed.attrs[attr];
    if (!value) continue;
    out.push({ attr, value: attr === 'srcset' ? value.split(/[\s,]+/)[0] : value });
  }
  return out;
}

/**
 * Derive one finding's attribution from its sampled instances plus site
 * context. Pure — unit-testable with synthetic inputs. Conflicting evidence
 * (two layers each with medium-or-stronger support) yields 'undetermined'
 * with all evidence listed; conflict is surfaced, never silently resolved.
 */
export function deriveAttribution({ instances = [], pages = 0, totalPages = 0, templateThreshold = 10, siteTech = [], domain = '' } = {}) {
  const evidence = [];
  const scores = {};
  const seen = new Set();
  const add = (signal, detail, supports, strength) => {
    const key = `${signal}|${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    evidence.push({ signal, detail, supports: supports ?? null });
    if (supports) scores[supports] = (scores[supports] ?? 0) + strength;
  };

  let server = 0;
  let injected = 0;
  for (const i of instances) {
    if (i?.render_origin === 'server') server++;
    else if (i?.render_origin === 'js-injected') injected++;
  }
  const classified = server + injected;
  if (classified > 0) {
    add('render-origin', `${server} of ${classified} classified instance(s) server-rendered, ${injected} JS-injected`, null, 0);
  }

  const siteRd = registrableDomain(domain);
  for (const i of instances) {
    const parsed = parseOpeningTag(i?.html ?? i?.target ?? '');
    if (!parsed) continue;
    for (const { attr, value } of urlValues(parsed)) {
      if (/^https?:\/\//.test(value)) {
        let host;
        try { host = new URL(value).hostname; } catch { continue; }
        if (registrableDomain(host) !== siteRd) {
          const signal = parsed.tag === 'iframe' ? 'third-party-iframe' : 'third-party-url';
          add(signal, `<${parsed.tag}> ${attr} references third-party host ${host}`, 'third-party', STRONG);
          continue;
        }
      }
      const ap = classifyAssetPath(value);
      if (ap) {
        if (techConfirms(siteTech, ap.product)) add('asset-path', ap.detail, ap.layer, STRONG);
        else add('asset-path', `${ap.detail} — but ${ap.product} was not detected on this site`, null, 0);
      }
    }
    for (const ns of classifyClassTokens(parsed.classTokens)) {
      if (techConfirms(siteTech, ns.product)) {
        add('class-namespace', `class prefix "${ns.prefix}" is ${ns.product}-generated markup`, 'platform', MEDIUM);
      } else {
        add('class-namespace', `class prefix "${ns.prefix}" looks like ${ns.product} markup — but ${ns.product} was not detected on this site`, null, 0);
      }
    }
  }

  if (pages >= templateThreshold) {
    add('page-spread', `appears on ${pages} of ${totalPages} scanned pages — template-scale spread`, 'site-custom', WEAK);
  } else if (pages > 0 && pages <= 2 && classified > 0 && injected === 0) {
    add('page-spread', `appears on only ${pages} page(s) — content-scale spread`, 'content', WEAK);
  }

  if (classified > 0 && injected === classified && !scores['third-party']) {
    add('render-origin', 'every classified instance is JS-injected with no third-party markup evidence — likely the site\'s own script', 'site-custom', WEAK);
  }

  const supported = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const conflicting = supported.filter(([, score]) => score >= MEDIUM);
  let layer = 'undetermined';
  if (conflicting.length < 2 && supported.length > 0 && !(supported.length > 1 && supported[0][1] === supported[1][1])) {
    layer = supported[0][0];
  }

  let confidence = 'low';
  if (layer !== 'undetermined') {
    const pts = scores[layer];
    confidence = pts >= 5 ? 'high' : pts >= 3 ? 'medium' : 'low';
    const mixed = server > 0 && injected > 0;
    if (mixed) confidence = 'low';
    else if (classified > 0 && injected === 0 && layer !== 'third-party' && pts >= MEDIUM && confidence !== 'high') {
      confidence = confidence === 'medium' ? 'high' : 'medium';
    }
  }

  return { layer, confidence, evidence };
}
