# Accessibility statement

This project follows the practices described in the canonical statement at
<https://mgifford.github.io/ACCESSIBILITY.md> and applies them to both the
tool itself and everything it produces.

## What this project commits to

**Generated reports are accessible.** Every HTML report and the dashboard:

- use semantic HTML (headings in order, tables with `caption` and `scope`,
  landmarks, a skip link);
- work without JavaScript, because they contain none;
- meet WCAG 2.2 AA contrast in both light and dark mode
  (`prefers-color-scheme` is respected);
- never communicate change through colour alone. Week-over-week deltas are
  written as text ("worse", "better") first;
- mark decorative sparklines as such (`aria-hidden`) and pair them with
  visually hidden text equivalents;
- use system fonts and relative units so user font-size preferences apply.

**The scanner measures accessibility honestly.** Reports state plainly that
automated checks find roughly a third of accessibility barriers. A clean
automated scan is a floor, not a pass. Manual testing with assistive
technology remains necessary.

**Two independent engines.** Pages are tested with both axe-core (Deque) and
Alfa (Siteimprove). They implement WCAG conformance testing differently and
catch different problems; disagreements between them are informative, not
noise.

## Live inspection bookmarklet

The optional **VITAL Inspect** bookmarklet locates a recorded finding on the
live site. It is an inspection aid, not a fresh audit: a visible element does
not prove the historical violation still exists.

- **Keyboard:** the install section is open by default at the top of the
  Accessibility page and Explorer. If dragging is not possible, use **Copy
  bookmarklet** or the link’s “Copy link” action, then create a bookmark
  manually and paste the code as its address. The instructions include the
  bookmarks-bar shortcut for each desktop browser. Close with `Escape` or the Close button; Previous/Next, Find
  again, Hide highlight, Collapse/Expand and Move panel are ordinary buttons;
  focus returns to the page after closing.
- **Dynamic pages:** if the element is removed, replaced, hidden or changes a
  recorded identity attribute, the highlight is suspended and the panel says
  so. Use Find again after changing the page state; the bookmarklet never
  clicks, accepts consent, opens dialogs or switches to a different element.
- **Status is text, not colour:** "Recorded element located", "Possible matching
  element. Verification required.", "Recorded element changed" and "Element not
  found" are written in the panel, and the candidate/changed boxes use dashed
  borders and labels as well as colour.
- **Strict Content-Security-Policy:** a page whose `script-src` blocks inline
  script may prevent the bookmarklet from running at all, so no error can be
  shown. Do not weaken the site's policy; use the Finding Explorer or the
  Playwright reproduction instead.
- **Native text fragment:** “Highlight text on site” uses the browser’s
  `#:~:text=` support. It requires no bookmark, but highlights text rather than
  the element box, may select the first matching text, and is unavailable when
  the page already uses its fragment. It is a location aid, not a VITAL panel.
- **Copy inspection code:** both the Accessibility page and Finding Explorer
  offer a URL-free code for pages that use hash routing or when a fragment is
  lost.
- **Frames and shadow roots:** live highlighting is unavailable and the report
  says so rather than guessing.
- **Which method?** The install panel distinguishes historical evidence, the
  live element highlight, the native text-fragment link, Playwright
  reproduction and manual validation. They answer different questions and are
  not interchangeable.
- **Access-denied pages:** the bookmarklet and local inspector report a firewall
  or bot-block page explicitly; they do not try to bypass it.
- **Manual assistive-technology testing of the bookmarklet has not been
  performed yet.** Keyboard behaviour is tested in Chromium; screen reader,
  forced-colors and cross-browser checks remain manual work.

## Reporting problems

If a generated report is hard to use with a screen reader, keyboard,
magnification, or any other assistive technology, that is a bug of the same
severity as a broken scan. Open an issue describing the assistive technology
and browser involved and what failed.

## Scope

This statement covers the report templates in `src/report-html.js`, the
shared stylesheet they emit, and the Markdown issue comments. It does not
cover the sites being scanned; that is what the scanner is for.
