# Spec: Ollama Local-LLM Integration

**Feature slug**: ollama-integration  
**Mission ID**: ollama-integration-01KVG6SJ

## Goal

Allow vital-core to optionally use a local Ollama instance
(`http://192.168.50.171:11434` or `$VITAL_OLLAMA_URL`) for:

1. **AI findings summarisation** — richer natural-language summaries of
   accessibility bug clusters (currently no prose generation exists).
2. **Plain-language scoring** — classify readability issues with an LLM instead
   of relying solely on Flesch-Kincaid.
3. **Report metadata extraction** — generate alt-text quality assessments and
   flag missing descriptions in bulk.

Ollama is always **optional**: if the endpoint is unreachable or not configured,
the code falls back silently to the existing logic. No Ollama → no change in output.

## Requirements

| ID | Requirement |
|---|---|
| FR-01 | `src/lib/ollama.js` exports `isAvailable()`, `detectModel()`, `chat()` |
| FR-02 | `isAvailable()` uses a 2-second timeout; returns `false` on any error |
| FR-03 | Config via `VITAL_OLLAMA_URL` and `VITAL_OLLAMA_MODEL` env vars |
| FR-04 | `ai-findings.js` calls `ollama.chat()` when available; adds `ollama_summary` field |
| FR-05 | No change to output shape when Ollama is absent |
| FR-06 | `scripts/check-ollama.js` diagnostic; `check:ollama` npm script |
| NFR-01 | No new npm dependencies |
| NFR-02 | All 91 existing unit tests still pass; new ollama unit tests added |

## Acceptance Criteria

- [ ] `src/lib/ollama.js` — thin client: `chat(prompt, model?)`, `isAvailable()`,
      `detectModel()`. Uses `fetch()` against the Ollama REST API (`/api/generate`
      or `/api/chat`). No new npm dependencies.
- [ ] `isAvailable()` probes `GET /api/tags` with a 2-second timeout. Returns
      `false` on any error. Never throws.
- [ ] Config: `VITAL_OLLAMA_URL` env var (default `http://localhost:11434`);
      `VITAL_OLLAMA_MODEL` (default `llama3` or first available model).
- [ ] At least one consumer wired: `src/lib/ai-findings.js` calls
      `ollama.chat(summaryPrompt)` when available, prepends result to
      `ai_summary` field in the output JSON.
- [ ] Unit tests cover: `isAvailable()` when server is up and when it times out,
      `chat()` happy path and error path (mock `fetch`).
- [ ] `scripts/check-ollama.js` — diagnostic: prints available models and a
      test generation. Usage: `node scripts/check-ollama.js`.
- [ ] All 91 existing unit tests still pass.

## Out of Scope

- No streaming responses (keep simple request/response).
- No Ollama model management (pull, delete).
- No change to the scan workflow schedule — Ollama calls happen at report-build
  time (`aggregate.js`), not scan time, to keep scan jobs fast.

## Implementation Notes

- Ollama REST API: `POST /api/generate` body `{ model, prompt, stream: false }`.
- Response shape: `{ response: "...", done: true, ... }`.
- The `src/lib/ollama.js` module should be pure ESM, no top-level `await`.
- Probe `VITAL_OLLAMA_URL` from env; fall back to `http://localhost:11434`.

## References

- Ollama local instance: `http://192.168.50.171:11434`
- Existing AI findings: `src/lib/ai-findings.js`
- Scan wiring pattern: `src/scan.js` + `src/aggregate.js`
