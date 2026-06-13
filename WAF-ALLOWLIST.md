# WAF allowlist requests

Some target sites sit behind a web application firewall (WAF) / bot
manager that returns **HTTP 403 "Access Denied"** to automated browsers,
even a real headless Chromium identifying itself honestly. When that
happens the scanner records the page as blocked with no audit data, and
discovery stalls because there is no HTML to crawl.

The correct fix is not to evade the WAF (we don't, and won't) but to ask
the site's web team to **allowlist the scanner** so it can measure the
site's accessibility and sustainability. The scanner self-identifies for
exactly this reason.

## Currently blocked

| Site | Symptom | Status |
|------|---------|--------|
| www.hhs.gov | 403 "Access Denied" (Akamai signature) | request not yet sent |
| www.nih.gov | 403 | request not yet sent |

Update this table as requests are sent and access is granted.

## Technical details to give a web-ops team

These are the facts an agency needs to write an allowlist rule. Keep them
in sync with `config/targets.yml` and `.github/workflows/scan.yml`.

- **User-Agent (exact string):**
  `vital-scans/0.1 (+https://github.com/mgifford/vital-core; accessibility and sustainability monitoring)`
  The `+URL` in the UA is the contact/identity link and resolves to the
  project. Allowlisting on this UA substring is the simplest, most stable
  match.
- **What it is:** an open-source, non-commercial accessibility (axe-core +
  Siteimprove Alfa) and sustainability (co2.js) monitor. It reads pages
  only — it never submits forms, logs in, or modifies anything.
- **Politeness / rate limit:** one page at a time per host, with a
  ≥1.5 s delay between requests (more if `robots.txt` sets a longer
  `Crawl-delay`). Honors `robots.txt` (Disallow/Allow/Crawl-delay). Up to
  ~300 pages per nightly run, capped at ~2,500 pages/week per host.
- **Schedule:** runs at off-hours (nightly ~01:23 US Eastern, plus a
  second pass three nights a week).
- **Source IPs:** runs on GitHub-hosted Actions runners, whose egress IPs
  are ephemeral and drawn from GitHub's published ranges
  (<https://api.github.com/meta>, `actions` key). Because that range is
  large and rotates, **allowlisting by User-Agent is strongly preferred
  over IP.** If the agency requires a fixed IP, the workflow can be moved
  to a self-hosted runner or a static-egress proxy with a dedicated IP —
  ask and we can arrange one.
- **Public output (what the scan produces):**
  <https://mgifford.github.io/vital-core/> (weekly accessibility and
  sustainability reports; nothing private is collected).

## Request template (email or contact form)

> **Subject:** Allowlist request — open-source accessibility monitor (vital-scans)
>
> Hello,
>
> I run an open-source, non-commercial project that continuously measures
> the accessibility and sustainability of public U.S. government websites
> and publishes weekly, public, week-over-week trend reports. Your site is
> one I would like to include, but requests are currently blocked with an
> HTTP 403 "Access Denied" by your WAF / bot manager.
>
> I'm writing to ask whether you can allowlist the scanner. It identifies
> itself honestly and is designed to be a polite, read-only visitor:
>
> - **User-Agent:** `vital-scans/0.1 (+https://github.com/mgifford/vital-core; accessibility and sustainability monitoring)`
> - **Behavior:** read-only (GET only); never logs in, submits forms, or
>   changes data.
> - **Rate:** one page at a time, ≥1.5 s between requests, honoring
>   robots.txt; ~300 pages/night, ≤2,500/week, at off-hours.
> - **Source:** GitHub-hosted Actions runners (egress IPs from GitHub's
>   published ranges; I can move to a fixed-IP runner if you require one).
> - **What it produces:** public accessibility (axe-core + Siteimprove
>   Alfa) and sustainability (co2.js) reports at
>   https://mgifford.github.io/vital-core/
> - **Project / contact:** https://github.com/mgifford/vital-core
>
> Allowlisting on the User-Agent substring `vital-scans` is the simplest
> stable match. I'm happy to adjust scan rate, timing, or scope to fit your
> operational needs, and to coordinate with whoever manages your WAF.
>
> Thank you for supporting accessible, sustainable public services.
>
> [Your name]
> [Your email]

## Where to send it

Federal agency web teams don't publish a single "allowlist my crawler"
inbox, so use these channels (most→least direct):

- **hhs.gov:** the HHS web team via the site feedback/contact form at
  <https://www.hhs.gov/web/> contacts, or the digital strategy team. The
  508/accessibility program office is a good secondary contact since this
  is an accessibility tool.
- **nih.gov:** NIH Web Communications / OCPL via the contact form at
  <https://www.nih.gov/about-nih/contact-us>; mention it's an
  accessibility-monitoring tool for their Section 508 program.

Because these are run by people, frame it as an accessibility-program
collaboration, not a generic crawler request — it lands better and these
are the teams who own both the WAF policy and the 508 mandate.
