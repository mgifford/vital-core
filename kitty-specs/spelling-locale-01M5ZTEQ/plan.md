# Plan: Spelling locale

Mission `spelling-locale-01M5ZTEQ`. Scaffolded with `spec-kitty specify`
3.2.7 on `claude/vigilant-shannon-79oda8`; the spec is in `spec.md`.

## Summary

Add a `spelling_locale` setting (`en-US` default, `en-GB`, `en-CA`, `en-AU`)
that picks the Hunspell dictionary the plain-language engine checks against.
The dictionaries are the `dictionary-en*` packages from the same author as the
existing `dictionary-en`; each exports `{ aff, dic }` the same way.

Checked before planning, with nspell on each package:

| Word | en-US | en-GB | en-CA | en-AU |
|---|---|---|---|---|
| organisation | ✗ | ✓ | ✗ | ✓ |
| organization | ✓ | ✗ | ✓ | ✗ |
| colour / centre / behaviour | ✗ | ✓ | ✓ | ✓ |
| programme | ✗ | ✓ | ✗ | ✗ |
| accesibility (typo) | ✗ | ✗ | ✗ | ✗ |

`en-GB` is the "-ise" dictionary, as GOV.UK style uses. A site that writes
Oxford "-ize" British English adds its words to the allowlist.

## Charter check (sustainable-web-output)

- **No client-side JavaScript**; the report gains one line of text.
- **Build-time only**: the locale is chosen at scan time, and the report reads
  it from the data.
- **Only the configured dictionary is loaded.** US English stays a static
  import, so the default path is byte-for-byte today's; the others are
  imported on first use.
- **Install size**: three more dictionaries, ~575 KB each unpacked
  (~1.7 MB) in every `npm ci`. Accepted: a dictionary per variant is the
  smallest correct option, and loading is lazy.

## WP01: Config and dictionaries (FR-001–003, FR-005, FR-008)

- `package.json`: add `dictionary-en-gb`, `dictionary-en-ca`,
  `dictionary-en-au` (`^3.0.0`).
- `src/lib/config.js`: `SPELLING_DICTIONARIES` (locale → package);
  `spelling_locale` merges from `defaults` like other target keys, is
  normalized case-insensitively, defaults to `en-US`, and an unknown value
  throws with the supported list.
- `src/lib/spell.js`: one cached speller per locale, each with the project
  allowlist; `loadSpeller(locale)` imports a non-default dictionary once;
  `findMisspellings(words, cap, extra, locale = 'en-US')` stays synchronous
  and throws if that locale wasn't loaded.
- Tests (`tests/unit/config.test.js`, `tests/unit/lib.test.js`): default,
  normalization, per-target override, rejection; the SC-001 words per
  locale; allowlists still apply; existing spelling tests unchanged.

## WP02: Engine, record and report (FR-004, FR-006, FR-007)

- `src/engines/plain-language.js`: take `spellingLocale`, `await
  loadSpeller()` before checking, and return `spellingLocale` in the result.
- `src/scan.js`: pass `target.spelling_locale`.
- `src/aggregate.js`: roll up the locales seen this week as
  `plainLanguage.spellingLocales`; records without the field count as
  `en-US`, which is what they were checked against.
- `src/report-html.js`: the "Possible misspellings" note states the variant
  ("Checked against the British English dictionary."), as text through
  `t()`; `npm run i18n:extract` updates the template.
- Tests: render test for the note.

## WP03: Docs

- `config/targets.yml`: document `spelling_locale` with the per-target
  options, and add it to `defaults` with the US default.
- `AGENTS.md` engine inventory / `CLAUDE.md`: one line each where the
  plain-language engine and its allowlist are described.

## Risks

- **Week-over-week step change** when a fleet switches locale. Mitigated by
  FR-006/FR-007: the data and report say which dictionary each week used.
- **Dictionary quality** differs between variants (SCOWL-derived). Out of
  scope; the allowlists remain the escape hatch.
