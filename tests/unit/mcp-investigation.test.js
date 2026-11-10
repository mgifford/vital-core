import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mcpInvestigationPrompt } from '../../src/lib/mcp-investigation.js';

const bug = {
  url: 'https://example.gov/page',
  selector: '#faq',
  rule_id: 'label-content-name-mismatch',
  wcag_sc: '2.5.3',
  occurrence_id: 'VO-abc12345',
  element: { available: true, tag: 'a', role: null, name: 'Go to FAQs', name_source: 'aria-label' },
};

test('the Playwright MCP prompt asks for observation, not diagnosis or repair', () => {
  const prompt = mcpInvestigationPrompt(bug);
  assert.match(prompt, /Playwright MCP/);
  assert.match(prompt, /browser extension/);
  assert.match(prompt, /https:\/\/example\.gov\/page/);
  assert.match(prompt, /#faq/);
  assert.match(prompt, /tag: a/);
  assert.match(prompt, /name: Go to FAQs \(from aria-label\)/);
  assert.match(prompt, /hidden, clipped, covered/);
  assert.match(prompt, /Do not run a new accessibility audit/);
  assert.doesNotMatch(prompt, /how to fix|apply this fix|you should change/i);
});

test('the MCP prompt is unavailable without a URL and locator', () => {
  assert.equal(mcpInvestigationPrompt({ ...bug, selector: '' }), null);
  assert.equal(mcpInvestigationPrompt({ ...bug, url: 'file:///tmp/x' }), null);
  assert.match(mcpInvestigationPrompt({ ...bug, selector: '', xpath: '//a' }), /XPath: \/\/a/);
});
