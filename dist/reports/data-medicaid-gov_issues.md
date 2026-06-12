# 🛑 Section 508 Compliance Registry: DATA-MEDICAID-GOV
> **Scan Summary:** Processed completely on Wed, 03 Jun 2026 02:52:02 GMT | Duration: 4345.61s

## 📘 Conformance Policy Context
* **Legal baseline:** WCAG 2.0 AA (federal minimum requirement).
* **Recommended target:** WCAG 2.2 AA where feasible, while keeping WCAG 2.0 / 2.1 / 2.2 distinctions explicit in reporting.
* **AAA guidance:** Encourage AAA improvements where practical, but do not treat automated AAA checks as equivalent to human validation.
* **Manual testing priority:** Keyboard-only and assistive-technology testing should be prioritized above automated AAA score chasing.

## ♿ Accessibility Grade

| Metric | Value |
|--------|-------|
| **Grade** | **A** |
| **Score** | 93.33 / 100 |
| **Summary** | 1 serious rule |
| Priority pages scanned | 0 |
| Priority pages with violations | 0 |

### Severity Breakdown

| Severity | Instances | Unique Rules | Systemic Rules | Priority-Page Pairs | Weighted Penalty |
|----------|-----------|--------------|----------------|---------------------|------------------|
| Critical | 0 | 0 | 0 | 0 | 0 |
| Serious | 22 | 1 | 0 | 0 | 5 |
| Moderate | 0 | 0 | 0 | 0 | 0 |
| Minor | 0 | 0 | 0 | 0 | 0 |

> **Grade scale:** A+ (97–100) · A (93–96) · A− (90–92) · B+ (87–89) · B (83–86) · B− (80–82) · C+ (77–79) · C (73–76) · C− (70–72) · D+ (67–69) · D (63–66) · D− (<63)

## 🔎 Report Navigation
- [Page report 1: https://data.medicaid.gov/dataset/1c853fe0-28c0-43f9-a7ac-26d28c3633c2](#page-1-https-data-medicaid-gov-dataset-1c853fe0-28c0-43f9-a7ac-26d28c3633c2)
- [Page report 2: https://data.medicaid.gov/medicaid-chip-eligibility-enrollment-snapshot-data](#page-2-https-data-medicaid-gov-medicaid-chip-eligibility-enrollment-snapshot-dat)
- [Page report 3: https://data.medicaid.gov/about/program-overview](#page-3-https-data-medicaid-gov-about-program-overview)

--- 

<a id="page-1-https-data-medicaid-gov-dataset-1c853fe0-28c0-43f9-a7ac-26d28c3633c2" tabindex="-1"></a>
## 📄 Page Context: [https://data.medicaid.gov/dataset/1c853fe0-28c0-43f9-a7ac-26d28c3633c2](https://data.medicaid.gov/dataset/1c853fe0-28c0-43f9-a7ac-26d28c3633c2)
* Jump to section: [Accessibility deficiencies](#page-1-https-data-medicaid-gov-dataset-1c853fe0-28c0-43f9-a7ac-26d28c3633c2-accessibility-deficiencies) | [Alternative text anomalies](#page-1-https-data-medicaid-gov-dataset-1c853fe0-28c0-43f9-a7ac-26d28c3633c2-alternative-text-anomalies) | [Third-party JavaScript regression](#page-1-https-data-medicaid-gov-dataset-1c853fe0-28c0-43f9-a7ac-26d28c3633c2-third-party-regression)
* **Result Execution Status:** `COMPLETED`
* **Lighthouse Performance Score:** 56
* **First Contentful Paint (ms):** 11017
* **Largest Contentful Paint (ms):** 13649
* **Speed Index (ms):** 11017
<a id="page-1-https-data-medicaid-gov-dataset-1c853fe0-28c0-43f9-a7ac-26d28c3633c2-accessibility-deficiencies" tabindex="-1"></a>
### ♿ Technical Accessibility Deficiencies
#### 🛑 Rule Triggered: `target-size` (SERIOUS)
* **Description:** Ensure touch targets have sufficient size and space
* **Target Standards Alignment:** `wcag22aa`, `wcag258`
* **WCAG Scope Classification:** WCAG 2.2
* **Primary Rule Guidance (Deque Axe):** [Deque Axe Ruleset Specification](https://dequeuniversity.com/rules/axe/4.11/target-size?application=playwright)

##### 🛠️ Code Failure Snippets:
###### Instance 1
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="NDC1"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize NDC1 column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize NDC1 column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 2
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="NDC2"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize NDC2 column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize NDC2 column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 3
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="NDC3"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize NDC3 column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize NDC3 column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 4
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="Labeler Name"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize Labeler Name column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize Labeler Name column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 5
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="Labeler Status"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize Labeler Status column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize Labeler Status column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 6
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="FDA Name"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize FDA Name column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize FDA Name column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 7
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="COD Status"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize COD Status column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize COD Status column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 8
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="FDA Application Number"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize FDA Application Number column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 9
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="Drug Category"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize Drug Category column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize Drug Category column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 10
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="Drug Type"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize Drug Type column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize Drug Type column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 11
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="Line Extension"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize Line Extension column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize Line Extension column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 12
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="FDA Approval Date"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize FDA Approval Date column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 13
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="Market Date"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize Market Date column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize Market Date column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 14
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="Unit Type"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize Unit Type column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize Unit Type column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 15
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="Unit Per Package Size"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize Unit Per Package Size column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 16
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="Therapeutic Equivalent Code"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize Therapeutic Equivalent Code column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 17
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="5i Indicator"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible[aria-label="Resize 5i Indicator column"]`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize 5i Indicator column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 18
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="Purchased Product Date"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize Purchased Product Date column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 19
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="Coverage Effective Date"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize Coverage Effective Date column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 20
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="Drug Termination Date"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize Drug Termination Date column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 21
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="Drug Reactivation Date"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize Drug Reactivation Date column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

###### Instance 22
* **Target DOM Coordinate:** `#data-table > div:nth-child(1) > .dc-c-datatable-wrapper.ds-u-border-x--1.ds-u-border-bottom--1 > .dc-c-datatable > thead > .dc-c-sticky-header > .ds-u-border-y--2[title="Date Reported to CMS"][aria-sort="none"] > .dc-c-resize-handle.ds-u-focus-visible`
* **Failing Source Node Code:**
 ```html
 <button class="dc-c-resize-handle ds-u-focus-visible " aria-label="Resize Date Reported to CMS column"></button>
 ```
* **Remediation Action Path:** Fix any of the following:
  Target has insufficient size (10px by 58px, should be at least 24px by 24px)
  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 22px instead of at least 24px.

<a id="page-1-https-data-medicaid-gov-dataset-1c853fe0-28c0-43f9-a7ac-26d28c3633c2-alternative-text-anomalies" tabindex="-1"></a>
### 📝 Alternative Text Anomalies
Found **3** instances of missing or generic alt patterns (e.g., 'image.png', 'screenshot').

1. **Target Code Matrix:** `<img src="/frontend/build/static/media/data.medicaid.gov.png" alt="data.medicaid.gov Logo">` | **Value Identified:** *"data.medicaid.gov Logo"*
2. **Target Code Matrix:** `<img class="dc-c-footer__logo" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADsAAAA7CAMAAADy+wKBAAAAnFBMVEUAAABCUVU7RUw0PUczPEczOkY3QEo5QkwzO0Y2` | **Value Identified:** *"HHS Logo"*
3. **Target Code Matrix:** `<img class="dc-c-footer__logo" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHUAAAAoCAMAAAD3ykWnAAAAmVBMVEUAAAAqNkAAACMvOEItOEMfKTAwNkMxOUQrNEEy` | **Value Identified:** *"CMS Logo"*

<a id="page-1-https-data-medicaid-gov-dataset-1c853fe0-28c0-43f9-a7ac-26d28c3633c2-third-party-regression" tabindex="-1"></a>
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

<a id="page-2-https-data-medicaid-gov-medicaid-chip-eligibility-enrollment-snapshot-dat" tabindex="-1"></a>
## 📄 Page Context: [https://data.medicaid.gov/medicaid-chip-eligibility-enrollment-snapshot-data](https://data.medicaid.gov/medicaid-chip-eligibility-enrollment-snapshot-data)
* Jump to section: [Alternative text anomalies](#page-2-https-data-medicaid-gov-medicaid-chip-eligibility-enrollment-snapshot-dat-alternative-text-anomalies)
* **Result Execution Status:** `COMPLETED`
* **Lighthouse Performance Score:** 40
* **First Contentful Paint (ms):** 9080
* **Largest Contentful Paint (ms):** 12005
* **Speed Index (ms):** 9080
<a id="page-2-https-data-medicaid-gov-medicaid-chip-eligibility-enrollment-snapshot-dat-alternative-text-anomalies" tabindex="-1"></a>
### 📝 Alternative Text Anomalies
Found **3** instances of missing or generic alt patterns (e.g., 'image.png', 'screenshot').

1. **Target Code Matrix:** `<img src="/frontend/build/static/media/data.medicaid.gov.png" alt="data.medicaid.gov Logo">` | **Value Identified:** *"data.medicaid.gov Logo"*
2. **Target Code Matrix:** `<img class="dc-c-footer__logo" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADsAAAA7CAMAAADy+wKBAAAAnFBMVEUAAABCUVU7RUw0PUczPEczOkY3QEo5QkwzO0Y2` | **Value Identified:** *"HHS Logo"*
3. **Target Code Matrix:** `<img class="dc-c-footer__logo" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHUAAAAoCAMAAAD3ykWnAAAAmVBMVEUAAAAqNkAAACMvOEItOEMfKTAwNkMxOUQrNEEy` | **Value Identified:** *"CMS Logo"*

--- 

<a id="page-3-https-data-medicaid-gov-about-program-overview" tabindex="-1"></a>
## 📄 Page Context: [https://data.medicaid.gov/about/program-overview](https://data.medicaid.gov/about/program-overview)
* Jump to section: [Alternative text anomalies](#page-3-https-data-medicaid-gov-about-program-overview-alternative-text-anomalies)
* **Result Execution Status:** `COMPLETED`
* **Lighthouse Performance Score:** 50
* **First Contentful Paint (ms):** 9180
* **Largest Contentful Paint (ms):** 11790
* **Speed Index (ms):** 9180
* **Error Context:** `Page scan exceeded strict 120s limit and was cancelled.`
