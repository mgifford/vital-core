import * as fs from 'node:fs';
import path from 'node:path';

const PRIMARY_SOURCE_BASE = 'https://data.scangov.org';
const FALLBACK_SOURCE_BASE = 'https://github.com/ScanGov/data/raw/refs/heads/main';
const CACHE_ROOT = path.resolve(process.cwd(), 'tools/submodules/standards/.cache/scangov');

function normalizeRelativePath(url: string): string {
  const parsed = new URL(url);

  if (parsed.origin === 'https://github.com' && parsed.pathname.startsWith('/ScanGov/data/raw/refs/heads/main')) {
    return parsed.pathname.slice('/ScanGov/data/raw/refs/heads/main'.length);
  }

  return parsed.pathname;
}

function getCachePath(url: string): string {
  return path.join(CACHE_ROOT, normalizeRelativePath(url).slice(1));
}

function getCandidateUrls(url: string): string[] {
  const relativePath = normalizeRelativePath(url);

  return [
    `${PRIMARY_SOURCE_BASE}${relativePath}`,
    `${FALLBACK_SOURCE_BASE}${relativePath}`,
  ];
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Response status: ${response.status}`);
  }

  return response.json();
}

async function fetchWithFallback(url: string): Promise<unknown> {
  let lastError: unknown = null;

  for (const candidateUrl of getCandidateUrls(url)) {
    try {
      const json = await fetchJson(candidateUrl);
      console.log(`got ${candidateUrl}`);
      return json;
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'unknown error';
  throw new Error(`Fetch error: ${message}`);
}

export async function getData(url: string, local = false): Promise<unknown> {
  const cachePath = getCachePath(url);

  if (fs.existsSync(cachePath)) {
    return readJsonFile(cachePath);
  }

  const relativePath = normalizeRelativePath(url).slice(1);
  const localDataPath = path.resolve(process.cwd(), 'tools/submodules/standards/data', relativePath);

  if (local && fs.existsSync(localDataPath)) {
    return readJsonFile(localDataPath);
  }

  const json = await fetchWithFallback(url);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(json, null, 2));

  return json;
}