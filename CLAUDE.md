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

**Optional — local Ollama LLM** (adds `ollama_summary` to ai-findings output):
```bash
# Set in .env (see .env.example); defaults to http://localhost:11434
npm run check:ollama   # verify connectivity
```
Ollama is always optional — absent or unreachable = no change in report output.

---

## Spec Kitty workflow

This project uses [Spec Kitty](https://spec-kitty.dev) as its AI-agent
orchestration layer. Every non-trivial feature goes through a mission.
Spec Kitty is not an Ollama-specific workflow; Ollama is only an optional
runtime feature for `ai-findings` summaries.

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
