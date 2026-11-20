# Deployment models and optional profiles

VITAL Scans supports independently configured installations for different organizations, website inventories, and research projects.

**The recommended approach is to maintain a separate repository for each independently operated VITAL instance**, rather than managing multiple deployments through an expanding collection of configuration profiles in one repository.

Profiles remain available as an optional way to produce a subset of reports from an existing installation. They are not the recommended approach for operating separate monitoring programmes.

## Recommended approach: independent repositories

Each VITAL installation should be able to operate independently, with its own:

- Website inventory and scanning configuration.
- GitHub Actions workflows and schedules.
- Companion data repository and historical evidence.
- Deployment credentials and permissions.
- GitHub Pages reporting site.
- Accessibility, performance, and sustainability assessments.
- JSON API, exports, and investigation tools.
- Maintenance, testing, and upgrade process.

An independent installation should retain the full capabilities of VITAL rather than being restricted to a reduced set of features because it uses a particular profile.

Actual feature availability depends on the VITAL revision deployed in that repository. Independent installations are responsible for integrating relevant upstream improvements.

### Existing installations

The following repositories demonstrate this approach:

| Project | Focus | Repository |
|---|---|---|
| VITAL Core | US government website monitoring and upstream development | [mgifford/vital-core](https://github.com/mgifford/vital-core) |
| VITAL Core NSF | National Science Foundation websites | [mgifford/vital-core-nsf](https://github.com/mgifford/vital-core-nsf) |
| VITAL Core LGD | LocalGov Drupal and local government websites | [localgovdrupal/vital-core-lgd](https://github.com/localgovdrupal/vital-core-lgd) |

These are separate codebases and deployments, not profiles of one shared runtime.

The NSF and LocalGov Drupal repositories maintain their own target configurations and scanning and reporting workflows.

This approach gives each installation control over its scope, operations, data, and maintenance without requiring deployment-specific exceptions in the main VITAL repository.

### Why separate repositories?

Managing deployments through one repository introduces unnecessary coupling when different organizations need different:

- Website inventories and scanning budgets.
- Access permissions and data governance.
- Deployment schedules.
- Hosting arrangements.
- Reporting priorities.
- Maintenance responsibilities.
- Development timelines.

Separate repositories make those responsibilities explicit.

They also allow improvements to be developed and evaluated within a particular installation before being contributed upstream for broader use.

The trade-off is that repositories can diverge. Shared improvements should be contributed upstream where appropriate, and downstream maintainers should periodically incorporate relevant changes.

The aim is to reuse the VITAL engine and its established interfaces, not to maintain permanently incompatible versions.

See the [deployment guide](../../docs-internal/DEPLOYMENT.md) for instructions on creating and operating an independent installation.

## What profiles still do

A profile defines a subset of targets and optional reporting metadata within a single VITAL installation.

Profiles live in `config/profiles/`.

A profile can specify:

| Field | Purpose |
|---|---|
| `name` | Human-readable profile name |
| `targets` | Existing target domains or keys to include |
| `branding.title` | Report title |
| `branding.intro` | Report introduction |
| `report_base_url` | Optional base URL used for certain generated links |

A profile does not define an independent scanning environment.

All profile targets must already exist in [`config/targets.yml`](../targets.yml), which remains the authoritative source for scanning configuration.

Profiles must not duplicate per-target settings such as sampling rates, crawl limits, delays, or engine configuration.

### Profile-scoped aggregation

The aggregation code supports selecting an existing profile through the `VITAL_PROFILE` environment variable.

For example:

```bash
VITAL_PROFILE=cms npm run aggregate
```

This generates reports for the targets selected by `config/profiles/cms.yml`, using the scan evidence available to the current installation.

It does not:

- Create a separate VITAL instance.
- Acquire or scan additional websites.
- Create an independent data repository.
- Establish a separate scanning schedule.
- Configure GitHub Pages or another hosting provider.
- Preserve separate historical evidence for that profile.

Generated output is not an independent deployment merely because it was built using a profile.

The standard GitHub Actions reporting workflow does not currently provide a general-purpose profile deployment interface.

### When profiles remain useful

Profiles may still be appropriate for:

- Generating a focused report from an existing monitoring dataset.
- Experimenting with report branding or presentation.
- Building a temporary subset of reports for evaluation.
- Testing profile-aware aggregation without deploying another instance.

Profiles should not be introduced merely to create another organization's monitoring service.

For that purpose, use a separate repository.

## Existing profile files

### `cms.yml`

[`cms.yml`](cms.yml) is an existing example of profile-scoped reporting for Centers for Medicare & Medicaid Services websites.

It selects targets already registered in the main VITAL inventory.

The main VITAL installation continues to monitor its configured websites through the standard scan and report workflows. The existence of this profile does not mean that it has a separate production deployment.

Retain this file while profile-aware aggregation remains useful.

### `va.yml`

[`va.yml`](va.yml) documents an experimental Department of Veterans Affairs deployment associated with Hugging Face Spaces.

**This configuration is not actively maintained or supported.**

It remains in the repository as a record of an earlier implementation and a possible starting point for future experimentation.

Its presence does not establish that VA scanning is currently operational.

VA targets are marked `hf_only: true` in `config/targets.yml`. This excludes them from the standard GitHub Actions scanning workflow. That restriction must not be removed merely to reactivate a profile.

Do not present `va.yml` as a supported production deployment.

## Hugging Face: proof of concept

VITAL has previously demonstrated that its scanning and reporting architecture can be adapted to Hugging Face Spaces.

The repository retains relevant implementation material, including:

- [`Dockerfile`](../../Dockerfile).
- [`src/serve-hf.js`](../../src/serve-hf.js).
- [`config/profiles/va.yml`](va.yml).

This demonstrates an alternative deployment model in which a persistent application can perform scans and serve generated reports.

However, **Hugging Face is not an actively supported deployment target for this project**.

The current repository does not contain a maintained `deploy-huggingface.yml` workflow. Earlier documentation describing automatic deployment to arbitrary profiles and hosting providers should be treated as historical design material, not a description of supported functionality.

### Reintroducing Hugging Face support

Hugging Face support could be restored if there is sufficient interest and a clear maintainer or operational need.

That work would require:

1. Verifying the current hosting and runtime capabilities.
2. Reviewing the existing Docker implementation.
3. Establishing persistent, appropriately protected data storage.
4. Validating deployment credentials and security boundaries.
5. Testing scheduled scanning, publication, and recovery.
6. Documenting maintenance responsibilities and operational costs.
7. Demonstrating an end-to-end deployment before describing it as supported.

A restored deployment should reuse VITAL's existing scanning, evidence, and reporting capabilities rather than introduce a separate implementation.

Until this work is completed, Hugging Face should be regarded as an experimental deployment option.

## Creating another VITAL installation

To monitor a new organization or group of websites, start with an independent repository based on VITAL Core.

The typical process is:

1. Create a code repository from the VITAL source or repository template.
2. Create and configure a companion data repository.
3. Update `config/targets.yml` with the intended website inventory, policies, scanning budgets, and deployment settings.
4. Configure GitHub Actions credentials and GitHub Pages.
5. Run controlled initial scans, validate the collected evidence, and enable regular monitoring once the deployment is verified.

There is normally no need to create a new file under `config/profiles/`.

Follow the [deployment guide](../../docs-internal/DEPLOYMENT.md) for the complete process.

### Keeping installations aligned

Independent installations should:

- Track the upstream VITAL Core repository.
- Preserve stable data and API contracts.
- Avoid unnecessary changes to shared scanning behaviour.
- Contribute generally useful fixes upstream.
- Incorporate upstream improvements after reviewing compatibility.
- Maintain their own deployment and operational documentation.
- Run the relevant tests before updating production workflows.

Local differences are appropriate when they address a genuine requirement of the installation.

They should not lead to unnecessary duplication of general-purpose functionality.

## Current status

| Capability | Status |
|---|---|
| Independent GitHub-based VITAL installations | Recommended deployment model |
| NSF installation | Separate repository with its own configuration and workflows |
| LocalGov Drupal installation | Separate repository with its own configuration and workflows |
| Profile-scoped aggregation through `VITAL_PROFILE` | Implemented |
| Automatically deploying arbitrary profiles to different hosting providers | Not implemented as a maintained workflow |
| CMS profile | Existing optional reporting configuration |
| VA profile | Historical, inactive |
| Hugging Face Docker implementation | Experimental proof of concept, not actively supported |

## Related documentation

- [VITAL Core README](../../README.md): Project overview and capabilities.
- [Deployment guide](../../docs-internal/DEPLOYMENT.md): Creating and operating independent installations.
- [Architecture](../../ARCHITECTURE.md): Scanning, data storage, and reporting.
- [Target configuration](../targets.yml): The authoritative website inventory and scan settings.
- [Feature status](../../FEATURES.md): Implemented and planned capabilities.

This documentation should be updated when the recommended deployment model changes or when experimental hosting integrations become supported.

**Independent repositories are the default. Profiles are an optional reporting mechanism, not the foundation for operating multiple VITAL installations.**
