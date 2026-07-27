#!/usr/bin/env node
// Regenerates src/data/alfa-wcag-rules.json from the installed
// @siteimprove/alfa-rules package's own requirements[] declarations
// (Criterion.of(...) entries), rather than hand-maintained guesses.
//
// Run this whenever @siteimprove/alfa-rules is upgraded:
//   node scripts/generate-alfa-wcag-rules.mjs
//
// It preserves every WCAG SC key already present in the current file (even
// when the installed package now declares zero rules for it, so the gap
// stays documented rather than silently disappearing) and adds any new SC
// the package declares. It does NOT preserve hand-added rule ids that the
// package's own source no longer declares -- review the diff after running
// this, and re-apply any deliberate, documented exception (see the
// alfa-wcag-rules.json _comment for the one currently in place) by hand.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUTPUT_PATH = path.join(ROOT, 'src', 'data', 'alfa-wcag-rules.json');

function ruleIdFor(rule) {
  const uri = rule._uri ?? '';
  const m = /\/(sia-[a-z0-9]+)$/.exec(uri);
  return m ? m[1] : null;
}

function scSortKey(sc) {
  return sc
    .split('.')
    .map((n) => Number.parseInt(n, 10))
    .reduce((acc, n, i) => acc + n / 1000 ** i, 0);
}

async function main() {
  const alfa = await import('@siteimprove/alfa-rules');
  const active = alfa.Rules.toArray();
  const deprecated = Object.entries(alfa.deprecatedRules ?? {});
  const experimental = Object.entries(alfa.experimentalRules ?? {});
  const allRules = [...active, ...deprecated, ...experimental];

  const bySc = {};
  for (const [, rule] of allRules) {
    const id = ruleIdFor(rule);
    if (!id) continue;
    const num = id.replace(/^sia-r/, '');
    const reqs = rule._requirements ?? [];
    const criteria = (Array.isArray(reqs) ? reqs : (reqs.toArray?.() ?? []))
      .filter((r) => r.type === 'criterion')
      .map((r) => r.chapter);
    for (const sc of new Set(criteria)) {
      (bySc[sc] ??= new Set()).add(num);
    }
  }

  let existingRules = {};
  try {
    existingRules = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')).rules ?? {};
  } catch {
    // No existing file yet: start from an empty SC key set.
  }

  const allScKeys = new Set([...Object.keys(existingRules), ...Object.keys(bySc)]);
  const sortedScs = [...allScKeys].sort((a, b) => scSortKey(a) - scSortKey(b));

  const out = {
    _comment:
      "WCAG success criteria mapped to Siteimprove/Alfa sia-rN rule ids (bare numbers). Generated from @siteimprove/alfa-rules's own requirements[] Criterion.of(...) declarations via scripts/generate-alfa-wcag-rules.mjs -- the installed package is the ground truth, not hand-maintained guesses. Review the diff after regenerating: this script does not preserve hand-added rule ids the package's own source no longer declares, and any deliberate, documented exception (see git history) must be re-applied by hand.",
    rules: {},
  };
  for (const sc of sortedScs) {
    out.rules[sc] = bySc[sc] ? [...bySc[sc]].sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10)) : [];
  }

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Wrote ${sortedScs.length} SC keys to ${path.relative(ROOT, OUTPUT_PATH)}.`);
  console.log('Review the diff, then re-apply any documented exception noted in the previous _comment.');
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
