import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Workflow contracts', () => {
  it('keeps docs workflow as validation-only (no Pages deployment)', () => {
    const workflowPath = path.resolve(process.cwd(), '.github/workflows/deploy-pages.yml');
    const content = fs.readFileSync(workflowPath, 'utf8');

    expect(content).toContain('name: Validate Docs Bundle');
    expect(content).toContain('workflow_dispatch:');
    expect(content).not.toContain('actions/deploy-pages@');
    expect(content).not.toContain('actions/upload-pages-artifact@');
    expect(content).not.toContain('pages: write');
  });

  it('requires generated dist artifacts before scan deployment', () => {
    const workflowPath = path.resolve(process.cwd(), '.github/workflows/vital-scan.yml');
    const content = fs.readFileSync(workflowPath, 'utf8');

    expect(content).toContain('Verify required generated dashboard artifacts exist');
    expect(content).toContain('dist/index.html');
    expect(content).toContain('dist/runs/latest.json');
    expect(content).toContain('dist/runs/index.json');
    expect(content).toContain('dist/runs/trends.json');
    expect(content).toContain('dist/runs/page-state.json');
  });

  it('enforces bounded scan runtime and adaptive batch controls', () => {
    const workflowPath = path.resolve(process.cwd(), '.github/workflows/vital-scan.yml');
    const content = fs.readFileSync(workflowPath, 'utf8');

    expect(content).toContain('VITAL_MAX_RUN_MINUTES: ${{');
    expect(content).toContain("steps.offhours.outputs.scan_intensity == 'deep' && '12'");
    expect(content).toContain("steps.offhours.outputs.scan_intensity == 'standard' && '6'");
    expect(content).toContain("steps.offhours.outputs.scan_intensity == 'light' && '3'");
    expect(content).toContain("VITAL_DYNAMIC_BATCH_ENABLE: 'true'");
    expect(content).toContain("VITAL_BATCH_SIZE_BASE: '2'");
    expect(content).toContain('VITAL_BATCH_SIZE_MAX: ${{');
  });

  it('runs link and axe quality gates for docs', () => {
    const workflowPath = path.resolve(process.cwd(), '.github/workflows/pages-quality-gate.yml');
    const content = fs.readFileSync(workflowPath, 'utf8');

    expect(content).toContain('concurrency:');
    expect(content).toContain('cancel-in-progress: true');
    expect(content).toContain('timeout-minutes: 15');
    expect(content).toContain('lycheeverse/lychee-action@v2');
    expect(content).toContain('--accept 200,403,429');
    expect(content).toContain('Run docs CI guardrail tests');
    expect(content).toContain('tests/unit/docs-accessibility-guardrails.test.ts');
    expect(content).toContain('Install Playwright Chromium');
    expect(content).toContain('Run axe smoke checks against docs');
    expect(content).toContain('node scripts/run-axe-site-check.mjs');
  });

  it('tracks failed workflow runs with issues', () => {
    const workflowPath = path.resolve(process.cwd(), '.github/workflows/monitor-actions-failures.yml');
    const content = fs.readFileSync(workflowPath, 'utf8');

    expect(content).toContain('on:');
    expect(content).toContain('workflow_run:');
    expect(content).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(content).toContain('issues: write');
    expect(content).toContain('actions/github-script@v7');
    expect(content).toContain("labels: ['automated', 'ci-failure']");
    expect(content).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(content).toContain('Close matching failure tracking issue');
    expect(content).toContain("state_reason: 'completed'");
  });
});
