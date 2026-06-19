---
work_package_id: "WP04"
title: "Smoke test + CLAUDE.md update"
dependencies:
  - WP02
  - WP03
requirement_refs:
  - NFR-02
subtasks:
  - T011
  - T012
owned_files:
  - "CLAUDE.md"
authoritative_surface: "."
execution_mode: "code_change"
---

# WP04: Smoke test + CLAUDE.md update

**Implement with**: `spec-kitty agent action implement WP04 --agent claude --mission ollama-integration-01KVG6SJ`

**Prerequisite**: WP02 and WP03 merged.

Verify the full integration end-to-end and document the env vars in CLAUDE.md.

---

### T011: Run full verification

**Purpose**: Confirm nothing is broken before opening the PR.

**Steps**:
1. Run `npm run test:unit` — must show all tests pass (≥91, including new ollama tests).
2. Run `node scripts/check-ollama.js` — note whether Ollama at
   `http://192.168.50.171:11434` is reachable. Record the output.
3. If Ollama is reachable: run `node src/aggregate.js` for one domain
   (`VITAL_DOMAIN=www.cms.gov node src/aggregate.js` or equivalent) and confirm:
   - `ollama_summary` appears in the generated `*_ai-findings.json`
   - All other fields are unchanged
   - The run completes without error
4. If Ollama is not reachable: run the same aggregate and confirm `ollama_summary`
   is absent from the JSON output and the run still completes cleanly.

**Files**: none (validation only)
**Validation**: Unit tests pass; aggregate runs without error with and without Ollama

---

### T012: Update CLAUDE.md with Ollama env vars

**Purpose**: Document the two new env vars so developers know how to configure Ollama.

**Steps**:
1. Open `CLAUDE.md`.
2. Add a new section after "Key commands":
   ```markdown
   **Optional — local Ollama LLM** (for `ollama_summary` in ai-findings output):
   ```bash
   export VITAL_OLLAMA_URL=http://192.168.50.171:11434  # default: http://localhost:11434
   export VITAL_OLLAMA_MODEL=llama3                      # default: first available model
   npm run check:ollama   # verify connectivity
   ```
   Ollama is always optional — absent or unreachable = no change in report output.
   ```
3. Keep it brief — one code block, no paragraphs.

**Files**: `CLAUDE.md`
**Validation**: `CLAUDE.md` mentions both env vars and `npm run check:ollama`
