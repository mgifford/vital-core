// Cross-repo consistency check: this exact finding is also maintained in
// mgifford/ACCESSIBILITY.md (examples/shared-fixtures/) and
// mgifford/accessibility-skills. It must classify identically wherever
// obligation/handling/evidence_status are computed -- see
// tests/shared-fixtures/README.md and the canonical repo's
// examples/shared-fixtures/README.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mergeFindingPolicy, applyFindingPolicy } from '../../src/lib/finding-policy.js';
import { resolveWcag } from '../../src/lib/wcag.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(HERE, '..', 'shared-fixtures', 'color-contrast-unreviewed.json');

function loadFixture() {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

// Translates a schema_version 2.1 finding record's standards[]/test_results[]
// into the shape finding-policy.js's applyFindingPolicy() expects. This is
// deliberately a small, explicit mapping (not a shared library) so a
// mismatch between the two shapes fails a visible assertion here rather
// than being silently absorbed by a shared translation layer.
function bugFromFixture(fixture) {
  const standard = fixture.standards[0];
  const testResult = fixture.test_results[0];
  const wcag = resolveWcag('axe-core', { tags: [`wcag${standard.requirement.replace(/\./g, '')}`] });
  return {
    instance_id: 'VS-fixture1',
    pattern_id: 'VS-pfixture1',
    engine_key: testResult.tool_namespace,
    rule_id: testResult.rule,
    wcag_sc: standard.requirement,
    wcag_level: standard.level,
    wcag_version: standard.version,
    wcag_category: wcag ? `WCAG ${wcag.wcag_version} ${wcag.level}` : 'Undetermined',
    // The fixture's evidence_status ("automated-indicator") maps directly:
    // a fixture with test_results[0].review.status "needs-review" and no
    // human confirmation is exactly an unreviewed automated indicator.
    evidence_status: fixture.policy.evidence_status,
    url: fixture.location.safe_url,
    affected_pages: [fixture.location.safe_url],
    frequency: { pages_affected: 1, instances: 1, total_pages_scanned: 1 },
  };
}

test('shared fixture: color-contrast-unreviewed classifies as required+review, evidence_status automated-indicator', () => {
  const fixture = loadFixture();
  assert.equal(fixture.schema_version, '2.1');
  assert.equal(fixture.policy.evidence_status, 'automated-indicator');
  assert.equal(fixture.policy.handling, 'review');
  assert.equal(fixture.policy.standards_obligations[0].obligation, 'required');

  const bug = bugFromFixture(fixture);
  assert.equal(bug.wcag_sc, '1.4.3');
  assert.equal(bug.wcag_level, 'AA');

  const policy = mergeFindingPolicy({}, {});
  const { bugs } = applyFindingPolicy(policy, [bug]);

  // vital-core's finding-policy.js must independently arrive at the same
  // obligation/handling the canonical fixture declares for this finding.
  assert.equal(bugs[0].obligation, fixture.policy.standards_obligations[0].obligation);
  assert.equal(bugs[0].handling, fixture.policy.handling);
  assert.equal(bugs[0].included_in_primary_score, false, 'a "review" finding must never count toward the primary score by default');
});
