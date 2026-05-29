# 📋 Features Registry // vital-core

These are the anticipated features for this project.

`vital-core` synthesizes the capabilities of specialized automated web quality, accessibility, performance, and data extraction engines into a singular, high-performance, spec-driven pipeline. Operating 100% serverless via GitHub Actions and Playwright caching, it protects federal target bandwidth using a **Single-Hit, Multi-Yield** execution lifecycle.

---

## 🎛️ 1. Traffic-Weighted Discovery & Routing

*Derived from `top-task-finder`, `ScanGov/standards`, and standard sitemap logic.*

* **Top-Task Prioritization:** Rather than blindly crawling thousands of deep database links, the engine processes site endpoints weighted by real user traffic metrics, targeting high-impact public pathways first.
* **Glob-Filtered Sitemap Aggregation:** Parses remote `sitemap.xml` entries natively and cross-references them with path-specific glob filtering (`/*`) to isolate specific interactive data tools (e.g., fee schedules, application grids).
* **Forced Seed Injection:** Merges high-value seed URLs (such as targeted search endpoints or newly released features) straight to the front of the processing queue, ensuring they are audited regardless of crawl depth limits.

---

## 🛡️ 2. Deep Accessibility & Section 508 Verification

*Derived from `open-scans`, `a11y-meta-skills`, `o-hat-standalone`, and `axe-core`.*

* **Keyboard-Only & Meta-Skill Analysis:** Evaluates structural tab-index ordering, focus trapping, skip-navigation links, and semantic landmark indicators required for functional keyboard navigation.
* **Hydrated DOM Contrasts:** Runs native browser injections *after* frame stabilization to execute deep element contrast ratio checks ($AA / AAA$), eradicating the false positives typical of unstyled static code parsers.
* **FPC Impact Mapping:** Automatically maps automated code violations straight to Section 508 Functional Performance Criteria (e.g., *Without Vision*, *Limited Manipulation*), turning technical error logs into empathetic accessibility profiles.

---

## 📝 3. Content Integrity & Plain Language Metrics

*Derived from `plain-language-checker` and `alt-text-scan`.*

* **Readability Scoring:** Extracts hydrated body text nodes locally to calculate sentence density and Flesch-Kincaid Reading Ease scores, aligning the system directly with the Plain Writing Act of 2010.
* **Alt-Text Quality Heuristics:** Uses a local DOM parser (`cheerio`) to check every sequential `<img>` wrapper. It flags missing `alt` properties as well as lazy, generic, or suspicious values (e.g., `"image.png"`, `"screenshot"`, `"logo"`, or blank spacers).

---

## 🧩 4. Platform Fingerprinting & Ecosystem Compliance

*Derived from `wappalyzer-next`, `design-system-scan`, and `Find-Overlays`.*

* **Tech-Stack Failure Tracking:** Uses lightweight environment profiling to identify underlying CMS platforms, server frameworks, and core dependencies. This data maps back to common automated layout bugs, helping target systematic errors.
* **Design System Footprint Verification:** Detects utility class signatures and components to track the real-world adoption and version health of the U.S. Web Design System (USWDS).
* **Third-Party Overlay Detection:** Scans local DOM snapshots for known automated script footprints to flag compliance risks associated with third-party accessibility overlay widgets.

---

## 🗂️ 5. Resource Extraction & Document Auditing

*Derived from `pdf-crawler`.*

* **Asynchronous Document Tracking:** Identifies binary document downloads (like critical user guides and application PDFs) nested inside target routes during the discovery phase.
* **Isolated Document Profiling:** Logs the presence, structural location, and hosting frequency of static documents, laying the groundwork for secondary offline PDF compliance evaluations.

---

## 🚀 6. Modernization, Hyperlink Health, & Longevity

*Derived from `open-site-review`, `link-check`, `linkchecker`, and `johnwargo/link-checker`.*

* **Hyperlink Status Matrix:** Extracts and checks outbound hyperlinks asynchronously, identifying dead ends, loops, and broken redirects without stalling the main browser thread.
* **Code Modernization Auditing:** Reviews DOM footprints to catch deprecated HTML elements, old scripting patterns, or ahead-of-spec experimental code blocks that compromise cross-browser accessibility.

---

## 🔋 7. Digital Performance & Energy Efficiency

*Derived from `open-susty-scans` and Google Lighthouse.*

* **Page Weight & Energy Tracking:** Tracks data transfers and page-bloat metrics during live network rendering. It uses page metrics to estimate energy consumption per visit, pairing web accessibility with responsible resource use.
* **Core Web Vitals:** Measures crucial metrics like Largest Contentful Paint (LCP) and Cumulative Layout Shift (CLS) directly within the pipeline's headless engine to find heavy components that degrade performance on low-bandwidth connections.

---

## ⚙️ 8. Serverless Execution & Automated Ticketing

*Derived from `eu-plus-government-scans`, `dot-gov-scans`, and the `ACCESSIBILITY.md` bug reporting standard.*

* **Single-Hit Local Snapshot Caching:** Hits the production network exactly once per page target. It runs active browser metrics in memory and writes the raw HTML to disk, allowing all secondary text and signature audits to run entirely offline to save bandwidth and prevent WAF blocking.
* **Automated Git Ticketing Exporter:** Transforms technical error logs into clean, formatted Markdown files matching `ACCESSIBILITY.md` specs. These files are ready to copy-paste into GitHub Issues or Jira tickets, complete with code snippets, CSS selectors, and clear remediation guides.
* **Flat Dashboard Compilation:** Generates a lightweight, responsive HTML dashboard deployed to GitHub Pages. It uses plain, client-side JavaScript to pull data from flat JSON records, completely bypassing the need for databases or cloud hosting costs.


## 🛠️ vital-core Comprehensive Tool Mapping

### 1. Discovery & Target Orchestration

How the pipeline maps, prioritizes, and cuts down sprawling government sitemaps before booting up the browser.

* **Sitemap Extraction:** Powered by **`sitemapper`** (Node.js ecosystem). This asynchronous worker extracts deeply nested XML maps without risking execution memory leaks.
* **Path Isolation & Glob Rules:** Powered by **`picomatch`**. This fast string-matching engine evaluates your path routing constraints (e.g., `https://www.cms.gov/medicare/physician-fee-schedule/`) against raw sitemap arrays in milliseconds.
* **Prioritization Intelligence:** Powered by **`top-task-finder`** logic. Instead of running random passes, the pipeline matches paths against critical federal top-task lists, automatically bubbling higher-weight user pathways to the front of the queue.

---

### 2. Live Browser-Context Testing Matrix

Tools executed directly in memory inside the active Playwright Chromium tab to capture live interaction and styling state.

* **Core Technical Accessibility Auditing:** Powered by **`@axe-core/playwright`** (Deque Systems) and **`@siteimprove/alfa`**.
* *Mechanism:* Injected dynamically post-hydration. `axe-core` catches immediate semantic elements, while `alfa` enforces strict, specification-driven test logic.


* **Keyboard Mobility & Meta Audits:** Powered by a programmatic port of **`a11y-meta-skills`** and **`o-hat-standalone`**.
* *Mechanism:* Runs active focus-state evaluations across the DOM tree. It tests for explicit skip-links (`href="#main-content"`), verifies that interactive data dashboards don't create focus traps, and flags missing ARIA landmarks.


* **Performance & Core Web Vitals:** Powered by the programmatic **`lighthouse`** node package.
* *Mechanism:* Measures interactive metrics like Cumulative Layout Shift (CLS) and Largest Contentful Paint (LCP) directly inside the container before the network context changes.



---

### 3. Local Offline Snapshot Diagnostics

Tools that run instantly against the saved `tmp/html-snapshots/` filesystem, completely protecting federal target bandwidth.

* **Technology Fingerprinting:** Powered by **`wappalyzer-next`**.
* *Mechanism:* Evaluates headers, global variable footprints, and meta scripts on the cached file to identify underlying infrastructure (e.g., Drupal, Adobe Experience Manager, React, Angular).


* **Compliance & Design System Tracking:** Powered by a custom port of **`design-system-scan`**.
* *Mechanism:* Uses structural selectors to scan for U.S. Web Design System (USWDS) patterns. It verifies the presence of mandatory structural utility signatures (e.g., `.usa-banner`, `.usa-header`, `.usa-accordion`).


* **Third-Party Overlay Detection:** Powered by a customized signature matrix from **`Find-Overlays`**.
* *Mechanism:* Uses pattern-matching rules to look for automated accessibility overlay widgets (e.g., AccessiBe, UserWay, AudioEye). It flags these scripts as high-risk, non-compliant dependencies.



---

### 4. Content, Language, & Hyperlink Auditing

Offline text and anchor validation processes handled entirely within the local repository build environment.

* **Alternative Text Diagnostics:** Powered by **`alt-text-scan`** wrapped over **`cheerio`**.
* *Mechanism:* Parses all sequential `<img>` containers from disk. It runs regular expression matching to catch missing `alt` attributes or lazy fallback strings (like `alt="image.png"`, `alt="logo"`, or purely numeric naming conventions).


* **Plain Language Verification:** Powered by a programmatic implementation of **`plain-language-checker`**.
* *Mechanism:* Strips visual components to isolate pure body text. It calculates sentence complexity and syllable density to compute the **Flesch-Kincaid Reading Ease** score, ensuring compliance with federal plain writing mandates.


* **Asynchronous Hyperlink Auditing:** Powered by a background worker inspired by **`link-check`** and **`linkchecker`**.
* *Mechanism:* Extracts the complete array of outbound `href` references. A separate, non-blocking network queue tests anchor destinations using low-overhead HTTP `HEAD` requests to catch broken links, loops, and dead endpoints.


* **PDF Identification:** Powered by structural components from **`pdf-crawler`**.
* *Mechanism:* Scans the snapshot DOM for links targeting binary `.pdf` assets, creating an isolated registry of document downloads for downstream validation.



---

### 5. Performance & Compliance Reporting

The systems that transform technical numbers into readable executive metrics and developer instructions.

* **Digital Performance Estimations:** Powered by metrics from **`open-susty-scans`**.
* *Mechanism:* Computes the overall page footprint using uncompressed byte-transfer data from the network log. It applies the SWD model to log a real-world energy consumption metric per visit.


* **Continuous Automation Workflow:** Powered by native **GitHub Actions Runner Environment Actions** (`actions/upload-pages-artifact`, `actions/deploy-pages`).
* *Mechanism:* Automatically triggers the entire tool matrix via a scheduled GitHub cron task, running headless browser contexts seamlessly without third-party server hosting fees.


* **Actionable Dev Ticket Exporter:** Guided by the **`ACCESSIBILITY.md`** reporting specification.
* *Mechanism:* Loops through validation array blocks and translates cryptic errors into clean Markdown tickets, complete with exact CSS paths, source code violations, and remediation instructions.
