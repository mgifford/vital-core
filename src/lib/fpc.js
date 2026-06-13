/**
 * Human-impact modeling for accessibility findings.
 *
 * Maps each WCAG 2.x success criterion to the Section 508 Functional
 * Performance Criteria (FPC) it relates to, and each FPC to a disability
 * group with a US population prevalence estimate. This lets a finding say
 * *who* it affects and roughly *how many people*, instead of an opaque
 * "requires manual testing".
 *
 * Sources:
 *  - WCAG -> FPC mapping: GSA Section 508 program,
 *    https://www.section508.gov/develop/mapping-wcag-to-fpc/ (extended to
 *    WCAG 2.2 criteria here). FPC categories also align with EU EN 301 549
 *    Table B.2.
 *  - Prevalence: US Census Bureau American Community Survey (ACS) 2022
 *    1-Year Estimates (disability tables), with supplemental CDC/NIDCD/NEI
 *    figures. These are population-level estimates, not site analytics —
 *    use them to convey scale, not as precise measurements.
 *
 * Approach borrowed from mgifford/daily-dap.
 */

// FPC code -> disability group + US prevalence (fraction of population).
export const FPC = {
  WV:    { code: 'WV',    group: 'Without vision',        prevalence: 0.010 },
  LV:    { code: 'LV',    group: 'Limited vision',        prevalence: 0.024 },
  WPC:   { code: 'WPC',   group: 'Without color perception', prevalence: 0.045 },
  WH:    { code: 'WH',    group: 'Without hearing',       prevalence: 0.003 },
  LH:    { code: 'LH',    group: 'Limited hearing',       prevalence: 0.035 },
  WS:    { code: 'WS',    group: 'Without speech',        prevalence: 0.005 },
  LM:    { code: 'LM',    group: 'Limited manipulation/strength', prevalence: 0.130 },
  LR:    { code: 'LR',    group: 'Limited reach',         prevalence: 0.020 },
  LCLA:  { code: 'LCLA',  group: 'Limited cognitive, language, or learning ability', prevalence: 0.110 },
};

// WCAG success criterion -> the FPC codes it most directly affects.
// Covers WCAG 2.0/2.1/2.2 Level A and AA. A criterion with no entry
// returns an empty impact (treated as undetermined rather than guessed).
const SC_TO_FPC = {
  // 1.1 Text Alternatives
  '1.1.1': ['WV', 'LV', 'LCLA'],
  // 1.2 Time-based Media
  '1.2.1': ['WV', 'WH'],
  '1.2.2': ['WH', 'LH'],
  '1.2.3': ['WV', 'LV'],
  '1.2.4': ['WH', 'LH'],
  '1.2.5': ['WV', 'LV'],
  // 1.3 Adaptable
  '1.3.1': ['WV', 'LV', 'LCLA'],
  '1.3.2': ['WV', 'LCLA'],
  '1.3.3': ['WV', 'LV', 'LCLA'],
  '1.3.4': ['LV', 'LM'],
  '1.3.5': ['LCLA', 'LM'],
  // 1.4 Distinguishable
  '1.4.1': ['WPC', 'LV'],
  '1.4.2': ['WV', 'LV'],
  '1.4.3': ['LV', 'WPC'],
  '1.4.4': ['LV'],
  '1.4.5': ['LV', 'WPC'],
  '1.4.10': ['LV', 'LM'],
  '1.4.11': ['LV', 'WPC'],
  '1.4.12': ['LV', 'LCLA'],
  '1.4.13': ['LV', 'LM', 'LCLA'],
  // 2.1 Keyboard Accessible
  '2.1.1': ['WV', 'LM', 'LR'],
  '2.1.2': ['WV', 'LM', 'LR'],
  '2.1.4': ['WV', 'LM'],
  // 2.2 Enough Time
  '2.2.1': ['LM', 'LR', 'LCLA'],
  '2.2.2': ['LV', 'LCLA'],
  // 2.3 Seizures
  '2.3.1': ['LCLA'],
  // 2.4 Navigable
  '2.4.1': ['WV', 'LM'],
  '2.4.2': ['WV', 'LV', 'LCLA'],
  '2.4.3': ['WV', 'LM'],
  '2.4.4': ['WV', 'LV', 'LCLA'],
  '2.4.5': ['WV', 'LV', 'LCLA'],
  '2.4.6': ['WV', 'LV', 'LCLA'],
  '2.4.7': ['LV', 'LM'],
  '2.4.11': ['LV', 'LM'],
  // 2.5 Input Modalities
  '2.5.1': ['LM', 'LR'],
  '2.5.2': ['LM', 'LR'],
  '2.5.3': ['WV', 'WS'],
  '2.5.4': ['LM', 'LR'],
  '2.5.7': ['LM', 'LR'],
  '2.5.8': ['LM', 'LR', 'LV'],
  // 3.1 Readable
  '3.1.1': ['WV', 'LCLA'],
  '3.1.2': ['WV', 'LCLA'],
  // 3.2 Predictable
  '3.2.1': ['WV', 'LV', 'LCLA'],
  '3.2.2': ['WV', 'LV', 'LCLA'],
  '3.2.3': ['LV', 'LCLA'],
  '3.2.4': ['LV', 'LCLA'],
  '3.2.6': ['LCLA'],
  // 3.3 Input Assistance
  '3.3.1': ['WV', 'LV', 'LCLA'],
  '3.3.2': ['WV', 'LV', 'LCLA'],
  '3.3.3': ['WV', 'LV', 'LCLA'],
  '3.3.4': ['LCLA'],
  '3.3.7': ['LCLA', 'LM'],
  '3.3.8': ['LCLA', 'LM'],
  // 4.1 Compatible
  '4.1.1': ['WV', 'LV'],
  '4.1.2': ['WV', 'LV', 'LM'],
  '4.1.3': ['WV', 'LV'],
};

/**
 * Impact for a WCAG success criterion: the disability groups affected,
 * each with prevalence. Returns { groups: [{code, group, prevalence}],
 * maxPrevalence } or null when the SC is unmapped/unknown.
 */
export function impactFor(sc) {
  const codes = SC_TO_FPC[sc];
  if (!codes || codes.length === 0) return null;
  const groups = codes.map((c) => FPC[c]).filter(Boolean);
  if (groups.length === 0) return null;
  return {
    groups,
    // The single most-affected group's prevalence — a conservative
    // headline figure (groups overlap, so we don't sum them).
    maxPrevalence: Math.max(...groups.map((g) => g.prevalence)),
  };
}

/**
 * Optional people-excluded estimate, when page-load data is supplied.
 *   prevalence: fraction (0-1)
 *   pageLoads:  loads attributable to the affected pages
 * Rough by design — meant to convey scale, not precision.
 */
export function estimateExcluded(prevalence, pageLoads) {
  if (!pageLoads || pageLoads <= 0) return null;
  return Math.round(prevalence * pageLoads);
}

/** Format a prevalence fraction as a percent string, e.g. 0.024 -> "2.4%". */
export function pct(fraction) {
  return `${(fraction * 100).toFixed(1)}%`;
}
