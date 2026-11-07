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

/** Why a finding cannot be highlighted from the top-level document, if it cannot. */
export function inspectUnavailableReason(bug) {
  if (!bug) return 'no-finding';
  if (bug.element?.reason === 'frame-or-shadow-path') return 'frame-or-shadow-path';
  if (bug.element && bug.element.available !== true) return 'no-element-evidence';
  if (bug.element?.shadow === true) return 'shadow-root';
  if (bug.element?.iframe === true) return 'iframe';
  if (typeof bug.selector !== 'string' || !bug.selector.trim()) return 'no-selector';
  if (typeof bug.url !== 'string' || !/^https?:\/\//i.test(bug.url)) return 'no-live-url';
  return null;
}

/** Human-readable explanation for an unavailable live highlight. */
export function inspectUnavailableText(reason) {
  var messages = {
    'no-finding': 'No finding was supplied.',
    'no-element-evidence': 'No element evidence was captured for this finding.',
    'frame-or-shadow-path': 'The recorded element is inside a frame or shadow root, which this bookmarklet cannot reach from the top-level page.',
    'shadow-root': 'The recorded element is inside a shadow root, which this bookmarklet cannot reach.',
    'iframe': 'The recorded element is inside an iframe, which this bookmarklet cannot reach.',
    'no-selector': 'No replayable selector was recorded.',
    'no-live-url': 'No live page URL is available.',
  };
  return messages[reason] || 'Live highlighting is unavailable for this finding.';
}

/**
 * Build the compact inspection code (base64url JSON). It contains no full URL
 * and no page content: only the selector, recorded identity, rule/WCAG/fix and
 * the expected origin, so query parameters and personal data are not carried.
 */
export function inspectCodeFor(bug) {
  if (inspectUnavailableReason(bug)) return null;
  let origin;
  try { origin = new URL(bug.url).origin; } catch (error) { return null; }
  const payload = {
    v: 1,
    s: bug.selector.slice(0, 500),
    t: typeof bug.element?.tag === 'string' ? bug.element.tag.slice(0, 50) : null,
    r: typeof bug.element?.role === 'string' ? bug.element.role.slice(0, 50) : null,
    n: typeof bug.element?.name === 'string' ? bug.element.name.slice(0, 200) : null,
    ns: bug.element?.name_source ?? 'none',
    rule: typeof bug.rule_id === 'string' ? bug.rule_id.slice(0, 100) : null,
    label: String(bug.rule_label ?? bug.summary ?? '').slice(0, 200) || null,
    w: typeof bug.wcag_sc === 'string' ? bug.wcag_sc.slice(0, 20) : null,
    fix: String(bug.remediation_tip || bug.suggested_fix || '').slice(0, 400),
    h: /^https?:\/\//i.test(bug.rule_url ?? '') ? bug.rule_url.slice(0, 500) : null,
    org: origin,
    id: typeof bug.occurrence_id === 'string' ? bug.occurrence_id.slice(0, 100) : null,
  };
  const json = JSON.stringify(payload);
  const base64 = typeof Buffer !== 'undefined'
    ? Buffer.from(json, 'utf8').toString('base64')
    : btoa(unescape(encodeURIComponent(json)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Build the target URL with an inspection code in the fragment. This is the
 * one-click path. Callers should warn when the target already uses its hash
 * for routing; `inspectCodeFor` is the URL-free alternative.
 */
export function inspectUrlFor(bug) {
  const token = inspectCodeFor(bug);
  if (!token) return null;
  const url = new URL(bug.url);
  const existing = url.hash ? url.hash.slice(1) + '&' : '';
  url.hash = `${existing}vital-inspect=${token}`;
  return url.href;
}

/** Decode and size-check an inspection code. Throws a plain reason on failure. */
export function decodeInspectToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,8192}$/.test(token)) throw new Error('invalid inspection code encoding');
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
  let json;
  try {
    json = typeof Buffer !== 'undefined'
      ? Buffer.from(b64, 'base64').toString('utf8')
      : decodeURIComponent(escape(atob(b64)));
  } catch (error) {
    throw new Error('the inspection code could not be decoded');
  }
  if (json.length > 6000) throw new Error('the inspection code is too large');
  try { return JSON.parse(json); } catch (error) { throw new Error('the inspection code is not valid JSON'); }
}

/** Validate an inspection payload before it is used. Returns {ok} or {ok:false, reason}. */
export function validateInspectPayload(payload, pageHref) {
  const payloadKeys = ['v', 's', 't', 'r', 'n', 'ns', 'rule', 'label', 'w', 'fix', 'h', 'org', 'id'];
  const nameSources = ['aria-label', 'alt', 'title', 'placeholder', 'aria-labelledby', 'aria-labelledby-unresolved', 'none'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'inspection payload must be an object' };
  for (const key of Object.keys(payload)) {
    if (!payloadKeys.includes(key)) return { ok: false, reason: `unexpected inspection property: ${key}` };
  }
  if (payload.v !== 1) return { ok: false, reason: 'unsupported inspection payload version' };
  if (typeof payload.s !== 'string' || !payload.s.trim() || payload.s.length > 500) return { ok: false, reason: 'invalid selector in inspection payload' };
  if (/[\u0000-\u001f]/.test(payload.s)) return { ok: false, reason: 'invalid control character in selector' };
  if (typeof payload.org !== 'string' || !/^https?:\/\/[^/]+$/i.test(payload.org)) return { ok: false, reason: 'invalid origin in inspection payload' };
  try {
    if (new URL(payload.org).origin !== payload.org) return { ok: false, reason: 'inspection origin must be an origin only' };
    if (pageHref && new URL(pageHref).origin !== payload.org) return { ok: false, reason: 'this inspection code belongs to a different site origin' };
  } catch (error) {
    return { ok: false, reason: 'invalid page or inspection origin' };
  }
  const stringOrNull = (key, max) => {
    const value = payload[key];
    if (value == null) return true;
    if (typeof value !== 'string' || value.length > max) return false;
    return true;
  };
  if (!stringOrNull('t', 50) || !stringOrNull('r', 50) || !stringOrNull('n', 200) || !stringOrNull('rule', 100) || !stringOrNull('label', 200) || !stringOrNull('w', 20) || !stringOrNull('fix', 400) || !stringOrNull('h', 500) || !stringOrNull('id', 100)) {
    return { ok: false, reason: 'inspection payload field is too long or the wrong type' };
  }
  if (payload.ns != null && !nameSources.includes(payload.ns)) return { ok: false, reason: 'invalid name source in inspection payload' };
  if (payload.h != null && !/^https?:\/\//i.test(payload.h)) return { ok: false, reason: 'unsafe documentation URL in inspection payload' };
  return { ok: true };
}

/** A one-time bookmarklet; reads the payload from the current page's hash. *//** A one-time bookmarklet; reads a payload from the hash or a pasted code. */
export function inspectBookmarklet() {
  const inspect = vitalInspect.toString().replace(/\s+/g, ' ').trim();
  const validate = validateInspectPayload.toString().replace(/\s+/g, ' ').trim();
  return `javascript:(function(){var validate=${validate};(${inspect})(validate);})()`;
}

/**
 * Runs in the target page. Kept ES5-ish and self-contained so it can be
 * stringified into the bookmarklet. It creates a high-contrast outline and a
 * panel with the recorded rule/WCAG/selector/fix, checks that the selector
 * still points at the recorded kind of element, and removes itself on close.
 */
export function vitalInspect(validate) {
  var marker = 'vital-inspect=';
  var hash = window.location.hash || '';
  var start = hash.indexOf(marker);
  var token = start < 0 ? '' : hash.slice(start + marker.length).split('&')[0];
  if (!token) {
    token = (window.prompt('VITAL: paste the inspection code copied from the finding, or open a "Highlight on site" link first.') || '').trim();
    if (!token) return;
  }
  var payload;
  try {
    if (!/^[A-Za-z0-9_-]{1,8192}$/.test(token)) throw new Error('encoding');
    var b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    payload = JSON.parse(decodeURIComponent(escape(window.atob(b64))));
  } catch (error) {
    window.alert('VITAL: this inspection code is damaged or unsupported.');
    return;
  }
  var checked = typeof validate === 'function' ? validate(payload, window.location.href) : localValidate(payload);
  if (!checked.ok) {
    window.alert('VITAL: ' + checked.reason);
    return;
  }

  var old = document.getElementById('vital-inspect-ui');
  if (old) old.remove();
  var oldBox = document.getElementById('vital-inspect-box');
  if (oldBox) oldBox.remove();
  var previousFocus = document.activeElement;

  function localValidate(value) {
    if (!value || value.v !== 1) return { ok: false, reason: 'unsupported inspection payload version' };
    if (typeof value.s !== 'string' || !value.s.trim() || value.s.length > 500) return { ok: false, reason: 'invalid selector in inspection payload' };
    if (value.org !== window.location.origin) return { ok: false, reason: 'this inspection code belongs to a different site origin' };
    return { ok: true };
  }

  var matches = [];
  var index = 0;
  var target = null;
  var box = null;
  var label = null;
  var hidden = false;
  var scheduled = false;

  function liveRole(el) {
    var value = (el.getAttribute('role') || '').trim().toLowerCase().split(/\s+/)[0];
    return value || null;
  }
  function labelledByText(el) {
    var refs = (el.getAttribute('aria-labelledby') || '').trim();
    if (!refs) return '';
    return refs.split(/\s+/).map(function (id) {
      var node = document.getElementById(id);
      return node ? (node.textContent || '') : '';
    }).join(' ').replace(/\s+/g, ' ').trim();
  }
  function liveName(el, source) {
    if (source === 'aria-labelledby') return labelledByText(el);
    if (source === 'aria-label' || source === 'alt' || source === 'title' || source === 'placeholder') {
      return el.getAttribute(source);
    }
    return null;
  }
  function compare(el) {
    var differences = [];
    var tagKnown = typeof payload.t === 'string' && payload.t;
    var roleKnown = Object.prototype.hasOwnProperty.call(payload, 'r');
    var nameSource = payload.ns;
    var nameReliable = payload.n != null && ['aria-label', 'alt', 'title', 'placeholder', 'aria-labelledby'].indexOf(nameSource) >= 0;
    if (tagKnown && payload.t !== el.localName) differences.push('tag: recorded ' + payload.t + ', live ' + el.localName);
    var live = liveRole(el);
    if (roleKnown && (payload.r || null) !== live) differences.push('role: recorded ' + (payload.r || 'none') + ', live ' + (live || 'none'));
    var nameChecked = false;
    if (nameReliable) {
      var name = liveName(el, nameSource);
      if (name !== payload.n) differences.push((nameSource === 'aria-labelledby' ? 'accessible name from aria-labelledby' : nameSource) + ': recorded "' + payload.n + '", live "' + (name == null ? '' : name) + '"');
      else nameChecked = true;
    }
    if (differences.length) return { status: 'changed', differences: differences };
    if (!tagKnown || !roleKnown) return { status: 'candidate', reason: 'Recorded tag or role was not available, so identity cannot be confirmed.' };
    if (!nameChecked) return { status: 'candidate', reason: 'No reliable recorded name attribute is available to confirm this is the same element.' };
    return { status: 'matched' };
  }

  function evaluate() {
    target = matches[index] || null;
    if (!target) return { status: 'not_located' };
    var result = compare(target);
    if (matches.length > 1) {
      return { status: 'candidate', reason: matches.length + ' elements match the selector. Compare them before choosing.', comparison: result };
    }
    return result;
  }
  function collect() {
    matches = [];
    index = 0;
    try {
      var found = document.querySelectorAll(payload.s);
      for (var i = 0; i < found.length; i++) matches.push(found[i]);
    } catch (error) {
      matches = [];
    }
    return evaluate();
  }

  var ui = document.createElement('div');
  ui.id = 'vital-inspect-ui';
  ui.setAttribute('role', 'region');
  ui.setAttribute('aria-label', 'VITAL inspect');
  ui.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:min(460px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#1b1b1b;border:2px solid #1b1b1b;border-radius:6px;box-shadow:0 6px 28px rgba(0,0,0,.4);font:14px/1.45 system-ui,-apple-system,sans-serif;padding:16px 18px;';

  var close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.setAttribute('aria-label', 'Close VITAL inspect');
  close.style.cssText = 'position:absolute;top:10px;right:10px;font:inherit;font-weight:600;padding:4px 8px;border:2px solid #1b1b1b;border-radius:4px;background:#fff;color:#1b1b1b;cursor:pointer;';
  ui.appendChild(close);

  var heading = document.createElement('h2');
  heading.id = 'vital-inspect-title';
  heading.style.cssText = 'margin:0 64px 4px 0;font-size:1.05rem;line-height:1.3;';
  ui.setAttribute('aria-labelledby', heading.id);
  ui.appendChild(heading);

  var statusLine = document.createElement('p');
  statusLine.setAttribute('aria-live', 'polite');
  statusLine.style.cssText = 'margin:0 0 10px;font-weight:700;';
  ui.appendChild(statusLine);

  var details = document.createElement('div');
  ui.appendChild(details);

  var controls = document.createElement('div');
  controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;';
  ui.appendChild(controls);

  var previous = document.createElement('button');
  previous.type = 'button';
  previous.textContent = 'Previous candidate';
  var next = document.createElement('button');
  next.type = 'button';
  next.textContent = 'Next candidate';
  var findAgain = document.createElement('button');
  findAgain.type = 'button';
  findAgain.textContent = 'Find again';
  var toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = 'Hide highlight';
  var showChanged = document.createElement('button');
  showChanged.type = 'button';
  showChanged.textContent = 'Show changed element';
  [previous, next, findAgain, toggle, showChanged].forEach(function (button) {
    button.style.cssText = 'font:inherit;padding:4px 8px;border:1px solid #1b1b1b;border-radius:4px;background:#fff;color:#1b1b1b;cursor:pointer;';
    controls.appendChild(button);
  });

  function addDetail(tag, text, css) {
    var node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (css) node.style.cssText = css;
    details.appendChild(node);
    return node;
  }
  function addIdentity(title, values) {
    addDetail('p', title, 'margin:10px 0 2px;font-weight:700;');
    var list = document.createElement('ul');
    list.style.cssText = 'margin:0 0 0 1.1rem;padding:0;';
    values.forEach(function (value) {
      var item = document.createElement('li');
      item.textContent = value;
      list.appendChild(item);
    });
    details.appendChild(list);
  }

  function removeBox() {
    if (box && box.parentNode) box.remove();
    if (label && label.parentNode) label.remove();
    box = null;
    label = null;
  }
  function drawBox(kind, text) {
    removeBox();
    if (!target) return;
    var colors = kind === 'matched'
      ? 'border:3px solid #d4351c;box-shadow:0 0 0 2px #fff,0 0 0 5px #1b1b1b;'
      : kind === 'candidate'
        ? 'border:3px dashed #8a5a00;box-shadow:0 0 0 2px #fff,0 0 0 4px #1b1b1b;'
        : 'border:3px dashed #4a4a4a;box-shadow:0 0 0 2px #fff;';
    box = document.createElement('div');
    box.id = 'vital-inspect-box';
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border-radius:2px;' + colors;
    label = document.createElement('div');
    label.setAttribute('aria-hidden', 'true');
    label.textContent = text;
    label.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:#1b1b1b;color:#fff;font:700 12px/1.4 system-ui,sans-serif;padding:2px 6px;border-radius:2px;';
    document.body.appendChild(box);
    document.body.appendChild(label);
    hidden = false;
    toggle.textContent = 'Hide highlight';
    toggle.hidden = false;
    place();
  }
  function place() {
    if (!target || !box || hidden) return;
    var r = target.getBoundingClientRect();
    box.style.left = Math.max(0, r.left - 3) + 'px';
    box.style.top = Math.max(0, r.top - 3) + 'px';
    box.style.width = Math.max(2, r.width + 6) + 'px';
    box.style.height = Math.max(2, r.height + 6) + 'px';
    if (label) {
      label.style.left = Math.max(0, Math.min(window.innerWidth - 160, r.left - 3)) + 'px';
      label.style.top = Math.max(0, r.top - 27) + 'px';
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(function () { scheduled = false; place(); });
  }

  function render(result) {
    details.textContent = '';
    previous.hidden = matches.length < 2;
    next.hidden = matches.length < 2;
    previous.disabled = index === 0;
    next.disabled = index >= matches.length - 1;
    toggle.hidden = !box || result.status === 'changed';
    showChanged.hidden = result.status !== 'changed';
    if (result.status === 'matched') {
      heading.textContent = 'Recorded element located';
      statusLine.textContent = 'The selector and recorded identity agree. This does not re-test the accessibility violation.';
    } else if (result.status === 'candidate') {
      heading.textContent = 'Possible matching element. Verification required.';
      statusLine.textContent = (result.reason || 'Identity evidence is incomplete.') + (matches.length > 1 ? ' Candidate ' + (index + 1) + ' of ' + matches.length + '.' : '');
    } else if (result.status === 'changed') {
      heading.textContent = 'Recorded element changed';
      statusLine.textContent = 'The selector matches an element, but its recorded identity differs. It is not highlighted as the original occurrence.';
    } else {
      heading.textContent = 'Element not found';
      statusLine.textContent = 'No element on this page matches the recorded selector.';
    }
    addDetail('p', 'Rule: ' + (payload.rule || 'unknown') + (payload.w ? ' · WCAG ' + payload.w : ''), 'margin:10px 0 4px;');
    addDetail('p', 'Selector', 'margin:8px 0 2px;font-weight:700;');
    var code = document.createElement('code');
    code.textContent = payload.s;
    code.style.cssText = 'display:block;white-space:pre-wrap;word-break:break-word;background:#f3f3f3;padding:6px;border-radius:3px;';
    details.appendChild(code);
    if (target) {
      addIdentity('Recorded identity', [
        'Tag: ' + (payload.t || 'not recorded'),
        'Role: ' + (payload.r || 'none recorded'),
        'Name: ' + (payload.n || 'not recorded') + (payload.ns && payload.ns !== 'none' ? ' (' + payload.ns + ')' : ''),
      ]);
      addIdentity('Live identity', [
        'Tag: ' + target.localName,
        'Role: ' + (liveRole(target) || 'none'),
        'Name: ' + (liveName(target, payload.ns) || 'none'),
      ]);
    }
    if (result.differences && result.differences.length) {
      addDetail('p', 'Differences', 'margin:10px 0 2px;font-weight:700;');
      var ul = document.createElement('ul');
      ul.style.cssText = 'margin:0 0 0 1.1rem;padding:0;';
      result.differences.forEach(function (difference) {
        var li = document.createElement('li');
        li.textContent = difference;
        ul.appendChild(li);
      });
      details.appendChild(ul);
    }
    if (result.status === 'not_located') {
      addDetail('p', 'Possible causes: the element was removed, the locator changed, an interaction is required, content loads dynamically, it is inside a frame or shadow root, the page is in another state, or access is restricted.', 'margin:8px 0;');
      addDetail('p', 'Change the page state if needed, then choose Find again.', 'margin:0 0 8px;');
    }
    if (result.comparison && result.comparison.differences) {
      addDetail('p', 'This candidate also differs: ' + result.comparison.differences.join('; '), 'margin:8px 0;');
    }
    if (payload.fix) {
      addDetail('p', 'Historical remediation guidance (from the scan; not a fresh test)', 'margin:12px 0 4px;font-weight:700;');
      addDetail('p', payload.fix, 'margin:0 0 8px;');
    }
    if (payload.h && /^https?:\/\//.test(payload.h)) {
      var link = document.createElement('a');
      link.href = payload.h;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Rule documentation';
      link.style.cssText = 'color:#0b57d0;';
      details.appendChild(link);
    }
    addDetail('p', 'Runs locally in your browser. VITAL sends nothing; this overlay is not stored. A visible element is not proof the violation persists.', 'margin:12px 0 0;font-size:.85rem;color:#4a4a4a;');
    if (result.status === 'matched') drawBox('matched', 'Recorded element');
    else if (result.status === 'candidate') drawBox('candidate', 'Candidate ' + (index + 1) + ' of ' + matches.length + ' — verify');
    else if (result.status === 'changed') removeBox();
    else removeBox();
  }

  function run() {
    render(collect());
  }
  previous.addEventListener('click', function () { if (index > 0) { index--; render(evaluate()); } });
  next.addEventListener('click', function () { if (index < matches.length - 1) { index++; render(evaluate()); } });
  findAgain.addEventListener('click', function () { run(); });
  toggle.addEventListener('click', function () {
    hidden = !hidden;
    if (box) box.hidden = hidden;
    if (label) label.hidden = hidden;
    toggle.textContent = hidden ? 'Show highlight' : 'Hide highlight';
  });
  showChanged.addEventListener('click', function () {
    if (target) {
      drawBox('changed', 'Different element — not the recorded occurrence');
      showChanged.hidden = true;
      toggle.hidden = false;
    }
  });
  close.addEventListener('click', cleanup);
  function onKey(event) { if (event.key === 'Escape') cleanup(); }
  function cleanup() {
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    document.removeEventListener('keydown', onKey);
    removeBox();
    if (ui.parentNode) ui.remove();
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  }
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ui);
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  run();
  close.focus();
}
