// Talks to any OpenAI-compatible chat-completions server (llama.cpp's
// llama-server, Ollama's /v1/ endpoint, LM Studio, etc.) — the repo's
// default local LLM is llama.cpp on a separate machine with more RAM
// (see .env.example), so this targets the OpenAI-compatible surface every
// one of those servers implements, rather than Ollama's native API.
const BASE_URL = process.env.VITAL_OLLAMA_URL ?? 'http://localhost:11434';
const DEFAULT_MODEL = process.env.VITAL_OLLAMA_MODEL ?? null;

async function openaiFetch(path, init = {}) {
  const signal = init.signal ?? AbortSignal.timeout(2000);
  const res = await fetch(`${BASE_URL}${path}`, { ...init, signal });
  if (!res.ok) throw new Error(`LLM server ${res.status}`);
  return res.json();
}

export async function isAvailable() {
  try {
    await openaiFetch('/v1/models');
    return true;
  } catch {
    return false;
  }
}

export async function detectModel() {
  if (DEFAULT_MODEL) return DEFAULT_MODEL;
  try {
    const data = await openaiFetch('/v1/models');
    return data.data?.[0]?.id ?? 'local-model';
  } catch {
    return 'local-model';
  }
}

export async function chat(prompt, model) {
  try {
    const m = model ?? await detectModel();
    const data = await openaiFetch('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: m, messages: [{ role: 'user', content: prompt }], stream: false }),
      signal: AbortSignal.timeout(30000),
    });
    const content = data.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content.trim() : null;
  } catch {
    return null;
  }
}
