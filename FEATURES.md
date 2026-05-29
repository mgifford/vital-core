# 📋 Features Registry // vital-core

These are the anticipated features for this project.

`vital-core` synthesizes the capabilities of specialized automated web quality, accessibility, sustainability, and data extraction engines into a singular, high-performance, spec-driven pipeline. Operating 100% serverless via GitHub Actions and Playwright caching, it protects federal target bandwidth using a **Single-Hit, Multi-Yield** execution lifecycle.

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

## 🌱 7. Digital Sustainability & Performance

*Derived from `open-susty-scans` and Google Lighthouse.*

* **Page Weight & Carbon Tracking:** Tracks data transfers and page-bloat metrics during live network rendering. It uses page metrics to estimate carbon emissions per visit, pairing web accessibility with environmental sustainability.
* **Core Web Vitals:** Measures crucial metrics like Largest Contentful Paint (LCP) and Cumulative Layout Shift (CLS) directly within the pipeline's headless engine to find heavy components that degrade performance on low-bandwidth connections.

---

## ⚙️ 8. Serverless Execution & Automated Ticketing

*Derived from `eu-plus-government-scans`, `dot-gov-scans`, and the `ACCESSIBILITY.md` bug reporting standard.*

* **Single-Hit Local Snapshot Caching:** Hits the production network exactly once per page target. It runs active browser metrics in memory and writes the raw HTML to disk, allowing all secondary text and signature audits to run entirely offline to save bandwidth and prevent WAF blocking.
* **Automated Git Ticketing Exporter:** Transforms technical error logs into clean, formatted Markdown files matching `ACCESSIBILITY.md` specs. These files are ready to copy-paste into GitHub Issues or Jira tickets, complete with code snippets, CSS selectors, and clear remediation guides.
* **Flat Dashboard Compilation:** Generates a lightweight, responsive HTML dashboard deployed to GitHub Pages. It uses plain, client-side JavaScript to pull data from flat JSON records, completely bypassing the need for databases or cloud hosting costs.
