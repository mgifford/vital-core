import { Audit } from '@siteimprove/alfa-test-utils';
import { Playwright } from '@siteimprove/alfa-playwright';

const MAX_EXAMPLES = 3;
const MAX_SNIPPET = 200;

// Alfa serializes the document through Playwright. On very large documents
// (for example a long MMWR table page) that can exhaust the Node heap instead
// of returning a result. Skip the engine explicitly; never report the page as
// clean. These bounds are intentionally generous for ordinary government pages.
export const ALFA_MAX_ELEMENTS = 20000;
export const ALFA_MAX_TEXT_LENGTH = 1_000_000;

// Alfa reports each outcome's target as a serialized node description (tag,
// attributes, text), not a CSS selector or DOM path. It therefore cannot be
// located in the live document honestly, so element evidence is recorded as
// explicitly unavailable rather than guessed at a look-alike element.
const ELEMENT_EVIDENCE = Object.freeze({
  status: 'unavailable',
  reason: 'alfa-target-is-a-serialized-node-description-not-a-selector',
});

/**
 * Run Siteimprove's Alfa engine against a snapshot of the live page.
 * Alfa is the open source core of Siteimprove's commercial checker,
 * which is exactly why it is here: same rules lineage, open license.
 *
 * Output mirrors the axe adapter: per-rule failed counts plus capped
 * examples, and a cantTell count (Alfa is explicit about uncertainty,
 * which is one of its strengths).
 */
export async function runAlfa(page) {
  const size = await page.evaluate(() => ({
    elements: document.querySelectorAll('*').length,
    textLength: (document.body?.innerText || '').length,
  })).catch(() => null);
  if (size && (size.elements > ALFA_MAX_ELEMENTS || size.textLength > ALFA_MAX_TEXT_LENGTH)) {
    console.warn(`[alfa] skipped: page too large (${size.elements} elements, ${size.textLength} text chars)`);
    return {
      engine: 'alfa',
      version: null,
      skipped: true,
      skippedReason: 'page-too-large',
      pageSize: size,
      failedCount: 0,
      failed: {},
      cantTellCount: 0,
      passedRules: 0,
      element_evidence: { ...ELEMENT_EVIDENCE },
    };
  }

  // Playwright JSHandle to the page's document. It MUST be disposed:
  // an undisposed handle pins both the Node-side wrapper and the
  // browser-side DOM, and across a few hundred large government pages
  // that leak grows until the run runs out of heap (OOM).
  const documentHandle = await page.evaluateHandle(() => window.document);
  try {
    const alfaPage = await Playwright.toPage(documentHandle);
    const audit = await Audit.run(alfaPage);

    const failed = {};
    let failedCount = 0;
    let cantTellCount = 0;
    let passedRules = 0;

    for (const [ruleUrl, agg] of audit.resultAggregates) {
      const ruleId = ruleUrl.split('/').pop(); // e.g. sia-r2
      if (agg.failed > 0) {
        failedCount += agg.failed;
        failed[ruleId] = { count: agg.failed, ruleUrl, examples: [] };
      }
      cantTellCount += agg.cantTell;
      if (agg.passed > 0 && agg.failed === 0) passedRules++;
    }

    // Attach capped examples for failed rules.
    for (const [ruleUrl, outcomes] of audit.outcomes) {
      const ruleId = ruleUrl.split('/').pop();
      if (!failed[ruleId]) continue;
      for (const o of outcomes) {
        if (failed[ruleId].examples.length >= MAX_EXAMPLES) break;
        const oj = o.toJSON();
        if (oj.outcome !== 'failed') continue;
        failed[ruleId].examples.push({
          target: describeTarget(oj.target).slice(0, MAX_SNIPPET),
        });
      }
    }

    return {
      engine: 'alfa',
      version: audit.alfaVersion ?? null,
      failedCount,
      failed,
      cantTellCount,
      passedRules,
      element_evidence: { ...ELEMENT_EVIDENCE },
    };
  } finally {
    await documentHandle.dispose().catch(() => {});
  }
}

function describeTarget(target) {
  if (!target) return '';
  if (target.type === 'element') {
    const attrs = (target.attributes ?? [])
      .slice(0, 4)
      .map((a) => `${a.name}="${a.value}"`)
      .join(' ');
    return `<${target.name}${attrs ? ' ' + attrs : ''}>`;
  }
  if (target.type === 'text') return `text: "${target.data}"`;
  if (target.type === 'attribute') return `@${target.name}="${target.value}"`;
  return JSON.stringify(target).slice(0, 80);
}
