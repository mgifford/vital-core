# Mission Specification: Spelling locale

**Mission Branch**: `claude/vigilant-shannon-79oda8`
**Created**: 2026-10-27
**Status**: Implemented (awaiting review)
**Input**: vital-core-lgd `docs-internal/UPSTREAM-SUGGESTIONS.md` #1, and the
maintainer: "Being able to adjust spelling libraries would be useful for both
plain language work and basic spell checking. Canadian English is also
different than both US and UK spellings."

## Background

The plain-language engine reports misspelled words per page. It checks every
site against one US English dictionary (`dictionary-en`). Fleets outside the
US write in other English variants: UK councils (vital-core-lgd) write
"organisation", "colour" and "centre", and Canadian sites mix British and
American forms ("colour" but "organization"). Today every such correct word is
reported as a misspelling, which buries the real typos and makes the spelling
figures meaningless outside the US.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A fleet checks spelling in its own English (Priority: P1)

A fleet maintainer whose sites are written in British (or Canadian, or
Australian) English sets one value in `config/targets.yml`, and from the next
scan on, correct spellings in that variant are no longer reported as
misspellings.

**Why this priority**: it is the whole point: without it the spelling figures
for non-US fleets are mostly noise.

**Independent Test**: scan a page containing "organisation" and "colour" with
the fleet set to British English: neither word is reported. With the default
(US English), both are, as today.

**Acceptance Scenarios**:

1. ✓ **Given** `spelling_locale: en-GB` in `defaults`, **When** a page with
   "organisation", "colour" and "centre" is scanned, **Then** none of them is
   reported as misspelled, and a real typo on the same page still is.
2. ✓ **Given** no `spelling_locale` anywhere, **When** the same page is scanned,
   **Then** the result is exactly what it is today (US English).
3. ✓ **Given** `spelling_locale: en-CA`, **When** a page with "colour" and
   "organization" is scanned, **Then** neither is reported.

### User Story 2 - One target differs from the rest of its fleet (Priority: P2)

A fleet that is mostly in one variant includes a site written in another (for
example a US fleet with one Canadian partner site). The maintainer overrides
the locale for that one target.

**Why this priority**: mixed fleets exist, but they are the exception.

**Independent Test**: with `defaults.spelling_locale: en-US` and one target
set to `en-CA`, the Canadian target accepts "colour" and the others do not.

**Acceptance Scenarios**:

1. ✓ **Given** a per-target `spelling_locale`, **When** that target is scanned,
   **Then** its value wins over `defaults`.

### User Story 3 - Readers know which dictionary was used (Priority: P3)

Someone reading a report or the data can tell which English variant the
spelling figures were checked against, so a change in the count after a
fleet switches locale is explainable.

**Why this priority**: transparency for the people acting on the numbers; it
doesn't change the numbers themselves.

**Independent Test**: a page record produced with `en-GB` says `en-GB`; the
report's spelling section names the dictionary.

**Acceptance Scenarios**:

1. ✓ **Given** any scan, **When** the plain-language result is written,
   **Then** it records the locale it was checked against.
2. ✓ **Given** a domain's report, **When** it shows spelling results, **Then**
   it states the English variant used, as text.

### Edge Cases

- An unknown or misspelled locale value (`en-UK`, `fr`) must fail config
  loading with a message naming the supported values, not silently fall back
  to US English.
- Case differences (`en-gb`, `EN-GB`) are accepted and normalized.
- Switching a fleet's locale mid-history changes its misspelling counts from
  that week on. The data must make the switch visible (Story 3); old weeks
  are not rescanned.
- The project-wide `config/spelling-allowlist.txt` and per-target
  `spelling_allowlist` keep working with every locale.

## Requirements *(mandatory)*

### Functional Requirements

| ID | Requirement |
|---|---|
| FR-001 ✓ | `spelling_locale` can be set in `defaults` and overridden per target in `config/targets.yml`. |
| FR-002 ✓ | Supported values are `en-US` (default), `en-GB`, `en-CA` and `en-AU`, matched case-insensitively. |
| FR-003 ✓ | Config loading rejects any other value with an error that lists the supported values. |
| FR-004 ✓ | The plain-language engine checks spelling against the dictionary for the target's locale. |
| FR-005 ✓ | The project and per-target allowlists apply on top of whichever dictionary is used. |
| FR-006 ✓ | Each plain-language result records the locale it used. |
| FR-007 ✓ | The report's spelling section states the English variant used, as text. |
| FR-008 ✓ | With no `spelling_locale` set, results are identical to today's. |

### Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-001 ✓ | **Sustainability:** no client-side JavaScript and no extra data in published pages beyond one short line of text. Only the configured dictionary is loaded during a scan; unused ones are never read. The extra dictionaries add about 1.7 MB to `npm ci`, which is stated in the PR. |
| NFR-002 ✓ | The page-record and API schemas only gain an optional field; nothing existing changes shape (AGENTS.md rule 2). |
| NFR-003 ✓ | New report text goes through `t()` and the i18n template stays current (`npm run i18n:check`). |

### Constraints

- Plain Node, no build step; dictionaries come from the existing Hunspell
  packages already used for US English (`dictionary-en`), not a new engine.
- Readability formulas, passive-voice and acronym checks are unchanged: they
  are the same for every English variant.
- Only English variants are in scope. Other languages need their own
  plain-language rules and are a separate mission.

### Key Entities

- **Spelling locale**: a BCP 47 English tag naming the dictionary a target is
  checked against.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** ✓: With `en-GB`, a page containing "organisation", "colour",
  "centre" and "programme" reports none of them, and a planted typo
  ("accesibility") is still reported.
- **SC-002** ✓: With the default, all existing spelling unit tests pass
  unchanged.
- **SC-003** ✓: vital-core-lgd can switch to British English by adding one line
  to its `config/targets.yml`, with no code change in the fleet.
