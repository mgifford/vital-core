# Implementation prompt: profile/deployment decoupling + Hugging Face

> Drop-in replacement for the "Repository Authority and Deployment Model"
> section of the Copilot prompt. It points at concrete shapes already in the
> repo (`config/profiles/`, `.github/workflows/deploy-huggingface.yml`) so the
> agent fills a known mechanism rather than inventing an architecture.

## Two HF deployment shapes (pick per Space)

There are two valid, independent ways to use Hugging Face, both supported:

1. **Static mirror** (`sdk: static`). GitHub Actions crawls + builds, pushes
   `docs/` to the Space. HF only serves. Cheapest; GitHub stays sole source of
   truth. → `.github/workflows/deploy-huggingface.yml`.
2. **Docker appliance** (`sdk: docker`). A long-lived container *both* crawls
   its profile's targets on an internal schedule *and* serves the site. HF is
   a standalone scanner, not a mirror. → `Dockerfile` + `src/serve-hf.js`.
   Requires an **always-on (paid) Space** and **persistent storage**
   (`VITAL_DATA_ROOT=/data`) or crawl history is lost on restart. This is the
   chosen model for the VA profile.

---

## Repository authority and deployment model

The **authoritative** repository is `https://github.com/mgifford/vital-core`.
GitHub is the single source of truth: all code, configuration, profiles,
workflows, docs, tests, **and the committed scan data under `data/` and crawl
state under `state/`** live here. That accumulated data is the project's
history of every government site scanned — it must be **preserved, never
reset**. No task in this work deletes, moves, or regenerates `data/` or
`state/`.

`https://huggingface.co/spaces/mgifford/vital-core` is a **deployment mirror
only** — generated automatically from GitHub. Never treat it as a source repo,
never recommend manual edits there, never create features in it. Anything
HF-specific (README front matter, deploy metadata) is produced by the deploy
workflow, not authored by hand.

## Profiles and deployment targets are independent dimensions

A **profile** answers *which sites, branded how* — it is a named scope over the
site registry in `config/targets.yml`. A **deployment target** answers *where
it publishes*. They never reference each other. Any profile may publish to any
target (`github-pages ← cms`, `huggingface ← va`, …) with no code or workflow
edits.

The concrete shapes already exist — build to them, don't redesign them:

- **Profile schema:** `config/profiles/cms.yml` (the only real profile today).
  Contract and rules in `config/profiles/README.md`. A profile sets `name`,
  `targets` (a *selection* of domains/keys that already exist in
  `targets.yml`), `branding` (`title`, `intro`), and an optional
  deploy-specific `report_base_url`. It **must not** restate per-site scan
  settings (those have one home: `targets.yml`) and **must not** name a
  deployment target.
- **HF deploy workflow:** `.github/workflows/deploy-huggingface.yml` already
  exists — `workflow_dispatch` (with `profile` + `space` inputs), optional
  commented nightly schedule, builds with `node src/aggregate.js`, wraps
  `docs/` with `sdk: static` front matter, force-pushes `docs/` to the Space.
  It does **not** run on push and does **not** modify `report.yml`.

## What's left to implement (the actual work)

1. **Make the build profile-aware.** `src/aggregate.js` must honor a
   `VITAL_PROFILE` env var: load `config/profiles/<profile>.yml`, restrict the
   built domains to that profile's `targets`, and apply its `branding`
   (`title`/`intro`) to the report header in `src/report-html.js`. When
   `VITAL_PROFILE` is unset, behavior is **identical to today** (full site,
   current branding) — GitHub Pages via `report.yml` must not change.
   `report_base_url` resolution: profile value if set, else the existing
   `targets.yml` `report_base_url`, else relative.
2. **Add a unit test** for profile scoping: with a profile selecting a subset
   of targets, the aggregate output contains only those domains; with no
   profile, it contains all. This is the falsifiable acceptance check.
3. **Document the required secret.** CI needs an `HF_TOKEN` repository secret
   (write token for the Space). Locally it lives in `.env` (now gitignored;
   template in `.env.example`). The workflow already references
   `secrets.HF_TOKEN` — the agent's job is to document setting it, not to
   handle auth in code.

## Hard guardrails (do not violate)

- **Preserve all data.** Never touch `data/` or `state/`. Excluding a target
  from a profile hides it from that profile's report only; its data is shared
  and stays put.
- **`docs/` is never committed** to vital-core — it's a build artifact
  (gitignored). The HF deploy pushes `docs/` to the *Space* repo only.
- **One builder.** Both deploy targets run the same `node src/aggregate.js`;
  do not fork the report generator per target. They differ only by
  `VITAL_PROFILE`, `report_base_url`, and destination.
- **Don't scaffold empty profiles.** Ship the mechanism with `cms.yml` plus
  the `README.md` template. Add `va.yml`/`nsf.yml`/etc. only when their
  targets actually exist in `targets.yml`.
- **The internal site links are relative** — confirmed in `report-html.js`
  (`'../'.repeat(depth)`). No base-URL rewriting is needed for the site to
  work under the HF path. Only CSV absolute links use `report_base_url`.

## Acceptance test (must pass before merge)

Adding `config/profiles/<name>.yml` (selecting targets that exist) and
dispatching `deploy-huggingface.yml` with `profile=<name>` publishes that
scoped, branded site to the Space — **without editing any file under
`.github/workflows/` or `src/`.** If a new profile needs code changes, the
decoupling is broken; fix the build to read the profile generically.
