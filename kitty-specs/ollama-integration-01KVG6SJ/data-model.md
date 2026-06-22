# Data Model: Ollama Local-LLM Integration

## New module: `src/lib/ollama.js`

### Exports

```js
isAvailable() → Promise<boolean>
detectModel() → Promise<string>          // first available model name
chat(prompt, model?) → Promise<string|null>  // null on any error
```

### Config (read from `process.env`)

| Variable | Default | Purpose |
|---|---|---|
| `VITAL_OLLAMA_URL` | `http://localhost:11434` | Ollama base URL |
| `VITAL_OLLAMA_MODEL` | first from `/api/tags`, else `'llama3'` | Model to use |

## Change to `ai-findings.js` output shape

The JSON document written to `<domain>_<date>_ai-findings.json` gains one
optional top-level field:

```jsonc
{
  "schema_version": 4,
  "site": "www.cms.gov",
  // ... existing fields unchanged ...
  "ollama_summary": "Two plain-English sentences about the top issues."
  // present only when Ollama was reachable; absent otherwise
}
```

No existing fields are modified. Consumers that don't know about
`ollama_summary` are unaffected.

## No database / storage changes

Ollama results are generated fresh each aggregate run and written into the
same JSON file as the rest of ai-findings. Nothing is cached between runs.
