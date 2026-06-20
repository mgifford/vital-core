const BASE_URL = process.env.VITAL_OLLAMA_URL ?? 'http://localhost:11434';
const DEFAULT_MODEL = process.env.VITAL_OLLAMA_MODEL ?? null;

async function ollamaFetch(path, init = {}) {
  const signal = init.signal ?? AbortSignal.timeout(2000);
  const res = await fetch(`${BASE_URL}${path}`, { ...init, signal });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  return res.json();
}

export async function isAvailable() {
  try {
    await ollamaFetch('/api/tags');
    return true;
  } catch {
    return false;
  }
}

export async function detectModel() {
  if (DEFAULT_MODEL) return DEFAULT_MODEL;
  try {
    const data = await ollamaFetch('/api/tags');
    return data.models?.[0]?.name ?? 'llama3';
  } catch {
    return 'llama3';
  }
}

export async function chat(prompt, model) {
  try {
    const m = model ?? await detectModel();
    const data = await ollamaFetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: m, prompt, stream: false }),
      signal: AbortSignal.timeout(30000),
    });
    return typeof data.response === 'string' ? data.response.trim() : null;
  } catch {
    return null;
  }
}
