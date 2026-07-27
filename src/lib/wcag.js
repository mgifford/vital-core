import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './config.js';

/**
 * Map scanner output to WCAG Success Criteria and a severity, following
 * the bug-reporting best-practices guide
 * (ACCESSIBILITY_BUG_REPORTING_BEST_PRACTICES). Everything here is
 * derived from what the engines actually report — axe tags and Alfa rule
 * ids — so it stays truthful. Where a mapping is unknown we say so
 * rather than guess.
 */

// WCAG 2.x success criteria: number -> [name, level, wcag_version].
//
// wcag_version is the WCAG spec version that introduced the criterion:
//   '2.0' — original WCAG 2.0 (2008)
//   '2.1' — added in WCAG 2.1 (2018): 1.3.4, 1.3.5, 1.4.10–1.4.13,
//            2.1.4, 2.5.1–2.5.4
//   '2.2' — added in WCAG 2.2 (2023): 2.4.11, 2.4.12, 2.4.13, 2.5.7,
//            2.5.8, 3.2.6, 3.3.7, 3.3.8, 3.3.9 (also removes 4.1.1)
//
// This lets the UI and CSV filter to "WCAG 2.2 AA" (the most common
// compliance target) without showing 2.1-only or 2.0-only criteria unless
// requested.
const WCAG_CRITERIA = {
  // --- WCAG 2.0 ---
  '1.1.1': ['Non-text Content', 'A', '2.0'],
  '1.2.1': ['Audio-only and Video-only (Prerecorded)', 'A', '2.0'],
  '1.2.2': ['Captions (Prerecorded)', 'A', '2.0'],
  '1.2.3': ['Audio Description or Media Alternative (Prerecorded)', 'A', '2.0'],
  '1.2.4': ['Captions (Live)', 'AA', '2.0'],
  '1.2.5': ['Audio Description (Prerecorded)', 'AA', '2.0'],
  '1.2.8': ['Media Alternative (Prerecorded)', 'AAA', '2.0'],
  '1.3.1': ['Info and Relationships', 'A', '2.0'],
  '1.3.2': ['Meaningful Sequence', 'A', '2.0'],
  '1.3.3': ['Sensory Characteristics', 'A', '2.0'],
  '1.4.1': ['Use of Color', 'A', '2.0'],
  '1.4.2': ['Audio Control', 'A', '2.0'],
  '1.4.3': ['Contrast (Minimum)', 'AA', '2.0'],
  '1.4.4': ['Resize Text', 'AA', '2.0'],
  '1.4.5': ['Images of Text', 'AA', '2.0'],
  '1.4.6': ['Contrast (Enhanced)', 'AAA', '2.0'],
  '1.4.8': ['Visual Presentation', 'AAA', '2.0'],
  '2.1.1': ['Keyboard', 'A', '2.0'],
  '2.1.2': ['No Keyboard Trap', 'A', '2.0'],
  '2.1.3': ['Keyboard (No Exception)', 'AAA', '2.0'],
  '2.2.1': ['Timing Adjustable', 'A', '2.0'],
  '2.2.2': ['Pause, Stop, Hide', 'A', '2.0'],
  '2.2.4': ['Interruptions', 'AAA', '2.0'],
  '2.3.1': ['Three Flashes or Below Threshold', 'A', '2.0'],
  '2.4.1': ['Bypass Blocks', 'A', '2.0'],
  '2.4.2': ['Page Titled', 'A', '2.0'],
  '2.4.3': ['Focus Order', 'A', '2.0'],
  '2.4.4': ['Link Purpose (In Context)', 'A', '2.0'],
  '2.4.5': ['Multiple Ways', 'AA', '2.0'],
  '2.4.6': ['Headings and Labels', 'AA', '2.0'],
  '2.4.7': ['Focus Visible', 'AA', '2.0'],
  '2.4.9': ['Link Purpose (Link Only)', 'AAA', '2.0'],
  '3.1.1': ['Language of Page', 'A', '2.0'],
  '3.1.2': ['Language of Parts', 'AA', '2.0'],
  '3.2.1': ['On Focus', 'A', '2.0'],
  '3.2.2': ['On Input', 'A', '2.0'],
  '3.2.3': ['Consistent Navigation', 'AA', '2.0'],
  '3.2.4': ['Consistent Identification', 'AA', '2.0'],
  '3.2.5': ['Change on Request', 'AAA', '2.0'],
  '3.3.1': ['Error Identification', 'A', '2.0'],
  '3.3.2': ['Labels or Instructions', 'A', '2.0'],
  '3.3.3': ['Error Suggestion', 'AA', '2.0'],
  '3.3.4': ['Error Prevention (Legal, Financial, Data)', 'AA', '2.0'],
  '4.1.1': ['Parsing', 'A', '2.0'],  // deprecated in WCAG 2.2 but engines may still report it
  '4.1.2': ['Name, Role, Value', 'A', '2.0'],
  '4.1.3': ['Status Messages', 'AA', '2.1'],
  // --- WCAG 2.1 additions ---
  '1.3.4': ['Orientation', 'AA', '2.1'],
  '1.3.5': ['Identify Input Purpose', 'AA', '2.1'],
  '1.4.10': ['Reflow', 'AA', '2.1'],
  '1.4.11': ['Non-text Contrast', 'AA', '2.1'],
  '1.4.12': ['Text Spacing', 'AA', '2.1'],
  '1.4.13': ['Content on Hover or Focus', 'AA', '2.1'],
  '2.1.4': ['Character Key Shortcuts', 'A', '2.1'],
  '2.5.1': ['Pointer Gestures', 'A', '2.1'],
  '2.5.2': ['Pointer Cancellation', 'A', '2.1'],
  '2.5.3': ['Label in Name', 'A', '2.1'],
  '2.5.4': ['Motion Actuation', 'A', '2.1'],
  '2.5.5': ['Target Size (Enhanced)', 'AAA', '2.1'],
  // --- WCAG 2.2 additions ---
  '2.4.11': ['Focus Not Obscured (Minimum)', 'AA', '2.2'],
  '2.4.12': ['Focus Not Obscured (Enhanced)', 'AAA', '2.2'],
  '2.4.13': ['Focus Appearance', 'AAA', '2.2'],
  '2.5.7': ['Dragging Movements', 'AA', '2.2'],
  '2.5.8': ['Target Size (Minimum)', 'AA', '2.2'],
  '3.2.6': ['Consistent Help', 'A', '2.2'],
  '3.3.7': ['Redundant Entry', 'A', '2.2'],
  '3.3.8': ['Accessible Authentication (Minimum)', 'AA', '2.2'],
  '3.3.9': ['Accessible Authentication (Enhanced)', 'AAA', '2.2'],
};

/**
 * Pull a WCAG SC number out of an axe tag like "wcag412" or "wcag2aa".
 * Only the numeric "wcagNNN" tags carry a criterion; level tags
 * ("wcag2a", "wcag21aa") and "best-practice" do not.
 */
function scFromAxeTag(tag) {
  const m = /^wcag(\d)(\d)(\d+)$/.exec(tag);
  if (!m) return null;
  return `${m[1]}.${m[2]}.${m[3]}`;
}

/**
 * Curated Alfa metadata corrections where historical mappings drifted or where
 * a rule intentionally isn't a direct conformance criterion.
 *
 * Verified 2026-07-27 against @siteimprove/alfa-rules 0.117.0's own
 * requirements[] declarations (see scripts/generate-alfa-wcag-rules.mjs,
 * which regenerates src/data/alfa-wcag-rules.json from the same source).
 * Two prior overrides were factually wrong and have been corrected:
 *   - sia-r50 (autoplaying audio duration) DOES declare Criterion.of("1.4.2")
 *     in its own source; it is not a notRequiredForConformance rule and is
 *     removed from this table so it falls through to the regenerated
 *     alfa-wcag-rules.json mapping instead.
 *   - sia-r54 (assertive live region atomicity) declares NO WCAG criterion
 *     at all in its own source (no `requirements` field); the prior
 *     ['3.3.1', '4.1.3'] mapping was unsupported and has been removed.
 * sia-r70 (deprecated HTML elements) was re-verified and is correctly
 * notRequiredForConformance: its own source declares only
 * BestPractice.of("no-deprecated-elements"), no WCAG criterion.
 */
const ALFA_RULE_METADATA_OVERRIDES = {
  'sia-r66': {
    wcagScs: ['1.4.6'],
  },
  'sia-r70': {
    wcagScs: [],
    notRequiredForConformance: true,
  },
  'sia-r111': {
    wcagScs: ['2.5.5'],
  },
  'sia-r113': {
    wcagScs: ['2.5.8'],
  },
};

let alfaRuleToSc = null;

function parseSc(sc) {
  return String(sc)
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
}

function compareSc(a, b) {
  const aa = parseSc(a);
  const bb = parseSc(b);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const d = (aa[i] ?? 0) - (bb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function normalizeAlfaRuleId(id) {
  const s = String(id ?? '').trim().toLowerCase();
  if (!s) return '';
  if (s.startsWith('sia-r')) return s;
  return `sia-r${s}`;
}

function loadAlfaRuleToSc() {
  if (alfaRuleToSc) return alfaRuleToSc;
  const byRule = {};
  const p = path.join(DIRS.root, 'src', 'data', 'alfa-wcag-rules.json');
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const [sc, ids] of Object.entries(raw.rules ?? {})) {
      for (const id of ids ?? []) {
        const ruleId = normalizeAlfaRuleId(id);
        if (!ruleId) continue;
        const arr = (byRule[ruleId] ??= []);
        if (!arr.includes(sc)) arr.push(sc);
      }
    }
    for (const arr of Object.values(byRule)) {
      arr.sort(compareSc);
    }
  } catch {
    // Optional dataset: if missing, we fall back to curated constants.
  }
  alfaRuleToSc = byRule;
  return alfaRuleToSc;
}

function alfaScForRule(ruleId) {
  const normalized = normalizeAlfaRuleId(ruleId);
  if (!normalized) return null;
  const override = ALFA_RULE_METADATA_OVERRIDES[normalized];
  if (override) return override.wcagScs;
  const mapped = loadAlfaRuleToSc()[normalized];
  if (Array.isArray(mapped) && mapped.length > 0) {
    return mapped;
  }
  return null;
}

export function alfaRuleMetadata(ruleId) {
  const normalized = normalizeAlfaRuleId(ruleId);
  if (!normalized) {
    return {
      ruleId: null,
      wcagScs: [],
      notRequiredForConformance: false,
    };
  }
  const override = ALFA_RULE_METADATA_OVERRIDES[normalized] ?? null;
  const wcagScs = override?.wcagScs ?? (loadAlfaRuleToSc()[normalized] ?? []);
  return {
    ruleId: normalized,
    wcagScs: Array.isArray(wcagScs) ? [...wcagScs] : [],
    notRequiredForConformance: !!override?.notRequiredForConformance,
  };
}

/**
 * Resolve a finding's WCAG criterion.
 *   engine: 'axe-core' | 'alfa'
 *   tags:   axe tags array (for axe)
 *   ruleId: rule id (sia-rN for alfa)
 * Returns { sc, name, level, wcag_version } or null when undetermined.
 */
export function resolveWcag(engine, { tags = [], ruleId } = {}) {
  let sc = null;
  let scs = null;
  if (engine === 'axe-core') {
    for (const t of tags) {
      const c = scFromAxeTag(t);
      if (c && WCAG_CRITERIA[c]) {
        sc = c;
        break;
      }
    }
  } else if (engine === 'alfa') {
    scs = alfaScForRule(ruleId);
    sc = Array.isArray(scs) && scs.length > 0 ? scs[0] : null;
  }
  if (!sc || !WCAG_CRITERIA[sc]) return null;
  const [name, level, wcag_version] = WCAG_CRITERIA[sc];
  const out = { sc, name, level, wcag_version };
  if (Array.isArray(scs) && scs.length > 1) out.scs = [...scs];
  return out;
}

/**
 * Classify a finding's relationship to WCAG requirements for filtering.
 * Returns one of:
 *   'WCAG 2.0 A'   — required in WCAG 2.0, Level A
 *   'WCAG 2.0 AA'  — required in WCAG 2.0, Level AA
 *   'WCAG 2.1 A'   — new in WCAG 2.1, Level A
 *   'WCAG 2.1 AA'  — new in WCAG 2.1, Level AA
 *   'WCAG 2.2 A'   — new in WCAG 2.2, Level A
 *   'WCAG 2.2 AA'  — new in WCAG 2.2, Level AA (most common compliance target)
 *   'WCAG 2.x AAA' — AAA criteria (rarely required)
 *   'Best Practice' — axe best-practice rules, not tied to a WCAG criterion
 *   'Undetermined' — no WCAG mapping found
 *
 * For axe findings, also inspects the tags array for 'best-practice'.
 */
export function classifyFinding(engine, { tags = [], ruleId } = {}, resolvedWcag = null) {
  if (engine === 'axe-core' && Array.isArray(tags) && tags.includes('best-practice') && !resolvedWcag) {
    return 'Best Practice';
  }
  if (!resolvedWcag) return 'Undetermined';
  const { level, wcag_version } = resolvedWcag;
  if (level === 'AAA') return 'WCAG 2.x AAA';
  return `WCAG ${wcag_version} ${level}`;
}

/**
 * Severity per the guide's taxonomy, derived from axe's impact and then
 * amplified by frequency: a low/medium finding that appears across most
 * scanned pages is escalated one level (a site-wide minor issue is a
 * bigger deal than an isolated one).
 *
 *   impact:           axe impact ('critical'|'serious'|'moderate'|'minor') or null
 *   pagesAffected:    number of scanned pages with this finding
 *   totalPages:       pages scanned this week
 */
export function severityFor(impact, pagesAffected, totalPages) {
  const order = ['Minor', 'Moderate', 'Serious', 'Critical'];
  // axe impact -> axe severity label (kept verbatim for engineer familiarity).
  const base = {
    critical: 'Critical',
    serious: 'Serious',
    moderate: 'Moderate',
    minor: 'Minor',
  }[impact] ?? 'Moderate'; // Alfa has no impact; default to Moderate.

  let idx = order.indexOf(base);
  // Frequency amplification: appears on a majority of scanned pages.
  if (totalPages > 0 && pagesAffected / totalPages >= 0.5 && idx < order.length - 1) {
    idx += 1;
  }
  return order[idx];
}
