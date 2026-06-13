/**
 * Map scanner output to WCAG Success Criteria and a severity, following
 * the bug-reporting best-practices guide
 * (ACCESSIBILITY_BUG_REPORTING_BEST_PRACTICES). Everything here is
 * derived from what the engines actually report — axe tags and Alfa rule
 * ids — so it stays truthful. Where a mapping is unknown we say so
 * rather than guess.
 */

// WCAG 2.x success criteria: number -> [name, level]. Covers the criteria
// the automated engines can flag. Extend as needed.
const WCAG_CRITERIA = {
  '1.1.1': ['Non-text Content', 'A'],
  '1.2.1': ['Audio-only and Video-only (Prerecorded)', 'A'],
  '1.2.2': ['Captions (Prerecorded)', 'A'],
  '1.3.1': ['Info and Relationships', 'A'],
  '1.3.2': ['Meaningful Sequence', 'A'],
  '1.3.3': ['Sensory Characteristics', 'A'],
  '1.3.4': ['Orientation', 'AA'],
  '1.3.5': ['Identify Input Purpose', 'AA'],
  '1.4.1': ['Use of Color', 'A'],
  '1.4.2': ['Audio Control', 'A'],
  '1.4.3': ['Contrast (Minimum)', 'AA'],
  '1.4.4': ['Resize Text', 'AA'],
  '1.4.5': ['Images of Text', 'AA'],
  '1.4.10': ['Reflow', 'AA'],
  '1.4.11': ['Non-text Contrast', 'AA'],
  '1.4.12': ['Text Spacing', 'AA'],
  '1.4.13': ['Content on Hover or Focus', 'AA'],
  '2.1.1': ['Keyboard', 'A'],
  '2.1.2': ['No Keyboard Trap', 'A'],
  '2.1.4': ['Character Key Shortcuts', 'A'],
  '2.2.1': ['Timing Adjustable', 'A'],
  '2.2.2': ['Pause, Stop, Hide', 'A'],
  '2.3.1': ['Three Flashes or Below Threshold', 'A'],
  '2.4.1': ['Bypass Blocks', 'A'],
  '2.4.2': ['Page Titled', 'A'],
  '2.4.3': ['Focus Order', 'A'],
  '2.4.4': ['Link Purpose (In Context)', 'A'],
  '2.4.5': ['Multiple Ways', 'AA'],
  '2.4.6': ['Headings and Labels', 'AA'],
  '2.4.7': ['Focus Visible', 'AA'],
  '2.5.1': ['Pointer Gestures', 'A'],
  '2.5.2': ['Pointer Cancellation', 'A'],
  '2.5.3': ['Label in Name', 'A'],
  '2.5.4': ['Motion Actuation', 'A'],
  '2.5.7': ['Dragging Movements', 'AA'],
  '2.5.8': ['Target Size (Minimum)', 'AA'],
  '3.1.1': ['Language of Page', 'A'],
  '3.1.2': ['Language of Parts', 'AA'],
  '3.2.1': ['On Focus', 'A'],
  '3.2.2': ['On Input', 'A'],
  '3.2.6': ['Consistent Help', 'A'],
  '3.3.1': ['Error Identification', 'A'],
  '3.3.2': ['Labels or Instructions', 'A'],
  '3.3.3': ['Error Suggestion', 'AA'],
  '3.3.4': ['Error Prevention (Legal, Financial, Data)', 'AA'],
  '3.3.7': ['Redundant Entry', 'A'],
  '3.3.8': ['Accessible Authentication (Minimum)', 'AA'],
  '4.1.1': ['Parsing', 'A'],
  '4.1.2': ['Name, Role, Value', 'A'],
  '4.1.3': ['Status Messages', 'AA'],
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
 * Best-effort WCAG SC mapping for common Siteimprove Alfa rule ids
 * (sia-rN). Alfa rules map to ACT rules, which map to WCAG; this covers
 * the rules seen most often. Unknown rules return null and the report
 * says the criterion is undetermined.
 */
const ALFA_SC = {
  'sia-r2': '1.1.1', // img has accessible name
  'sia-r3': '4.1.1', // id attribute unique
  'sia-r4': '3.1.1', // lang of page
  'sia-r5': '3.1.1', // valid lang attribute
  'sia-r8': '4.1.2', // form field has accessible name
  'sia-r9': '2.2.1', // meta refresh no delay
  'sia-r10': '1.3.5', // autocomplete valid
  'sia-r11': '4.1.2', // link has accessible name
  'sia-r12': '4.1.2', // button has accessible name
  'sia-r13': '1.1.1', // iframe has accessible name
  'sia-r14': '2.5.3', // visible label in accessible name
  'sia-r15': '4.1.2', // iframes with same name same content
  'sia-r16': '4.1.2', // role has required states/properties
  'sia-r17': '1.3.1', // aria-hidden no focusable content
  'sia-r18': '4.1.2', // aria states/properties allowed
  'sia-r19': '4.1.2', // aria attribute has valid value
  'sia-r20': '4.1.2', // aria attribute is defined
  'sia-r21': '4.1.2', // role is valid
  'sia-r28': '1.1.1', // image button has accessible name
  'sia-r41': '4.1.2', // links with same name same purpose
  'sia-r42': '1.3.1', // element required context role
  'sia-r43': '1.1.1', // svg has accessible name
  'sia-r48': '1.4.2', // audio no autoplay
  'sia-r53': '1.3.1', // heading hierarchy
  'sia-r62': '1.4.1', // links distinguishable from text
  'sia-r66': '1.4.3', // text contrast (AAA variant in some)
  'sia-r69': '1.4.3', // text has sufficient contrast
  'sia-r111': '2.5.8', // target size
};

/**
 * Resolve a finding's WCAG criterion.
 *   engine: 'axe-core' | 'alfa'
 *   tags:   axe tags array (for axe)
 *   ruleId: rule id (sia-rN for alfa)
 * Returns { sc, name, level } or null when undetermined.
 */
export function resolveWcag(engine, { tags = [], ruleId } = {}) {
  let sc = null;
  if (engine === 'axe-core') {
    for (const t of tags) {
      const c = scFromAxeTag(t);
      if (c && WCAG_CRITERIA[c]) {
        sc = c;
        break;
      }
    }
  } else if (engine === 'alfa') {
    sc = ALFA_SC[ruleId] ?? null;
  }
  if (!sc || !WCAG_CRITERIA[sc]) return null;
  const [name, level] = WCAG_CRITERIA[sc];
  return { sc, name, level };
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
  const order = ['Low', 'Medium', 'High', 'Critical'];
  // axe impact -> guide severity baseline.
  const base = {
    critical: 'Critical',
    serious: 'High',
    moderate: 'Medium',
    minor: 'Low',
  }[impact] ?? 'Medium'; // Alfa has no impact; default to Medium.

  let idx = order.indexOf(base);
  // Frequency amplification: appears on a majority of scanned pages.
  if (totalPages > 0 && pagesAffected / totalPages >= 0.5 && idx < order.length - 1) {
    idx += 1;
  }
  return order[idx];
}
