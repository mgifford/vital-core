import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { searchForSignals } from '../../../mcp/local/search.js';

function makeFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vital-search-test-'));
}

function write(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('searchForSignals: a signal in exactly one file is found with the correct relative path', () => {
  const root = makeFixtureRoot();
  try {
    write(root, 'src/hero.html', '<div class="hero-banner-distinctive">Hi</div>');
    write(root, 'src/other.html', '<div class="unrelated">Nope</div>');
    const results = searchForSignals(root, [{ type: 'css_class', value: 'hero-banner-distinctive' }]);
    assert.equal(results.length, 1);
    assert.equal(results[0].path, path.join('src', 'hero.html'));
    assert.deepEqual(results[0].matched_signals, [{ type: 'css_class', value: 'hero-banner-distinctive' }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('searchForSignals: 3+ distinct matched signal types yields high confidence', () => {
  const root = makeFixtureRoot();
  try {
    // Signal values are matched as literal substrings of file content, so
    // the fixture must contain each value verbatim (the data_attr value
    // shape, `key=value` with no quotes, is what extractSignals() produces
    // from a finding's evidence — see mcp/local/signals.js).
    write(root, 'src/hero.html', '<div class="hero-banner" id="main-hero">Hi</div><!-- data-track=hero1 -->');
    const signals = [
      { type: 'css_class', value: 'hero-banner' },
      { type: 'css_id', value: 'main-hero' },
      { type: 'data_attr', value: 'data-track=hero1' },
    ];
    const results = searchForSignals(root, signals);
    assert.equal(results.length, 1);
    assert.equal(results[0].confidence, 'high');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('searchForSignals: exactly 2 distinct matched signal types yields medium confidence', () => {
  const root = makeFixtureRoot();
  try {
    write(root, 'src/hero.html', '<div class="hero-banner" id="main-hero">Hi</div>');
    const signals = [
      { type: 'css_class', value: 'hero-banner' },
      { type: 'css_id', value: 'main-hero' },
    ];
    const results = searchForSignals(root, signals);
    assert.equal(results.length, 1);
    assert.equal(results[0].confidence, 'medium');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('searchForSignals: a common, single-type signal is conservatively low confidence, never high or medium', () => {
  const root = makeFixtureRoot();
  try {
    for (let i = 0; i < 10; i++) {
      write(root, `src/file${i}.html`, '<div class="btn">Click</div>');
    }
    const results = searchForSignals(root, [{ type: 'css_class', value: 'btn' }]);
    assert.equal(results.length, 10);
    for (const r of results) {
      assert.equal(r.confidence, 'low');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('searchForSignals: results are capped at resultCap and the survivors are the highest-confidence ones', () => {
  const root = makeFixtureRoot();
  try {
    // 5 high-confidence files (all 3 signal types match) + 20 low-confidence
    // files (only the "hi" class matches) — 25 total matches, capped to 10.
    for (let i = 0; i < 5; i++) {
      write(root, `src/high${i}.html`, '<div class="hi" id="hid">Hi</div><!-- data-track=d -->');
    }
    for (let i = 0; i < 20; i++) {
      write(root, `src/low${i}.html`, '<div class="hi">Hi</div>');
    }
    const signals = [
      { type: 'css_class', value: 'hi' },
      { type: 'css_id', value: 'hid' },
      { type: 'data_attr', value: 'data-track=d' },
    ];
    const results = searchForSignals(root, signals, { resultCap: 10 });
    assert.equal(results.length, 10);
    // All 5 high-confidence files must survive the cap, ranked before any low.
    const highResults = results.filter((r) => r.confidence === 'high');
    assert.equal(highResults.length, 5);
    for (let i = 0; i < 5; i++) {
      assert.equal(results[i].confidence, 'high');
    }
    for (let i = 5; i < 10; i++) {
      assert.equal(results[i].confidence, 'low');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('searchForSignals: a file larger than maxFileSizeBytes is skipped even if it matches', () => {
  const root = makeFixtureRoot();
  try {
    const bigContent = `<div class="big-match">${'x'.repeat(2000)}</div>`;
    write(root, 'src/big.html', bigContent);
    const results = searchForSignals(root, [{ type: 'css_class', value: 'big-match' }], {
      maxFileSizeBytes: 100,
    });
    assert.equal(results.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('searchForSignals: maxFiles bounds the number of files examined, stopping the walk early', () => {
  const root = makeFixtureRoot();
  try {
    for (let i = 0; i < 10; i++) {
      write(root, `src/file${i}.html`, '<div class="match-me">Hi</div>');
    }
    const results = searchForSignals(root, [{ type: 'css_class', value: 'match-me' }], { maxFiles: 3 });
    assert.ok(results.length <= 3, `expected at most 3 matches when maxFiles=3, got ${results.length}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('searchForSignals: a match inside node_modules/ is never returned, even though content matches', () => {
  const root = makeFixtureRoot();
  try {
    write(root, 'node_modules/some-pkg/index.js', 'class="hidden-match"');
    write(root, 'src/visible.html', '<div class="hidden-match">Hi</div>');
    const results = searchForSignals(root, [{ type: 'css_class', value: 'hidden-match' }]);
    assert.equal(results.length, 1);
    assert.equal(results[0].path, path.join('src', 'visible.html'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('searchForSignals: a custom ignorePatterns entry excludes its directory', () => {
  const root = makeFixtureRoot();
  try {
    write(root, 'fixtures/generated.html', '<div class="custom-ignored">Hi</div>');
    write(root, 'src/real.html', '<div class="custom-ignored">Hi</div>');
    const results = searchForSignals(root, [{ type: 'css_class', value: 'custom-ignored' }], {
      ignorePatterns: ['fixtures'],
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].path, path.join('src', 'real.html'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('searchForSignals: an adversarial regex-metacharacter signal value matches only as a literal substring', () => {
  const root = makeFixtureRoot();
  try {
    // Literal value containing regex metacharacters — must match verbatim.
    write(root, 'src/literal.html', '<div class="a.*b">exact literal match</div>');
    // Would match `a.*b` if misinterpreted as a regex (any chars between a and b),
    // but does not contain the literal string "a.*b" — must NOT match.
    write(root, 'src/false-positive.html', '<div class="aXXXb">not a literal match</div>');
    const results = searchForSignals(root, [{ type: 'css_class', value: 'a.*b' }]);
    assert.equal(results.length, 1);
    assert.equal(results[0].path, path.join('src', 'literal.html'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('searchForSignals: an empty signal list returns [] immediately without walking the filesystem', () => {
  const root = makeFixtureRoot();
  try {
    write(root, 'src/whatever.html', '<div>content</div>');
    let readdirCalled = false;
    const originalReaddirSync = fs.readdirSync;
    fs.readdirSync = (...args) => {
      readdirCalled = true;
      return originalReaddirSync(...args);
    };
    try {
      const results = searchForSignals(root, []);
      assert.deepEqual(results, []);
      assert.equal(readdirCalled, false);
    } finally {
      fs.readdirSync = originalReaddirSync;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
