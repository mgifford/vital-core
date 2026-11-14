# Optional Playwright MCP investigation path

VITAL does not bundle or require Playwright MCP. It is an **optional
power-user route** for people who already run an MCP-compatible client and want
to inspect a finding in their own signed-in browser.

The report can copy an observation-only prompt for Playwright MCP; the prompt
contains the recorded URL, selector, tag/role/name and occurrence. Nothing is
sent to VITAL.

## Why this exists

The bookmarklet is the only zero-install way to inject a highlight into another
origin, but it is best-effort: a site can block bookmarklets with CSP, an old
copy can reject newer payloads, and it cannot see a closed shadow root or
cross-origin frame. Playwright MCP with the browser extension can use the
browser you already have open, including cookies, SSO/2FA sessions and
installed extensions.

It is not a replacement for the report's no-install text link, and it is not a
one-click button for a procurement officer. It needs:

- Chrome or Edge with the Playwright Extension;
- Node/npx;
- an MCP-compatible client (Claude Code, Copilot, etc.);
- permission to let that client observe and interact with the browser.

## Setup (external tools)

1. Install the [Playwright Extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)
   in Chrome or Edge.
2. Register the Playwright MCP server in the client's MCP config:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--extension"]
    }
  }
}
```

Use `--profile-dir-name="Profile 1"` if the extension is installed in a
specific profile. See the [Playwright extension documentation](https://playwright.dev/mcp/configuration/browser-extension).

3. Optionally register VITAL's own read-only MCP server
   (`node mcp/server.js`) so the same client can fetch the finding context from
   the published API. The two servers are independent.

## Workflow

1. Open a finding in the Finding Explorer.
2. Choose **Copy Playwright MCP prompt**.
3. Paste it into the MCP client.
4. The client opens the URL in the existing browser and reports:
   - whether one or more visible elements match the selector;
   - whether the recorded tag/role/name still match;
   - whether it is hidden, clipped, covered, in an iframe or shadow root;
   - what page state reveals it.
5. Record the observation in the manual review. The client must not run a new
   audit or claim conformance.

## Boundaries

- **Observation, not diagnosis.** The prompt explicitly forbids an audit,
  remediation claim or fixed/conformant conclusion.
- **The browser is the user's.** The extension can read and act on whatever
  the profile can reach. Use a dedicated profile, do not paste credentials into
  the prompt, and close the session when done.
- **Chrome/Edge only.** No Firefox/Safari extension path.
- **No VITAL dependency.** The static report and API do not call Playwright
  MCP. Removing it changes nothing in the published site.
- **No additional data collection.** VITAL stores no browser data from this
  path; the MCP client's own data handling applies.
- **Accessibility caveat.** Locating the element does not prove the violation
  persists or that the page is inaccessible to a person. False positives and
  false assurance remain possible.

## Decision

Keep the in-report **text fragment** and **bookmarklet** as the default, and
offer the Playwright MCP prompt as an advanced fallback. A later small,
VITAL-branded extension could make this one-click, but that is still deferred
and outside this milestone.
