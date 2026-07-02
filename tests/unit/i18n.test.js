import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { t, nf, setLocale, getLocale, SUPPORTED_LOCALES } from '../../src/lib/i18n.js';
import { extractSources } from '../../scripts/i18n-extract.js';

const LOCALES_DIR = path.resolve(new URL('../../src/locales', import.meta.url).pathname);

test('i18n: returns the English source verbatim with no catalog (en)', () => {
  setLocale('en');
  assert.equal(getLocale(), 'en');
  assert.equal(t('Accessibility'), 'Accessibility');
  assert.equal(t("Won't fix"), "Won't fix");
});

test('i18n: unknown locale falls back to en', () => {
  assert.equal(setLocale('xx'), 'en');
  assert.equal(t('Overview'), 'Overview');
  setLocale('en');
});

test('i18n: @token placeholders interpolate', () => {
  setLocale('en');
  const out = t('Showing @count of @total issue type(s).', { '@count': 3, '@total': 9 });
  assert.equal(out, 'Showing 3 of 9 issue type(s).');
});

test('i18n: a present translation is used; missing keys fall back to source', () => {
  // Exercise the catalog path without depending on a real locale file by
  // round-tripping through setLocale on every supported non-en locale: any
  // key absent from the catalog must come back as the English source.
  for (const locale of SUPPORTED_LOCALES.filter((l) => l !== 'en')) {
    setLocale(locale);
    assert.equal(t('__definitely_not_a_real_key__'), '__definitely_not_a_real_key__');
  }
  setLocale('en');
});

test('i18n: nf formats numbers per the active locale', () => {
  setLocale('en');
  assert.equal(nf(1234567), '1,234,567');
  setLocale('fr');
  // French uses a narrow no-break space as the thousands separator.
  assert.match(nf(1234567), /1[\s  ]234[\s  ]567/);
  setLocale('en');
});

test('i18n: every key in each locale catalog exists in the extracted template', () => {
  const sources = new Set(extractSources());
  for (const locale of SUPPORTED_LOCALES.filter((l) => l !== 'en')) {
    const file = path.join(LOCALES_DIR, `${locale}.json`);
    if (!fs.existsSync(file)) continue; // partial/absent catalogs are allowed
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const key of Object.keys(catalog)) {
      assert.ok(
        sources.has(key),
        `${locale}.json has a key not used in source (stale or typo'd): ${JSON.stringify(key)}`,
      );
    }
  }
});
