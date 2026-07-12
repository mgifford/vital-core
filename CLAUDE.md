# CLAUDE.md — vital-core

Instructions for Claude Code when working in this repository.

---

## Project overview

vital-core crawls government websites with Playwright/Chromium, runs
axe-core + Siteimprove Alfa accessibility audits plus a suite of
sustainability/standards engines, and publishes static HTML reports to
GitHub Pages via `docs/` (generated; gitignored locally, deployed as
a GitHub Actions artifact).

**Stack**: Node.js ESM ≥20, no build step, no bundler.

**Key commands**:
```bash
npm run scan          # crawl + audit one target (VITAL_DOMAIN=www.cms.gov)
npm run aggregate     # build docs/ from data/
npm run test:unit     # unit tests (Node built-in runner)
npm run test:e2e      # smoke test
npm run check:public-interest www.cms.gov   # quick 4-check diagnostic
```

**Optional — local LLM summaries** (adds `ollama_summary` to ai-findings output):
```bash
# Set VITAL_OLLAMA_URL in .env (see .env.example); defaults to http://localhost:11434.
# Any OpenAI-compatible server works (llama.cpp's llama-server, Ollama, LM Studio).
npm run check:ollama   # verify connectivity
```
This is always optional — absent or unreachable = no change in report output.

---

## Spec Kitty workflow

This project uses [Spec Kitty](https://spec-kitty.dev) as its AI-agent
orchestration layer. Every non-trivial feature goes through a mission.
Spec Kitty is not an LLM-specific workflow; a local LLM server is only an
optional runtime feature for `ai-findings` summaries.

Configured agent surfaces:

- `claude` — global Claude Code commands in `~/.claude/commands/spec-kitty.*.md`
- `codex` — project skills in `.agents/skills/spec-kitty.*`
- `copilot` — global GitHub Copilot prompts in `~/.github/prompts/`

On a fresh machine, materialize missing global/project agent surfaces before
trusting this list:

```bash
spec-kitty agent config sync --create-missing
spec-kitty agent config status
spec-kitty doctor skills --json
npm run check:spec-kitty
```

Prefer the strongest available reasoning model for `specify`, `plan`, `tasks`,
and `review`. Lower-capability local models can help with mechanical drafting,
but they should not be the final authority for scope, compatibility, or
acceptance gates.

### Session start

At the start of any implementation session, run these two commands and
include both outputs in your first message:

```bash
# 1. Check current mission state (what step is next)
spec-kitty next --agent <claude|codex|copilot> --mission <slug>

# 2. Get the structured prompt for that step
spec-kitty agent context resolve --action tasks --agent <claude|codex|copilot> --mission <slug>
```

For a mission that already has a plan and work packages, substitute
`tasks` with `implement` and add `--wp-id WP01` (etc.).

### Workflow

```
specify → fill spec.md → plan → implement (WP by WP) → accept → merge
```

1. `spec-kitty specify <feature-name>` — creates `kitty-specs/<mission>/`
2. Edit `kitty-specs/<mission>/spec.md` with concrete acceptance criteria
   (the "what", not the "how")
3. `spec-kitty plan --mission <slug>` — scaffolds ordered work packages
4. Implement one work package per agent session; commit when done
5. `spec-kitty accept --mission <slug>` — gate before opening a PR
6. PR targets `main`; after merge the branch is deleted

### Spec hygiene

- When you complete an acceptance criterion, add a ✓ beside it in `spec.md`.
- When you discover a criterion is wrong or superseded, update it in-place
  rather than leaving stale text.
- Before opening a PR, run `spec-kitty upgrade --dry-run` to catch drift.
- Never put implementation plans in `spec.md` — those belong in `plan.md`.

### Sustainability gate

The `sustainable-web-output` charter directive (`.kittify/charter/`) binds every
mission to the [W3C Web Sustainability Guidelines](https://w3c.github.io/sustainableweb-wsg/)
and [SUSTAINABILITY.md](https://mgifford.github.io/SUSTAINABILITY.md/). Each
mission's `spec.md` should carry a sustainability acceptance criterion — does the
change add client-side JavaScript or data transfer, and is it justified and
progressively enhanced? Is work done at build time rather than per request? Stays
within the no-web-fonts / static-SVG / ~2 KB-CSS budget? Treat it like the
severity taxonomy and accessibility rules: a standing gate, not an afterthought.

---

## Security rules (non-negotiable)

- **Never commit `.env`** — it contains `HF_TOKEN`.
- **VA domains are `hf_only: true`** — they must never run in GitHub Actions.
  The `.filter(t => !t.hf_only)` guard in `scan.yml` is the enforcement point.
- **VA `data/` and `state/` paths are gitignored** — Playwright may capture
  CSRF/OAuth tokens on those pages. The gitignore entries are the only defense.

---

## Severity taxonomy

Use axe-core's four labels **verbatim**. Never use High / Medium / Low.

| Label | axe impact |
|---|---|
| Critical | critical |
| Serious | serious |
| Moderate | moderate |
| Minor | minor |

---

## VITAL default view

Shown by default = WCAG A/AA issues that are Critical or Serious (any page
count), OR Moderate/Minor with ≥10 pages affected. Best Practice is always
hidden by default. "Show everything" toggle reveals all.

Priority tiers: 0 = Critical/Serious + WCAG A/AA; 1 = Critical/Serious +
BP/Undetermined; 2 = Moderate/Minor + WCAG A/AA + ≥10 pages; 5 = hidden.

---

## URL exclusion (three layers)

Three independent mechanisms drop URLs, at three different stages. Keep them
straight — they are not interchangeable:

| Layer | Key(s) | Stage | Who controls it | Effect |
|---|---|---|---|---|
| **Scan** | `url_exclude` / `url_exclude_file` (substring or `/regex/`), `url_include` | crawl | config author (`config/targets.yml`) | URL is never fetched or audited |
| **Report render** | `url_exclude_patterns` | build (aggregate) | config author | URL hidden from the rendered report for everyone; still scanned |
| **Viewer** | `localStorage['vital-exclude:<domain-key>']` | runtime, in the browser | the report reader | URL's findings hidden from *this viewer's* view; still scanned, still in the data/API |

The **viewer** layer (issue #209) is a progressive-enhancement control
(`exclusionBox()` + `exclusionFilterScript()` in `src/report-html.js`) shown on
the landing page (under the site-inventory line) and the Accessibility page. It
shares one per-domain `localStorage` list across both pages, filters findings
client-side, and supports export/import/copy-share. Matching mirrors the config
filter (`matchesExclusionPattern`): case-insensitive substring or slash-wrapped
`/regex/`. It is **additive** to the config `url_exclude_patterns` baseline and
never recomputes the headline score (a note flags the whole-site scope). With JS
off, the box is hidden and the full report renders. A finding is hidden when
**every affected page the viewer can see matches** the patterns. Findings with
>25 pages only carry a sample in the DOM (`data-complete=0`), so for those the
decision is **sample-based** — the banner flags how many were matched on a sample
and offers a "view everything" reset. (This is deliberately more aggressive than
"prove the whole finding is out of scope": on large gov sites almost every
finding spans >25 pages, so a strict rule never hid anything — see issue #209
feedback.) Matching is a case-insensitive substring or slash-wrapped `/regex/`;
prefer a substring like `.aspx` over an anchored `/\.aspx$/i`, since normalized
URLs keep query strings and the `$` anchor would miss `…\.aspx?x=1`.

The viewer can also **download a filtered copy** of the findings (issue #209
Phase 2): the box's "Download this view" controls fetch the pre-built `bugs.json`
on demand and re-filter it in the browser, saving `<domain>_<date>_bugs.filtered.
{csv,json}`. The filter uses the **same sample-based rule** as the on-screen
view, so the download matches what's shown (counts are recomputed only when the
sample is the complete list; larger findings keep their true counts). The browser
CSV serializer mirrors `bugsCsvTable()` (the single source of truth for the
bugs.csv schema, `src/lib/csv.js`) so filtered CSV is byte-identical to the server
export. The pre-built static files are never modified; this is on-demand,
client-side only.

The build-time **`url_exclude_patterns`** baseline (report render layer) is wired
through `aggregate.js` → `renderAccessibilityPage(…, target.url_exclude_patterns)`
→ `filterBugsByExclusion`; it also accepts substrings or `/regex/`. Keep that
argument threaded when touching the aggregate render call — it was silently
dropped once, which made the config exclusion a no-op.

---

## Information architecture

Reports are organized by the **visitor's question**, not the scanner's engine
list, in three layers (progressive disclosure):

- **Layer 1 "How are we doing?"** — the per-domain landing page
  (`renderDomainReport`): score + trajectory, then three deltas
  (**new / fixed / regressed** this week), then one **"biggest available win"**
  callout, then next actions. Supporting detail ("This week at a glance",
  trends, changes) is demoted into collapsed `<details>` drill-downs with a
  visible count in each summary. Inverted pyramid: conclusion → support → raw
  data. One primary action per page.
- **Layer 2 "What do I do next?"** — the next-actions queue with triage on the
  Accessibility page (`#h-next-actions`).
- **Layer 3 "Show me the evidence"** — the engine pages, grouped in the subnav
  by outcome question.

Conventions to preserve:

- **Deltas everywhere.** Pair a headline number with its week-over-week change +
  sparkline via `statTile(label, value, { deltaN, deltaOpts, spark })`. Finding-
  level new/fixed/regressed and the severity burndown come from
  `src/lib/progress.js` (pure functions over the committed findings ledger);
  aggregate computes them per week and passes them into the landing page.
- **Progress artifacts**: fixed-this-week list, severity **burndown**
  (`severityBurndown`), triage completion (client-side, reads
  `localStorage['vital-triage:<id>']`, blank with JS off), and streak badges
  (`streaks`).
- **One canonical location per finding.** A finding is rendered in full once (on
  the Accessibility page); other pages link to it (`pageHref('accessibility',
  instanceId)`), never re-render it.
- **Outcome nav.** The subnav (`SUBNAV_GROUPS`, `subnav()`) is grouped under
  **Accessible? · Fast? · Findable? · Trustworthy? · Sustainable?**. The nav is
  still FIXED (every criterion always listed; every sub-page always written with
  a "no data this week" empty state, so no 404s).

### Page filenames and the redirect-stub invariant

Page basenames are outcome-aligned and centralized in the `PAGES` map in
`src/report-html.js`; **all cross-links go through `pageHref(key, anchor)`**
(which also applies the active locale suffix). Current renames (`PAGE_REDIRECTS`):

| Key | File | Outcome |
|---|---|---|
| accessibility | `accessible.html` | Accessible? |
| lighthouse | `fast.html` | Fast? |
| readability | `findable.html` | Findable? |
| third-party | `third-parties.html` | Trustworthy? |

**Hard rule — never break a URL.** Fragment IDs are filename-independent
(`#h-*` heading literals; `#VS-*` content hashes from `bug-report.js`), but deep
links are hosted on specific files. **Any page rename MUST add an entry to
`PAGE_REDIRECTS` so a hash-preserving redirect stub (`redirectStub()`) is written
at the old basename**, for the default and every `-<loc>` sibling (see the
`aggregate.js` write loop). The stub uses `<link rel="canonical">` + meta-refresh
+ `location.replace(dest + location.hash)` so pinned issue links land on the
renamed page at the right anchor. When renaming, also update `tests/e2e.mjs`
(`SUBPAGES`, subnav/href assertions), `tests/unit/i18n-render.test.js` hrefs, and
any prose-embedded `t()` strings that hardcode the old href (migrate the catalog
keys too). The static JSON API keys on domain/week, not page filenames, so it is
unaffected.

---

## Code conventions

- **CSS changes**: edit the CSS string constant inside `src/report-html.js`.
  Never edit `docs/style.css` — it is gitignored generated output.
- **Engine modules**: `src/engines/<name>.js`. Wire into `src/scan.js`
  (runs per-page or per-origin) and `src/aggregate.js` (rolls up).
- **Sampling rate**: add a line to `config/targets.yml` under `sampling:`.
- **Numeric columns in HTML tables**: `<th class="num">` and `<td class="num">`
  right-align values. Sortable buttons inside `th.num` need `text-align: right`.
- **Download filenames**: `<domain>_<DDMONYYYY>_<type>.<ext>` via
  `filePrefix(domain, week)` in `src/lib/csv.js`.
- **No comments** explaining what code does — only comment when the *why*
  is non-obvious (hidden constraint, workaround, subtle invariant).

---

## Testing

- Unit tests live in `tests/unit/**/*.test.js`.
- All unit tests must pass before any PR is merged.
- No mocking of the database or filesystem in unit tests — use the real
  module APIs with small synthetic inputs.
- Run `npm run test:unit` after every change that touches `src/lib/`.

---

## PR discipline

- Branch off `main`, PR targets `main`.
- Push to the feature branch when work is ready for review — the user tests
  against `main` after merge, so merge before asking them to validate.
- Never force-push to `main`.
- Never use `--no-verify` to skip hooks.

---

## Static JSON API

`npm run aggregate` writes a versioned static JSON API to `docs/api/v1/` alongside
the HTML reports. Files are gitignored locally and deployed to GitHub Pages.

**Endpoint families** (all served from `https://<pages-host>/api/v1/`):

| Path | Description |
|---|---|
| `index.json` | All domains — severity counts, latest week, links |
| `<domain-key>/snapshot.json` | Full domain history — summary, findings ledger, weekly series |
| `<domain-key>/<week>/findings.json` | Per-week findings with trend status |

**Schema version**: `schema_version: "1"` in every file. Bump to `"2"` only with a
breaking change; add the new path under `api/v2/` and keep `v1/` until consumers migrate.

**No server required** — these are pre-built static files. The `src/lib/api-writer.js`
module builds them; `src/aggregate.js` calls `writeApiFiles()` once at the end of each run.

---

## Internationalization (i18n)

Reports can be published in multiple languages. The model is **Drupal/gettext
style**: the English source string is the key and the default.

- `src/lib/i18n.js` exposes `t(source, args)`, `setLocale()`, `getLocale()`,
  `setReportLanguages()` and locale-aware `nf()`. `t('Accessibility')` returns
  the English source unless the active locale's catalog has a translation. A
  missing **or empty** translation falls back to English, so partial catalogs
  are always safe. English has no catalog — it is the literal in the code.
- **Placeholders** use Drupal-style `@tokens`: `t('Showing @count of @total
  issue type(s).', { '@count': n, '@total': m })`. Inline `<script>` blocks are
  rendered per-locale server-side, so translated message *templates* are injected
  via `JSON.stringify(t('…'))` and the script only substitutes the number.
- **Supported locales**: `en`, `fr`, `ja`, `nl` (`SUPPORTED_LOCALES` in
  `src/lib/i18n.js`). Catalogs live in `src/locales/<locale>.json` as flat
  `{ "English source": "translation" }`. They are **human-reviewed**; the seeded
  files cover common UI chrome and the rest falls back to English.
- **Config**: global `languages` / `default_language` in `config/targets.yml`,
  overridable per target (e.g. Canada `languages: [en, fr]`). `src/lib/config.js`
  validates them. The `default_language` owns the canonical (unsuffixed) report
  paths; every other language is written as `<page>-<loc>.html` with a header
  language switcher (`languageSwitcher()` in `src/report-html.js`).
- **Latest-week only** (sustainability): `aggregate.js` builds non-default
  languages for the **latest** week per domain only; older weeks stay English at
  the canonical paths (graceful fallback). The fleet dashboard and url-lookup are
  built in every configured language, so `?lang=` at the site root still works.
- **`language_switcher` flag** (global or per target, default `true`): when
  `false`, the visible header switcher is suppressed but the `?lang=` /
  localStorage runtime and the per-language builds still happen — so every
  language stays reachable by URL with no visible change to the default pages.
- **Runtime selection** (`languageRuntime()` in `src/report-html.js`): a pre-paint
  script — emitted **only when more than one language is configured** — picks the
  language from `?lang=<loc>` (works from any page, persisted to
  `localStorage['vital-lang']`) or, on the default-language pages only, from a
  stored preference, and redirects to the sibling file. A click on the switcher
  persists the choice. `<link rel="alternate" hreflang>` tags are emitted for SEO.
  An explicitly-shared `<page>-<loc>.html` URL is never redirected away from. With
  a single configured language, none of this is emitted (no switcher, no script).
- **Scope is UI chrome only.** Engine-sourced text — axe-core/Alfa/WCAG rule
  descriptions, technology names, domain names — stays English by design.
  Internal severity keys stay `critical/serious/moderate/minor`; only the
  *display* labels localize (the taxonomy above is unchanged).

### Adding or updating a translation

1. `npm run i18n:extract` regenerates `src/locales/template.json` — a sorted
   `{ "source": "" }` checklist of every translatable string. `npm run i18n:check`
   fails if it is stale (use it in CI).
2. Copy needed entries into `src/locales/<locale>.json` and fill in the values.
   Preserve any `@tokens` and inline HTML (`<a href="…">`) verbatim.
3. Strings translated indirectly (via `t(variable)` or a label table — subnav
   labels, WCAG categories, `RESOURCE_LABELS`, etc.) are listed in
   `src/locales/dynamic-strings.json` so they appear in the template.
4. `npm run test:unit` runs the catalog-key lint (every catalog key must exist
   in the template) plus `t()` fallback/interpolation and render tests.
5. To add a brand-new locale, add it to `SUPPORTED_LOCALES`, its endonym to
   `LANGUAGE_ENDONYMS` in `src/report-html.js`, and create the catalog file.
