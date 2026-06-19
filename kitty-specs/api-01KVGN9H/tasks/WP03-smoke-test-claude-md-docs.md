---
work_package_id: WP03
title: Smoke test + CLAUDE.md docs
dependencies:
- WP02
requirement_refs:
- NFR-02
- NFR-03
planning_base_branch: public-interest-checks
merge_target_branch: public-interest-checks
branch_strategy: Planning artifacts for this feature were generated on public-interest-checks. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into public-interest-checks unless the human explicitly redirects the landing branch.
subtasks:
- T010
- T011
history: []
authoritative_surface: CLAUDE.md
execution_mode: code_change
owned_files:
- CLAUDE.md
tags: []
---

# WP03: Smoke test + CLAUDE.md docs

**Implement with**: `spec-kitty agent action implement WP03 --agent claude --mission api-01KVGN9H`

**Requires WP02** to be merged first (api-writer must be wired into aggregate).

This WP validates the end-to-end output of the static JSON API and documents the new endpoints in `CLAUDE.md`. No new source files. No new npm dependencies.

---

### T010: Validate JSON structure of generated API files

**Purpose**: Confirm the three file families are well-formed and match the schema described in `spec.md` before the PR is opened.

**Steps**:
1. Run `npm run aggregate` locally (requires local scan data in `data/`). If no local data is available, skip to validation step 4 and note the skip in the acceptance matrix.
2. Confirm files exist:
   ```bash
   ls docs/api/v1/index.json
   ls docs/api/v1/*/snapshot.json
   ls docs/api/v1/*/*/findings.json
   ```
3. Validate `index.json` structure:
   ```bash
   node -e "
     const d = JSON.parse(require('fs').readFileSync('docs/api/v1/index.json', 'utf8'));
     console.assert(d.schema_version === '1', 'schema_version must be 1');
     console.assert(Array.isArray(d.domains), 'domains must be array');
     console.assert(d.domains.every(e => e.domain && e.key && e.snapshot_url), 'each entry needs domain, key, snapshot_url');
     console.log('index.json OK:', d.domains.length, 'domains');
   "
   ```
4. Validate one `snapshot.json`:
   ```bash
   node -e "
     const files = require('fs').readdirSync('docs/api/v1').filter(f => !f.includes('.'));
     const key = files[0];
     const snap = JSON.parse(require('fs').readFileSync(\`docs/api/v1/\${key}/snapshot.json\`, 'utf8'));
     console.assert(snap.schema_version === '1');
     console.assert(snap.summary && typeof snap.summary.critical_count === 'number');
     console.assert(snap.weekly && Array.isArray(snap.weekly.series));
     console.log('snapshot.json OK:', key);
   "
   ```
5. Validate one `findings.json`:
   ```bash
   node -e "
     const fs = require('fs');
     const key = fs.readdirSync('docs/api/v1').filter(f => !f.includes('.'))[0];
     const weeks = fs.readdirSync(\`docs/api/v1/\${key}\`).filter(f => f.startsWith('2'));
     const f = JSON.parse(fs.readFileSync(\`docs/api/v1/\${key}/\${weeks[0]}/findings.json\`, 'utf8'));
     console.assert(f.schema_version === '1');
     console.assert(Array.isArray(f.findings));
     if (f.findings.length > 0) {
       const entry = f.findings[0];
       console.assert(entry.finding_id && entry.rule_id && entry.severity);
       console.assert(['new','persistent','worsening','improving'].includes(entry.trend_status));
     }
     console.log('findings.json OK:', f.findings.length, 'findings');
   "
   ```
6. Run `npm run test:unit` one final time to confirm all tests still pass.

**Validation**: All three node assertions pass; `npm run test:unit` green

---

### T011: Update CLAUDE.md with API output documentation

**Purpose**: Document the static JSON API in `CLAUDE.md` so future contributors know where the files come from, what they contain, and how to access them on GitHub Pages.

**Steps**:
1. Open `CLAUDE.md` and locate the **Key commands** section near the top.
2. Add `npm run aggregate` documentation if not already there (it may already be listed — do not duplicate).
3. Find or create a section titled **Static JSON API** (insert after the existing "Code conventions" section or at the end of the file, whichever reads more naturally). Add:

   ```markdown
   ## Static JSON API

   `npm run aggregate` writes a versioned static JSON API to `docs/api/v1/` alongside
   the HTML reports. Files are gitignored locally and deployed to GitHub Pages.

   **Endpoint families** (all served from `https://<pages-host>/api/v1/`):

   | Path | Description |
   |---|---|
   | `index.json` | All domains — severity counts, latest week, links |
   | `<domain-key>/snapshot.json` | Full domain history — summary, findings ledger, weekly series |
   | `<domain-key>/<week>/findings.json` | Per-week findings with trend status |

   **Schema version**: `schema_version: "1"` in every file. Bump to `"2"` only with a
   breaking change; add the new path under `api/v2/` and keep `v1/` until consumers migrate.

   **No server required** — these are pre-built static files. The `src/lib/api-writer.js`
   module builds them; `src/aggregate.js` calls `writeApiFiles()` once at the end of each run.
   ```

4. Do not modify any other section of `CLAUDE.md`. Do not add emoji or change existing formatting conventions.

**Files**: `CLAUDE.md`
**Validation**: `CLAUDE.md` contains a "Static JSON API" section; existing sections are unchanged
