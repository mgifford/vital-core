# Deploying VITAL Scans

Operator guide for deploying, configuring, maintaining, and troubleshooting an independent [VITAL Scans](https://github.com/mgifford/vital-core) instance.

**Status:** The GitHub Actions, companion data repository, and GitHub Pages model is the primary supported deployment architecture. Alternative hosting and deployment profiles require additional verification.

This document is intended for repository maintainers and people deploying VITAL for an organization or website inventory.

For the project introduction, see [README.md](../README.md). For the implementation architecture, see [ARCHITECTURE.md](../ARCHITECTURE.md).

## 1. Deployment architecture

A standard VITAL deployment uses two GitHub repositories:

| Repository | Contains | Responsibility |
|---|---|---|
| Code repository | Scanner, configuration, workflows, documentation and tests | Defines what to scan and how |
| Data repository | Page evidence, weekly summaries, finding ledgers and historical results | Preserves monitoring history |

GitHub Actions runs the scanner and report generator.

GitHub Pages publishes the generated reports.

Crawl progress is stored separately from Git history as compressed assets in the code repository's `scan-state` GitHub Release.

```text
Code repository
  |
  +-- config/targets.yml
  +-- src/
  +-- .github/workflows/
  |
  +-- scan.yml
  |     |
  |     +--> Crawl-state release
  |     |
  |     +--> Websites
  |     |
  |     +--> Data repository
  |
  +-- report.yml
        |
        +--> Read data repository
        |
        +--> Aggregate evidence
        |
        +--> Update weekly summaries
        |
        +--> Generate HTML and JSON
        |
        +--> Publish GitHub Pages
        |
        +--> Update reporting issue
```

The scanner does not require a continuously running application server or database for its standard GitHub deployment.

### Authoritative sources

- `config/targets.yml`: website inventory and scan settings.
- `.github/workflows/scan.yml`: scheduled and manually triggered scans.
- `.github/workflows/report.yml`: aggregation and publication.
- `.github/workflows/pdf-audit.yml`: optional PDF checks.
- `.github/workflows/diagnose.yml`: manual target diagnostics.
- `ARCHITECTURE.md`: system design.
- `API.md`: published JSON API contracts.

Do not duplicate configuration values in multiple files without an explicit reason.

## 2. Prerequisites

You need:

- A GitHub account with permission to create repositories.
- Permission to manage GitHub Actions secrets and repository settings.
- Git installed locally.
- Node.js 22 or newer.
- npm.
- SSH key generation tools.
- A suitable inventory of websites you are authorized to monitor.

For local browser testing, install Playwright Chromium.

The repository's `.nvmrc` currently selects Node.js 26 for its own workflows. Contributors should normally use that version even though `package.json` permits Node.js 22 or newer.

For GitHub Pages publication, the repository must have Pages enabled and GitHub Actions configured as the publication source.

### Responsible scanning

Before deployment, determine:

- Which websites are in scope.
- Whether the organization has approved the monitoring.
- Whether authentication is required.
- Whether the websites use bot protection or traffic restrictions.
- Appropriate scanning hours and request budgets.
- How the scanner should identify its operator.
- Who will review findings.
- Who is responsible for preserving and removing historical evidence.

VITAL respects `robots.txt` and configured crawl delays. Do not use the scanner to bypass security controls or access restrictions.

## 3. Create the code repository

There are two supported approaches for obtaining the code.

### Option A: Clone and retain upstream Git history

**Recommended when ongoing upstream updates are important.**

Clone VITAL:

```bash
git clone https://github.com/mgifford/vital-core.git
cd vital-core
```

Create an empty repository under your own GitHub account or organization.

Rename the existing remote:

```bash
git remote rename origin upstream
```

Add your new repository as `origin`, using its actual GitHub URL:

```bash
git remote add origin "$NEW_REPOSITORY_URL"
```

Before running the final command, set `NEW_REPOSITORY_URL` to the URL of the repository you created.

After reviewing the remote configuration and receiving the appropriate repository authorization:

```bash
git remote -v
git push -u origin main
```

This approach preserves shared history and makes subsequent upstream merges straightforward.

Do not push to a repository you do not control or have permission to update.

### Option B: Use the GitHub repository template

Open the [VITAL repository](https://github.com/mgifford/vital-core) and select **Use this template → Create a new repository**.

Do not select **Include all branches**.

A template-based repository begins with a new initial commit. It does not preserve the original repository's commit history.

This works for a standalone instance, but requires additional work if you want to merge future upstream updates.

#### Establish an upstream relationship

Clone your new repository and add VITAL as an upstream remote:

```bash
git remote add upstream https://github.com/mgifford/vital-core.git
git fetch upstream main
```

The original README documented a history-joining method that locates the upstream commit with the same Git tree as the template's initial commit.

Run the following only in a clean, newly created template repository:

```bash
ROOT_TREE=$(git rev-parse "$(git rev-list --max-parents=0 HEAD)^{tree}")
BASE=$(git log --format='%H %T' upstream/main | awk -v t="$ROOT_TREE" '$2 == t { print $1; exit }')
printf 'Matching upstream commit: %s\n' "$BASE"
```

Review the result.

If a matching commit is found, you can record that exact upstream commit as the template's common historical base:

```bash
if [ -n "$BASE" ]; then
  git merge -s ours --allow-unrelated-histories "$BASE" -m "Record matching VITAL upstream base"
else
  printf 'No matching upstream base found. Stop and investigate.\n' >&2
fi
```

**Do not substitute `upstream/main` for the matching base commit.**

Doing so can falsely mark newer upstream changes as already merged without applying them.

If no matching commit exists, stop. Do not guess which upstream revision was used to create the template.

Review the resulting Git history and repository contents before pushing.

## 4. Create the data repository

Create a second repository, such as:

`example-org/vital-data`

The standard GitHub deployment expects a separate public data repository.

Initialize it with a README so the default branch exists.

The current workflows use one companion data repository for all targets that are not marked `hf_only`.

They do not currently support splitting ordinary GitHub Actions scan data across multiple repositories.

### Data repository responsibilities

The data repository stores:

- Per-page scan records.
- Per-run execution records.
- Weekly summaries.
- Accessibility finding histories.
- Historical evidence and associated metadata.
- Optional screenshots and PDF audit results.
- Retention and archive metadata.
- Storage monitoring markers.

Its historical data should not be rewritten or deleted as part of routine application updates.

### Data visibility and privacy

A public data repository means that stored findings and supporting evidence may be publicly accessible.

VITAL includes sanitization and data-minimization safeguards, but operators must still review:

- URLs and query parameters.
- Screenshot content.
- Page text or element attributes.
- Potentially sensitive user information.
- Access tokens or session identifiers.
- Third-party service metadata.

Do not scan authenticated or confidential material into a public repository without an appropriate privacy review.

## 5. Configure the website inventory

Edit:

`config/targets.yml`

This is the main configuration file for monitoring.

### Repository settings

Update the repository-level settings:

```yaml
report_base_url: "https://example-org.github.io/vital-monitoring"

data_repo: example-org/vital-data
```

Replace the example organization and repository names with the ones used for your deployment.

`report_base_url` is used for absolute report links in certain exports. HTML navigation is generally relative.

### User agent

The crawler should identify its operator and provide a useful contact address or repository URL.

For example:

```yaml
defaults:
  user_agent: "vital-scans/0.1 (+https://github.com/example-org/vital-monitoring)"
```

Retain the other existing `defaults` values unless you have reviewed their effects.

### Website targets

Define the sites that should be monitored in the existing `targets:` collection.

For example:

```yaml
targets:
  - domain: www.example.gov
    importance: 3
    pages_per_run: 50
```

A new instance should remove or deliberately disable the original project's targets before scheduled scanning begins.

**Do not accidentally deploy the original VITAL inventory using your organization's credentials.**

That could cause unwanted requests to websites outside your intended scope.

### Scan budgets

Important settings include:

| Setting | Purpose |
|---|---|
| `pages_per_run` | Maximum number of pages attempted in a scan run |
| `max_pages_per_week` | Weekly page budget before importance adjustment |
| `importance` | Relative priority affecting weekly coverage |
| `delay_ms` | Delay between requests |
| `nav_timeout_ms` | Browser navigation timeout |
| `networkidle_cap_ms` | Maximum passive network-idle wait |
| `settle_delay_ms` | Additional wait before accessibility auditing |
| `max_crawl_depth` | Discovery depth limit |
| `priority_urls` | Important pages selected early |
| `priority_urls_file` | File containing priority URLs |
| `url_include` | Restrict scanning to matching URLs |
| `url_exclude` | Exclude matching URLs from crawling |

For initial deployment, use a small page budget and review actual request patterns before increasing coverage.

### Accessibility requirements

VITAL distinguishes the accessibility standard being assessed from a legally applicable baseline.

For example, a project may assess against WCAG 2.2 AA while identifying WCAG 2.0 AA requirements incorporated by US Section 508.

Review `finding_policy.conformance`, `finding_policy.legal_baseline`, and any jurisdiction-specific rules before enabling reports.

Do not assume that the configuration shipped for US federal websites applies to another jurisdiction.

### Engine sampling

Each testing engine has its own weekly sampling rate.

Rates are configured under `sampling:` in `config/targets.yml`.

A rate of `100` selects all eligible weekly pages for that engine; a lower rate selects a deterministic subset. A value of `0` disables the engine.

For example:

```yaml
sampling:
  axe: 100
  alfa: 50
  lighthouse: 10
  sustainability: 10
```

This example is illustrative. The real configuration has additional engines and settings that should be preserved.

Lighthouse is considerably more expensive than basic DOM inspection and may need a smaller sample.

### PDF audits

PDF checking is separately configurable.

The `pdf-audit` workflow runs on its own schedule for targets with PDF auditing enabled and can also be invoked manually.

Start with small document budgets.

Do not assume that a passing HTML scan establishes that linked PDF documents are accessible.

## 6. Configure languages and report features

VITAL supports multiple report languages.

For example:

```yaml
languages: [en, fr]
default_language: en
language_switcher: true
```

The default-language pages use canonical report paths.

Additional languages use locale-specific filenames.

Only the interface text is translated. Accessibility-rule descriptions originating from testing engines may remain in English.

Current language catalogs support English, French, Japanese, and Dutch.

Adding a language to the configuration builds its report pages. It does not create missing translations.

### Optional features

The configuration also supports selected optional capabilities, including:

- Screenshots, disabled by default.
- WebMCP, enabled per target.
- Consent handling based on explicit configured controls.
- Component signatures and page families.
- Report language-switcher visibility.
- Optional interactive charts.

Do not enable optional functionality solely because it exists. Review its storage, performance, accessibility, and privacy implications.

The report's primary content should remain usable without JavaScript.

## 7. Configure GitHub Actions credentials

The scanner must push results into the companion data repository.

The code repository's default GitHub Actions token does not automatically provide write access to a separate data repository.

The current workflows therefore use a dedicated SSH deploy key.

### Generate a deploy key

On a trusted local computer:

```bash
ssh-keygen -t ed25519 -N "" -C "VITAL Actions" -f vital-data-deploy-key
```

This creates:

- `vital-data-deploy-key`: private key.
- `vital-data-deploy-key.pub`: public key.

Do not commit either file.

### Configure the data repository

Open the data repository's settings.

Under **Deploy keys**, add the public key.

Enable **Allow write access**.

The key must belong to the data repository, not the code repository.

### Configure the code repository

Open the code repository.

Go to **Settings → Secrets and variables → Actions**.

Create a repository secret named:

`VITAL_DATA_DEPLOY_KEY`

Paste the complete private key, including its BEGIN and END lines.

The key must not appear in workflow YAML, documentation, chat messages, or Git commits.

After verifying that the secret has been stored and the key works, securely remove the local copies if they are no longer required.

### What the workflows verify

The `scan` and `report` workflows run `scripts/check-data-push.sh`.

This script confirms that the deploy key exists and tests whether Git can push to the companion repository.

If the push check fails, scanning or reporting stops before performing substantial work.

A successful repository checkout does not establish that the key has write access.

## 8. Configure repository permissions

In the code repository:

### GitHub Pages

Go to **Settings → Pages**.

Set the publication source to **GitHub Actions**.

The report workflow builds the static site and publishes it as a Pages artifact.

The generated site exists under `docs/` during the build. This directory is not committed to the code repository.

### GitHub Actions

Go to **Settings → Actions → General**.

Enable GitHub Actions.

Configure workflow permissions to permit the operations required by the scan and reporting workflows.

The workflows request scoped permissions, including:

- Reading and writing repository content where required.
- Publishing GitHub Pages artifacts.
- Using the GitHub Pages identity token.
- Updating the reporting issue.

Review the permissions before enabling the workflows. Do not grant broader access than necessary.

### Issues

Keep GitHub Issues enabled if you want the report workflow to publish its weekly summary to an issue named **Weekly scan reports**.

The report workflow can create or update that issue.

This is separate from the scanner's collection of website evidence.

## 9. Verify configuration before scanning

Do not enable regular monitoring until the deployment has passed local and CI checks.

### Install dependencies

From the code repository:

```bash
npm ci
npx playwright install chromium
```

### Run unit tests

```bash
npm run test:unit
```

### Run end-to-end tests

```bash
npm run test:e2e
```

Or run both:

```bash
npm test
```

The end-to-end tests use controlled fixtures. They are not proof that your actual target websites can be accessed from GitHub Actions.

### Review the target configuration

Confirm that:

- The original project's targets were removed or intentionally retained.
- Your data repository is configured correctly.
- The published base URL is correct.
- The user agent identifies your instance.
- Legal-baseline settings are appropriate.
- Sampling and page budgets are conservative.
- Sensitive or restricted websites have been excluded.
- Languages are configured correctly.
- No required secrets are embedded in source files.

## 10. Run the first scan

Use GitHub Actions to test the actual CI environment.

In the code repository:

1. Open **Actions**.
2. Select the **scan** workflow.
3. Choose **Run workflow**.
4. Enter a single configured domain.
5. Enter a small page budget, such as `10`.
6. Enable **Run report** if you want the report workflow to execute afterward.
7. Start the workflow.

Do not start several manual scans simultaneously.

The scanner uses a global concurrency group to control overlapping executions.

### Verify the scan

Inspect the Actions log.

Confirm that:

- The expected domain was selected.
- The deploy-key preflight passed.
- The scanner attempted the intended pages.
- Scan counts and outcomes are recorded.
- Pages blocked by access restrictions are identified.
- The corresponding data was committed to the data repository.
- Crawl state was saved when the run completed.

**A green GitHub Actions run is not sufficient evidence that pages were successfully scanned.**

Check the actual scan outcomes and records.

### Verify the reports

If the report workflow ran, confirm:

- New weekly summaries appear in the data repository.
- GitHub Pages deployed successfully.
- The dashboard loads.
- Your intended sites appear.
- Coverage and missing data are presented accurately.
- The JSON API is available.
- Report links and exports use the expected base URL.
- The weekly reporting issue was created or updated, if configured.

If a result seems implausibly clean, confirm that the intended pages were tested rather than a firewall, error page, redirect, or empty document.

## 11. Scheduled operation

The current GitHub Actions configuration separates scanning from reporting.

### Scan workflow

`.github/workflows/scan.yml`

The workflow uses staggered off-hours schedules.

Eligible domains are selected according to their configuration, remaining weekly budget, crawl state, and deployment restrictions.

Completed pages are ordinarily scanned no more than once per ISO week. Failed pages may be retried under the configured limits.

The workflows use ISO weeks to organize results.

### Report workflow

`.github/workflows/report.yml`

The report workflow runs on a separate daily schedule and can also be dispatched manually.

It:

1. Reads accumulated scan evidence.
2. Builds weekly summaries and derived data.
3. Commits updated summaries to the companion data repository.
4. Generates static HTML and JSON API files.
5. Deploys the site to GitHub Pages.
6. Publishes the weekly summary issue update.

It does not perform automatic historical-data pruning.

### PDF audit workflow

`.github/workflows/pdf-audit.yml`

The PDF audit is separately scheduled and can be triggered manually.

It processes configured PDF candidates within its own limits.

### Scheduling considerations

GitHub Actions schedules use UTC.

Scheduled runs can be delayed or skipped by GitHub. Monitoring should account for those possibilities rather than assuming exact execution times.

Before changing scan frequency, assess:

- The number of eligible domains.
- Typical page duration.
- Server politeness and rate limits.
- GitHub Actions resource consumption.
- Storage growth.
- Report freshness.
- Repeated infrastructure failures.

Do not increase scan frequency solely to produce more data.

## 12. Diagnosing blocked websites

Some websites respond differently to GitHub Actions than to a local desktop browser.

Common causes include:

- Web application firewalls.
- Bot-detection systems.
- Geographic or network restrictions.
- Authentication requirements.
- `robots.txt` restrictions.
- Redirect problems.
- Timeouts or unstable application behaviour.

### Manual diagnostic workflow

Open **Actions → diagnose**.

Enter the configured domain and run the workflow.

This compares available HTTP and browser observations from GitHub's network.

The diagnostic workflow does not publish scan records or modify the data repository.

It must not be used to bypass access controls.

### Local diagnostics

You can also use:

```bash
npm run diagnose -- www.cms.gov
```

Replace the domain with your configured target.

Local diagnostics describe your network environment. They may not reproduce restrictions experienced by GitHub Actions.

### What to do when a site blocks scanning

Identify the restriction and its likely cause.

If monitoring is authorized, work with the website operator to establish an appropriate access arrangement or allowlist.

Otherwise, record the site as unavailable and limit or stop the scan.

Do not repeatedly retry blocked pages without considering the operational impact.

See [WAF Allowlist Guidance](../WAF-ALLOWLIST.md).

## 13. Maintaining upstream compatibility

Organizations may deploy their own VITAL instances while receiving improvements from the original project.

The code repository should remain the source of truth for its own configuration and changes.

### Updating a clone with shared history

Fetch upstream changes:

```bash
git fetch upstream main
```

Review the changes before merging:

```bash
git log --oneline HEAD..upstream/main
git diff --stat HEAD..upstream/main
```

Merge after reviewing the impact on your local configuration:

```bash
git merge upstream/main
```

Resolve conflicts deliberately.

Pay particular attention to:

- `config/targets.yml`.
- GitHub Actions workflows.
- `package.json` and `package-lock.json`.
- Report schemas.
- API versioning.
- Storage and retention settings.
- Generated report behaviour.

Run the tests after merging.

### Template-based instances

If the instance was created with GitHub's template mechanism, confirm that the correct upstream history relationship has been established before merging.

Do not use a broad `-s ours` merge to bypass unrelated upstream history.

### Lockfile conflicts

If the lockfile conflicts after an upstream update, determine whether local dependency changes were intentional.

Do not automatically discard custom dependencies without reviewing them.

After resolving the conflict:

```bash
npm ci
npm test
```

### Contributing improvements upstream

General improvements should be proposed to [mgifford/vital-core](https://github.com/mgifford/vital-core).

Examples include:

- Scanner bugs.
- False-positive investigations.
- API inconsistencies.
- Accessibility problems in published reports.
- Improvements to data retention and storage.
- Better deployment documentation.
- Configuration assumptions that should be generalized.

Local target inventories and credentials should not be included in upstream contributions.

## 14. Data storage and retention

VITAL separates different kinds of persistent state.

| Data | Primary location | Retention |
|---|---|---|
| Application source | Code repository | Normal Git history |
| Crawl frontier | `scan-state` release assets | Updated as scanning progresses |
| Page evidence | Data repository | Preserved unless explicitly pruned |
| Weekly summaries | Data repository | Retained indefinitely |
| Finding ledgers | Data repository | Retained for historical comparisons |
| Published HTML and API | Generated GitHub Pages artifact | Rebuilt from evidence |
| Optional screenshots | Data repository | Subject to explicit retention policy |

### Crawl-state recovery

If a domain's crawl-state release asset is missing, the crawler can reseed from the site's sitemap and homepage.

That does not mean the previous scan evidence has been deleted.

However, losing crawl state can affect scanning efficiency and page-selection continuity.

### Retention safeguards

Automatic pruning is disabled.

Do not invoke the legacy `npm run prune` command as a routine maintenance action.

The current retention process requires:

1. A documented policy.
2. An approved archive destination.
3. A complete, verified archive.
4. A successful restore drill.
5. A readiness check.
6. Explicit authorization for the exact destructive operation.

The preview and readiness commands include:

```bash
npm run retention:plan -- --domain www.cms.gov
npm run retention:prune-check -- --domain www.cms.gov
```

Replace the example with the appropriate configured domain.

These commands do not authorize deletion.

Follow the [Retention Runbook](RETENTION-RUNBOOK.md) before considering any destructive operation.

Never rewrite Git history or remove historical evidence as a shortcut for reducing storage consumption without separate, explicit approval.

## 15. Monitoring storage and operating costs

Although the standard deployment does not require an application server, GitHub Actions and repository storage are not resource-free.

Operators should monitor:

- GitHub Actions execution time.
- Browser startup and scan duration.
- Number of pages successfully assessed.
- Number of blocked or failed pages.
- Data repository growth.
- Generated report artifact size.
- Screenshot and PDF evidence storage.
- Repeated scanning of unstable pages.

The report workflow includes storage-growth monitoring using markers in the data repository.

Storage warnings are advisory. They must not automatically trigger deletion.

Review the thresholds in `config/targets.yml` before changing them.

## 16. Alternative deployments and profiles

VITAL includes code and configuration related to deployment profiles and Hugging Face hosting.

These capabilities must be distinguished from the primary GitHub Actions deployment.

### Deployment profiles

Profiles are stored under:

`config/profiles/`

A profile selects existing targets and provides report-level metadata such as branding.

It should not duplicate scanning settings from `config/targets.yml`.

Current profile files include `cms.yml` and `va.yml`.

See [Profiles](../config/profiles/README.md).

### Hugging Face deployment

The repository contains:

- `Dockerfile`.
- `src/serve-hf.js`.
- `config/profiles/va.yml`.
- Historical deployment instructions and prompts.
- Hosting synchronization utilities.

The Docker appliance is designed to crawl a profile's targets and serve generated reports from a persistent volume.

Its configuration uses environment variables including:

- `VITAL_PROFILE`.
- `VITAL_DATA_ROOT`.
- `PORT`.
- `SCAN_INTERVAL_MS`.
- `SCAN_ON_START`.

The VA targets in `config/targets.yml` are marked `hf_only: true` and excluded from the ordinary GitHub Actions scan matrix.

**Current deployment status requires verification.**

The repository's available GitHub Actions workflows do not include the `deploy-huggingface.yml` or profile-aware deployment workflow referenced by some older documentation.

Do not treat the existence of a profile or Dockerfile as proof that a managed Hugging Face deployment is operating.

Before deploying this model, verify hosting availability, persistent storage, credentials, scheduled execution, authentication, and the handling of potentially sensitive scan data.

Do not push the public GitHub data repository into a hosting environment or transfer VA evidence to GitHub Actions without an explicit review of the relevant security and privacy boundaries.

### Future hosting

Alternative hosting should preserve the same core requirements:

- One authoritative configuration.
- Reproducible evidence.
- Durable crawl and scan state.
- Honest reporting of missing data.
- Controlled retention.
- No implicit disclosure of private data.
- Accessible published results.

Do not introduce a second source of truth merely to support another hosting provider.

## 17. Deployment troubleshooting

| Symptom | Likely cause | Investigation |
|---|---|---|
| Data repository checkout succeeds but push fails | Missing or read-only deploy key | Inspect `VITAL_DATA_DEPLOY_KEY` and data-repository deploy-key permissions |
| Scan runs but no data appears | No eligible pages, blocked site, or write failure | Inspect scan outcomes, selected target, and data-repository commits |
| Report workflow fails before building | Data-repository gate failed | Examine the push-access check and marker retrieval |
| GitHub Pages does not update | Deployment failure or report gate skipped | Inspect `report.yml`, Pages configuration, and deployment job |
| Dashboard shows no useful findings | No successful audits, engine sampling, or unexpected response | Review coverage and page outcomes |
| Scan encounters repeated 403 or 202 responses | WAF or bot protection | Run the manual diagnostic workflow |
| Scan is slow or exceeds runtime limits | Large page budgets, slow targets, expensive engines | Reduce budgets and Lighthouse sampling; review timeouts |
| Weekly trends appear inconsistent | Changing coverage, URL normalization, or testing conditions | Inspect revisions, sample size, and engine provenance |
| Data repository grows rapidly | Retained page detail, screenshots, PDFs, or repeated generated data | Review storage warnings and retention plans; do not delete automatically |
| Public report includes unexpected content | Configuration, sanitization, or disclosure issue | Stop publication as necessary, investigate, and follow an approved remediation process |

For persistent problems, open an issue in the relevant repository with the workflow name, commit, affected target, observed failure, and sanitized logs.

Do not publish secrets or potentially sensitive page evidence in an issue.

## 18. Deployment acceptance checklist

A deployment should not be considered operational until these checks are complete.

- [ ] Code repository exists and its upstream relationship is understood.
- [ ] Companion data repository exists.
- [ ] The original VITAL target inventory has been reviewed.
- [ ] Target domains and scan budgets are explicitly configured.
- [ ] The crawler identifies the correct operator.
- [ ] Accessibility assessment targets and legal baselines have been reviewed.
- [ ] The data repository's privacy implications have been assessed.
- [ ] A write-enabled deploy key is configured.
- [ ] The data repository push-access preflight succeeds.
- [ ] GitHub Pages is configured to publish through GitHub Actions.
- [ ] Unit and end-to-end tests pass.
- [ ] A small manual scan completes with recorded outcomes.
- [ ] Evidence is committed to the intended data repository.
- [ ] Crawl state can be preserved across runs.
- [ ] Reports are generated and published successfully.
- [ ] The published JSON API is accessible.
- [ ] Blocked or untested pages are reported accurately.
- [ ] Historical data is not automatically pruned.
- [ ] The operator has a documented response for failures and storage growth.

## 19. Related documentation

- [README](../README.md): Project overview.
- [ARCHITECTURE.md](../ARCHITECTURE.md): Crawling, scanning, storage, and publication.
- [FEATURES.md](../FEATURES.md): Implemented and planned features.
- [AGENTS.md](../AGENTS.md): Instructions for AI-assisted development.
- [CLAUDE.md](../CLAUDE.md): Additional development and operational conventions.
- [API.md](../API.md): Static JSON API.
- [MCP.md](../MCP.md): MCP integrations.
- [ACCESSIBILITY.md](../ACCESSIBILITY.md): Accessibility commitments.
- [SUSTAINABILITY.md](../SUSTAINABILITY.md): Sustainability commitments.
- [WAF-ALLOWLIST.md](../WAF-ALLOWLIST.md): Handling restricted websites.
- [Retention Runbook](RETENTION-RUNBOOK.md): Archive verification and authorized pruning.
- [Profiles](../config/profiles/README.md): Deployment scope and branding.

## 20. Maintaining this guide

Update this guide whenever deployment requirements, security boundaries, primary workflows, or supported hosting options change.

Preserve migration history and operational knowledge, but distinguish historical procedures from current instructions.

When implementation and documentation disagree, verify the current workflow and configuration before changing the documentation.

Do not describe a deployment capability as supported unless its requirements and operational behaviour have been verified.
