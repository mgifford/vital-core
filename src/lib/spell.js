import fs from 'node:fs';
import path from 'node:path';
import nspell from 'nspell';
import dictionary from 'dictionary-en';
import { DIRS } from './config.js';

/**
 * Spell checking for page prose. Uses nspell with the en dictionary,
 * plus an optional project allowlist (config/spelling-allowlist.txt, one
 * term per line, # comments) for domain jargon — government, medical,
 * and program terms that aren't in a general dictionary but are correct.
 *
 * The dictionary is loaded once and reused. Numbers, ALL-CAPS acronyms,
 * URLs/emails, and very short tokens are skipped: those are not spelling
 * mistakes and would only add noise.
 */

let speller = null;

function getSpeller() {
  if (speller) return speller;
  speller = nspell(dictionary);
  // Layer the allowlist on top so jargon stops being flagged.
  const allowPath = path.join(DIRS.config, 'spelling-allowlist.txt');
  if (fs.existsSync(allowPath)) {
    for (const line of fs.readFileSync(allowPath, 'utf8').split('\n')) {
      const t = line.trim();
      if (t && !t.startsWith('#')) speller.add(t);
    }
  }
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
 */
export function findMisspellings(words, cap = 25, extraAllowlist = []) {
  const spell = getSpeller();
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
