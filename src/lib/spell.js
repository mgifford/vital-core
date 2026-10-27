import fs from 'node:fs';
import path from 'node:path';
import nspell from 'nspell';
import usDictionary from 'dictionary-en';
import { DIRS, SPELLING_DICTIONARIES, DEFAULT_SPELLING_LOCALE } from './config.js';

/**
 * Spell checking for page prose. Uses nspell with the dictionary for the
 * target's spelling_locale (US English by default), plus an optional project
 * allowlist (config/spelling-allowlist.txt, one term per line, # comments)
 * for domain jargon — government, medical, and program terms that aren't in
 * a general dictionary but are correct.
 *
 * Each locale's dictionary is loaded once and reused. Numbers, ALL-CAPS
 * acronyms, URLs/emails, and very short tokens are skipped: those are not
 * spelling mistakes and would only add noise.
 */

// Only the dictionaries a scan actually uses are read: US English is
// imported up front (the default path is unchanged), the rest on first use.
const dictionaries = new Map([[DEFAULT_SPELLING_LOCALE, usDictionary]]);
const spellers = new Map();

/** Load the dictionary for `locale` so findMisspellings can use it. */
export async function loadSpeller(locale = DEFAULT_SPELLING_LOCALE) {
  if (!dictionaries.has(locale)) {
    const pkg = SPELLING_DICTIONARIES[locale];
    if (!pkg) throw new Error(`Unsupported spelling locale "${locale}".`);
    dictionaries.set(locale, (await import(pkg)).default);
  }
  return getSpeller(locale);
}

function getSpeller(locale) {
  if (spellers.has(locale)) return spellers.get(locale);
  const dictionary = dictionaries.get(locale);
  if (!dictionary) throw new Error(`Spelling locale "${locale}" is not loaded; await loadSpeller("${locale}") first.`);
  const speller = nspell(dictionary);
  // Layer the allowlist on top so jargon stops being flagged.
  const allowPath = path.join(DIRS.config, 'spelling-allowlist.txt');
  if (fs.existsSync(allowPath)) {
    for (const line of fs.readFileSync(allowPath, 'utf8').split('\n')) {
      const t = line.trim();
      if (t && !t.startsWith('#')) speller.add(t);
    }
  }
  spellers.set(locale, speller);
  return speller;
}

/** A token worth spell-checking? Skip numbers, acronyms, URLs, short bits. */
function checkable(word) {
  if (word.length < 3) return false;
  if (/\d/.test(word)) return false; // contains a digit
  if (/^[A-Z]{2,}$/.test(word)) return false; // ALL-CAPS acronym
  if (/[@/:.]/.test(word)) return false; // URL/email-ish
  return /^[A-Za-z][A-Za-z'-]*$/.test(word);
}

/**
 * Find misspelled words in a list of tokens. Returns
 * { misspelledCount, misspelled: [...capped distinct words...] }.
 * Possessives and a leading capital (sentence start) are tolerated.
 *
 * extraAllowlist: optional string[] of per-target terms (from
 * target.spelling_allowlist in targets.yml) layered on top of the
 * project-wide config/spelling-allowlist.txt.
 *
 * locale: a key of SPELLING_DICTIONARIES; anything but the default must be
 * loaded with loadSpeller() first.
 */
export function findMisspellings(words, cap = 25, extraAllowlist = [], locale = DEFAULT_SPELLING_LOCALE) {
  const spell = getSpeller(locale);
  // Build a per-call allowed set so the shared speller is never mutated.
  const extra = new Set(extraAllowlist.map((w) => w.toLowerCase()));
  const distinct = new Set();
  let count = 0;
  for (const w of words) {
    if (!checkable(w)) continue;
    const bare = w.replace(/['']s$/, ''); // strip possessive
    if (extra.has(bare.toLowerCase())) continue;
    if (spell.correct(bare) || spell.correct(bare.toLowerCase())) continue;
    count++;
    if (distinct.size < cap) distinct.add(bare);
  }
  return { misspelledCount: count, misspelled: [...distinct] };
}
