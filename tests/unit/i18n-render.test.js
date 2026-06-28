import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDomainReport, setLocale, setReportLanguages, localeSuffix } from '../../src/report-html.js';

const summary = {
  week: '2026-W25', pagesScanned: 20, pagesAudited: 20,
  generatedAt: '2026-06-23T00:00:00.000Z',
  axe: { medianViolations: 4, pagesScanned: 20, pagesWithViolations: 12, rules: {} },
  alfa: { medianFailures: 8, pagesScanned: 10, pagesWithFailures: 6 },
  coverage: {},
};
const target = { key: 'www.example.gov', domain: 'www.example.gov', display: { score_format: 'both' } };
const render = () => renderDomainReport(target, summary, null, null, [], [], {}, null);

test('i18n-render: single language emits no switcher and unsuffixed links', () => {
  setReportLanguages(['en'], 'en');
  setLocale('en');
  const html = render();
  assert.match(html, /<html lang="en"/);
  assert.doesNotMatch(html, /class="lang-switch"/);
  assert.equal(localeSuffix(), '');
  assert.match(html, /href="accessibility\.html"/);
});

test('i18n-render: default language keeps canonical paths and links to suffixed siblings', () => {
  setReportLanguages(['en', 'fr'], 'en');
  setLocale('en');
  const html = render();
  assert.match(html, /<html lang="en"/);
  assert.match(html, /class="lang-switch"/);
  assert.equal(localeSuffix(), '');
  assert.match(html, /href="accessibility\.html"/);      // subnav stays in-language
  assert.match(html, /href="index-fr\.html"[^>]*hreflang="fr"/); // switcher cross-links
});

test('i18n-render: non-default language suffixes its own links and switches back to default', () => {
  setReportLanguages(['en', 'fr'], 'en');
  setLocale('fr');
  const html = render();
  assert.match(html, /<html lang="fr"/);
  assert.equal(localeSuffix(), '-fr');
  assert.match(html, /href="accessibility-fr\.html"/);   // subnav stays in fr
  assert.match(html, /href="index\.html"[^>]*hreflang="en"/); // switch back to en default
});

test('i18n-render: switcher is pure links (works with JS disabled)', () => {
  setReportLanguages(['en', 'fr'], 'en');
  setLocale('en');
  const html = render();
  const switcher = html.match(/<nav class="lang-switch"[\s\S]*?<\/nav>/)[0];
  assert.doesNotMatch(switcher, /<script|onclick=/);
  assert.match(switcher, /<a href=/);
  // reset shared module state for other tests
  setReportLanguages(['en'], 'en');
  setLocale('en');
});
