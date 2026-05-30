import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { RemediationAdvisor } from '../../src/engine/reporters/remediation-advisor';

const ORIGINAL_PURPLE_DIR = process.env.VITAL_PURPLE_AI_DIR;

const createFixtureCatalog = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-purple-'));
  fs.mkdirSync(path.join(root, 'results'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'catalog.json'),
    JSON.stringify(
      {
        lastUpdated: '2026-05-29T00:00:00.000Z',
        label: ['input_id_name', 'select_name_id']
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(root, 'results', 'label.json'),
    JSON.stringify(
      {
        input_id_name: 'Associate the form control with a visible text label.'
      },
      null,
      2
    )
  );
  return root;
};

afterEach(() => {
  if (ORIGINAL_PURPLE_DIR === undefined) {
    delete process.env.VITAL_PURPLE_AI_DIR;
  } else {
    process.env.VITAL_PURPLE_AI_DIR = ORIGINAL_PURPLE_DIR;
  }
});

describe('RemediationAdvisor', () => {
  it('returns null when no Purple-AI catalog is configured', () => {
    process.env.VITAL_PURPLE_AI_DIR = path.join(os.tmpdir(), 'vital-purple-missing');
    const advisor = new RemediationAdvisor();
    const result = advisor.getSupplemental('label', '<input id="email" name="email">');
    expect(result).toBeNull();
  });

  it('returns exact-match supplemental advice with HIGH confidence', () => {
    const fixtureDir = createFixtureCatalog();
    process.env.VITAL_PURPLE_AI_DIR = fixtureDir;

    const advisor = new RemediationAdvisor();
    const result = advisor.getSupplemental('label', '<input id="email" name="email">');

    expect(result).not.toBeNull();
    expect(result?.source).toBe('curated-purple-ai');
    expect(result?.confidence).toBe('HIGH');
    expect(result?.advice).toContain('visible text label');
    expect(result?.matchedLabel).toBe('input_id_name');
  });
});