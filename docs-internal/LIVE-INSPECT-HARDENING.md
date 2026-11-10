# Live inspection bookmarklet — hardening notes

Status: PR 1–4 of the hardening sequence are complete. Packaged-extension,
interaction-replay and cross-browser/manual-AT work remain deferred.

The bookmarklet is an **inspection aid**. It locates a recorded element; it does
not run a new accessibility assessment or prove that a historical violation
still exists.

## Confirmed problems fixed in PR 1

- The old code used `querySelectorAll(...)[0]` and highlighted it even when
  several elements matched.
- Tag/role/name differences were reported but the element was still highlighted
  as the occurrence.
- Frames, shadow roots and missing element evidence could still produce a
  "Highlight on site" link.

## Matching model (PR 1)

| Status | Evidence | UI |
|---|---|---|
| Recorded element located | unique selector; recorded tag, explicit role and a reliable name attribute agree | solid box; explicitly says the violation was not re-tested |
| Possible matching element | multiple matches, or tag/role/name evidence incomplete | dashed box; Candidate N of M; Previous/Next |
| Recorded element changed | selector matches but a recorded identity value differs | no box by default; differences listed; explicit Show changed element |
| Element not found | no selector match | no box; causes; Find again |

A unique selector plus tag and role alone is deliberately **not** enough for
"located"; a reliable recorded name attribute is required. This is stricter than
the old behaviour and keeps uncertainty visible.

## Confirmed problems fixed in PR 2

- The payload carried the full destination URL (including query parameters) and
  used the occurrence field `o`; it now carries only the **origin**, selector,
  recorded identity, rule/WCAG/fix text and occurrence id.
- No payload version/size/origin/field validation existed.
- A fragment-routed page received `&vital-inspect=...` appended to its existing
  hash with no warning and no alternative.
- The old tests called the function with `page.evaluate()`, which does not prove
  that a real `javascript:` activation works.

## Payload contract (v1)

```json
{
  "v": 1,
  "s": "CSS selector (max 500)",
  "t": "recorded tag or null",
  "r": "recorded explicit role or null",
  "n": "recorded name attribute value or null",
  "ns": "aria-label | alt | title | placeholder | aria-labelledby | aria-labelledby-unresolved | none",
  "rule": "rule id",
  "label": "short rule label",
  "w": "WCAG SC",
  "fix": "historical remediation tip (max 400)",
  "h": "http(s) documentation URL or null",
  "org": "https://origin (no path, query or fragment)",
  "id": "occurrence id or null"
}
```

Validation rejects: non-object payloads, unsupported versions, unexpected
properties, over-size values, invalid selectors, non-origin `org`, origin
mismatch with the current page, non-http documentation links, unknown name
sources, and codes over 8,192 characters (decoded JSON over 6,000). All values
are rendered with `textContent`; there is no `eval` and no network request.

## Fragment transport and the URL-free fallback

The one-click path still uses the fragment: `#vital-inspect=<code>`. It is the
simplest handoff that needs no server or extension. Two protections apply:

1. When the destination already has a fragment, the report says so and warns
   that hash-routed pages may be affected.
2. Every finding also offers **Copy inspection code** (hidden without
   JavaScript). The bookmarklet prompts for a code when no fragment payload is
   present, so a hash-routed page can be opened normally instead.

The code is base64url, **not encryption**. Scripts on the destination page can
read the fragment and clipboard contents are visible to the user's applications.
It contains no page text, HTML, full URL or query string.

## Chromium test results (automated)

Environment: Playwright 1.60, macOS. Chromium 148.0.7778.96 and WebKit 26.4
launched successfully; Firefox (1522) timed out at launch and is **untested**.

| Page policy | Activation method | Result |
|---|---|---|
| No CSP | click a `javascript:` link in the page | overlay rendered in Chromium and WebKit |
| `script-src 'self'; style-src 'self'` | same | **blocked** in Chromium and WebKit |
| `script-src 'none'` | same | **blocked** in Chromium (WebKit not separately rerun) |
| `script-src 'unsafe-inline'; style-src 'none'` | same | overlay rendered; CSSOM positioning still works (Chromium) |
| `script-src 'unsafe-inline'; style-src 'nonce-abc'` | same | overlay rendered (Chromium) |

The `javascript:` link is a proxy for bookmark activation, not a bookmark-bar
click. A real bookmark may behave differently; this is not yet proven in any
browser.

**Firefox, Edge, mobile browsers and actual bookmark-bar activation are
untested.** WebKit is tested through the same `javascript:` link proxy, not
Safari bookmark UI. Do not claim cross-browser support.

## Manual verification procedure

1. Load a VITAL report and install **VITAL Inspect** in the bookmarks bar.
2. Open a finding's **Highlight on site** link (or copy its inspection code).
3. Activate the bookmark.
4. Record browser and version, OS, page CSP (DevTools → Network → response
   headers), activation method (bookmark bar / bookmark menu / pasted code),
   match status, console errors, and a screenshot.
5. Try the same on a page with a restrictive `script-src` and on a hash-routed
   page using the code fallback.

Known failure mode: a page whose `script-src` does not allow inline script can
block the bookmarklet before it can show any message. The report warns about
this; users must not weaken the site's CSP.

## Performance measurements

- Bookmarklet source: **23,397 bytes** (unminified except whitespace; PR 3 added the shadow-root UI and observers).
- Typical inspection code: **424 bytes**; decoded payload **318 bytes**.
- No external dependencies, network requests, full-DOM serialization or
  background observers.
- Initialization and selector lookup are bounded by `querySelectorAll`; the
  panel updates on scroll/resize with `requestAnimationFrame`. No continuous
  polling. Repeated activation removes the previous UI (covered by tests).
- Observed activation-to-panel time in Chromium: **median 48 ms** over five
  runs (Playwright click + wait, so this includes automation overhead; not a
  user-perceived benchmark).
- These are static measurements; cross-browser/user-device timings are not yet
  measured.

## Dynamic DOM and overlay (PR 3)

- The UI lives in an open shadow root on a fixed host, so aggressive page CSS
  (`button { display:none !important }`, global borders) does not reach it.
- MutationObserver (document tree and target attributes) plus ResizeObserver
  detect removal/replacement, hidden state, and identity-attribute changes.
  Updates are coalesced with requestAnimationFrame; observers and listeners are
  disconnected on close and on Find again. There is no polling or automatic
  clicking.
- Removal/replacement or an identity change suspends the marker and requires
  Find again; hidden elements suspend the marker and restore it when visible.
- Controls: Close, Previous/Next candidate, Find again, Hide highlight, Show
  changed element, Collapse/Expand, Move panel. Escape closes; focus returns.
- Forced-colors and dark-mode CSS, a 320px viewport check, shadow isolation,
  collapse/move, and an axe-core overlay check are covered in Chromium.
- Manual screen-reader and cross-browser testing is still **not performed**.

## Integration (PR 4)

- The overlay now shows the occurrence id, and Collapse declares
  `aria-controls` on the details region.
- The Finding Explorer offers the same **Copy inspection code** as the
  Accessibility page; the install block is open by default.
- E2E assertions cover the open install block, the URL-free code on both
  surfaces, and the existing Explorer/accessibility workflow.
- The unsupported-context message, the historical-guidance label and the
  “not re-tested” status are retained; no terminology implies a fresh pass.

Final measured values: bookmarklet **23,397 bytes**, typical code **424 bytes**,
decoded payload **318 bytes**. Chromium activation-to-panel remains in the tens
of milliseconds; see the measurements section.

## Finding the element

The panel scrolls the first **visible** candidate into view on activation and
offers **Show element** to re-centre it. A matched element with no visible box
(display:none, visibility:hidden, opacity:0, zero rect) is reported as **hidden
in this page state**, with instructions to open the containing menu/tab/dialog
and choose **Find again**. It is never replaced with a different element just to
produce a visible outline. The outline now includes a translucent fill as well
as the high-contrast border.

If the recorded selector no longer matches, the panel looks for up to ten
visible elements of the recorded tag whose visible text anchor or recorded name
attribute matches. They are offered as **candidates**, never as a located
occurrence, and the panel says the recorded selector no longer matches.

## Stale installed bookmarklets

The bookmarklet is self-contained and cannot auto-update. A copy installed
before a payload change can reject newer fields; the report now shows the
current version and tells earlier installers to drag it again. The help panel's
**“Clicked VITAL Inspect and nothing happened?”** item names reinstall, CSP,
clipboard fallback and blocked-automation routes. Do not treat an alert or no
panel as evidence about the page until the current version is installed.

## Access-block pages

The bookmarklet now detects common Akamai/edge access-denied pages and reports
**Page access blocked** instead of “element not found”. It does not attempt to
bypass the block; the guidance is to use the same inspection URL in the user's
normal browser or the local inspector's `--print-url`.

## Deferred

- **P2 packaged extension** — reliable execution where bookmarklets are blocked,
  same-origin frames, open shadow roots, stronger identity.
- **P2 deterministic interaction replay** — no automatic clicks/cookie actions;
  Find again asks the user to change state.
- **P2 computed accessibility semantics** — recorded name attributes only.
- **P2 manual assessment enhancements** — unchanged.
- **P2 ARRM task/role mapping** — separate milestone.
- **P3 cross-fleet adoption** — downstream fleets, including LocalGov Drupal,
  without modifying them now.
- PR 4: Explorer workflow, terminology, integration tests, final measurements.
