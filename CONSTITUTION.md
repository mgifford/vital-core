# Vital Core Project Constitution

## Purpose

Vital Core exists to improve public-facing web quality for government services, with accessibility as a first-class outcome, practical remediation as the default output, and **continuous week-over-week trend tracking as our primary measure of success**.

---

## Constitutional Principles

### Public impact first
* Prioritize pages, workflows, and defects that most affect residents.
* Prefer findings that unblock real user tasks over cosmetic findings.

### Accessibility is non-negotiable
* Treat WCAG and Section 508 requirements as core quality criteria.
* Do not ship changes that reduce accessibility coverage or report fidelity.

### Longitudinal consistency over isolated metrics
* A single scan is a snapshot; our value lies in the film strip. 
* Every data structure, finding schema, and element identifier must be designed for stable, multi-week comparison. 

### Evidence over assumptions
* Every high-severity finding must include reproducible, machine-comparable evidence.
* Reports must trace back to URL, element, rule, and standards criterion, using stable selectors that persist across weekly deployments.

### Determinism and repeatability
* Scans must be reproducible with stable inputs and clear versioned logic.
* Keep schemas strict and outputs machine-consumable so time-series databases can parse them without breaking.

### Minimize unnecessary load
* Constrain scan scope to high-value pages and in-scope hosts to ensure automated weekly schedules are cost-effective and performant.
* Avoid broad crawling that creates cost without user value.

### Prefer actionable outputs
* Every major finding should include remediation guidance to help teams clear their weekly backlog.
* Exports must support engineering workflows in Markdown, CSV, and JSON.

### Secure and responsible operation
* Do not collect secrets or sensitive personal data.
* Keep automation auditable through history artifacts and change logs.

### Continuous improvement
* **Use weekly trend data and run history to prove remediation and catch regressions early.**
* Evolve heuristics as federal sites and standards change, but build translation layers to preserve historical data continuity.

---

## Decision Rules

* **When speed and coverage conflict:** Prefer reliable, stable coverage of top-task pages.
* **When data structure and elegance conflict:** Prefer data structure stability. Never break backward compatibility of scan outputs if it destroys historical week-over-week trend lines.
* **When discovery is noisy:** Prioritize host-scoped and HTML-only sampling first.
* **When tests and implementation conflict:** Fix implementation unless tests are wrong by evidence.
* **When uncertain:** Choose the option that improves accessibility signal quality and longitudinal tracking accuracy.

---

## Required Artifacts

* Profile configuration for each monitored target set.
* Strict, versioned output schema for scan and finding data.
* Issue exports in at least one human format and one machine format.
* **Weekly trend artifacts and delta reports (showing new, fixed, and persistent issues) published with each scheduled run.**

---

## Amendment Process

1. Open a pull request that describes the proposed change and rationale.
2. Include expected impact on accessibility outcomes, scan reliability, and **historical data continuity**.
3. Obtain maintainer approval before adoption.

---

*This constitution is authoritative for project direction, agent constraints, and code review decisions.*
