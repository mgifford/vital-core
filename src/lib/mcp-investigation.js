/**
 * A copyable investigation prompt for Playwright MCP with the Playwright
 * browser extension. This is an optional power-user path, not a VITAL
 * dependency: it uses the user's own browser profile/session and an MCP client
 * they already run. It asks for observation, never diagnosis or remediation.
 */
export function mcpInvestigationPrompt(bug) {
  const url = typeof bug?.url === 'string' && /^https?:\/\//i.test(bug.url) ? bug.url : null;
  const selector = typeof bug?.selector === 'string' && bug.selector.trim() ? bug.selector.trim().slice(0, 500) : null;
  const xpath = typeof bug?.xpath === 'string' && bug.xpath.trim() ? bug.xpath.trim().slice(0, 500) : null;
  if (!url || (!selector && !xpath)) return null;
  const identity = [
    bug.element?.tag ? `tag: ${bug.element.tag}` : null,
    bug.element?.role ? `role: ${bug.element.role}` : null,
    bug.element?.name ? `name: ${String(bug.element.name).slice(0, 200)}${bug.element.name_source ? ` (from ${bug.element.name_source})` : ''}` : null,
  ].filter(Boolean);
  return [
    'Use Playwright MCP with the Playwright browser extension connected to my existing browser profile.',
    `Open: ${url}`,
    `Locate ${selector ? `this CSS selector: ${selector}` : `this XPath: ${xpath}`}`,
    identity.length ? `Recorded identity: ${identity.join('; ')}.` : 'The recorded identity has no reliable tag/role/name evidence.',
    `Finding: ${bug.rule_id ?? 'unknown rule'}${bug.wcag_sc ? ` (WCAG ${bug.wcag_sc})` : ''}; occurrence ${bug.occurrence_id ?? 'not recorded'}.`,
    '',
    'Report observation only:',
    '- how many visible elements match, and whether each is the recorded tag/role/name;',
    '- whether the element is visible, hidden, clipped, covered by another element, or inside an iframe/shadow root;',
    '- the page state or interaction needed to reveal it (menu, tab, dialog, accordion);',
    '- its bounding box and a short DOM/accessibility-tree snapshot if useful.',
    '',
    'Do not run a new accessibility audit, do not claim conformance or that the finding is fixed, and do not change the page. If the selector is stale, say so and show candidate elements with their identity; do not guess.'
  ].join('\n');
}
