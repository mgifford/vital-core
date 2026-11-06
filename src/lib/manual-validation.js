/**
 * Manual validation guidance for a finding.
 *
 * Automated checks find roughly a third of accessibility barriers, and a
 * checkbox is not evidence that a test happened. This module produces
 * finding-relevant prompts, suggested test conditions and a blank structured
 * review record. It never marks anything reviewed and never claims
 * conformance.
 *
 * `manualValidationFor` and `manualReviewRecord` are self-contained so the
 * Finding Explorer can stringify them and generate the record client-side.
 */

/** Reviewer-assigned states. Only `not_reviewed` is ever set by VITAL. */
export const MANUAL_REVIEW_STATUSES = Object.freeze([
  'not_reviewed',
  'in_progress',
  'confirmed',
  'not_reproduced',
  'false_positive',
  'needs_investigation',
]);

/**
 * Guidance relevant to this finding. Prompts are deliberately specific to the
 * criterion or rule, with a generic fallback — not one identical checklist for
 * every finding. Bounded to three prompts.
 */
export function manualValidationFor(bug) {
  // In-function so the function can be stringified into the report page.
  const GENERIC_PROMPTS = [
    'Reproduce the finding in context and confirm its effect on a real task.',
    'Test with a keyboard only, then with a screen reader if the finding affects names, roles, states or reading order.',
    'Note the browser, assistive technology and viewport you used, and what you observed.',
  ];

  const ENVIRONMENT = [
    'Keyboard only (Tab, Shift+Tab, Enter, Space, arrow keys)',
    'A screen reader where the finding affects names, roles, states or reading order',
    'Browser zoom at 200% and 400%',
    'Light, dark and forced-colours modes',
    'Reduced motion',
    'A small viewport (320 CSS px wide)',
  ];

  const LIMITATIONS = [
    'Automated tools find roughly a third of accessibility barriers; absence of a finding is not evidence of accessibility.',
    'Recording a review does not establish conformance; it records what one reviewer observed in one environment.',
  ];
  const criterion = typeof bug?.wcag_sc === 'string' ? bug.wcag_sc : '';
  const rule = typeof bug?.rule_id === 'string' ? bug.rule_id : '';
  const byCriterion = {
    '1.1.1': [
      'Check that each meaningful image has a text alternative that conveys its purpose, and that decorative images are ignored by assistive technology.',
      'Confirm the alternative matches the image in context (a logo, a chart, a button icon).',
    ],
    '1.3.1': [
      'Navigate with a screen reader and confirm headings, lists, tables and form labels are announced and related correctly.',
      'Check that the visual structure is also available nonvisually.',
    ],
    '1.3.2': [
      'Confirm the reading order announced by a screen reader matches the visual order.',
    ],
    '1.4.3': [
      'Measure the contrast with a colour picker in light and dark mode, and again in forced-colours mode.',
      'Check the text in its hover, focus, disabled and error states.',
    ],
    '1.4.11': [
      'Check the contrast of the control boundary, icon or focus indicator against its adjacent colours.',
    ],
    '1.4.4': [
      'Zoom to 200% and confirm text is not clipped, truncated or overlapping.',
    ],
    '1.4.10': [
      'At 320 CSS px wide (about 400% zoom), confirm content reflows without two-dimensional scrolling.',
    ],
    '2.1.1': [
      'Complete the task using only a keyboard, without a mouse or trackpad.',
      'Confirm every control can be reached and operated, including any custom widget.',
    ],
    '2.1.2': [
      'Confirm focus can leave every component; there is no keyboard trap.',
    ],
    '2.4.3': [
      'Tab through the page and confirm the focus order follows the visual and task order.',
    ],
    '2.4.7': [
      'Confirm the focus indicator is clearly visible on every interactive element, including in forced-colours mode.',
    ],
    '2.4.4': [
      'Read each link out of context with a screen reader; its purpose should be clear from the link text.',
    ],
    '2.5.5': [
      'Activate the control with touch, a mouse and a keyboard, and confirm it is easy to hit accurately.',
    ],
    '2.5.8': [
      'Check the target size and spacing against the 24×24 CSS px minimum, or confirm the spacing exception applies.',
    ],
    '3.3.1': [
      'Submit the form with errors and confirm each error is identified in text and linked to the field.',
    ],
    '3.3.2': [
      'Confirm every input has a visible label that remains available to assistive technology.',
    ],
    '3.3.3': [
      'Trigger an error and confirm the suggestion is specific and understandable.',
    ],
    '4.1.2': [
      'Inspect the accessible name, role and state with a screen reader or the accessibility tree.',
      'Confirm the state change is announced when the control is operated.',
    ],
    '4.1.3': [
      'Trigger the status message and confirm it is announced without moving focus.',
    ],
  };
  const byRule = {
    'image-alt': byCriterion['1.1.1'],
    'color-contrast': byCriterion['1.4.3'],
    'target-size': byCriterion['2.5.8'],
    'button-name': byCriterion['4.1.2'],
    'link-name': byCriterion['2.4.4'],
    'label': byCriterion['3.3.2'],
    'form-field-multiple-labels': byCriterion['3.3.2'],
    'aria-required-children': byCriterion['1.3.1'],
    'aria-required-parent': byCriterion['1.3.1'],
    'list': byCriterion['1.3.1'],
    'region': [
      'Confirm the content you are checking is inside a landmark that a screen reader announces.',
      'Check the landmark names distinguish repeated regions (for example two navigation areas).',
    ],
  };
  const prompts = (byCriterion[criterion] ?? byRule[rule] ?? GENERIC_PROMPTS).slice(0, 3);
  return {
    status: 'not_reviewed',
    prompts,
    environment: ENVIRONMENT,
    environment_note: 'Use the conditions that can affect this finding; not every item applies to every finding.',
    limitations: LIMITATIONS,
  };
}

/**
 * A blank, structured review record for one finding. Nothing is stored or
 * submitted by VITAL; the reviewer fills it in and shares it through their own
 * process. `not_a_conformance_claim` is always true.
 */
export function manualReviewRecord(bug, { generatedAt = new Date().toISOString() } = {}) {
  const guidance = manualValidationFor(bug);
  const region = bug?.semantic_context?.nearest_region ?? null;
  return {
    schema: 1,
    generated_at: generatedAt,
    not_a_conformance_claim: true,
    finding: {
      instance_id: bug?.instance_id ?? null,
      pattern_id: bug?.pattern_id ?? null,
      rule_id: bug?.rule_id ?? null,
      engine: bug?.engine_key ?? null,
      severity: bug?.severity ?? null,
      wcag_sc: bug?.wcag_sc ?? null,
      url: bug?.url ?? null,
      selector: bug?.selector ?? null,
      region: region ? (region.name ? `${region.role} "${region.name}"` : `${region.role} (unnamed)`) : null,
      component: bug?.component_scope?.component_label ?? null,
    },
    guidance,
    review: {
      status: 'not_reviewed',
      reviewer: null,
      reviewed_at: null,
      browser: null,
      assistive_technology: null,
      viewport: null,
      steps: [],
      outcome: null,
      notes: null,
      evidence: [],
    },
    instructions: 'Fill in review, keep the guidance with it, and share it through your own channel. This file is generated on demand and is not saved by VITAL.',
  };
}
