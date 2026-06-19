---
work_package_id: WP01
title: Ollama client module + unit tests
dependencies: []
requirement_refs:
- FR-01
- FR-02
- FR-03
- NFR-01
- NFR-02
planning_base_branch: public-interest-checks
merge_target_branch: public-interest-checks
branch_strategy: Planning artifacts for this feature were generated on public-interest-checks. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into public-interest-checks unless the human explicitly redirects the landing branch.
subtasks:
- T001
- T002
- T003
- T004
- T005
history: []
agent: claude
shell_pid: 0
authoritative_surface: src/lib/
execution_mode: code_change
owned_files:
- src/lib/ollama.js
- tests/unit/ollama.test.js
tags: []
---

# WP01: Ollama client module + unit tests

**Implement with**: `spec-kitty agent action implement WP01 --agent claude --mission ollama-integration-01KVG6SJ`

Create `src/lib/ollama.js` — a thin, self-contained Ollama client — and its unit tests.
No consumers are wired in this WP. No new npm dependencies.

---

### T001: Create `src/lib/ollama.js` with config and base fetch helper

**Purpose**: Establish the module with env-var config and a shared internal fetch helper
that adds the timeout and handles JSON parsing.

**Steps**:
1. Create `src/lib/ollama.js` as a pure ESM module.
2. Read config at module load time:
   ```js
   const BASE_URL = process.env.VITAL_OLLAMA_URL ?? 'http://localhost:11434';
   const DEFAULT_MODEL = process.env.VITAL_OLLAMA_MODEL ?? null; // null = auto-detect
   ```
3. Write an internal `ollamaFetch(path, init = {})` helper:
   - Prepends `BASE_URL` to `path`
   - Adds `signal: AbortSignal.timeout(2000)` by default (overridable via `init.signal`)
   - Returns parsed JSON or throws on non-2xx
   - Never used directly outside this module

**Files**: `src/lib/ollama.js` (new)
**Validation**: Module imports without error; `BASE_URL` reflects env var when set

---

### T002: Implement `isAvailable()`

**Purpose**: Probe the Ollama server; return `false` on any failure, never throw.

**Steps**:
1. Export `async function isAvailable()`:
   ```js
   export async function isAvailable() {
     try {
       await ollamaFetch('/api/tags');
       return true;
     } catch {
       return false;
     }
   }
   ```
2. The 2-second timeout from `ollamaFetch` is the only timeout — no additional wrapping needed.
3. Return type is `Promise<boolean>`.

**Files**: `src/lib/ollama.js`
**Validation**: Returns `false` when server is unreachable; returns `true` when `/api/tags` responds 200

---

### T003: Implement `detectModel()`

**Purpose**: Return the best available model name, using env override if set.

**Steps**:
1. Export `async function detectModel()`:
   - If `DEFAULT_MODEL` is set (env var `VITAL_OLLAMA_MODEL`), return it immediately
   - Otherwise call `GET /api/tags`, parse `data.models[0]?.name`
   - Fall back to `'llama3'` if the list is empty or the request fails
2. Result is a plain string — never throws.

**Files**: `src/lib/ollama.js`
**Validation**: Returns env var value when `VITAL_OLLAMA_MODEL` is set; returns `'llama3'` when server has no models

---

### T004: Implement `chat(prompt, model?)`

**Purpose**: Send a prompt to Ollama and return the response string, or `null` on any error.

**Steps**:
1. Export `async function chat(prompt, model)`:
   ```js
   export async function chat(prompt, model) {
     try {
       const m = model ?? await detectModel();
       const data = await ollamaFetch('/api/generate', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ model: m, prompt, stream: false }),
         signal: AbortSignal.timeout(30000), // longer timeout for generation
       });
       return typeof data.response === 'string' ? data.response.trim() : null;
     } catch {
       return null;
     }
   }
   ```
2. Use a 30-second timeout for generation (models can be slow).
3. Return `null` (not throw) on any error.

**Files**: `src/lib/ollama.js`
**Validation**: Returns string on success; returns `null` when server is down or times out

---

### T005: Write unit tests in `tests/unit/ollama.test.js`

**Purpose**: Verify all three exports work correctly without a real Ollama server.

**Steps**:
1. Create `tests/unit/ollama.test.js` using Node's built-in test runner (`node:test`).
2. Mock `globalThis.fetch` before each test and restore after:
   ```js
   import { describe, it, before, after } from 'node:test';
   import assert from 'node:assert/strict';
   ```
3. Tests to write:
   - `isAvailable()` returns `true` when fetch resolves 200 with `{ models: [] }`
   - `isAvailable()` returns `false` when fetch throws (network error)
   - `isAvailable()` returns `false` when fetch rejects with AbortError (timeout)
   - `chat()` returns the `response` string on success
   - `chat()` returns `null` when fetch throws
4. Keep each test's mock minimal — only stub `globalThis.fetch`.

**Files**: `tests/unit/ollama.test.js` (new)
**Validation**: `npm run test:unit` — all existing 91 tests plus new ollama tests pass; no tests skipped

## Activity Log

- 2026-06-19T19:05:44Z – unknown – Moved to done
