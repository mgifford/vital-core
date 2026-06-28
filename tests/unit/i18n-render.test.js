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

test('i18n-render: single-language build emits no language runtime (config gate)', () => {
  setReportLanguages(['en'], 'en');
  setLocale('en');
  const html = render();
  assert.doesNotMatch(html, /vital-lang/);          // no redirect/persist script
  assert.doesNotMatch(html, /rel="alternate"/);     // no hreflang alternates
  assert.doesNotMatch(html, /class="lang-switch"/); // no switcher
});

test('i18n-render: multi-language build emits the redirect script and hreflang alternates', () => {
  setReportLanguages(['en', 'fr'], 'en');
  setLocale('en');
  const html = render();
  // Pre-paint script reads ?lang and localStorage['vital-lang'].
  assert.match(html, /URLSearchParams\(location\.search\)\.get\('lang'\)/);
  assert.match(html, /localStorage\.(get|set)Item\('vital-lang'/);
  // Config baked in: current locale, default, page, and only configured langs.
  assert.match(html, /"cur":"en"/);
  assert.match(html, /"def":"en"/);
  assert.match(html, /"page":"index"/);
  assert.match(html, /"langs":\["en","fr"\]/);
  // SEO alternates (siblings + x-default).
  assert.match(html, /<link rel="alternate" hreflang="fr" href="index-fr\.html">/);
  assert.match(html, /<link rel="alternate" hreflang="x-default" href="index\.html">/);
  setReportLanguages(['en'], 'en');
  setLocale('en');
});

test('i18n-render: redirect config carries the current locale on a suffixed page', () => {
  setReportLanguages(['en', 'fr'], 'en');
  setLocale('fr');
  const html = render();
  assert.match(html, /"cur":"fr"/); // script can tell it is already on a non-default page
  setReportLanguages(['en'], 'en');
  setLocale('en');
});

test('i18n-render: switcher can be hidden while ?lang/runtime stays active', () => {
  // languages reachable by URL, but no visible switcher (no UI change).
  setReportLanguages(['en', 'fr', 'ja', 'nl'], 'en', false);
  setLocale('en');
  const html = render();
  assert.doesNotMatch(html, /class="lang-switch"/);          // no visible switcher
  assert.match(html, /URLSearchParams\(location\.search\)\.get\('lang'\)/); // runtime present
  assert.match(html, /"langs":\["en","fr","ja","nl"\]/);     // all langs reachable
  assert.match(html, /<link rel="alternate" hreflang="ja" href="index-ja\.html">/); // SEO alternates
  setReportLanguages(['en'], 'en');
  setLocale('en');
});

test('i18n-render: sortableTable column headers localize via t()', async () => {
  const { renderArchivePage } = await import('../../src/report-html.js');
  const week = '2026-W25';
  const summary = {
    week, pagesScanned: 20, pagesAudited: 20, generatedAt: '2026-06-23T00:00:00.000Z',
    axe: { medianViolations: 4, pagesScanned: 20, pagesWithViolations: 12, rules: {} },
    alfa: { medianFailures: 8, pagesScanned: 10, pagesWithFailures: 6 }, coverage: {},
  };
  const t = { key: 'www.example.gov', domain: 'www.example.gov', display: { score_format: 'both' } };

  setLocale('fr'); // fr.json ships "Pages audited" -> "Pages auditées"
  const fr = renderArchivePage(t, [summary], week);
  assert.match(fr, /Pages auditées/);
  assert.doesNotMatch(fr, />Pages audited</);

  setLocale('en'); // English path unchanged
  const en = renderArchivePage(t, [summary], week);
  assert.match(en, />Pages audited</);
  assert.doesNotMatch(en, /Pages auditées/);
});
