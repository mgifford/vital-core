import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AXE_SOURCE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const MAX_EXAMPLES = 3;
const MAX_SNIPPET = 200;
const MAX_TARGET_PATH = 4;

/**
 * Run axe-core in the page and reduce the result to a compact,
 * comparison-friendly record. Full node lists are NOT stored: the
 * stable week-over-week signals are rule ids, counts, and pages
 * affected. A few capped examples are kept for triage.
 *
 * `target` stays the joined string every existing report/API consumer reads.
 * `target_path` is added only when axe reports a frame/shadow path (more than
 * one selector): such a path is not a CSS selector for the top document, and
 * element-evidence.js must not resolve it against the wrong node.
 */
export async function runAxe(page) {
  await page.evaluate(AXE_SOURCE);
  const raw = await page.evaluate(async () => {
    return await window.axe.run(document, {
      resultTypes: ['violations', 'incomplete'],
      reporter: 'v2',
    });
  });

  const violations = {};
  let violationCount = 0;
  for (const v of raw.violations) {
    violationCount += v.nodes.length;
    violations[v.id] = {
      count: v.nodes.length,
      impact: v.impact ?? 'unknown',
      help: v.help,
      helpUrl: v.helpUrl,
      tags: v.tags.filter((t) => /^wcag/.test(t) || t === 'best-practice'),
      examples_truncated: v.nodes.length > MAX_EXAMPLES,
      examples: v.nodes.slice(0, MAX_EXAMPLES).map((n) => ({
        target: Array.isArray(n.target) ? n.target.join(' ') : String(n.target),
        html: (n.html ?? '').slice(0, MAX_SNIPPET),
        ...(Array.isArray(n.target) && n.target.length > 1
          ? { target_path: n.target.slice(0, MAX_TARGET_PATH).map((part) => String(part).slice(0, MAX_SNIPPET)) }
          : {}),
      })),
    };
  }

  return {
    engine: 'axe-core',
    version: raw.testEngine?.version ?? null,
    violationCount,
    violations,
    incompleteCount: raw.incomplete?.reduce((s, i) => s + i.nodes.length, 0) ?? 0,
  };
}
