/**
 * a11y/pattern/v1 and a11y/occurrence/v1 fingerprint computation.
 *
 * This is a dual-write alongside vital-core's existing pattern_id /
 * instance_id (see computePatternId-equivalent logic in bug-report.js).
 * It does NOT change, replace, or migrate those — they stay exactly as
 * they are, including their cross-domain identity, which
 * mergeFleetPatterns()/rankFleetPatterns() (src/lib/priority.js) depend on
 * to find the same rule failing on multiple government sites (see
 * kitty-specs/cross-domain-pattern-analysis-01KXKV69/spec.md, which lists
 * "Changing pattern_id computation itself... stays as-is" as an explicit
 * constraint).
 *
 * The new fingerprints here are scoped to the SCANNED SITE's own origin
 * (target.domain), per the frozen, versioned profiles defined at
 * https://mgifford.github.io/ACCESSIBILITY.md/examples/fingerprints/README.html
 * (canonical source: mgifford/ACCESSIBILITY.md, examples/fingerprints/).
 * They exist for cross-project correlation with drupal-core and
 * open-scans, which dual-write the same profiles — not to replace
 * vital-core's own cross-domain pattern grouping, which is a different,
 * intentional, and still-needed concept (see
 * examples/ACCESSIBILITY_FINDING_TRACKING.md's distinction between a
 * "pattern" scoped to one target and a heuristic "cluster" grouped across
 * targets).
 *
 * Stability: a11y/pattern/v1 and a11y/occurrence/v1 are stable, versioned
 * profiles. Do not change canonicalizeForFingerprint(), computeFingerprint(),
 * or the display-ID format here in a way that could change an
 * already-emitted fingerprint.
 */

import { createHash } from 'node:crypto';

/**
 * Minimal RFC 8785 (JSON Canonicalization Scheme) implementation for the
 * plain, finite, string/number/boolean/null/array/object values this module
 * ever passes to it. Mirrors the `canonicalize` npm package used by the
 * canonical ACCESSIBILITY.md checker: object keys sorted with the default
 * string sort, primitives serialized with JSON.stringify, no inserted
 * whitespace.
 */
function canonicalizeForFingerprint(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('fingerprint-core: NaN/Infinity is not a valid fingerprint input value');
  }

  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalizeForFingerprint(item === undefined ? null : item));
    return `[${items.join(',')}]`;
  }

  const parts = [];
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalizeForFingerprint(value[key])}`);
  }
  return `{${parts.join(',')}}`;
}

function sha256Hex(utf8String) {
  return createHash('sha256').update(utf8String, 'utf8').digest('hex');
}

/**
 * Computes the full authoritative fingerprint for a given profile name and
 * input object: lowercase-hex(SHA-256(UTF-8(JCS-canonicalize(input-with-profile-field)))).
 *
 * @param {string} profileName - e.g. "a11y/pattern/v1" or "a11y/occurrence/v1"
 * @param {object} input - the profile's input contract fields (without `profile`)
 * @returns {string} 64-character lowercase hex digest
 */
export function computeFingerprint(profileName, input) {
  const withProfile = { ...input, profile: profileName };
  return sha256Hex(canonicalizeForFingerprint(withProfile));
}

/**
 * Derives a short, non-authoritative display ID from a full fingerprint.
 *
 * @param {'A11Y-PAT'|'A11Y-OCC'} prefix
 * @param {string} fullDigestHex - 64-character lowercase hex digest
 * @returns {string} e.g. "A11Y-PAT-57869BAE817F"
 */
export function displayId(prefix, fullDigestHex) {
  return `${prefix}-${fullDigestHex.slice(0, 12).toUpperCase()}`;
}

/**
 * Computes the a11y/pattern/v1 fingerprint and display ID for a vital-core
 * finding, scoped to the scanned domain.
 *
 * @param {string} domain - the scanned site's domain, e.g. "nih.gov"
 * @param {string} engineKey - the stable engine key, e.g. "axe-core", "alfa", "deprecated-html"
 * @param {string} ruleId - the engine's own rule identifier (not a WCAG SC)
 * @param {string} normalizedLocator - normalized DOM target/selector for this rule
 * @returns {{ fingerprint: string, displayId: string, input: object }}
 */
export function computeA11yPatternFingerprint(domain, engineKey, ruleId, normalizedLocator) {
  const input = {
    target: { scope_type: 'site-origin', scope_id: `https://${domain}` },
    rule: { namespace: engineKey, id: ruleId },
    locator: {
      type: 'unknown',
      normalization_profile: 'a11y/css-locator/v1',
      value: normalizedLocator ?? '',
    },
    state_key: null,
  };
  const fingerprint = computeFingerprint('a11y/pattern/v1', input);
  return { fingerprint, displayId: displayId('A11Y-PAT', fingerprint), input };
}

/**
 * Computes the a11y/occurrence/v1 fingerprint and display ID for one
 * observed location of a pattern.
 *
 * @param {string} patternFingerprint - full 64-hex a11y/pattern/v1 value
 * @param {string} url - the concrete affected page URL
 * @returns {{ fingerprint: string, displayId: string, input: object }}
 */
export function computeA11yOccurrenceFingerprint(patternFingerprint, url) {
  const input = {
    pattern_fingerprint: {
      profile: 'a11y/pattern/v1',
      algorithm: 'sha-256',
      value: patternFingerprint,
    },
    location: {
      scope: 'exact-resource',
      normalization_profile: 'a11y/exact-resource/v1',
      key: url ?? '',
    },
    test_profile: null,
  };
  const fingerprint = computeFingerprint('a11y/occurrence/v1', input);
  return { fingerprint, displayId: displayId('A11Y-OCC', fingerprint), input };
}
