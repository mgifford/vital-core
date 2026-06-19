# Implementation Plan: Ollama Local-LLM Integration

**Branch**: `ollama-integration` (off `main` after PR #151 merges)  
**Date**: 2026-06-19  
**Spec**: [spec.md](spec.md)

## Summary

Add an optional thin client (`src/lib/ollama.js`) that calls a local Ollama
instance via plain `fetch()`. Wire one consumer: `src/lib/ai-findings.js`
calls it at aggregate time to prepend a natural-language summary to each
domain's AI findings output. If Ollama is unreachable the code falls back
silently — no change in output, no thrown errors.

## Technical Context

**Language/Version**: Node.js ESM ≥20  
**Primary Dependencies**: none new — `fetch` (built-in Node 18+)  
**Storage**: N/A (no persistent state; result is written into ai-findings.json)  
**Testing**: Node built-in test runner (`npm run test:unit`); mock `fetch` for unit tests  
**Target Platform**: macOS + Linux (local dev + GitHub Actions)  
**Performance Goals**: `isAvailable()` must resolve in ≤2 s (hard timeout)  
**Constraints**: Zero new npm dependencies; Ollama calls happen only at
`aggregate` time, never during scan jobs  
**Scale/Scope**: One new module, one consumer, one diagnostic script

## Charter Check

- ✓ No new npm dependencies
- ✓ Graceful fallback — output unchanged when Ollama absent
- ✓ Tests added alongside new code
- ✓ CSS unchanged (no report layout changes)
- ✓ No VA data touched

## Project Structure

```
src/lib/ollama.js            ← new: thin Ollama client
src/lib/ai-findings.js       ← modified: call ollama when available
scripts/check-ollama.js      ← new: diagnostic CLI
tests/unit/ollama.test.js    ← new: unit tests
```

## Work Packages

### WP01 — `src/lib/ollama.js` client module

Implement the thin client. No consumers yet — just the module itself and its tests.

**Deliverables**:
- `src/lib/ollama.js` exports `isAvailable()`, `detectModel()`, `chat(prompt, model?)`
- `isAvailable()`: `GET /api/tags` with 2 s `AbortController` timeout, returns `false` on any error
- `detectModel()`: calls `/api/tags`, returns first model name or `'llama3'` as fallback
- `chat(prompt, model?)`: `POST /api/generate` with `{ model, prompt, stream: false }`, returns `response` string or `null` on error
- Config: `VITAL_OLLAMA_URL` (default `http://localhost:11434`), `VITAL_OLLAMA_MODEL`
- `tests/unit/ollama.test.js`: mock `globalThis.fetch`; test `isAvailable()` up/down/timeout, `chat()` success/error

### WP02 — Wire into `ai-findings.js`

At aggregate time, if Ollama is available, generate a one-paragraph
natural-language summary of the top accessibility issues and prepend it to
the `ai_summary` field in the output JSON.

**Deliverables**:
- `src/lib/ai-findings.js`: import `ollama.js`; call `isAvailable()` once; if true, call `chat(summaryPrompt)` and prepend result to the findings doc's `ai_summary` field
- Prompt is compact: top-5 issues by severity + page count, ask for a 2-sentence plain-English summary
- No change to output shape when Ollama is absent

### WP03 — `scripts/check-ollama.js` diagnostic

**Deliverables**:
- `node scripts/check-ollama.js` prints: Ollama reachable (Y/N), available models, a test generation with a canned prompt
- `--json` flag for machine-readable output
- Exit 0 always (diagnostic, not CI gate)
- `package.json`: `"check:ollama": "node scripts/check-ollama.js"`

### WP04 — Integration smoke test + docs

**Deliverables**:
- Run `npm run check:ollama` against `http://192.168.50.171:11434` and confirm output
- Run `npm run test:unit` — all tests pass (including new ollama tests)
- Update `CLAUDE.md` with the `VITAL_OLLAMA_URL` env var note
