# Research: Ollama Local-LLM Integration

## Key Decisions

### 1. `fetch()` only — no new npm dependencies
The Ollama REST API is simple JSON over HTTP. Node 18+ has built-in `fetch`.
No `axios`, `node-fetch`, or Ollama SDK needed.

### 2. Aggregate time, not scan time
Ollama calls happen in `src/aggregate.js` (report build), not `src/scan.js`.
Scan jobs run on GitHub Actions where Ollama is unavailable. Aggregate runs
locally where it is. This is already the pattern for `buildAiFindings()`.

### 3. `isAvailable()` with hard 2-second timeout
Use `AbortController` + `AbortSignal.timeout(2000)` to probe `GET /api/tags`.
Any error (network, timeout, non-200) returns `false` — never throws.
Called once per aggregate run, not per domain.

### 4. Output field: `ollama_summary` alongside existing `ai_summary`
Rather than replacing `ai_summary` (which is algorithmic), add a separate
`ollama_summary` string field. This keeps the existing output stable and
makes it easy to tell which text came from the LLM vs. the rule-based system.

### 5. Prompt design: compact, structured input
Send the top-5 bugs by severity+pages as a compact JSON block. Ask for
2 plain-English sentences max. Keep the prompt under ~500 tokens so it
works with small models (llama3.2, mistral, etc.).

## Ollama API Reference

```
GET  /api/tags            → { models: [{ name, size, ... }] }
POST /api/generate        → { response: "...", done: true }
  body: { model: string, prompt: string, stream: false }
```

Local instance: `http://192.168.50.171:11434`
Default env var: `VITAL_OLLAMA_URL` (falls back to `http://localhost:11434`)
Default model env var: `VITAL_OLLAMA_MODEL` (falls back to first available, then `'llama3'`)

## Risks / Open Questions

- **Model availability**: different Ollama installs have different models pulled.
  `detectModel()` reads `/api/tags` and picks the first; user can override via env.
- **Output quality**: small models may produce poor summaries. The field is
  purely informational — no logic depends on it.
- **Rate/latency**: one call per domain per aggregate run. At ~11 domains, ~3s
  per call worst case = ~33s added to aggregate. Acceptable.
