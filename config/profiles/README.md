# Profiles

A **profile** is a named scope over the site registry in
[`config/targets.yml`](../targets.yml), plus the report-level metadata for
one published instance. Profiles exist so the same scan data and the same
build code can produce several differently-scoped published sites (CMS-only,
NSF-only, a whole-of-government view, …) without forking anything.

## The two-dimensional model

Profiles and **deployment targets** are independent:

| Dimension          | Answers                                  | Lives in                                  |
| ------------------ | ---------------------------------------- | ----------------------------------------- |
| Profile            | *Which sites, branded how?*              | `config/profiles/<name>.yml`              |
| Deployment target  | *Published where?*                       | `.github/workflows/deploy-*.yml` dispatch |

Any profile can go to any deployment target. The profile never names a
deployment target, and the deploy workflow never hard-codes a profile —
both are passed at dispatch time. So all of these are valid combinations
with **no code or workflow changes**:

```
github-pages  ←  cms
github-pages  ←  nsf
huggingface   ←  ed
huggingface   ←  va
```

## What a profile MAY set

- `name` — human-readable label, shown in branding and deploy logs.
- `targets` — a list of `domain` or `key` values **that already exist in
  `targets.yml`**. A profile *selects* targets; it never restates their
  scan configuration.
- `branding` — `title` and `intro` for the report header.
- `report_base_url` — base URL for absolute CSV links. Deploy-target
  specific; usually left empty here and overridden at deploy time.

## What a profile MUST NOT do

- **Never** duplicate per-site scan settings (budgets, sampling, delays).
  Those have exactly one home: `targets.yml`. Duplication here would drift.
- **Never** name a deployment target or publishing destination.
- **Never** alter or move data on disk. Excluding a target from a profile
  hides it from that profile's reports; the crawl state and scan data under
  `state/` and `data/` are shared and untouched — preserving the history
  gathered across all profiles.

## Adding a new profile

1. Ensure every site you want is already a target in `targets.yml` (add it
   there if not — that's where scan behavior is defined).
2. Copy `cms.yml` to `config/profiles/<name>.yml` and edit `name`,
   `targets`, and `branding`.
3. Deploy it: dispatch `deploy.yml` (GitHub Pages) or
   `deploy-huggingface.yml` with `profile=<name>`.

> **Acceptance contract:** adding a profile file and dispatching a deploy
> workflow with `profile=<name>` must publish successfully **without editing
> any file under `.github/workflows/` or `src/`.** If a new profile requires
> code changes, the decoupling is broken — fix the build to read the
> profile, don't special-case the profile in code.

## Status today

`cms.yml` is the only real profile. `targets.yml` remains the source of
truth for scan behavior, and the existing GitHub Pages publish path
(`report.yml`) is unchanged. Profile-aware scoping in the build
(`src/aggregate.js`) and the `deploy-huggingface.yml` workflow are the
pieces that wire this up — see the implementation prompt.
