import fs from 'node:fs';
import path from 'node:path';

/**
 * Drupal-style translation primitive. The English source string is the key:
 *   t('Accessibility')  ->  'Accessibility'   (no catalog, or no entry)
 *                       ->  'Accessibilité'   (fr catalog supplies it)
 *
 * English is the canonical source and lives inline in the code, so there is no
 * en.json and the English render path is unaffected by this module (it just
 * returns the source string). Catalogs are flat { "English source": "translated" }
 * JSON files under src/locales/<locale>.json; any missing key falls back to the
 * English source, so partial catalogs are always safe.
 *
 * Locale is module-level state set once per render pass via setLocale(), mirroring
 * the setSustainabilityMetric() precedent in report-html.js. aggregate.js renders
 * locales sequentially, so there is no concurrency hazard.
 */

const LOCALES_DIR = path.resolve(new URL('../locales', import.meta.url).pathname);

// Locales the project knows how to render. 'en' is implicit (source language).
export const SUPPORTED_LOCALES = ['en', 'fr', 'ja', 'nl'];

const CATALOGS = new Map(); // locale -> { source: translation }
let current = 'en';

/** Load and cache a locale's catalog. No-op for 'en' and for already-loaded locales. */
export function loadCatalog(locale) {
  if (locale === 'en' || CATALOGS.has(locale)) return;
  const file = path.join(LOCALES_DIR, `${locale}.json`);
  let catalog = {};
  if (fs.existsSync(file)) {
    try {
      catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`Malformed locale catalog ${file}: ${e.message}`);
    }
  }
  CATALOGS.set(locale, catalog);
}

/** Set the active render locale. Unknown/empty falls back to 'en'. */
export function setLocale(locale) {
  current = SUPPORTED_LOCALES.includes(locale) ? locale : 'en';
  loadCatalog(current);
  return current;
}

export function getLocale() {
  return current;
}

/**
 * Translate an English source string, interpolating Drupal-style @tokens.
 *   t('Showing @count of @total issue type(s).', { '@count': n, '@total': m })
 * Tokens are replaced after lookup, so the same call works whether or not the
 * active catalog has an entry. Replacement is literal (not regex), so a token
 * value that itself contains a token name will not be re-scanned.
 */
export function t(source, args) {
  const catalog = CATALOGS.get(current);
  // gettext semantics: a missing OR empty translation falls back to the English
  // source, so a half-filled catalog (or template with blank values) is safe.
  let out = (catalog && catalog[source]) || source;
  if (args) {
    for (const token of Object.keys(args)) {
      out = out.split(token).join(String(args[token]));
    }
  }
  return out;
}

/** Locale-aware number formatting (Node >=20 ships full ICU: fr/ja/nl all work). */
export function nf(n, opts) {
  if (n == null || Number.isNaN(Number(n))) return String(n ?? '');
  return new Intl.NumberFormat(current, opts).format(n);
}
