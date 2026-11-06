/**
 * Deterministic reproduction of one accessibility finding.
 *
 * Three things are deliberately separate:
 *   1. the plan        — what would be replayed, and whether it can be;
 *   2. the test        — a standalone Playwright script a developer can run;
 *   3. the outcome     — what actually happened when it ran.
 *
 * Nothing here runs automatically during a scheduled scan. The report offers a
 * downloadable test; running it is an explicit action. Statuses are honest:
 * "not reproduced" never means "fixed", and a rule failing on some other
 * element is never counted as a reproduction.
 *
 * The module is self-contained where the browser reuses it: the Explorer
 * stringifies `reproductionPlan`, `executeReproduction` and
 * `playwrightTestFor` to generate the download client-side, so the server and
 * the report cannot drift.
 */

/** Outcomes a run can report. `not_attempted` and `unavailable` are plan states. */
export const REPRODUCTION_STATUSES = Object.freeze([
  'not_attempted',
  'unavailable',
  'test_generated',
  'reproduced',
  'not_reproduced',
  'locator_not_found',
  'ambiguous_locator',
  'interaction_state_unavailable',
  'page_unavailable',
  'timed_out',
  'rule_or_engine_changed',
  'inconclusive',
]);

/** Conventional exit codes for the generated script and the CLI. */
export const REPRODUCTION_EXIT_CODES = Object.freeze({
  reproduced: 0,
  not_reproduced: 1,
  locator_not_found: 2,
  ambiguous_locator: 3,
  interaction_state_unavailable: 4,
  page_unavailable: 4,
  timed_out: 4,
  rule_or_engine_changed: 5,
  inconclusive: 6,
  unavailable: 6,
});

export function isReplayableSelector(value) {
  if (typeof value !== 'string' || !value) return false;
  if (/^\s*text:/i.test(value) || /[<>]/.test(value)) return false;
  if (/\[\s*(?:value|data-|.*(?:token|secret|password|session))/i.test(value)) return false;
  return true;
}

/**
 * Build the replay plan for a finding. `status: "not_attempted"` means the
 * evidence is sufficient to replay; `unavailable` carries a reason and no
 * selector, so nothing is guessed.
 */
export function reproductionPlan(bug) {
  // In-function so the function can be stringified into the report page.
  const reasons = {
    noEvidence: 'element-evidence-unavailable',
    notFoundAtScan: 'element-not-found-at-scan',
    badSelector: 'selector-not-replayable',
    redactedUrl: 'url-redacted-for-publication',
    engine: 'only-axe-core-findings-can-be-replayed',
  };
  const element = bug?.element ?? null;
  const selector = bug?.selector ?? element?.selector ?? null;
  if (!element || element.available !== true) {
    return { status: 'unavailable', reason: element ? reasons.notFoundAtScan : reasons.noEvidence };
  }
  if (!isReplayableSelector(selector)) {
    return { status: 'unavailable', reason: reasons.badSelector };
  }
  if (bug.engine_key !== 'axe-core') {
    return { status: 'unavailable', reason: reasons.engine };
  }
  const url = typeof bug.url === 'string' ? bug.url : '';
  if (!url || url.includes('[REDACTED]')) {
    return { status: 'unavailable', reason: reasons.redactedUrl };
  }
  const context = {};
  const recorded = bug.browser_context ?? {};
  if (recorded.viewport?.width && recorded.viewport?.height) {
    context.viewport = { width: recorded.viewport.width, height: recorded.viewport.height };
  }
  if (recorded.color_scheme === 'light' || recorded.color_scheme === 'dark') context.colorScheme = recorded.color_scheme;
  if (recorded.reduced_motion === 'reduce' || recorded.reduced_motion === 'no-preference') context.reducedMotion = recorded.reduced_motion;
  if (recorded.forced_colors === 'active' || recorded.forced_colors === 'none') context.forcedColors = recorded.forced_colors;
  if (typeof recorded.locale === 'string' && recorded.locale) context.locale = recorded.locale;
  return {
    status: 'not_attempted',
    instance_id: bug.instance_id ?? null,
    pattern_id: bug.pattern_id ?? null,
    url,
    selector,
    locator: { strategy: 'css', value: selector },
    rule: { engine: 'axe-core', id: bug.rule_id ?? null, impact: bug.engine_severity ?? null },
    context,
    // A dialog may need interaction before the element exists; the runner then
    // reports interaction_state_unavailable instead of guessing a click.
    interaction_required: Boolean(bug.semantic_context?.in_dialog),
    steps: [],
  };
}

/**
 * Runs inside a Playwright page (also embedded in the generated script).
 * Document-level axe keeps page context; the specific element is checked by
 * identity, so a rule failing elsewhere is not reported as reproduced.
 */
export async function executeReproduction(page, axeSource, plan) {
  const result = {
    status: 'inconclusive',
    instance_id: plan?.instance_id ?? null,
    rule_id: plan?.rule?.id ?? null,
    selector: plan?.selector ?? null,
    url: plan?.url ?? null,
    matches: 0,
    detail: null,
  };
  let matches;
  try {
    matches = await page.locator(plan.selector).count();
  } catch (error) {
    result.status = 'locator_not_found';
    result.detail = 'invalid selector';
    return result;
  }
  result.matches = matches;
  if (matches === 0) {
    result.status = plan.interaction_required ? 'interaction_state_unavailable' : 'locator_not_found';
    result.detail = plan.interaction_required ? 'the element may need a dialog or interaction first' : null;
    return result;
  }
  if (matches > 1) {
    result.status = 'ambiguous_locator';
    result.detail = 'the recorded selector matches more than one element';
    return result;
  }

  await page.evaluate(axeSource);
  const outcome = await page.evaluate(async ({ selector, ruleId }) => {
    const target = document.querySelector(selector);
    if (!target) return { error: 'target-not-found' };
    let axeResult;
    try {
      axeResult = await window.axe.run(document, { runOnly: { type: 'rule', values: [ruleId] } });
    } catch (error) {
      return { error: String((error && error.message) || error) };
    }
    const violations = axeResult.violations || [];
    const nodeMatches = (node) => {
      const parts = Array.isArray(node.target) ? node.target : [String(node.target)];
      const last = parts[parts.length - 1];
      try {
        return document.querySelector(last) === target;
      } catch {
        return false;
      }
    };
    const hit = violations.some((violation) => (violation.nodes || []).some(nodeMatches));
    return {
      violation_ids: violations.map((violation) => violation.id),
      node_count: violations.reduce((total, violation) => total + (violation.nodes || []).length, 0),
      hit,
    };
  }, { selector: plan.selector, ruleId: plan.rule.id });

  if (outcome.error) {
    result.status = /unknown|not found|invalid/i.test(outcome.error) ? 'rule_or_engine_changed' : 'inconclusive';
    result.detail = outcome.error;
    return result;
  }
  if (outcome.hit) {
    result.status = 'reproduced';
    result.detail = 'the recorded rule still fails on the recorded element';
    return result;
  }
  result.status = 'not_reproduced';
  if (outcome.node_count > 0) {
    result.rule_fails_elsewhere = true;
    result.detail = 'the rule fails on other elements, not on the recorded one';
  } else {
    result.detail = 'the recorded rule no longer fails on this page';
  }
  return result;
}

/**
 * Standalone Playwright test for a plan. No arbitrary page JavaScript, no AI:
 * a fixed selector, one axe rule, element-identity verification, explicit exit
 * codes. Run it from a vital-core checkout so `playwright` and `axe-core`
 * resolve.
 */
export function playwrightTestFor(plan, { generatedAt = new Date().toISOString() } = {}) {
  if (!plan || plan.status === 'unavailable') {
    throw new Error(`Cannot generate a test for an unavailable plan${plan?.reason ? `: ${plan.reason}` : ''}`);
  }
  return `#!/usr/bin/env node
// Generated by vital-core, ${generatedAt}.
// Finding: ${plan.instance_id ?? '(unknown)'} (pattern ${plan.pattern_id ?? '(unknown)'})
// Rule: ${plan.rule.engine}:${plan.rule.id}
// This test replays recorded evidence only. Exit codes:
//   0 reproduced · 1 not reproduced · 2 locator not found · 3 ambiguous locator
//   4 page/interaction unavailable · 5 rule or engine changed · 6 inconclusive
// Run from a vital-core checkout: node <this-file>
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const AXE_SOURCE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const PLAN = ${JSON.stringify(plan, null, 2)};
const EXIT_CODES = ${JSON.stringify(REPRODUCTION_EXIT_CODES, null, 2)};

${executeReproduction.toString()}

const browser = await chromium.launch();
const context = await browser.newContext(PLAN.context || {});
const page = await context.newPage();
page.setDefaultNavigationTimeout(30000);
try {
  await page.goto(PLAN.url, { waitUntil: 'load' });
} catch (error) {
  console.log(JSON.stringify({ status: 'page_unavailable', detail: String((error && error.message) || error) }, null, 2));
  await browser.close();
  process.exit(EXIT_CODES.page_unavailable ?? 4);
}
const result = await executeReproduction(page, AXE_SOURCE, PLAN);
await browser.close();
console.log(JSON.stringify(result, null, 2));
process.exit(EXIT_CODES[result.status] ?? 6);
`;
}
