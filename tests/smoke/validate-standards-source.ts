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

  assert(fs.existsSync(standardsRoot), 'ScanGov standards submodule directory is missing: tools/submodules/standards');
  assert(fs.existsSync(path.join(standardsRoot, '.git')), 'ScanGov standards submodule is not initialized (.git missing). Run npm run submodules:init.');

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

  const auditsSource = fs.readFileSync(path.join(standardsRoot, '_data/audits.js'), 'utf8');
  const guidanceSource = fs.readFileSync(path.join(standardsRoot, '_data/guidance.js'), 'utf8');
  const readmeSource = fs.readFileSync(path.join(standardsRoot, 'README.md'), 'utf8');

  assert(
    auditsSource.includes('https://data.scangov.org/standards/audits.json'),
    'audits.js no longer points to canonical ScanGov audits.json source.'
  );
  assert(
    guidanceSource.includes('https://data.scangov.org/standards/guidance.json'),
    'guidance.js no longer points to canonical ScanGov guidance.json source.'
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
