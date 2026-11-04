// Best-effort record of what a configured shared component looked like when
// the page was audited: present, visible, a dialog, and its button labels.
// Read-only: it never clicks, types, scrolls or removes anything, so the page
// is audited exactly as it was loaded. Matching mirrors shared-components.js
// (class names/prefixes, ids, attributes) on the element itself.

const MAX_ELEMENTS = 1000;
const MAX_LABELS = 6;
const MAX_LABEL = 30;

// Runs inside the page. Returns matches(el, def): true when the element itself carries a signature signal.
function matcherFactory() {
  const boundary = (token, prefix) => token.startsWith(prefix) && (token.length === prefix.length || /[^a-z0-9]$/i.test(prefix) || /[^a-z0-9]/i.test(token[prefix.length]));
  return function matches(el, def) {
    const classes = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    if (classes.some((token) => def.class_names.includes(token) || def.class_prefixes.some((prefix) => boundary(token, prefix)))) return true;
    const id = el.getAttribute('id') ?? '';
    if (id && (def.ids.includes(id) || def.id_prefixes.some((prefix) => boundary(id, prefix)))) return true;
    return def.attributes.some((attr) => {
      if (!el.hasAttribute(attr.name)) return false;
      const value = el.getAttribute(attr.name) ?? '';
      return (attr.value == null && attr.value_prefix == null) || attr.value === value || (attr.value_prefix != null && value.startsWith(attr.value_prefix));
    });
  };
}

function observe(matches, { defs, MAX_ELEMENTS, MAX_LABELS, MAX_LABEL }) {
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const dialogSelector = '[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog';
  const attributeNames = [...new Set(defs.flatMap((def) => def.attributes.map((attr) => attr.name)))];
  const selector = ['[class]', '[id]', ...attributeNames.map((name) => `[${CSS.escape(name)}]`)].join(',');
  const all = Array.from(document.querySelectorAll(selector));
  return defs.map((def) => {
    const found = [];
    for (const el of all) {
      if (matches(el, def)) found.push(el);
      if (found.length >= MAX_ELEMENTS) break;
    }
    const labels = [];
    for (const el of found) {
      const buttons = el.matches('button,[role="button"]') ? [el] : Array.from(el.querySelectorAll('button,[role="button"]'));
      for (const button of buttons) {
        if (!isVisible(button)) continue;
        const label = (button.innerText || button.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
        if (label && !labels.includes(label) && labels.length < MAX_LABELS) labels.push(label);
      }
    }
    return {
      id: def.id,
      present: found.length > 0,
      element_count: found.length,
      visible_count: found.filter(isVisible).length,
      dialog: found.some((el) => el.matches(dialogSelector) || el.closest(dialogSelector) !== null || el.querySelector(dialogSelector) !== null),
      button_labels: labels,
    };
  });
}

// For each target selector, the id of the first signature found on the element or an ancestor, else null.
function ownerOf(matches, { defs, targets }) {
  return targets.map((target) => {
    let el = null;
    try { el = document.querySelector(target); } catch { return null; }
    for (let node = el; node; node = node.parentElement) {
      const def = defs.find((candidate) => matches(node, candidate));
      if (def) return def.id;
    }
    return null;
  });
}

// Evaluated as source text (not a function) so a page's CSP cannot block it.
const inPage = (fn, args) => `(() => { const matches = (${matcherFactory.toString()})(); return (${fn.toString()})(matches, ${JSON.stringify(args)}); })()`;

function toDefs(signatures) {
  return signatures.map(({ id, class_names, class_prefixes, ids, id_prefixes, attributes }) => ({ id, class_names, class_prefixes, ids, id_prefixes, attributes }));
}

export async function runComponentObservation(page, signatures) {
  const components = await page.evaluate(inPage(observe, { defs: toDefs(signatures), MAX_ELEMENTS, MAX_LABELS, MAX_LABEL }));
  return { schema: 1, components };
}

/**
 * Adds `component` (a signature id) to axe examples whose element, or one of
 * its DOM ancestors, carries a signature signal. Only examples with a plain
 * CSS selector can be resolved; others are left unmarked.
 */
export async function annotateComponentExamples(page, signatures, axeRecord) {
  const violations = axeRecord?.violations;
  if (!violations || !signatures?.length) return;
  const slots = [];
  for (const [ruleId, violation] of Object.entries(violations)) {
    (violation.examples ?? []).forEach((example, index) => {
      if (typeof example.target === 'string' && example.target) slots.push({ ruleId, index, target: example.target });
    });
  }
  if (slots.length === 0) return;
  const owners = await page.evaluate(inPage(ownerOf, { defs: toDefs(signatures), targets: slots.map((slot) => slot.target) }));
  slots.forEach((slot, i) => {
    if (owners[i]) violations[slot.ruleId].examples[slot.index].component = owners[i];
  });
}
