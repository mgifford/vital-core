#!/usr/bin/env node
/**
 * Extract translatable strings from the source and emit a translation template.
 *
 * Scans src/ for t('…') / t("…") calls — the Drupal-style i18n primitive where
 * the English source string is the key — and writes src/locales/template.json,
 * a sorted { "English source": "" } checklist. Translators copy it to
 * src/locales/<lang>.json and fill in the values; any blank or missing entry
 * falls back to English at render time (see src/lib/i18n.js).
 *
 * Usage:
 *   node scripts/i18n-extract.js          # rewrite src/locales/template.json
 *   node scripts/i18n-extract.js --check  # exit 1 if the template is stale
 *
 * The --check mode is for CI: it fails when the committed template does not
 * match what the source currently uses, so the checklist never drifts.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SRC = path.join(ROOT, 'src');
const TEMPLATE = path.join(SRC, 'locales', 'template.json');

// Match a standalone t('…') or t("…") call: `t` not preceded by a word char or
// a dot (so .split(, format(, import(, obj.t( never match), then a single- or
// double-quoted literal allowing escaped quotes.
const CALL_RE = /(?<![\w.])t\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;

function unescape(literal) {
  return literal
    .replace(/\\(['"\\])/g, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
}

// lib/i18n.js defines t() and only references it in illustrative JSDoc, so
// skip it to avoid harvesting documentation examples as real strings.
const SKIP = new Set([path.join(SRC, 'lib', 'i18n.js')]);

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'locales') continue;
      out.push(...jsFiles(full));
    } else if (entry.name.endsWith('.js') && !SKIP.has(full)) {
      out.push(full);
    }
  }
  return out;
}

// Strings translated indirectly — passed to t() through a variable or label
// table (e.g. subnav labels via t(label), WCAG categories via t(c), the
// RESOURCE_LABELS / LH_CATEGORY_LABELS maps) — so the literal never appears in
// a t('…') call the regex can see. Registered here so they show up in the
// template and the catalog-key lint accepts them.
const DYNAMIC_FILE = path.join(SRC, 'locales', 'dynamic-strings.json');

export function extractSources() {
  const sources = new Set();
  for (const file of jsFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(CALL_RE)) {
      const raw = m[1] ?? m[2];
      if (raw != null) sources.add(unescape(raw));
    }
  }
  if (fs.existsSync(DYNAMIC_FILE)) {
    for (const s of JSON.parse(fs.readFileSync(DYNAMIC_FILE, 'utf8'))) sources.add(s);
  }
  return [...sources].sort((a, b) => a.localeCompare(b, 'en'));
}

function templateJson(sources) {
  const obj = {};
  for (const s of sources) obj[s] = '';
  return JSON.stringify(obj, null, 2) + '\n';
}

function main() {
  const check = process.argv.includes('--check');
  const next = templateJson(extractSources());
  if (check) {
    const current = fs.existsSync(TEMPLATE) ? fs.readFileSync(TEMPLATE, 'utf8') : '';
    if (current !== next) {
      console.error('src/locales/template.json is stale. Run: node scripts/i18n-extract.js');
      process.exit(1);
    }
    console.log('src/locales/template.json is up to date.');
    return;
  }
  fs.mkdirSync(path.dirname(TEMPLATE), { recursive: true });
  fs.writeFileSync(TEMPLATE, next);
  console.log(`Wrote ${path.relative(ROOT, TEMPLATE)} (${Object.keys(JSON.parse(next)).length} strings).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
