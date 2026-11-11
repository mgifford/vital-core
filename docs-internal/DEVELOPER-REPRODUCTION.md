# Reproducing a finding

The report is static. It cannot run code on the reported site. There are four
developer paths; choose the lightest one that answers the question.

| | Chrome / Edge | Firefox / Safari |
|---|---|---|
| VITAL Inspect bookmarklet | Yes | Usually; a strict `script-src` can block it |
| No-install text fragment | Yes | Yes, when the finding has visible text |
| Copy selector / page URL | Yes | Yes |
| Generated Playwright test | Yes | Yes (download from Finding Explorer) |
| Playwright MCP + browser extension | Yes | No |

## Why “Highlight on site” shows nothing at first

The link only **opens the page** with an inspection payload in the URL
fragment. It does not run automatically. After the page loads, click the
**VITAL Inspect** bookmark in the bookmarks bar. The panel appears bottom-right.

If it still does not appear:

1. Reinstall VITAL Inspect from the top of the report; older copies can reject
   newer payloads.
2. Check the page's `script-src` CSP; a strict policy blocks bookmarklets.
3. Use **Copy inspection code** and paste it when VITAL Inspect asks.
4. Or copy the selector and page URL for a manual/Playwright check.

A missing panel means **unverified**, not fixed.

## Fastest paths

### 1. Copy selector + page URL

Both are in the finding details after **More inspection options**. This works in
every browser and is the shortest path for a developer who already has the page
open.

### 2. Inspect with the bookmarklet

1. Drag **VITAL Inspect** into the bookmarks bar once.
2. Open the finding's live page.
3. Click the bookmark.

The panel reports located / hidden / changed / not found and gives the recorded
rule, WCAG mapping and selector. It does not re-run an audit or prove a fix.

### 3. Playwright MCP (Chrome/Edge only)

Requires:

- the Playwright MCP server;
- the [Playwright browser extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)
  connected to the existing Chrome/Edge profile;
- an MCP client.

Copy **Playwright MCP prompt** from the finding. The prompt now tells the agent
to stop if the server or extension is missing, and asks it to report matching
elements, visibility/occlusion, required interaction, child roles for
relationship rules, and a short DOM/accessibility-tree snapshot.

It is observation-only: no new audit, no conformance claim, no page changes.

### 4. Generated Playwright test

Open the finding in **Finding Explorer** and use **Download Playwright test**.
This produces a standalone test from the recorded element and selector; run it
against the current or staging page.

## Firefox and Chrome output

The report content is the same in both. The difference is the live-reproduction
tooling:

- **Chrome/Edge:** bookmarklet plus optional Playwright MCP.
- **Firefox:** bookmarklet/text fragment/copied selector; Playwright MCP is
  hidden because it depends on the Chromium extension.

The MCP action is hidden outside Chromium rather than opening a dead path.
