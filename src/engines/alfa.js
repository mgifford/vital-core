import { Audit } from '@siteimprove/alfa-test-utils';
import { Playwright } from '@siteimprove/alfa-playwright';

const MAX_EXAMPLES = 3;
const MAX_SNIPPET = 200;

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
  const documentHandle = await page.evaluateHandle(() => window.document);
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
  };
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
