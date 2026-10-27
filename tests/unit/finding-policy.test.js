import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFindingPolicy, validateFindingPolicy, applyFindingPolicy } from '../../src/lib/finding-policy.js';
import { buildBugReports } from '../../src/lib/bug-report.js';

function bug(overrides = {}) {
  return {
    instance_id: 'VS-a1',
    pattern_id: 'VS-p1',
    engine_key: 'alfa',
    rule_id: 'sia-r113',
    wcag_sc: '2.5.8',
    wcag_level: 'AA',
    wcag_version: '2.2',
    wcag_category: 'WCAG 2.2 AA',
    url: 'https://www.example.gov/path',
    affected_pages: ['https://www.example.gov/path'],
    frequency: { pages_affected: 4, instances: 7, total_pages_scanned: 100 },
    ...overrides,
  };
}

test('policy defaults: WCAG A/AA => required+report', () => {
  const p = mergeFindingPolicy({}, {});
  const out = applyFindingPolicy(p, [bug()]);
  assert.equal(out.bugs[0].obligation, 'required');
  assert.equal(out.bugs[0].handling, 'report');
  assert.equal(out.bugs[0].included_in_primary_score, true);
});

test('policy defaults: AAA under an AA target => aspirational+report, non-blocking', () => {
  const p = mergeFindingPolicy({}, {});
  const out = applyFindingPolicy(p, [bug({ wcag_sc: '2.5.5', wcag_level: 'AAA', wcag_category: 'WCAG 2.x AAA', rule_id: 'sia-r111' })]);
  assert.equal(out.bugs[0].obligation, 'aspirational');
  assert.equal(out.bugs[0].handling, 'report');
  assert.equal(out.bugs[0].included_in_primary_score, false);
});

test('legal baseline: required findings split into legal (WCAG 2.0 A/AA) and target (2.1/2.2 A/AA)', () => {
  const p = mergeFindingPolicy({ conformance: { version: '2.2', level: 'AA', legal_baseline: { version: '2.0', level: 'AA' } } }, {});
  const out = applyFindingPolicy(p, [
    bug({ rule_id: 'list', engine_key: 'axe-core', wcag_sc: '1.3.1', wcag_level: 'A', wcag_version: '2.0', wcag_category: 'WCAG 2.0 A' }),
    bug({ rule_id: 'sia-r69', wcag_sc: '1.4.3', wcag_level: 'AA', wcag_version: '2.0', wcag_category: 'WCAG 2.0 AA' }),
    bug(), // sia-r113, 2.5.8, WCAG 2.2 AA
    bug({ rule_id: 'sia-r111', wcag_sc: '2.5.5', wcag_level: 'AAA', wcag_version: '2.1', wcag_category: 'WCAG 2.x AAA' }),
    bug({ rule_id: 'sia-r57', wcag_sc: null, wcag_level: null, wcag_version: null, wcag_category: 'Best Practice' }),
    bug({ rule_id: 'sia-r9999', wcag_sc: null, wcag_level: null, wcag_version: null, wcag_category: 'Undetermined' }),
  ]);
  assert.deepEqual(out.bugs.map((b) => b.conformance_tier), ['legal', 'legal', 'target', 'aspirational', 'advisory', 'unmapped']);
  // The baseline only changes the tier, never the obligation.
  assert.deepEqual(out.bugs.slice(0, 3).map((b) => b.obligation), ['required', 'required', 'required']);
});

test('legal baseline: absent => required findings keep a single required tier', () => {
  const out = applyFindingPolicy(mergeFindingPolicy({}, {}), [bug()]);
  assert.equal(out.bugs[0].conformance_tier, 'required');
});

test('legal baseline: an AAA criterion elevated to required counts as target, not legal', () => {
  const p = mergeFindingPolicy({
    conformance: { legal_baseline: { version: '2.0', level: 'AA' } },
    rules: [{ match: { wcag_sc: '1.4.6' }, obligation: 'required', handling: 'report' }],
  }, {});
  const out = applyFindingPolicy(p, [bug({ rule_id: 'sia-r66', wcag_sc: '1.4.6', wcag_level: 'AAA', wcag_version: '2.0', wcag_category: 'WCAG 2.x AAA' })]);
  assert.equal(out.bugs[0].obligation, 'required');
  assert.equal(out.bugs[0].conformance_tier, 'target');
});

test('legal baseline: validation rejects a malformed baseline or one above the target', () => {
  const bad = (legal_baseline, extra = {}) => validateFindingPolicy(mergeFindingPolicy({ conformance: { version: '2.1', level: 'AA', ...extra, legal_baseline } }, {})).errors;
  assert.deepEqual(bad({ version: '2.0', level: 'AA' }), []);
  assert.match(bad({ version: '2.2', level: 'AA' }).join('\n'), /legal_baseline\.version 2\.2 is above the conformance target 2\.1/);
  assert.match(bad({ version: '2.0', level: 'AAA' }).join('\n'), /legal_baseline\.level AAA is above the conformance target AA/);
  assert.match(bad({ version: 'two', level: 'AA' }).join('\n'), /legal_baseline\.version must look like/);
  assert.match(bad({ version: '2.0', level: 'B' }).join('\n'), /legal_baseline\.level must be A, AA, or AAA/);
});

test('policy defaults: an A/AA criterion newer than the target is advisory, not AAA', () => {
  const p = mergeFindingPolicy({ conformance: { version: '2.0', level: 'AA' } }, {});
  const out = applyFindingPolicy(p, [bug()]); // 2.5.8, WCAG 2.2 AA
  assert.equal(out.bugs[0].obligation, 'advisory');
  assert.equal(out.bugs[0].conformance_tier, 'advisory');
});

test('policy defaults: Alfa best-practice rule => advisory, not unmapped', () => {
  const p = mergeFindingPolicy({}, {});
  const out = applyFindingPolicy(p, [bug({ rule_id: 'sia-r57', wcag_sc: null, wcag_level: null, wcag_version: null, wcag_category: 'Best Practice' })]);
  assert.equal(out.bugs[0].obligation, 'advisory');
  assert.equal(out.bugs[0].included_in_primary_score, false);
});

test('policy override: a specific AAA criterion can be elevated to required', () => {
  const p = mergeFindingPolicy(
    {},
    {
      rules: [
        {
          match: { wcag_sc: '2.5.5' },
          obligation: 'required',
          handling: 'report',
          reason: 'local policy: target size elevated for touch-primary product',
        },
      ],
    }
  );
  const out = applyFindingPolicy(p, [bug({ wcag_sc: '2.5.5', wcag_level: 'AAA', wcag_category: 'WCAG 2.x AAA', rule_id: 'sia-r111' })]);
  assert.equal(out.bugs[0].obligation, 'required');
  assert.equal(out.bugs[0].included_in_primary_score, true);
});

test('policy override: not-applicable is only assignable via an explicit rule', () => {
  const p = mergeFindingPolicy(
    {},
    {
      rules: [
        {
          match: { engine: 'alfa', rule_id: 'sia-r113' },
          obligation: 'not-applicable',
          handling: 'suppress',
          reason: 'reviewed: component is not user-facing on this target',
          evidence: ['https://example.gov/review/2026-07-27'],
        },
      ],
    }
  );
  const out = applyFindingPolicy(p, [bug()]);
  assert.equal(out.bugs[0].obligation, 'not-applicable');
  assert.equal(out.bugs[0].handling, 'suppress');
  assert.equal(out.bugs[0].included_in_primary_score, false);
});

test('real pipeline integration: buildBugReports output defaults to required+review, not required+report', () => {
  // Every finding buildBugReports() produces comes straight from an
  // automated scan with no human review -- see the evidence_status
  // comment in bug-report.js. This proves the real pipeline, not just a
  // hand-written fixture, actually routes an unreviewed AA finding to
  // review rather than straight to report.
  const target = { domain: 'example.gov', key: 'example.gov' };
  const summary = {
    domain: 'example.gov', week: '2026-W24', pagesScanned: 10,
    axe: { rules: {
      'color-contrast': {
        count: 8, pages: 6, impact: 'serious', help: 'Elements must have sufficient color contrast',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.9/color-contrast', tags: ['wcag143', 'wcag2aa'],
        examplePages: ['https://example.gov/a'],
        instances: [{ url: 'https://example.gov/a', target: '.btn', html: '<a class="btn">Go</a>' }],
      },
    } },
    alfa: { rules: {} },
  };
  const rawBugs = buildBugReports(target, summary);
  const bug = rawBugs.find((b) => b.rule_id === 'color-contrast');
  assert.equal(bug.evidence_status, 'automated-indicator');

  const policy = mergeFindingPolicy({}, {});
  const { bugs } = applyFindingPolicy(policy, rawBugs);
  const classified = bugs.find((b) => b.rule_id === 'color-contrast');

  assert.equal(classified.obligation, 'required');
  assert.equal(classified.handling, 'review');
  assert.equal(classified.included_in_primary_score, false);
});

test('an explicit policy rule can still promote a specific rule to report despite evidence_status', () => {
  const p = mergeFindingPolicy(
    {},
    {
      rules: [
        {
          match: { engine: 'axe-core', rule_id: 'color-contrast' },
          obligation: 'required',
          handling: 'report',
          reason: 'axe color-contrast has near-zero false positives for this project; trusted without per-finding review',
        },
      ],
    }
  );
  const out = applyFindingPolicy(p, [bug({ engine_key: 'axe-core', rule_id: 'color-contrast', evidence_status: 'automated-indicator' })]);
  assert.equal(out.bugs[0].handling, 'report');
  assert.equal(out.bugs[0].included_in_primary_score, true);
});

test('non-blocking by default: only required+report counts toward the primary score', () => {
  const p = mergeFindingPolicy({}, {});
  const out = applyFindingPolicy(p, [
    bug({ wcag_sc: '2.5.5', wcag_level: 'AAA', wcag_category: 'WCAG 2.x AAA', rule_id: 'sia-r111' }), // aspirational
    bug({ engine_key: 'axe-core', rule_id: 'target-size', wcag_sc: null, wcag_level: null, wcag_version: null, wcag_category: 'Best Practice' }), // advisory
    bug({ rule_id: 'sia-r9999', wcag_sc: null, wcag_level: null, wcag_version: null, wcag_category: 'Undetermined' }), // unmapped -> review
  ]);
  for (const b of out.bugs) {
    assert.equal(b.included_in_primary_score, false, `${b.obligation}/${b.handling} must not count toward the primary score`);
  }
});

test('policy defaults: best-practice => advisory+report', () => {
  const p = mergeFindingPolicy({}, {});
  const out = applyFindingPolicy(p, [bug({ engine_key: 'axe-core', rule_id: 'target-size', wcag_sc: null, wcag_level: null, wcag_version: null, wcag_category: 'Best Practice' })]);
  assert.equal(out.bugs[0].obligation, 'advisory');
  assert.equal(out.bugs[0].handling, 'report');
});

test('policy defaults: unmapped => unmapped+review', () => {
  const p = mergeFindingPolicy({}, {});
  const out = applyFindingPolicy(p, [bug({ rule_id: 'sia-r9999', wcag_sc: null, wcag_level: null, wcag_version: null, wcag_category: 'Undetermined' })]);
  assert.equal(out.bugs[0].obligation, 'unmapped');
  assert.equal(out.bugs[0].handling, 'review');
});

test('policy override: engine+rule can force review while keeping required', () => {
  const p = mergeFindingPolicy(
    {},
    {
      rules: [
        {
          match: { engine: 'alfa', rule_id: 'sia-r113' },
          obligation: 'required',
          handling: 'review',
          reason: 'manual geometry check required',
        },
      ],
    }
  );
  const out = applyFindingPolicy(p, [bug()]);
  assert.equal(out.bugs[0].obligation, 'required');
  assert.equal(out.bugs[0].handling, 'review');
  assert.equal(out.bugs[0].included_in_primary_score, false);
});

test('policy precedence: engine+rule+url overrides engine+rule', () => {
  const p = mergeFindingPolicy(
    {},
    {
      rules: [
        {
          match: { engine: 'alfa', rule_id: 'sia-r113' },
          obligation: 'required',
          handling: 'review',
          reason: 'review globally',
        },
        {
          match: { engine: 'alfa', rule_id: 'sia-r113', url_patterns: ['/path'] },
          obligation: 'required',
          handling: 'suppress',
          reason: 'known non-reproducible subtree',
        },
      ],
    }
  );
  const out = applyFindingPolicy(p, [bug()]);
  assert.equal(out.bugs[0].handling, 'suppress');
  assert.equal(out.reportBugs.length, 0);
  assert.equal(out.suppressionSummary.patterns, 1);
});

test('policy validation rejects equal-specificity conflicts', () => {
  const p = mergeFindingPolicy({}, {
    rules: [
      { match: { engine: 'alfa', rule_id: 'sia-r113' }, obligation: 'required', handling: 'review', reason: 'a' },
      { match: { engine: 'alfa', rule_id: 'sia-r113' }, obligation: 'required', handling: 'report', reason: 'b' },
    ],
  });
  const result = validateFindingPolicy(p, { scope: 'test' });
  assert.equal(result.errors.some((e) => e.includes('conflicts')), true);
});

test('policy validation requires reason for suppress', () => {
  const p = mergeFindingPolicy({}, {
    rules: [
      { match: { engine: 'alfa', rule_id: 'sia-r113' }, obligation: 'required', handling: 'suppress' },
    ],
  });
  const result = validateFindingPolicy(p, { scope: 'test' });
  assert.equal(result.errors.some((e) => e.includes('no reason')), true);
});

test('policy validation rejects malformed regex patterns', () => {
  const p = mergeFindingPolicy({}, {
    rules: [
      { match: { engine: 'alfa', rule_id: 'sia-r113', url_patterns: ['/(/'] }, obligation: 'required', handling: 'review', reason: 'x' },
    ],
  });
  const result = validateFindingPolicy(p, { scope: 'test' });
  assert.equal(result.errors.some((e) => e.includes('malformed regular expression')), true);
});

test('policy validation warns for expired rule', () => {
  const p = mergeFindingPolicy({}, {
    rules: [
      { match: { engine: 'alfa', rule_id: 'sia-r113' }, obligation: 'required', handling: 'review', reason: 'x', expires: '2020-01-01' },
    ],
  });
  const result = validateFindingPolicy(p, { scope: 'test' });
  assert.equal(result.warnings.some((w) => w.includes('expired')), true);
});
