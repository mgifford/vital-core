# 🧪 Test Strategy Document // vital-core

This document outlines the Test-Driven Development (TDD) and Behavior-Driven Development (BDD) engineering strategy for **vital-core**. Because this system runs without infrastructure via GitHub Actions and targets highly volatile federal web applications, our testing framework must be deterministic, preventing false positives while guaranteeing strict schema compliance.

---

## 🎯 1. Core Testing Philosophy

Our strategy blends **TDD** (to ensure data contracts and calculation math are flawless) with **BDD** (to verify browser loading behaviors, fallback operations, and user interaction mechanics).

```
   ▲   [E2E BDD Contexts]         -> Playwright live-navigation, timeouts, and WAF handles.
  ╱█╲  [Integration Fixtures]     -> Testing offline workers against static mock HTML files.
 ╱███╲ [Unit TDD Validation]      -> Type schema constraints, configuration parsers, readability math.

```

* **Spec-First Engineering (TDD):** No execution logic is written without an underlying JSON/Zod data schema. Code validation means proving that a module ingests a strict type input and generates a strict type output.
* **Deterministic Isolation (BDD):** We do not run automated testing routines against live federal websites (`cms.gov`, etc.). Doing so introduces network latency and remote drift into our test suite. Instead, live behavior is mocked using local test servers, and offline behavior is tested against fixed HTML snapshots.

---

## 🧱 2. The Three-Tier Testing Matrix

### Tier 1: Unit Testing (TDD Focused)

Ensures our static logic, data parsers, and algorithmic calculations are mathematically sound and fail early when bad configuration is injected.

* **Target Components:** `ProfileParser`, Flesch-Kincaid readability scoring equations, URL filename sanitization, and output contract validation.
* **Execution Strategy:** Fast node-based tests executing on every commit.
* **Assertion Boundary:** Given invalid input data shapes (e.g., a profile missing a `base_url`), the system must explicitly reject execution with clear type validation errors before spinning up internal engines.

### Tier 2: Component Integration Testing (Fixture Focused)

Validates our offline analysis modules (`OfflineWorker`) without using browser contexts or active network paths.

* **Target Components:** Alternative text scanners, design system footprints (`design-system-scan`), and script-based widget identifiers (`Find-Overlays`).
* **The Fixture Repository:** We maintain a localized pool of mock HTML artifacts containing explicit, intentional compliance errors:
* `mock_bad_alts.html`: Features images with generic names (`alt="screenshot.png"`), blank attributes, and missing tags.
* `mock_with_overlay.html`: Contains standard header structures injected with active UserWay or AccessiBe script tags.
* `mock_uswds.html`: Implements components with valid federal utility signatures.


* **Assertion Boundary:** The parser must identify 100% of the embedded errors in the static files, mapping them identically to our target output arrays.

### Tier 3: End-to-End Behavioral Testing (BDD Focused)

Ensures our headless Playwright container behaves predictably when interacting with unpredictable, slow, or hostile server environments.

* **Target Components:** Browser life-cycles, network quiet states (`networkidle`), hydration delays, error containment, and graceful timeout recovery.
* **Mock Environment UI:** Spins up a local HTTP server inside the test runner using lightweight frameworks (e.g., `fastify` or `express`) capable of simulating network issues:
* *The Settle Simulator:* Serves a page that waits 3 seconds before injecting a grid via JavaScript, validating that our `postLoadDelay` allows components to render fully before scanning.
* *The Hang Simulator:* Drops incoming connections or sleeps for over 2 minutes, verifying that the browser terminates the process gracefully at the 120-second ceiling, records a `TIMEOUT`, and continues processing the rest of the queue.



---

## 📋 3. BDD Behavioral Feature Specifications

We define our end-to-end integration boundaries using human-readable, behavioral Gherkin-style assertions. These criteria guide the construction of our Playwright test loops.

### Feature: Resilient Connection Management & Settle Delay

> **Given** a target endpoint requires 3000ms to hydrate complex data fields,
> **And** the profile defines a `postLoadDelay` value of `4000`,
> **When** the browser orchestrator initiates connection protocols to the URL,
> **Then** the engine must wait until the active network drops to zero requests (`networkidle`),
> **And** it must apply a non-blocking pause of exactly 4000ms,
> **And** only then execute active compliance checks (`axe-core`), ensuring no dynamic tree elements are missed.

### Feature: Graceful Timeout Degradation

> **Given** a sluggish or unresponsive federal endpoint fails to respond,
> **When** the page loading sequence exceeds the strict `120000ms` global boundary,
> **Then** the engine must interrupt the network request,
> **And** catch the navigation exception without halting the Node runtime execution block,
> **And** log a `TIMEOUT` error status directly to that item's `PageScanReport` schema array,
> **And** advance immediately to process the next scheduled target in the queue.

### Feature: Single-Hit Local Snapshot Isolation

> **Given** an execution run targets a multi-page array,
> **When** the browser processes a valid destination,
> **Then** it must extract the fully hydrated DOM layout state via a single query execution,
> **And** stream that content directly into a local `.html` snapshot cache file on disk,
> **And** immediately close the browser instance window,
> **And** feed that local snapshot to all remaining analyzers (readability, alt-text, overlays) 100% offline, guaranteeing no additional network queries hit production systems.

---

## 🚀 4. Automated CI/CD Test Guardrails

Our testing strategy is hardcoded straight into the repository's continuous integration automation to ensure no broken code reaches production.

```yaml
# Conceptual workflow test segment integrated into development branches
- name: Execute Type Check & Code Linting
  run: npm run lint

- name: Run TDD Unit Tests (Schema & Parsers)
  run: npx vitest run unit

- name: Run Offline Fixture Integration Matrix
  run: npx vitest run integration

- name: Execute Playwright Behavioral Tests (Local Mock Servers)
  run: npx vitest run e2e

```

* **Pre-Commit Isolation:** Code adjustments cannot pull down live remote elements during the automated testing process. Every tier operates entirely inside container memory using localized mock definitions.
* **Deployment Blocking:** If a change changes calculation weights, breaks schema structures, or drops timeout exceptions, the GitHub Actions build step fails immediately. This blocks deployment to the live dashboard on GitHub Pages, keeping the core platform reliable.
