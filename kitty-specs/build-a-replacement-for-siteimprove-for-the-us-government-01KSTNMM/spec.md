# Specification: Build a Replacement for Siteimprove for the US Government

## 1. Problem Statement

US government teams need a transparent, open-source, continuously running quality and accessibility platform that can replace core Siteimprove feedback loops while aligning with Section 508 and WCAG requirements.

The platform must:

- Run continuously via GitHub Actions.
- Publish public, versioned reports on GitHub Pages.
- Prioritize issues by confidence, with highest priority for failures detected by both Alfa and Axe.

## 2. Vision and Scope

### In Scope

- Multi-engine accessibility scanning pipeline with:
	- Alfa as primary standards engine.
	- Axe as backup/comparison engine.
- Issue normalization and rule crosswalk between engines.
- Consensus-based prioritization (Alfa + Axe overlap first).
- Persistent run history and trends published on GitHub Pages.
- Exportable machine-readable outputs (JSON index, latest, per-run artifacts).

### Out of Scope (Initial Release)

- Full parity with all Siteimprove product features.
- Manual QA workflows with authenticated user access controls.
- Enterprise workflow integrations outside GitHub-native CI/CD.

## 3. Primary Users

- Federal accessibility program leads.
- Agency web developers and product teams.
- QA and compliance reviewers.
- Open-source maintainers supporting US government digital services.

## 4. Objectives

1. Deliver a reliable baseline replacement for recurring accessibility feedback.
2. Improve trust by making rule outcomes inspectable and reproducible.
3. Reduce false-priority noise by emphasizing consensus failures.
4. Preserve historical evidence for audits, remediation planning, and trend tracking.

## 5. Functional Requirements

### FR-1 Scan Orchestration

- System must execute scans on a schedule and on demand via GitHub Actions.
- System must support profile-driven target selection and crawl limits.

### FR-2 Alfa-First Engine Integration

- System must run Alfa checks as the primary accessibility rules engine.
- System must capture Alfa rule identifiers, outcomes, evidence, and target nodes.

### FR-3 Axe Backup Engine Integration

- System must run Axe checks for the same page set.
- System must capture Axe rule identifiers, impacts, evidence, and target selectors.

### FR-4 Normalization Layer

- System must normalize Alfa and Axe findings into a shared internal finding format.
- System must preserve source-engine metadata and raw evidence references.
- System must map engine rules to ACT/WCAG/Section 508 references where available.

### FR-5 Consensus Prioritization

- System must classify each issue into one of:
	- Consensus Failure (detected by Alfa and Axe).
	- Alfa-Only Failure.
	- Axe-Only Failure.
- System must assign highest priority to Consensus Failure issues.
- System must expose priority tiers in JSON outputs and UI summaries.

### FR-6 Reporting and Exports

- System must generate human-readable dashboard reports.
- System must generate machine-readable outputs per run.
- System must provide direct links to rule docs and remediation evidence.

### FR-7 Persistent Run History

- System must publish and retain:
	- latest run payload
	- historical run index
	- immutable per-run JSON artifacts
	- trend summary JSON
- System must merge previous history with each newly generated run.

### FR-8 Trend Summaries

- System must compute and publish trend metrics including:
	- total violations
	- violations per page
	- scan duration
	- delta vs previous run
	- rolling averages

### FR-9 GitHub Pages Browsability

- System must expose history and trend links in the published dashboard.
- System must allow reviewers to browse recent run entries and open raw JSON artifacts.

## 6. Non-Functional Requirements

### NFR-1 Reliability

- Scheduled runs should complete without manual intervention under normal network conditions.

### NFR-2 Traceability

- Every finding must be traceable to source engine, rule identifier, and page URL.

### NFR-3 Reproducibility

- Results should be reproducible from the same profile and target pages, acknowledging dynamic content variability.

### NFR-4 Performance

- Default profiles must include execution ceilings to control runtime and CI cost.

### NFR-5 Accessibility of Reports

- Published dashboard and report interfaces must be keyboard operable and readable with assistive technologies.

## 7. Data Model Requirements

System outputs must include at least:

- Run metadata: runId, generatedAt, duration, profilePath.
- Target metadata: targetId, domain.
- Page metadata: URL, status, timestamp.
- Findings metadata:
	- normalized rule key
	- source engine(s)
	- consensus classification
	- severity/impact
	- standards references (ACT/WCAG/508)
	- evidence snippets/selectors

## 8. Prioritization Model

Priority order must be:

1. P1: Consensus Failure (Alfa + Axe)
2. P2: Alfa-Only Failure
3. P3: Axe-Only Failure

Tie-breakers within a priority level:

1. Standards criticality (for example blocking WCAG A issues before AA enhancements).
2. Frequency across pages.
3. User impact severity (critical > serious > moderate > minor).

## 9. Acceptance Criteria

### AC-1 Engine Execution

- Given a configured target profile,
- When a scan runs,
- Then both Alfa and Axe execute for the scanned page set and produce normalized findings.

### AC-2 Consensus Detection

- Given overlapping Alfa and Axe findings,
- When results are processed,
- Then overlapping findings are labeled Consensus Failure and ranked above single-engine findings.

### AC-3 Persistent History

- Given an existing Pages history,
- When a new run is deployed,
- Then previous history is retained and new artifacts are appended with a new runId.

### AC-4 Trend Output

- Given at least two historical runs,
- When trend summary is generated,
- Then delta vs previous run and rolling averages are present and valid.

### AC-5 Browsable Reports

- Given a deployed Pages site,
- When a reviewer opens the dashboard,
- Then they can access latest, index, trends, and timestamped run artifacts from the UI.

## 10. Delivery Phases

### Phase A: Foundation

- Establish canonical normalized finding schema.
- Add Alfa integration path and data extraction contract.
- Ensure existing Axe path remains stable.

### Phase B: Correlation and Priority

- Implement rule crosswalk and overlap detection.
- Add consensus classifier and priority sorting.

### Phase C: Reporting and UX

- Update dashboard with consensus-first summaries.
- Add filters by engine and consensus state.

### Phase D: Hardening

- Validate workflows against representative federal sites.
- Improve reliability, guardrails, and troubleshooting docs.

## 11. Risks and Mitigations

- Rule mapping ambiguity between engines:
	- Mitigation: explicit crosswalk table and fallback matching strategy.
- Dynamic pages causing scan variance:
	- Mitigation: controlled wait strategy, retries, and stability windows.
- CI runtime growth with dual engines:
	- Mitigation: configurable max pages, priority URLs, and profile throttling.

## 12. Open Questions

1. What minimum set of Alfa rules must be enabled for initial parity goals?
2. Should consensus matching be exact-rule, standards-reference based, or hybrid?
3. Which summary metrics are most important for executive reporting (agency by agency)?
4. Do we require a separate machine export for remediation ticket systems in v1?

