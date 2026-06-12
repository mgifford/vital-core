# 🛑 Section 508 Compliance Registry: DATA-HEALTHCARE-GOV
> **Scan Summary:** Processed completely on Wed, 03 Jun 2026 02:52:02 GMT | Duration: 4345.24s

## 📘 Conformance Policy Context
* **Legal baseline:** WCAG 2.0 AA (federal minimum requirement).
* **Recommended target:** WCAG 2.2 AA where feasible, while keeping WCAG 2.0 / 2.1 / 2.2 distinctions explicit in reporting.
* **AAA guidance:** Encourage AAA improvements where practical, but do not treat automated AAA checks as equivalent to human validation.
* **Manual testing priority:** Keyboard-only and assistive-technology testing should be prioritized above automated AAA score chasing.

## ♿ Accessibility Grade

| Metric | Value |
|--------|-------|
| **Grade** | **A-** |
| **Score** | 92 / 100 |
| **Summary** | 1 serious rule |
| Priority pages scanned | 0 |
| Priority pages with violations | 0 |

### Severity Breakdown

| Severity | Instances | Unique Rules | Systemic Rules | Priority-Page Pairs | Weighted Penalty |
|----------|-----------|--------------|----------------|---------------------|------------------|
| Critical | 0 | 0 | 0 | 0 | 0 |
| Serious | 20 | 1 | 0 | 0 | 10 |
| Moderate | 0 | 0 | 0 | 0 | 0 |
| Minor | 0 | 0 | 0 | 0 | 0 |

> **Grade scale:** A+ (97–100) · A (93–96) · A− (90–92) · B+ (87–89) · B (83–86) · B− (80–82) · C+ (77–79) · C (73–76) · C− (70–72) · D+ (67–69) · D (63–66) · D− (<63)

## 🔎 Report Navigation
- [Page report 1: https://data.healthcare.gov/dataset/cqrd-buzn](#page-1-https-data-healthcare-gov-dataset-cqrd-buzn)
- [Page report 2: https://data.healthcare.gov/dataset/cfvf-wask](#page-2-https-data-healthcare-gov-dataset-cfvf-wask)
- [Page report 3: https://data.healthcare.gov/ab-registration-tracker](#page-3-https-data-healthcare-gov-ab-registration-tracker)
- [Page report 4: https://data.healthcare.gov/stories/s/a7nc-mrxa](#page-4-https-data-healthcare-gov-stories-s-a7nc-mrxa)
- [Page report 5: https://data.healthcare.gov/stories/s/Agent-Broker-Registration-and-Termination-List-Lan/a7nc-mrxa](#page-5-https-data-healthcare-gov-stories-s-agent-broker-registration-and-termina)

--- 

<a id="page-1-https-data-healthcare-gov-dataset-cqrd-buzn" tabindex="-1"></a>
## 📄 Page Context: [https://data.healthcare.gov/dataset/cqrd-buzn](https://data.healthcare.gov/dataset/cqrd-buzn)
* Jump to section: [Accessibility deficiencies](#page-1-https-data-healthcare-gov-dataset-cqrd-buzn-accessibility-deficiencies) | [Alternative text anomalies](#page-1-https-data-healthcare-gov-dataset-cqrd-buzn-alternative-text-anomalies) | [Third-party JavaScript regression](#page-1-https-data-healthcare-gov-dataset-cqrd-buzn-third-party-regression)
* **Result Execution Status:** `COMPLETED`
* **Lighthouse Performance Score:** 55
* **First Contentful Paint (ms):** 14103
* **Largest Contentful Paint (ms):** 15967
* **Speed Index (ms):** 14103
<a id="page-1-https-data-healthcare-gov-dataset-cqrd-buzn-accessibility-deficiencies" tabindex="-1"></a>
### ♿ Technical Accessibility Deficiencies
#### 🛑 Rule Triggered: `target-size` (SERIOUS)
* **Description:** Ensure touch targets have sufficient size and space
* **Target Standards Alignment:** `wcag22aa`, `wcag258`
* **WCAG Scope Classification:** WCAG 2.2
* **Primary Rule Guidance (Deque Axe):** [Deque Axe Ruleset Specification](https://dequeuniversity.com/rules/axe/4.11/target-size?application=playwright)

##### 🛠️ Code Failure Snippets:
###### Instance 1
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="BusinessYear"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize BusinessYear column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize BusinessYear column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 2
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="StateCode"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize StateCode column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize StateCode column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 3
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="IssuerId"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize IssuerId column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize IssuerId column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 4
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="SourceName"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize SourceName column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize SourceName column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 5
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="ImportDate"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize ImportDate column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize ImportDate column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 6
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="ServiceAreaId"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize ServiceAreaId column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize ServiceAreaId column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 7
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="ServiceAreaName"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize ServiceAreaName column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize ServiceAreaName column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 8
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="CoverEntireState"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize CoverEntireState column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize CoverEntireState column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 9
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="County"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize County column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize County column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 10
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="PartialCounty"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize PartialCounty column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize PartialCounty column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 11
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="ZipCodes"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize ZipCodes column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize ZipCodes column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 12
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="PartialCountyJustification"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize PartialCountyJustification column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 13
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="MarketCoverage"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize MarketCoverage column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize MarketCoverage column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 14
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="DentalOnlyPlan"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize DentalOnlyPlan column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize DentalOnlyPlan column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

<a id="page-1-https-data-healthcare-gov-dataset-cqrd-buzn-alternative-text-anomalies" tabindex="-1"></a>
### 📝 Alternative Text Anomalies
Found **3** instances of missing or generic alt patterns (e.g., 'image.png', 'screenshot').

1. **Target Code Matrix:** `<img src="/frontend/build/static/media/dataHC-logo.png" alt="Data.Healthcare logo">` | **Value Identified:** *"Data.Healthcare logo"*
2. **Target Code Matrix:** `<img class="dc-c-footer__logo" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADsAAAA7CAMAAADy+wKBAAAAnFBMVEUAAABCUVU7RUw0PUczPEczOkY3QEo5QkwzO0Y2` | **Value Identified:** *"HHS Logo"*
3. **Target Code Matrix:** `<img class="dc-c-footer__logo" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHUAAAAoCAMAAAD3ykWnAAAAmVBMVEUAAAAqNkAAACMvOEItOEMfKTAwNkMxOUQrNEEy` | **Value Identified:** *"CMS Logo"*

<a id="page-1-https-data-healthcare-gov-dataset-cqrd-buzn-third-party-regression" tabindex="-1"></a>
### 🧩 Third-Party JavaScript Accessibility Regression
Third-party script patterns were detected and this page was re-evaluated with JavaScript disabled.

* **JS Enabled Violations:** 1
* **JS Disabled Violations:** 0
* **Violations Introduced by JS:** 1
* **Potentially Responsible Rules:** `target-size`
* **Likely Third-Party Providers:** Google Tag Manager
* **Provider Confidence:** Google Tag Manager (MEDIUM, score 3)
* **Rule Attribution:** `target-size` -> Google Tag Manager
* **Rule Attribution Confidence:** target-size -> Google Tag Manager:MEDIUM
* **Trigger Evidence:** Tag manager present

--- 

<a id="page-2-https-data-healthcare-gov-dataset-cfvf-wask" tabindex="-1"></a>
## 📄 Page Context: [https://data.healthcare.gov/dataset/cfvf-wask](https://data.healthcare.gov/dataset/cfvf-wask)
* Jump to section: [Accessibility deficiencies](#page-2-https-data-healthcare-gov-dataset-cfvf-wask-accessibility-deficiencies) | [Alternative text anomalies](#page-2-https-data-healthcare-gov-dataset-cfvf-wask-alternative-text-anomalies)
* **Result Execution Status:** `TIMEOUT`
* **Lighthouse Performance Score:** n/a
* **First Contentful Paint (ms):** n/a
* **Largest Contentful Paint (ms):** n/a
* **Speed Index (ms):** n/a
* **Error Context:** `Page scan exceeded strict 120s limit and was cancelled.`
--- 

<a id="page-3-https-data-healthcare-gov-ab-registration-tracker" tabindex="-1"></a>
## 📄 Page Context: [https://data.healthcare.gov/ab-registration-tracker](https://data.healthcare.gov/ab-registration-tracker)
* Jump to section: [Alternative text anomalies](#page-3-https-data-healthcare-gov-ab-registration-tracker-alternative-text-anomalies)
* **Result Execution Status:** `COMPLETED`
* **Lighthouse Performance Score:** 54
* **First Contentful Paint (ms):** 12436
* **Largest Contentful Paint (ms):** 15638
* **Speed Index (ms):** 12436
* **Error Context:** `Page scan exceeded strict 120s limit and was cancelled.`
--- 

<a id="page-4-https-data-healthcare-gov-stories-s-a7nc-mrxa" tabindex="-1"></a>
## 📄 Page Context: [https://data.healthcare.gov/stories/s/a7nc-mrxa](https://data.healthcare.gov/stories/s/a7nc-mrxa)
* Jump to section: [Alternative text anomalies](#page-4-https-data-healthcare-gov-stories-s-a7nc-mrxa-alternative-text-anomalies)
* **Result Execution Status:** `TIMEOUT`
* **Lighthouse Performance Score:** n/a
* **First Contentful Paint (ms):** n/a
* **Largest Contentful Paint (ms):** n/a
* **Speed Index (ms):** n/a
* **Error Context:** `Page scan exceeded strict 120s limit and was cancelled.`
--- 

<a id="page-5-https-data-healthcare-gov-stories-s-agent-broker-registration-and-termina" tabindex="-1"></a>
## 📄 Page Context: [https://data.healthcare.gov/stories/s/Agent-Broker-Registration-and-Termination-List-Lan/a7nc-mrxa](https://data.healthcare.gov/stories/s/Agent-Broker-Registration-and-Termination-List-Lan/a7nc-mrxa)
* Jump to section: [Alternative text anomalies](#page-5-https-data-healthcare-gov-stories-s-agent-broker-registration-and-termina-alternative-text-anomalies)
* **Result Execution Status:** `TIMEOUT`
* **Lighthouse Performance Score:** n/a
* **First Contentful Paint (ms):** n/a
* **Largest Contentful Paint (ms):** n/a
* **Speed Index (ms):** n/a
* **Error Context:** `Page scan exceeded strict 120s limit and was cancelled.`
