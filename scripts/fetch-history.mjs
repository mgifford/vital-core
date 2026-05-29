import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'vital-core-history-fetcher'
    }
  });

  if (!response.ok) {
    return null;
  }

  return response.text();
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

    const outputPath = path.resolve(process.cwd(), historyCacheDir, artifactPath);
    const outputDir = path.dirname(outputPath);
    await mkdir(outputDir, { recursive: true });
    await writeFile(outputPath, artifactText, 'utf8');
  }

  console.log(`Restored historical run index and ${runs.length} referenced run entries.`);
}

main().catch((error) => {
  console.error('History fetch failed:', error);
  process.exit(1);
});
