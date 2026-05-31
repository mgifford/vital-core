import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Docs accessibility guardrails', () => {
  it('keeps inline links distinguishable without relying on color only', () => {
    const docsPath = path.resolve(process.cwd(), 'docs/index.html');
    const content = fs.readFileSync(docsPath, 'utf8');

    expect(content).toContain('a {');
    expect(content).toContain('text-decoration: underline;');
    expect(content).toContain('a:hover,');
    expect(content).toContain('a:focus-visible');
    expect(content).toContain('text-decoration-thickness: 2px;');
  });
});
