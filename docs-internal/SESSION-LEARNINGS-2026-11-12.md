# Session learnings — 2026-11-12

A handoff record for the retention, evidence and reproduction work completed in
this session. This is project memory, not a changelog of every commit.

## Retention lifecycle

- Four staged PRs built policy/planning, deterministic verified archives,
  archive availability pages/API, and observations/accounting.
- A later safety PR removed the unconditional `node src/prune.js` step from
  `report.yml` and disabled `src/prune.js`. No workflow can delete page detail
  now.
- The only destructive path is `npm run retention:prune -- --execute
  --confirm-domain <key>`, after `retention:prune-check` re-downloads and
  verifies the archive in the same run.
- `retention_weeks` remains readable/plannable but does not delete
  automatically.
- Archive expiry is calculated from the end of the original ISO scan week;
  re-uploading does not extend it. Expiry is metadata, not physical deletion.
- Archive index truncation was removed. Archives carry a manifest with file
  checksums, page IDs/URLs and resolved dedup-stub provenance.

## Real drill evidence

- `www.cms.gov/2026-W44`: 4,391 page records archived into a 7.9 MB ZIP
  (4,442 files), all checksums verified.
- Restored to a fresh directory: 4,391/4,391 pages and 49/49 run logs matched;
  summary matched.
- `retention:prune-check` returned READY for W44 only. **No prune was run.**
- The archive was local-only. A durable backend and real restore drill remain
  required before production pruning.

## ARRM

- `src/data/arrm-tasks.json` is pinned to `w3c/wai-arrm`
  `70f9d027d7a87ab72058ded2037915a76795e46a`.
- Findings join by WCAG SC; the Explorer filter uses **primary ownership**
  roles. It is a typical-responsibility lookup, not an ownership assignment.
- 4.1.1 is mapped for WCAG 2.0 but remains excluded from the WCAG 2.2 A/AA ACR
  catalog and is labelled removed in WCAG 2.1.

## Reproduction and report lessons

- A static report cannot run code on another origin. “Highlight on site” opens
  the page; the user must click the VITAL Inspect bookmark. Make that two-step
  explicit.
- Playwright MCP is Chrome/Edge + extension only; hide it elsewhere rather than
  offering a dead path.
- A template-literal regex with `\/` emitted `/Chrome/|Chromium/|Edg//`, a
  syntax error that stopped the entire Explorer script. Check generated JS, not
  just source. Regression fixed in #347.
- Copy selector/URL and a generated Playwright test are the most portable
  reproduction paths; the text fragment is the no-install path.

## Operations and testing gotchas

- GitHub Actions apt/Ubuntu mirror DNS failures can fail every browser install;
  Playwright without `--with-deps` plus a skip when a browser cannot launch kept
  CI moving, at the cost of WebKit coverage in that environment.
- Stacked docs PRs can inherit a stale `src/locales/template.json`; run
  `i18n:check` on the actual branch and rebase after the parent merges.
- Branch stacking caused avoidable merge work. Prefer one PR per issue and
  merge/rebase before starting the next dependent branch.
- ZIP32 limits: 65,535 entries and 4 GiB; `createZip` now fails clearly.
- Benchmarks: 1k URLs ~84 ms/76 MB RSS; 10k ~0.5 s/266 MB; 100k refused by the
  entry limit. Current per-domain weekly caps are below the limit.

## Open next steps

- **#130:** choose an S3-compatible/R2 or other durable backend, configure
  secrets, run a real restore drill, then authorize a pilot prune.
- **#259:** Section 508 assessment-support layer; largest reporting mission.
- **#144:** click-to-load/consent third-party probes.
- **#131:** CMS/USWDS component-signature coverage.
- **#202:** closed after the SCI-Web design note; future work needs an explicit
  measurement profile, not an SCI-Web conformance claim.
- **#118:** ongoing weekly report thread.

## Governance reminders

- Do not rewrite Git history, force-push `main`, or delete production evidence
  without explicit approval.
- Archive retrieval and checksum verification are mandatory before pruning.
- “Clean” means no axe/Alfa finding, not conformance.
