/**
 * Live inspection on the target site.
 *
 * A static report cannot draw on another origin. The honest equivalent of the
 * WAVE/Accessibility Insights visual helper is code running in the target page:
 * a one-time bookmarklet plus a per-finding payload in the URL fragment. The
 * payload contains only the selector, rule, WCAG mapping and fix text already
 * published; the bookmarklet never sends anything anywhere.
 */

export const INSPECT_HASH = 'vital-inspect';

/**
 * Build the target URL with a compact inspect payload. Only http(s) findings
 * with a selector can be highlighted; everything else returns null instead of
 * guessing.
 */
export function inspectUrlFor(bug) {
  if (!bug || typeof bug.url !== 'string' || !/^https?:\/\//i.test(bug.url)) return null;
  if (typeof bug.selector !== 'string' || !bug.selector.trim()) return null;
  const payload = {
    v: 1,
    u: bug.url,
    s: bug.selector,
    t: bug.element?.tag ?? null,
    r: bug.element?.role ?? null,
    n: bug.element?.name ?? null,
    ns: bug.element?.name_source ?? 'none',
    rule: bug.rule_id ?? null,
    label: bug.rule_label ?? bug.summary ?? null,
    w: bug.wcag_sc ?? null,
    fix: String(bug.remediation_tip || bug.suggested_fix || '').slice(0, 600),
    h: bug.rule_url ?? bug.help_url ?? null,
    o: bug.occurrence_id ?? null,
  };
  const json = JSON.stringify(payload);
  const base64 = typeof Buffer !== 'undefined'
    ? Buffer.from(json, 'utf8').toString('base64')
    : btoa(unescape(encodeURIComponent(json)));
  const token = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const url = new URL(bug.url);
  const existing = url.hash ? url.hash.slice(1) + '&' : '';
  url.hash = `${existing}vital-inspect=${token}`;
  return url.href;
}

/** A one-time bookmarklet; reads the payload from the current page's hash. */
export function inspectBookmarklet() {
  return `javascript:(${vitalInspect.toString().replace(/\s+/g, ' ').trim()})()`;
}

/**
 * Runs in the target page. Kept ES5-ish and self-contained so it can be
 * stringified into the bookmarklet. It creates a high-contrast outline and a
 * panel with the recorded rule/WCAG/selector/fix, checks that the selector
 * still points at the recorded kind of element, and removes itself on close.
 */
export function vitalInspect() {
  var marker = 'vital-inspect=';
  var hash = window.location.hash || '';
  var start = hash.indexOf(marker);
  if (start < 0) {
    window.alert('Open a VITAL "Highlight on site" link first, then click the VITAL Inspect bookmarklet.');
    return;
  }
  var token = hash.slice(start + marker.length).split('&')[0];
  var payload;
  try {
    var b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    payload = JSON.parse(decodeURIComponent(escape(window.atob(b64))));
  } catch (error) {
    window.alert('VITAL: this inspect link is damaged.');
    return;
  }

  var old = document.getElementById('vital-inspect-ui');
  if (old) old.remove();
  var oldBox = document.getElementById('vital-inspect-box');
  if (oldBox) oldBox.remove();
  var previousFocus = document.activeElement;

  var target = null;
  var matches = 0;
  try {
    var found = document.querySelectorAll(payload.s);
    matches = found.length;
    target = found[0] || null;
  } catch (error) {
    matches = 0;
  }

  var ui = document.createElement('div');
  ui.id = 'vital-inspect-ui';
  ui.setAttribute('role', 'region');
  ui.setAttribute('aria-label', 'VITAL inspect');
  ui.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:min(430px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#1b1b1b;border:2px solid #1b1b1b;border-radius:6px;box-shadow:0 6px 28px rgba(0,0,0,.4);font:14px/1.45 system-ui,-apple-system,sans-serif;padding:16px 18px;';

  var close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.setAttribute('aria-label', 'Close VITAL inspect');
  close.style.cssText = 'position:absolute;top:10px;right:10px;font:inherit;font-weight:600;padding:4px 8px;border:2px solid #1b1b1b;border-radius:4px;background:#fff;color:#1b1b1b;cursor:pointer;';
  ui.appendChild(close);

  function add(tag, text, css) {
    var node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (css) node.style.cssText = css;
    ui.appendChild(node);
    return node;
  }

  var heading = add('h2', payload.label || payload.rule || 'Accessibility finding', 'margin:0 64px 8px 0;font-size:1.05rem;line-height:1.3;');
  heading.id = 'vital-inspect-title';
  ui.setAttribute('aria-labelledby', heading.id);
  add('p', 'Rule: ' + (payload.rule || 'unknown') + (payload.w ? ' · WCAG ' + payload.w : ''), 'margin:0 0 8px;');
  add('p', 'Selector: ', 'margin:0 0 4px;font-weight:600;');
  var code = document.createElement('code');
  code.textContent = payload.s;
  code.style.cssText = 'display:block;white-space:pre-wrap;word-break:break-word;background:#f3f3f3;padding:6px;border-radius:3px;margin-bottom:10px;';
  ui.appendChild(code);

  if (!target) {
    add('p', 'Not found on this page. It may have moved, be hidden behind an interaction, or be inside an iframe or shadow root.', 'margin:0 0 10px;color:#b10e1e;font-weight:600;');
  } else {
    add('p', matches > 1 ? 'Selector matches ' + matches + ' elements; highlighting the first.' : 'Found on the live page.', 'margin:0 0 10px;font-weight:600;');
    var liveTag = target.localName;
    var liveRole = (target.getAttribute('role') || '').trim().toLowerCase().split(/\s+/)[0] || null;
    var nameAttr = { 'aria-label': 'aria-label', alt: 'alt', title: 'title', placeholder: 'placeholder' }[payload.ns];
    var liveName = nameAttr ? target.getAttribute(nameAttr) : null;
    var changed = [];
    if (payload.t && payload.t !== liveTag) changed.push('tag ' + payload.t + ' → ' + liveTag);
    if ((payload.r || null) !== liveRole) changed.push('role ' + (payload.r || 'none') + ' → ' + (liveRole || 'none'));
    if (nameAttr && payload.n != null && payload.n !== liveName) changed.push('name attribute changed');
    if (changed.length) add('p', 'The live element differs from the recorded evidence: ' + changed.join('; ') + '. Check that this is still the same occurrence.', 'margin:0 0 10px;color:#b10e1e;font-weight:600;');
  }

  if (payload.fix) {
    add('p', 'How to fix', 'margin:12px 0 4px;font-weight:700;');
    add('p', payload.fix, 'margin:0 0 10px;');
  }
  if (payload.h && /^https?:\/\//i.test(payload.h)) {
    var link = document.createElement('a');
    link.href = payload.h;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Rule documentation';
    link.style.cssText = 'color:#0b57d0;';
    ui.appendChild(link);
  }
  add('p', 'Runs locally in your browser. VITAL sends nothing; this overlay is not stored.', 'margin:12px 0 0;font-size:.85rem;color:#4a4a4a;');
  document.body.appendChild(ui);

  var box = null;
  var label = null;
  function place() {
    if (!target || !box) return;
    var r = target.getBoundingClientRect();
    box.style.left = Math.max(0, r.left - 3) + 'px';
    box.style.top = Math.max(0, r.top - 3) + 'px';
    box.style.width = Math.max(2, r.width + 6) + 'px';
    box.style.height = Math.max(2, r.height + 6) + 'px';
    if (label) {
      label.style.left = Math.max(0, r.left - 3) + 'px';
      label.style.top = Math.max(0, r.top - 27) + 'px';
    }
  }
  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(function () { scheduled = false; place(); });
  }
  function cleanup() {
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    document.removeEventListener('keydown', onKey);
    if (ui.parentNode) ui.remove();
    if (box && box.parentNode) box.remove();
    if (label && label.parentNode) label.remove();
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  }
  function onKey(event) { if (event.key === 'Escape') cleanup(); }
  close.addEventListener('click', cleanup);
  document.addEventListener('keydown', onKey);

  if (target) {
    box = document.createElement('div');
    box.id = 'vital-inspect-box';
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:3px solid #d4351c;box-shadow:0 0 0 2px #fff,0 0 0 5px #1b1b1b;border-radius:2px;';
    label = document.createElement('div');
    label.setAttribute('aria-hidden', 'true');
    label.textContent = payload.rule || 'VITAL';
    label.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:#1b1b1b;color:#fff;font:700 12px/1.4 system-ui,sans-serif;padding:2px 6px;border-radius:2px;';
    document.body.appendChild(box);
    document.body.appendChild(label);
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    place();
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
  }
  close.focus();
}
