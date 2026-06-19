---
work_package_id: WP03
title: Diagnostic script + package.json entry
dependencies:
- WP01
requirement_refs:
- FR-06
planning_base_branch: public-interest-checks
merge_target_branch: public-interest-checks
branch_strategy: Planning artifacts for this feature were generated on public-interest-checks. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into public-interest-checks unless the human explicitly redirects the landing branch.
subtasks:
- T009
- T010
history: []
authoritative_surface: scripts/
execution_mode: code_change
owned_files:
- scripts/check-ollama.js
- package.json
tags: []
---

# WP03: Diagnostic script + package.json entry

**Implement with**: `spec-kitty agent action implement WP03 --agent claude --mission ollama-integration-01KVG6SJ`

**Prerequisite**: WP01 merged — `src/lib/ollama.js` exists.

Create `scripts/check-ollama.js` modelled on the existing `scripts/check-public-interest.js`.
Exit code is always 0 — this is a diagnostic, not a CI gate.

---

### T009: Write `scripts/check-ollama.js`

**Purpose**: Let a developer instantly verify their local Ollama setup without running a full scan.

**Steps**:
1. Create `scripts/check-ollama.js` (ESM, `#!/usr/bin/env node`).
2. Import `{ isAvailable, detectModel, chat }` from `../src/lib/ollama.js`.
3. Behaviour:
   - Print the Ollama URL being probed (`VITAL_OLLAMA_URL` or default).
   - Call `isAvailable()` and print ✓ or ✗.
   - If available: call `detectModel()` and print the model name.
   - If available: call `chat('Say "Ollama is working" and nothing else.')` and print the response.
   - If not available: print a brief troubleshooting hint (check URL, check `ollama serve`).
4. Support `--json` flag: output a single JSON object with fields
   `{ url, available, model, test_response }` and skip all ANSI colour.
5. Use the same ANSI colour pattern as `scripts/check-public-interest.js`
   (check `process.stdout.isTTY` before emitting colour codes).
6. Exit 0 always.

**Files**: `scripts/check-ollama.js` (new)
**Validation**: `node scripts/check-ollama.js` prints results without throwing;
`node scripts/check-ollama.js --json` outputs valid JSON

---

### T010: Add `check:ollama` to `package.json`

**Purpose**: Make the diagnostic discoverable via `npm run`.

**Steps**:
1. Open `package.json`.
2. Add to `"scripts"`:
   ```json
   "check:ollama": "node scripts/check-ollama.js"
   ```
   Place it next to `"check:public-interest"`.
3. Verify: `npm run check:ollama` runs without error (Ollama may or may not be reachable).

**Files**: `package.json`
**Validation**: `npm run check:ollama` executes the script; exit code 0

## Activity Log

- 2026-06-19T19:16:48Z – unknown – Moved to done
