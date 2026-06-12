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

## Reporting problems

If a generated report is hard to use with a screen reader, keyboard,
magnification, or any other assistive technology, that is a bug of the same
severity as a broken scan. Open an issue describing the assistive technology
and browser involved and what failed.

## Scope

This statement covers the report templates in `src/report-html.js`, the
shared stylesheet they emit, and the Markdown issue comments. It does not
cover the sites being scanned; that is what the scanner is for.
