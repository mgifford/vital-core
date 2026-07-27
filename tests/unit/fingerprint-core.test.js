import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFingerprint,
  displayId,
  computeA11yPatternFingerprint,
  computeA11yOccurrenceFingerprint,
} from '../../src/lib/fingerprint-core.js';

// ── a11y/pattern/v1 and a11y/occurrence/v1 (Stage 2 fingerprint profiles) ──
//
// These assert exact digests published as golden test vectors in the
// canonical mgifford/ACCESSIBILITY.md repository
// (examples/fingerprints/test-vectors.json, vectors PV-01, PV-09, OV-01).
// If these fail, either this module's canonicalization has drifted from
// the frozen a11y/pattern/v1 / a11y/occurrence/v1 profiles, or the
// canonical profiles themselves changed — in the latter case, do NOT
// update the expected values here without confirming a new profile
// version was published upstream (a "v1" profile is immutable).

test('computeFingerprint matches canonical a11y/pattern/v1 vector PV-01', () => {
  const input = {
    target: { scope_type: 'repository', scope_id: 'https://github.com/example/product' },
    rule: { namespace: 'axe-core', id: 'color-contrast' },
    locator: { type: 'css', normalization_profile: 'a11y/css-locator/v1', value: '#edit-submit' },
    state_key: null,
  };
  const digest = computeFingerprint('a11y/pattern/v1', input);
  assert.equal(digest, 'e7c842e0e569532a337ec96e057ffe58e6e6521a5307c97f16980fdf1e1f43ca');
});

test('computeFingerprint matches canonical a11y/pattern/v1 vector PV-09 (non-ASCII UTF-8)', () => {
  const input = {
    target: { scope_type: 'repository', scope_id: 'https://github.com/example/produkt-über' },
    rule: { namespace: 'axe-core', id: 'color-contrast' },
    locator: { type: 'css', normalization_profile: 'a11y/css-locator/v1', value: '#édit-submit' },
    state_key: null,
  };
  const digest = computeFingerprint('a11y/pattern/v1', input);
  assert.equal(digest, '6e7a6f85f51a12669bada9e647511e054ca801741b6f70fca3ad36c21c7199e3');
});

test('computeFingerprint matches canonical a11y/occurrence/v1 vector OV-01', () => {
  const input = {
    pattern_fingerprint: {
      profile: 'a11y/pattern/v1',
      algorithm: 'sha-256',
      value: 'e7c842e0e569532a337ec96e057ffe58e6e6521a5307c97f16980fdf1e1f43ca',
    },
    location: { scope: 'route-pattern', normalization_profile: 'a11y/route/v1', key: '/node/[nid]' },
    test_profile: null,
  };
  const digest = computeFingerprint('a11y/occurrence/v1', input);
  assert.equal(digest, 'bb20023fd9626160a1ef2ca8c4e97e2e5296eb21040d077ac3488c867f31a728');
});

test('displayId matches canonical worked example', () => {
  const id = displayId('A11Y-OCC', 'bb20023fd9626160a1ef2ca8c4e97e2e5296eb21040d077ac3488c867f31a728');
  assert.equal(id, 'A11Y-OCC-BB20023FD962');
});

// ── vital-core-specific wrappers ─────────────────────────────────────────

test('computeA11yPatternFingerprint scopes to the scanned domain (site-origin)', () => {
  const { fingerprint, input } = computeA11yPatternFingerprint('nih.gov', 'alfa', 'sia-r111', '#main');
  assert.equal(input.target.scope_type, 'site-origin');
  assert.equal(input.target.scope_id, 'https://nih.gov');
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
});

test('computeA11yPatternFingerprint differs across domains for the same engine+rule (unlike pattern_id, by design)', () => {
  // This is the exact behavior vital-core's own pattern_id (VS-hash(engine,
  // ruleId)) deliberately does NOT have — mergeFleetPatterns() needs
  // pattern_id identical across domains to find shared template bugs. The
  // new fingerprint is for a different purpose (cross-project correlation
  // with drupal-core/open-scans, which need target scoping); it must not
  // be substituted for pattern_id anywhere in the fleet-pattern code path.
  const a = computeA11yPatternFingerprint('nih.gov', 'alfa', 'sia-r111', '#main');
  const b = computeA11yPatternFingerprint('www.cdc.gov', 'alfa', 'sia-r111', '#main');
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test('computeA11yPatternFingerprint is deterministic', () => {
  const a = computeA11yPatternFingerprint('nih.gov', 'axe-core', 'image-alt', 'img.logo');
  const b = computeA11yPatternFingerprint('nih.gov', 'axe-core', 'image-alt', 'img.logo');
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(a.displayId, b.displayId);
});

test('computeA11yOccurrenceFingerprint embeds the full pattern fingerprint, not a display ID', () => {
  const pattern = computeA11yPatternFingerprint('nih.gov', 'axe-core', 'image-alt', 'img.logo');
  const occurrence = computeA11yOccurrenceFingerprint(pattern.fingerprint, 'https://nih.gov/page-1');
  assert.equal(occurrence.input.pattern_fingerprint.value, pattern.fingerprint);
  assert.match(occurrence.input.pattern_fingerprint.value, /^[0-9a-f]{64}$/);
});

test('computeA11yOccurrenceFingerprint uses exact-resource scope for concrete URLs', () => {
  const pattern = computeA11yPatternFingerprint('nih.gov', 'axe-core', 'image-alt', 'img.logo');
  const occurrence = computeA11yOccurrenceFingerprint(pattern.fingerprint, 'https://nih.gov/page-1');
  assert.equal(occurrence.input.location.scope, 'exact-resource');
  assert.equal(occurrence.input.location.key, 'https://nih.gov/page-1');
});

test('computeA11yOccurrenceFingerprint differs across concrete URLs, same pattern', () => {
  const pattern = computeA11yPatternFingerprint('nih.gov', 'axe-core', 'image-alt', 'img.logo');
  const a = computeA11yOccurrenceFingerprint(pattern.fingerprint, 'https://nih.gov/page-1');
  const b = computeA11yOccurrenceFingerprint(pattern.fingerprint, 'https://nih.gov/page-2');
  assert.notEqual(a.fingerprint, b.fingerprint);
});
