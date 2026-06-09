import * as fs from 'node:fs';
import * as path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  console.log('⏳ Running standards source validation...');

  const repoRoot = process.cwd();
  const standardsRoot = path.resolve(repoRoot, 'tools/submodules/standards');
  const loaderPath = path.resolve(repoRoot, 'src/standards/getdata.ts');

  assert(fs.existsSync(standardsRoot), 'ScanGov standards submodule directory is missing: tools/submodules/standards');
  assert(fs.existsSync(path.join(standardsRoot, '.git')), 'ScanGov standards submodule is not initialized (.git missing). Run npm run submodules:init.');
  assert(fs.existsSync(loaderPath), 'Root standards loader is missing: src/standards/getdata.ts');

  const requiredFiles = [
    'README.md',
    'LICENSE',
    '_data/audits.js',
    '_data/guidance.js',
    'content/guidance.njk',
    'content/docs/standard.njk'
  ];

  for (const relFile of requiredFiles) {
    const fullPath = path.join(standardsRoot, relFile);
    assert(fs.existsSync(fullPath), `Required standards artifact missing: tools/submodules/standards/${relFile}`);
  }

  const loaderSource = fs.readFileSync(loaderPath, 'utf8');
  const readmeSource = fs.readFileSync(path.join(standardsRoot, 'README.md'), 'utf8');

  assert(
    loaderSource.includes('https://data.scangov.org') && loaderSource.includes('https://github.com/ScanGov/data/raw/refs/heads/main'),
    'Root standards loader no longer points to canonical ScanGov source bases.'
  );
  assert(
    readmeSource.toLowerCase().includes('scangov standards'),
    'Submodule README does not appear to be the expected ScanGov Standards repository.'
  );

  console.log('✅ Standards source validation passed.');
} catch (err: any) {
  console.error('❌ Standards source validation failed:', err.message);
  process.exit(1);
}
