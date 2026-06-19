---
work_package_id: "WP02"
title: "Wire Ollama into ai-findings.js"
dependencies:
  - WP01
requirement_refs:
  - FR-04
  - FR-05
subtasks:
  - T006
  - T007
  - T008
owned_files:
  - "src/lib/ai-findings.js"
authoritative_surface: "src/lib/"
execution_mode: "code_change"
---

# WP02: Wire Ollama into ai-findings.js

**Implement with**: `spec-kitty agent action implement WP02 --agent claude --mission ollama-integration-01KVG6SJ`

**Prerequisite**: WP01 merged — `src/lib/ollama.js` exists and tests pass.

Add an optional `ollama_summary` field to the ai-findings JSON output.
The field is present only when Ollama is reachable; absent otherwise.
No existing field changes.

---

### T006: Import ollama client into `ai-findings.js`

**Purpose**: Make the ollama module available without committing to calling it yet.

**Steps**:
1. Open `src/lib/ai-findings.js`.
2. Add at the top with existing imports:
   ```js
   import { isAvailable, chat } from './ollama.js';
   ```
3. Confirm the import path is correct relative to `src/lib/`.
4. Run `npm run test:unit` — must still pass (no behaviour change yet).

**Files**: `src/lib/ai-findings.js`
**Validation**: Import resolves; unit tests pass

---

### T007: Build the summary prompt and call `chat()`

**Purpose**: Generate the `ollama_summary` string from the top findings.

**Steps**:
1. In `buildAiFindings()` (or equivalent export in `ai-findings.js`), after the
   findings array is assembled, add:
   ```js
   let ollamaSummary = null;
   if (await isAvailable()) {
     const top = findings
       .slice(0, 5)
       .map((f, i) => `${i + 1}. [${f.severity}] ${f.rule_id}: ${f.pages_affected} pages`)
       .join('\n');
     const prompt =
       `You are an accessibility engineer. Summarise these top issues from ${domain} ` +
       `in 2 plain-English sentences for a non-technical audience:\n${top}`;
     ollamaSummary = await chat(prompt);
   }
   ```
2. Note: `buildAiFindings` may not currently be `async` — check and add `async` if needed.
   Callers in `aggregate.js` already `await` it (verify).
3. Keep the entire block inside a try/catch that silently discards errors — Ollama
   must never break the report build.

**Files**: `src/lib/ai-findings.js`
**Validation**: When `VITAL_OLLAMA_URL` points to a live server, `ollamaSummary` is a non-null string

---

### T008: Add `ollama_summary` to the output document

**Purpose**: Write the field into the JSON output only when a summary was generated.

**Steps**:
1. In the object returned / written by `buildAiFindings`, add:
   ```js
   ...(ollamaSummary ? { ollama_summary: ollamaSummary } : {}),
   ```
   Place it after `ai_summary` (or near the top of the document, before `findings`).
2. Field is omitted entirely when `ollamaSummary` is null — no `null` values in output.
3. Run `npm run test:unit` — all tests must pass.
4. Manually verify with `node src/aggregate.js` (no Ollama needed) — `ollama_summary`
   must be absent from the output JSON when Ollama is not reachable.

**Files**: `src/lib/ai-findings.js`
**Validation**: Field present in JSON when Ollama reachable; absent when not; unit tests pass
