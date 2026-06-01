import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.VITAL_HISTORY_FETCH_TIMEOUT_MS || '20000', 10);

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(REQUEST_TIMEOUT_MS) && REQUEST_TIMEOUT_MS > 0 ? REQUEST_TIMEOUT_MS : 20000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'vital-core-history-fetcher'
    }
  });

  if (!response.ok) {
    return null;
  }

  return response.text();
}

async function writeCachedFile(historyCacheDir, relativePath, body) {
  const outputPath = path.resolve(process.cwd(), historyCacheDir, relativePath);
  const outputDir = path.dirname(outputPath);
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, body, 'utf8');
}

async function writeCachedBinaryFile(historyCacheDir, relativePath, buffer) {
  const outputPath = path.resolve(process.cwd(), historyCacheDir, relativePath);
  const outputDir = path.dirname(outputPath);
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, buffer);
}

async function main() {
  const baseUrl = process.env.VITAL_PAGES_BASE_URL;
  const historyCacheDir = process.env.VITAL_HISTORY_CACHE_DIR || '.history-cache';

  if (!baseUrl) {
    console.log('Skipping history fetch: VITAL_PAGES_BASE_URL is not set.');
    return;
  }

  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const runsCacheDir = path.resolve(process.cwd(), historyCacheDir, 'runs');
  await mkdir(runsCacheDir, { recursive: true });

  async function fetchOptionalRunArtifact(relativePath) {
    try {
        const response = await fetchWithTimeout(`${trimmedBase}/runs/${relativePath}`, {
        headers: { 'User-Agent': 'vital-core-history-fetch/1.0' }
      });

      if (!response.ok) {
        return;
      }

      await writeCachedFile(historyCacheDir, `runs/${relativePath}`, await response.text());
      console.log(`✅ Restored optional history artifact: runs/${relativePath}`);
    } catch {
      // Optional artifacts should not fail the scan pipeline.
    }
  }

  const indexUrl = `${trimmedBase}/runs/index.json`;
  const indexText = await fetchText(indexUrl);

  if (!indexText) {
    console.log(`No existing run index found at ${indexUrl}.`);
    return;
  }

  const indexPath = path.join(runsCacheDir, 'index.json');
  await writeFile(indexPath, indexText, 'utf8');

  let parsed;
  try {
    parsed = JSON.parse(indexText);
  } catch {
    console.log('Existing run index is invalid JSON, skipping historical run downloads.');
    return;
  }

  const runs = Array.isArray(parsed?.runs) ? parsed.runs.slice(0, 200) : [];

  for (const run of runs) {
    const artifactPath = typeof run?.artifactPath === 'string' ? run.artifactPath : '';
    if (!artifactPath.startsWith('runs/') || !artifactPath.endsWith('.json')) {
      continue;
    }

    const artifactText = await fetchText(`${trimmedBase}/${artifactPath}`);
    if (!artifactText) {
      continue;
    }

    await writeCachedFile(historyCacheDir, artifactPath, artifactText);
  }

  await fetchOptionalRunArtifact('page-state.json');
  await fetchOptionalRunArtifact('top-task-seeds.json');
  await fetchOptionalRunArtifact('software-by-domain.json');

  // Fetch the SQLite database so SqlitePersister.restoreCachedDb() can seed
  // dist/vital.db before the next scan run appends new data to it.
  try {
    const dbUrl = `${trimmedBase}/vital.db`;
    const dbResponse = await fetchWithTimeout(dbUrl, {
      headers: { 'User-Agent': 'vital-core-history-fetch/1.0' }
    });
    if (dbResponse.ok) {
      const dbBuffer = Buffer.from(await dbResponse.arrayBuffer());
      await writeCachedBinaryFile(historyCacheDir, 'vital.db', dbBuffer);
      console.log('✅ Restored historical vital.db from cache.');
    }
  } catch {
    // vital.db is optional — do not fail the pipeline if it is unavailable.
  }

  // Fetch per-target url-manifest.json for each target defined in the profile,
  // so UrlManifestStore.restoreCachedManifest() can seed dist/runs/{targetId}/
  // before discoverUrls runs on the next scan.
  const profilePath = process.argv[2] || 'profiles/us-health.yml';
  let targetIds = [];
  try {
    const { parse: parseYaml } = await import('yaml');
    const { readFileSync, existsSync } = await import('node:fs');
    const profileAbsPath = path.resolve(process.cwd(), profilePath);
    if (existsSync(profileAbsPath)) {
      const profileData = parseYaml(readFileSync(profileAbsPath, 'utf8'));
      targetIds = Array.isArray(profileData?.targets)
        ? profileData.targets.map(t => t?.id).filter(id => typeof id === 'string')
        : [];
    }
  } catch {
    // Profile parsing is best-effort; skip manifest fetches if it fails.
  }

  for (const targetId of targetIds) {
    await fetchOptionalRunArtifact(`${targetId}/url-manifest.json`);
  }

  console.log(`Restored historical run index and ${runs.length} referenced run entries.`);
}

main().catch((error) => {
  console.error('History fetch failed:', error);
  process.exit(1);
});
