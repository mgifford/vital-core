/**
 * Deprecated / obsolete HTML engine. A worked example of adding a new
 * rate-controlled scanner: it runs in-page like axe/alfa, returns a
 * compact per-rule record in the same shape (so aggregation, the
 * findings ledger, and reports pick it up for free), and is selected by
 * its weekly rate in config/targets.yml.
 *
 * It flags legacy elements and attributes that are obsolete in the HTML
 * standard or whose use signals aging markup worth monitoring — e.g.
 * <font>, <center>, <marquee>, presentational attributes. This is the
 * seed for a fuller "open-site-review"-style check
 * (https://github.com/mgifford/open-site-review).
 */

const MAX_EXAMPLES = 3;
const MAX_SNIPPET = 200;

// Each rule: a label and how to find offending nodes in the page.
// Kept as plain selectors so the whole check is one page.evaluate.
const RULES = {
  'font-element': { help: 'Obsolete <font> element (use CSS)', sel: 'font' },
  'center-element': { help: 'Obsolete <center> element (use CSS)', sel: 'center' },
  'marquee-element': { help: 'Obsolete <marquee> element', sel: 'marquee' },
  'blink-element': { help: 'Obsolete <blink> element', sel: 'blink' },
  'big-element': { help: 'Obsolete <big> element (use CSS)', sel: 'big' },
  'frame-element': { help: 'Obsolete <frame>/<frameset>', sel: 'frame, frameset' },
  'applet-element': { help: 'Obsolete <applet> element', sel: 'applet' },
  'presentational-attr': {
    help: 'Presentational attribute (use CSS)',
    sel: '[bgcolor], [align], [valign], [border]:not(img), [cellpadding], [cellspacing]',
  },
};

export async function runDeprecatedHtml(page) {
  const ruleDefs = Object.entries(RULES).map(([id, r]) => ({ id, help: r.help, sel: r.sel }));

  const found = await page.evaluate((defs) => {
    const out = {};
    for (const { id, help, sel } of defs) {
      let nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch {
        continue;
      }
      if (nodes.length === 0) continue;
      const examples = [];
      for (const n of nodes) {
        if (examples.length >= 3) break;
        examples.push({
          target: n.tagName.toLowerCase(),
          html: (n.outerHTML || '').slice(0, 200),
        });
      }
      out[id] = { id, help, count: nodes.length, examples };
    }
    return out;
  }, ruleDefs);

  const findings = {};
  let total = 0;
  for (const [id, f] of Object.entries(found)) {
    total += f.count;
    findings[id] = {
      count: f.count,
      help: f.help,
      examples: f.examples.slice(0, MAX_EXAMPLES).map((e) => ({
        target: e.target,
        html: (e.html ?? '').slice(0, MAX_SNIPPET),
      })),
    };
  }

  return {
    engine: 'deprecated-html',
    findingCount: total,
    findings,
  };
}
