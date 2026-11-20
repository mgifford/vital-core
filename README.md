# VITAL Scans

**Open-source, continuous website quality monitoring for accessibility, performance, sustainability, and the public interest.**

[VITAL Scans](https://github.com/mgifford/vital-core) helps organizations understand how the quality of their websites changes over time.

Rather than relying on occasional audits, VITAL uses recurring, carefully budgeted scans to identify problems, observe changes, and help teams prioritize improvements.

It was developed with government websites in mind, where accessibility, transparency, reliability, and responsible use of public resources are essential.

The central question is not simply *"Does this website pass an automated test?"* It is **"Is this website getting better for the people who depend on it?"**

**[Explore the published VITAL Scans reports](https://mgifford.github.io/vital-core/)**

## Explore the reports

VITAL publishes accessible reports through GitHub Pages. You do not need to install software or have a GitHub account to explore the published results.

Reports help answer questions such as:

- Which accessibility problems affect the most pages?
- Which problems are newly observed, persistent, or no longer observed?
- Are website performance and resource use improving?
- Are recurring problems associated with shared technologies or components?
- Which pages or issues warrant further investigation?
- What evidence is available, and what still requires human verification?

The [public dashboard](https://mgifford.github.io/vital-core/) provides an overview of monitored websites and links to their detailed reports.

Each website has its own history, including the pages assessed, findings, trends, and limitations of the available evidence.

**These reports are monitoring evidence, not accessibility certifications or declarations of legal conformance.**

## What does VITAL measure?

VITAL collects several complementary indicators of website quality.

### Accessibility

VITAL uses two independent open-source accessibility testing engines:

- [axe-core](https://github.com/dequelabs/axe-core), maintained by Deque.
- [Siteimprove Alfa](https://github.com/Siteimprove/alfa), an open-source accessibility evaluation engine.

The engines implement different testing rules and may produce different findings on the same page.

VITAL preserves engine provenance and supports comparisons, rule mappings, and investigations into overlapping or inconsistent results.

Accessibility reporting includes references to relevant WCAG requirements, with the applicable assessment target and legal baseline configured for each monitored website.

Automated tests identify some accessibility barriers, but they cannot establish complete WCAG conformance. Manual accessibility and usability testing remain essential.

### Performance

VITAL uses [Google Lighthouse](https://github.com/GoogleChrome/lighthouse) and browser resource measurements to investigate performance.

It examines indicators such as loading behaviour, page resources, performance recommendations, and changes over time.

A stable group of important pages supports more meaningful historical comparisons.

Performance results depend on the testing environment, page state, and measurement conditions. A change in a score is not automatically a regression or improvement.

### Sustainability

VITAL collects resource-use indicators that can help identify opportunities to reduce unnecessary data transfer and computational work.

It uses [CO2.js](https://github.com/thegreenwebfoundation/co2.js) to estimate environmental impacts from available page-resource evidence.

These estimates are model outputs, not direct measurements of device energy consumption or verified carbon emissions.

The project follows the direction of the [W3C Web Sustainability Guidelines](https://w3c.github.io/sustainableweb-wsg/) and applies sustainability principles to its own scanning and reporting infrastructure.

### Content and discoverability

VITAL examines indicators including:

- Plain-language readability, spelling, and writing heuristics.
- Page metadata, titles, language declarations, and canonical URLs.
- Structured data and relevant web standards.
- Broken links and navigation-related signals.
- Image inventories and alternative-text indicators.
- Linked documents and other embedded resources.

These checks identify potential concerns. They cannot independently establish that content is understandable, accurate, or suitable for its intended audience.

### Security, public-interest signals, and technology

VITAL also collects selected HTTP security-header signals, public-interest metadata, and technology fingerprints.

Technology identification uses the open-source [Wappalyzer](https://github.com/HTTPArchive/wappalyzer) dataset. These observations are indicative, not authoritative inventories of a website's software.

VITAL can identify patterns associated with particular technologies across multiple websites. Such relationships are investigative leads, not proof that a technology caused an accessibility or performance problem.

### PDF documents

An optional PDF audit workflow examines linked PDF documents for configured targets.

Document findings are reported separately from HTML page findings, with their own testing limitations.

## How continuous monitoring works

VITAL monitors a configured inventory of websites rather than accepting arbitrary one-off scan requests.

It uses incremental crawling and sampling so that work can be spread across the week without repeatedly requesting the same pages unnecessarily.

The monitoring process follows five stages:

1. **Discover:** Identify pages through sitemaps, selected priority URLs, and links found during crawling.
2. **Sample:** Select pages and testing engines according to documented budgets and coverage rules.
3. **Measure:** Collect accessibility, performance, sustainability, and other configured evidence.
4. **Compare:** Preserve results by ISO week and compare them with previous observations.
5. **Publish:** Generate accessible reports, data exports, and historical summaries.

VITAL respects `robots.txt`, identifies its crawler, applies delays between page requests, and limits how much work it performs.

Pages that cannot be accessed because of a firewall, bot protection, technical failure, or other restriction must be identified as unavailable. They are not treated as passing tests.

The primary GitHub deployment uses GitHub Actions for scanning and reporting, a separate repository for scan data, and GitHub Pages for publication. It does not require a continuously running application server or database.

See [Architecture](ARCHITECTURE.md) for the implementation details.

## Understanding the evidence

VITAL aims to make website quality findings useful without overstating what automated tools can establish.

### Findings and trends

A finding can be newly observed, repeatedly observed, or no longer observed under the available testing conditions.

These categories require careful interpretation.

For example, a finding that is no longer detected may have been fixed. Alternatively, the page may have changed, the rule may not have run, or the testing environment may have differed.

**Not observed is not the same as verified fixed.**

Similarly, an accessibility score is an automated health signal. It is not a percentage of WCAG conformance or a measure of the proportion of users who can complete a task.

### Coverage and uncertainty

The reports distinguish between:

- Pages discovered and pages successfully scanned.
- Engines that ran and engines that did not run.
- Findings supported by recorded evidence.
- Findings requiring further investigation.
- Inconclusive, unavailable, or untested conditions.
- Automated observations and human-reviewed evidence.

A high score on a limited sample must not be presented as a complete evaluation of a website.

### Repeated problems

A single defective navigation component may appear on hundreds of pages.

VITAL emphasizes the number of pages affected and investigates shared patterns rather than treating every repeated occurrence as an unrelated problem.

Component associations and inferred ownership remain provisional until supported by appropriate evidence.

## Investigating accessibility problems

VITAL includes tools intended to help developers, accessibility specialists, and website owners move from a reported finding to an actionable investigation.

### Finding Explorer

The Finding Explorer provides searchable and filterable access to recorded accessibility findings.

Depending on the available evidence, a finding may include:

- The testing engine and rule.
- Relevant WCAG or ACT references.
- The page where it was observed.
- A selector or recorded element identity.
- Semantic region or containing widget information.
- A possible shared-component association.
- Historical evidence and reproduction information.
- Guidance for manual verification.

Filters and supporting controls enhance the reports without replacing their accessible HTML content.

### Inspecting findings on a live website

An optional VITAL Inspect bookmarklet and local Playwright inspector can help locate recorded elements on a live page.

These tools support investigation. They do not establish that a historical problem still exists.

A changed or missing element is reported as such rather than being silently replaced with a different match.

### Reproducible testing

VITAL can generate and execute targeted Playwright reproductions for supported findings.

These are separate, deliberate investigations. Routine monitoring does not automatically execute reproduction tests for every reported problem.

A reproduction that fails to locate an element does not prove the original issue was fixed.

### Manual testing

VITAL provides guidance and downloadable records to support human accessibility evaluation.

The system does not automatically claim that manual testing was completed.

The [W3C Accessibility Roles and Responsibilities Mapping](https://www.w3.org/WAI/planning/arrm/) can also help identify typical responsibilities associated with accessibility requirements. These mappings do not establish ownership of a particular defect.

## Accessibility evaluation reports

VITAL supports evaluation-oriented exports, including draft OpenACR and WCAG-EM-aligned reports, depending on the monitored website's configuration.

These outputs serve different purposes.

**OpenACR** provides a structure used for Accessibility Conformance Reports, particularly in procurement contexts. VITAL's generated output is explicitly incomplete and requires qualified human review.

**WCAG-EM-aligned reporting** organizes automated evidence around the W3C website accessibility evaluation methodology. The output is an automated pre-assessment, not a completed WCAG-EM evaluation.

Neither output should be used as a verified conformance statement without the necessary evaluation.

See [WCAG-EM and ACR documentation](docs-internal/WCAG-EM.md).

## Using the data

VITAL publishes structured data alongside its human-readable reports.

### JSON API

The static [JSON API](API.md) provides versioned, read-only access to website snapshots, historical summaries, and normalized findings.

It can be used by dashboards, development tools, research projects, and other applications without scraping HTML.

### Model Context Protocol

An optional [MCP server](MCP.md) lets compatible development tools retrieve and investigate published findings.

The local MCP integration uses a bounded, read-only interface, with additional local source-mapping functionality available when explicitly configured.

Optional WebMCP support can expose selected read-only tools to compatible browser-based agents.

These interfaces do not automatically authorize changes to the websites being monitored.

### Data and reproducibility

Scan evidence is maintained separately from the application code.

The default data repository is [mgifford/vital-core-data](https://github.com/mgifford/vital-core-data).

VITAL preserves historical summaries and finding identities to support longitudinal analysis.

Automatic deletion of historical page-level evidence is disabled. Destructive retention operations require an explicitly authorized, verified archive process.

See the [retention runbook](docs-internal/RETENTION-RUNBOOK.md).

## Related projects

VITAL complements other open-source testing and investigation tools.

- **[Open Scans](https://github.com/mgifford/open-scans):** On-demand accessibility scanning, cross-engine comparisons, ACT mappings, and reproducible investigations.
- **[Firefox Energy Scanner](https://github.com/mgifford/firefox-energy-scanner):** Controlled experiments that investigate browser activity and measured client energy consumption.
- **[Drupal Quality Observatory](https://github.com/mgifford/drupal-core):** An emerging project for tracking quality across Drupal Core, Drupal CMS, and related configurations.
- **[OpenACR Release Evidence](https://github.com/mgifford/openacr-release-evidence):** Accessibility evidence and draft conformance reporting associated with specific software releases.

VITAL's primary responsibility is recurring monitoring of configured website inventories.

It can identify candidates for further investigation without attempting to reproduce the specialized capabilities of these other projects.

## Get involved

Contributions are welcome from accessibility specialists, developers, designers, performance engineers, sustainability researchers, content authors, public servants, and website owners.

Useful contributions include:

- Reviewing findings and identifying possible false positives.
- Providing manual accessibility testing evidence.
- Investigating recurring problems across websites.
- Improving scanning coverage, accuracy, and reliability.
- Suggesting better ways to explain historical changes.
- Improving report accessibility, readability, and navigation.
- Helping reduce the environmental footprint of scanning.
- Contributing tests, documentation, translations, and code.
- Reporting problems with the scanner or its published evidence.

**[Open an issue or suggest an improvement](https://github.com/mgifford/vital-core/issues)**

Not every useful contribution requires writing code. Independent verification of a reported problem is particularly valuable.

## Run your own VITAL instance

VITAL is open source and designed to support independently configured and maintained installations.

**The recommended approach is to use a separate repository for each monitoring programme**, rather than managing multiple organizations or website inventories through deployment profiles in one repository.

Existing examples include:

- **[VITAL Core NSF](https://github.com/mgifford/vital-core-nsf):** Monitoring websites associated with the US National Science Foundation.
- **[VITAL Core LGD](https://github.com/localgovdrupal/vital-core-lgd):** Monitoring local government websites associated with LocalGov Drupal.

Each installation can retain VITAL's full scanning, reporting, investigation, and API capabilities while controlling its own website inventory, schedules, configuration, data, and maintenance.

These repositories are independently maintained. Improvements made to VITAL Core are not automatically incorporated into other installations.

A typical GitHub deployment uses a code repository for the scanner and configuration, a separate data repository for scan results, GitHub Actions for execution, and GitHub Pages for publication.

Organizations can adapt their target inventories, scanning budgets, languages, applicable accessibility requirements, and reporting configuration.

The project provides a GitHub repository template, but deploying a new instance requires configuring its data repository, deployment credentials, workflows, and target settings.

See the [Deployment Guide](docs-internal/DEPLOYMENT.md) for setup instructions and [Deployment Models and Optional Profiles](config/profiles/README.md) for the rationale behind independent installations.

### Local development

You need Node.js 22 or newer, npm, and a browser supported by Playwright.

```bash
git clone https://github.com/mgifford/vital-core.git
cd vital-core
npm ci
npx playwright install chromium
npm test
```

For a locally configured target, see [Architecture](ARCHITECTURE.md) and [Target Configuration](config/targets.yml).

The `npm test` command runs the project's unit and end-to-end test suites.

Developers should review the [agent instructions](AGENTS.md) and [feature status](FEATURES.md) before making substantial changes.

## Project status and limitations

VITAL is actively developed and used for recurring website quality monitoring.

Its capabilities and reporting formats continue to evolve.

Important limitations include:

- Automated accessibility testing cannot establish complete WCAG conformance.
- Sampling means not every page receives every test.
- Some websites restrict or block automated scanning.
- Missing data is not equivalent to a successful test.
- Technology fingerprints can be incomplete or inaccurate.
- Performance measurements depend on testing conditions.
- CO₂ and energy estimates are models, not direct energy measurements.
- Component and technology associations do not establish causation.
- Automated evaluation reports remain incomplete without appropriate human review.

See [Feature Status](FEATURES.md) for documented capabilities and outstanding work.

## Accessibility and sustainability commitments

VITAL aims to follow the same principles it encourages others to adopt.

Published reports prioritize semantic HTML, readable text, keyboard access, meaningful tables, dark-mode support, and lightweight delivery.

Core report content remains available without JavaScript. Optional features, including interactive filtering and selected browser integrations, use progressive enhancement.

The project also limits its own scanning workload and reuses existing evidence rather than repeatedly performing expensive assessments when it is unnecessary.

Read the [Accessibility Statement](ACCESSIBILITY.md) and [Sustainability Statement](SUSTAINABILITY.md).

## AI use

Generative AI has assisted with the development, documentation, testing, and maintenance of VITAL.

Optional local AI capabilities can help summarize findings when explicitly configured. These are not required for standard scans.

AI-generated explanations are not independent verification of accessibility, performance, sustainability, or legal conformance.

The scanner's underlying observations and their provenance must remain available separately from AI-generated interpretations.

See [AGENTS.md](AGENTS.md) for development and evidence requirements.

## Documentation

- [Feature Status](FEATURES.md): Implemented capabilities and outstanding development.
- [Architecture](ARCHITECTURE.md): Crawling, sampling, data storage, and reporting infrastructure.
- [API](API.md): Published JSON data contracts and schemas.
- [MCP Integration](MCP.md): Read-only tools for consuming findings.
- [Accessibility Strategy](A11Y-STRATEGY.md): Accessibility direction and priorities.
- [Finding Evidence Roadmap](docs-internal/FINDING-EVIDENCE-ROADMAP.md): Element evidence, component attribution, inspection, and reproduction.
- [WCAG-EM and ACR](docs-internal/WCAG-EM.md): Evaluation artifact distinctions and limitations.
- [Retention Runbook](docs-internal/RETENTION-RUNBOOK.md): Data preservation, verified archives, and authorized pruning.
- [Accessibility Statement](ACCESSIBILITY.md).
- [Sustainability Statement](SUSTAINABILITY.md).
- [AI Agent Instructions](AGENTS.md).
- [Deployment Guide](docs-internal/DEPLOYMENT.md):
  Creating, configuring, and maintaining independent VITAL installations.
- [Deployment Models and Optional Profiles](config/profiles/README.md):
  Recommended repository architecture and historical deployment experiments.

## License

VITAL is free and open-source software licensed under the [GNU Affero General Public License, version 3](LICENSE).

Included third-party components retain their respective licenses, including the Wappalyzer fingerprint database and the optional ParaCharts runtime.

Independent verification, adaptation, and contributions are encouraged.
