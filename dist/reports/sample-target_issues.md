# 🛑 Section 508 Compliance Registry: SAMPLE-TARGET
> **Scan Summary:** Processed completely on Sat, 06 Jun 2026 12:08:24 GMT | Duration: 1.23s

## 📘 Conformance Policy Context
* **Legal baseline:** WCAG 2.0 AA (federal minimum requirement).
* **Recommended target:** WCAG 2.2 AA where feasible, while keeping WCAG 2.0 / 2.1 / 2.2 distinctions explicit in reporting.
* **AAA guidance:** Encourage AAA improvements where practical, but do not treat automated AAA checks as equivalent to human validation.
* **Manual testing priority:** Keyboard-only and assistive-technology testing should be prioritized above automated AAA score chasing.

## ♿ Accessibility Grade

| Metric | Value |
|--------|-------|
| **Grade** | **B-** |
| **Score** | 80 / 100 |
| **Summary** | 1 serious rule |
| Priority pages scanned | 0 |
| Priority pages with violations | 0 |

### Severity Breakdown

| Severity | Instances | Unique Rules | Systemic Rules | Priority-Page Pairs | Weighted Penalty |
|----------|-----------|--------------|----------------|---------------------|------------------|
| Critical | 0 | 0 | 0 | 0 | 0 |
| Serious | 1 | 1 | 0 | 0 | 5 |
| Moderate | 0 | 0 | 0 | 0 | 0 |
| Minor | 0 | 0 | 0 | 0 | 0 |

> **Grade scale:** A+ (97–100) · A (93–96) · A− (90–92) · B+ (87–89) · B (83–86) · B− (80–82) · C+ (77–79) · C (73–76) · C− (70–72) · D+ (67–69) · D (63–66) · D− (<63)

## 🔎 Report Navigation
- [Page report 1: https://example.org/page](#page-1-https-example-org-page)

--- 

<a id="page-1-https-example-org-page" tabindex="-1"></a>
## 📄 Page Context: [https://example.org/page](https://example.org/page)
* Jump to section: [Accessibility deficiencies](#page-1-https-example-org-page-accessibility-deficiencies)
* **Result Execution Status:** `COMPLETED`
* **Lighthouse Performance Score:** 88
* **First Contentful Paint (ms):** 1200
* **Largest Contentful Paint (ms):** 2100
* **Speed Index (ms):** 3000
<a id="page-1-https-example-org-page-accessibility-deficiencies" tabindex="-1"></a>
### ♿ Technical Accessibility Deficiencies
#### 🛑 Rule Triggered: `image-alt` (SERIOUS)
* **Description:** Images must have alternate text
* **Target Standards Alignment:** `wcag2a`
* **WCAG Scope Classification:** WCAG 2.0
* **Primary Rule Guidance (Deque Axe):** [Deque Axe Ruleset Specification](https://dequeuniversity.com/rules/axe/4.10/image-alt)

##### 🛠️ Code Failure Snippets:
###### Instance 1
* **Target DOM Coordinate:** `.hero img`
* **Failing Source Node Code:**
 ```html
 <img src="hero.png">
 ```
* **Remediation Action Path:** Add a meaningful alt attribute.

* **Supplemental Pattern Advice (curated-purple-ai, HIGH confidence):** Use concise alt text describing the image purpose in page context.
* **Supplemental Match Signature:** `img_src`
* **Supplemental Catalog Last Updated:** 2026-05-29T00:00:00.000Z

