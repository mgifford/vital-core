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
    'A screenshot, when present, shows the page at scan time; re-check the live page before drawing a conclusion.',
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
    '1.4.1': [
      'Check whether colour alone conveys meaning (an error, a required field, a link in body text).',
      'Look for a second cue such as text, an icon with a name, or an underline.',
    ],
    '1.4.5': [
      'Check whether text is presented as an image of text; it should reflow and remain readable when zoomed.',
    ],
    '2.2.2': [
      'If content moves, blinks or auto-updates, check that it can be paused, stopped or hidden.',
    ],
    '2.4.1': [
      'Tab from the top of the page and confirm a skip link or landmark navigation bypasses repeated blocks.',
    ],
    '2.4.2': [
      'Check the page title describes the page purpose and is unique within the site.',
    ],
    '3.1.1': [
      'Confirm the page language is set and matches the main content language.',
    ],
    '3.1.2': [
      'Check passages in another language are marked so a screen reader switches pronunciation.',
    ],
    '3.2.1': [
      'Move focus through the page and confirm nothing unexpectedly changes context.',
    ],
    '3.2.2': [
      'Change a form control and confirm the page does not unexpectedly submit or navigate.',
    ],
    '3.3.4': [
      'Check that legal, financial or data-deletion submissions can be reviewed, corrected or confirmed.',
    ],
    '4.1.1': [
      'Check the markup for duplicate IDs and malformed nesting that could break assistive technology.',
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
    'document-title': byCriterion['2.4.2'],
    'html-has-lang': byCriterion['3.1.1'],
    'html-lang-valid': byCriterion['3.1.1'],
    'valid-lang': byCriterion['3.1.2'],
    'heading-order': byCriterion['1.3.1'],
    'empty-heading': byCriterion['1.3.1'],
    'page-has-heading-one': byCriterion['1.3.1'],
    'landmark-one-main': byCriterion['1.3.1'],
    'frame-title': byCriterion['4.1.2'],
    'aria-hidden-focus': byCriterion['4.1.2'],
    'nested-interactive': byCriterion['4.1.2'],
    'input-button-name': byCriterion['4.1.2'],
    'select-name': byCriterion['3.3.2'],
    'aria-valid-attr-value': byCriterion['4.1.2'],
    'aria-allowed-attr': byCriterion['4.1.2'],
    'aria-required-attr': byCriterion['4.1.2'],
    'duplicate-id': byCriterion['4.1.1'],
    'duplicate-id-aria': byCriterion['4.1.1'],
    'link-in-text-block': byCriterion['1.4.1'],
    'bypass': byCriterion['2.4.1'],
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
export function manualReviewRecord(bug, { generatedAt = new Date().toISOString(), review = {} } = {}) {
  const guidance = manualValidationFor(bug);
  const STATUSES = ['not_reviewed', 'in_progress', 'confirmed', 'not_reproduced', 'false_positive', 'needs_investigation'];
  const clean = (value, max = 300) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
  const status = STATUSES.includes(review.status) ? review.status : 'not_reviewed';
  const region = bug?.semantic_context?.nearest_region ?? null;
  const element = bug?.element?.available === true ? {
    tag: bug.element.tag ?? null,
    role: bug.element.role ?? null,
    name: bug.element.name ?? null,
    name_source: bug.element.name_source ?? 'none',
  } : null;
  const screenshot = bug?.screenshot?.available === true ? {
    file: bug.screenshot.file ?? null,
    captured_at: bug.screenshot.captured_at ?? null,
    full_page: bug.screenshot.full_page === true,
    historical: true,
  } : null;
  if (screenshot) {
    guidance.screenshot_note = 'The screenshot is historical evidence from the scan, not a live view; confirm the current page before recording an outcome.';
  }
  return {
    schema: 1,
    generated_at: generatedAt,
    not_a_conformance_claim: true,
    finding: {
      instance_id: bug?.instance_id ?? null,
      pattern_id: bug?.pattern_id ?? null,
      finding_ref: bug?.finding_ref ?? null,
      occurrence_id: bug?.occurrence_id ?? null,
      observation_id: bug?.observation_id ?? null,
      rule_id: bug?.rule_id ?? null,
      engine: bug?.engine_key ?? null,
      severity: bug?.severity ?? null,
      wcag_sc: bug?.wcag_sc ?? null,
      url: bug?.url ?? null,
      selector: bug?.selector ?? null,
      region: region ? (region.name ? `${region.role} "${region.name}"` : `${region.role} (unnamed)`) : null,
      component: bug?.component_scope?.component_label ?? null,
      element,
      screenshot,
      stored_examples: bug?.evidence?.stored_examples ?? bug?.examples?.length ?? null,
    },
    guidance,
    automated_evidence_only: true,
    manual_validation_required: true,
    review: {
      status,
      reviewer: status === 'not_reviewed' ? null : clean(review.reviewer, 120),
      reviewed_at: status === 'not_reviewed' ? null : (clean(review.reviewed_at, 40) ?? generatedAt),
      browser: status === 'not_reviewed' ? null : clean(review.browser, 160),
      assistive_technology: status === 'not_reviewed' ? null : clean(review.assistive_technology, 160),
      viewport: status === 'not_reviewed' ? null : clean(review.viewport, 80),
      steps: [],
      outcome: null,
      notes: null,
      evidence: [],
    },
    instructions: 'Fill in review, keep the guidance with it, and share it through your own channel. This file is generated on demand and is not saved by VITAL. Remove personal or sensitive data from notes and screenshots before sharing.',
  };
}
