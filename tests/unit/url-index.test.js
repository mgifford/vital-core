import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildUrlIndex, writeUrlIndex, URL_INDEX_SCHEMA_VERSION } from '../../src/lib/url-index.js';

const WEEK = '2026-W24';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vital-url-index-'));
}

function writePageRecord(pagesDir, id, record) {
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(path.join(pagesDir, `${id}.json`), JSON.stringify(record));
}

describe('buildUrlIndex', () => {
  test('returns null when pages dir does not exist', () => {
    const tmp = makeTmpDir();
    const result = buildUrlIndex(tmp, 'example.gov', WEEK);
    assert.equal(result, null);
  });

  test('returns schema_version, domain, and week', () => {
    const tmp = makeTmpDir();
    const pagesDir = path.join(tmp, WEEK, 'pages');
    writePageRecord(pagesDir, 'page1', {
      pageId: 'page1',
      url: 'https://example.gov/about',
      status: 200,
      scannedAt: '2026-06-14T03:00:00Z',
    });
    const idx = buildUrlIndex(tmp, 'example.gov', WEEK);
    assert.equal(idx.schema_version, URL_INDEX_SCHEMA_VERSION);
    assert.equal(idx.domain, 'example.gov');
    assert.equal(idx.week, WEEK);
    assert.ok(idx.generated_at);
  });

  test('extracts axe violations', () => {
    const tmp = makeTmpDir();
    const pagesDir = path.join(tmp, WEEK, 'pages');
    writePageRecord(pagesDir, 'p1', {
      pageId: 'p1',
      url: 'https://example.gov/page',
      status: 200,
      scannedAt: '2026-06-14T03:00:00Z',
      axe: {
        engine: 'axe-core',
        version: '4.12.1',
        violationCount: 1,
        violations: {
          'color-contrast': {
            count: 3,
            impact: 'serious',
            help: 'Elements must have sufficient color contrast',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/color-contrast',
            tags: ['wcag2aa', 'wcag143'],
            examples: [{ target: '.btn', html: '<button class="btn">Submit</button>' }],
          },
        },
        incompleteCount: 0,
      },
    });
    const idx = buildUrlIndex(tmp, 'example.gov', WEEK);
    assert.equal(idx.pages.length, 1);
    const page = idx.pages[0];
    assert.equal(page.url, 'https://example.gov/page');
    assert.equal(page.status, 200);
    assert.equal(page.violations.length, 1);
    const v = page.violations[0];
    assert.equal(v.engine, 'axe-core');
    assert.equal(v.rule_id, 'color-contrast');
    assert.equal(v.severity, 'Serious');
    assert.equal(v.count, 3);
    assert.equal(v.help, 'Elements must have sufficient color contrast');
    assert.deepEqual(v.wcag, ['1.4.3']);
    assert.equal(v.examples.length, 1);
    assert.equal(v.examples[0].html, '<button class="btn">Submit</button>');
  });

  test('extracts alfa failures without severity', () => {
    const tmp = makeTmpDir();
    const pagesDir = path.join(tmp, WEEK, 'pages');
    writePageRecord(pagesDir, 'p1', {
      pageId: 'p1',
      url: 'https://example.gov/page',
      status: 200,
      alfa: {
        engine: 'alfa',
        failedCount: 2,
        failed: {
          'sia-r11': {
            count: 2,
            ruleUrl: 'https://alfa.siteimprove.com/rules/sia-r11',
            examples: [{ target: 'img' }],
          },
        },
      },
    });
    const idx = buildUrlIndex(tmp, 'example.gov', WEEK);
    const v = idx.pages[0].violations[0];
    assert.equal(v.engine, 'alfa');
    assert.equal(v.rule_id, 'sia-r11');
    assert.equal(v.severity, null);
    assert.equal(v.count, 2);
    assert.equal(v.help_url, 'https://alfa.siteimprove.com/rules/sia-r11');
  });

  test('extracts deprecated-html findings', () => {
    const tmp = makeTmpDir();
    const pagesDir = path.join(tmp, WEEK, 'pages');
    writePageRecord(pagesDir, 'p1', {
      pageId: 'p1',
      url: 'https://example.gov/page',
      status: 200,
      deprecatedHtml: {
        engine: 'deprecated-html',
        findingCount: 1,
        findings: {
          'font-element': {
            count: 1,
            help: 'Obsolete <font> element (use CSS)',
            examples: [{ target: 'font', html: '<font color="red">text</font>' }],
          },
        },
      },
    });
    const idx = buildUrlIndex(tmp, 'example.gov', WEEK);
    const v = idx.pages[0].violations[0];
    assert.equal(v.engine, 'deprecated-html');
    assert.equal(v.rule_id, 'font-element');
    assert.equal(v.severity, 'Moderate');
    assert.equal(v.count, 1);
  });

  test('pages with no violations have empty violations array', () => {
    const tmp = makeTmpDir();
    const pagesDir = path.join(tmp, WEEK, 'pages');
    writePageRecord(pagesDir, 'p1', {
      pageId: 'p1',
      url: 'https://example.gov/clean',
      status: 200,
    });
    const idx = buildUrlIndex(tmp, 'example.gov', WEEK);
    assert.equal(idx.pages[0].violations.length, 0);
  });

  test('caps examples at 3 per violation', () => {
    const tmp = makeTmpDir();
    const pagesDir = path.join(tmp, WEEK, 'pages');
    writePageRecord(pagesDir, 'p1', {
      pageId: 'p1',
      url: 'https://example.gov/page',
      status: 200,
      axe: {
        violationCount: 1,
        violations: {
          'label': {
            count: 5,
            impact: 'critical',
            help: 'Form inputs must have labels',
            helpUrl: null,
            tags: [],
            examples: [
              { target: '#a', html: '<input id="a">' },
              { target: '#b', html: '<input id="b">' },
              { target: '#c', html: '<input id="c">' },
              { target: '#d', html: '<input id="d">' },
              { target: '#e', html: '<input id="e">' },
            ],
          },
        },
      },
    });
    const idx = buildUrlIndex(tmp, 'example.gov', WEEK);
    assert.equal(idx.pages[0].violations[0].examples.length, 3);
  });
});

describe('writeUrlIndex', () => {
  test('writes url-index.json to the correct path', () => {
    const tmp = makeTmpDir();
    const index = {
      schema_version: URL_INDEX_SCHEMA_VERSION,
      domain: 'example.gov',
      week: WEEK,
      generated_at: new Date().toISOString(),
      pages: [],
    };
    writeUrlIndex(tmp, 'example.gov', index);
    const written = JSON.parse(fs.readFileSync(path.join(tmp, 'example.gov', 'url-index.json'), 'utf8'));
    assert.equal(written.domain, 'example.gov');
    assert.equal(written.week, WEEK);
  });

  test('creates the domain directory if it does not exist', () => {
    const tmp = makeTmpDir();
    const index = { schema_version: '1', domain: 'new.gov', week: WEEK, generated_at: '', pages: [] };
    writeUrlIndex(tmp, 'new.gov', index);
    assert.ok(fs.existsSync(path.join(tmp, 'new.gov', 'url-index.json')));
  });
});

describe('WCAG ref extraction', () => {
  test('parses 3-digit wcag tags correctly via buildUrlIndex', () => {
    const tmp = makeTmpDir();
    const pagesDir = path.join(tmp, WEEK, 'pages');
    writePageRecord(pagesDir, 'p1', {
      pageId: 'p1',
      url: 'https://example.gov/page',
      status: 200,
      axe: {
        violationCount: 1,
        violations: {
          'rule': {
            count: 1,
            impact: 'moderate',
            help: 'test',
            helpUrl: null,
            tags: ['wcag2a', 'wcag111', 'wcag412'],
          },
        },
      },
    });
    const idx = buildUrlIndex(tmp, 'example.gov', WEEK);
    assert.deepEqual(idx.pages[0].violations[0].wcag, ['1.1.1', '4.1.2']);
  });
});
