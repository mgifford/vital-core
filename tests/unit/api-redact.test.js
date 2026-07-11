import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { redactUrl, redactBugUrls, redactBugs, deepRedactUrls, REDACTED } from '../../src/lib/api-redact.js';

describe('redactUrl', () => {
  test('strips URL fragments', () => {
    assert.equal(redactUrl('https://a.gov/page#section-2'), 'https://a.gov/page');
    assert.equal(redactUrl('/path/to/page#h-anchor'), '/path/to/page');
  });

  test('leaves fragment-free, query-free URLs untouched', () => {
    assert.equal(redactUrl('https://a.gov/page'), 'https://a.gov/page');
    assert.equal(redactUrl('/normalized/path'), '/normalized/path');
  });

  test('redacts sensitive query values across families', () => {
    for (const name of ['token', 'access_token', 'id_token', 'session', 'sid',
      'auth', 'password', 'pwd', 'email', 'apikey', 'api_key', 'secret',
      'signature', 'sig', 'code', 'jwt', 'bearer', 'nonce', 'state', 'otp', 'key']) {
      const out = redactUrl(`https://a.gov/p?${name}=SECRETVALUE`);
      assert.equal(out, `https://a.gov/p?${name}=${REDACTED}`, `param ${name} should be redacted`);
      assert.ok(!out.includes('SECRETVALUE'), `param ${name} leaked value`);
    }
  });

  test('redacts camelCase and kebab sensitive params', () => {
    assert.equal(redactUrl('https://a.gov/p?csrfToken=abc'), `https://a.gov/p?csrfToken=${REDACTED}`);
    assert.equal(redactUrl('https://a.gov/p?access-token=abc'), `https://a.gov/p?access-token=${REDACTED}`);
  });

  test('preserves harmless query params and their values', () => {
    assert.equal(redactUrl('https://a.gov/p?page=3&sort=name'), 'https://a.gov/p?page=3&sort=name');
  });

  test('redacts only the sensitive param in a mixed query, preserving order', () => {
    assert.equal(
      redactUrl('https://a.gov/p?page=3&token=SECRET&sort=name'),
      `https://a.gov/p?page=3&token=${REDACTED}&sort=name`
    );
  });

  test('does not spuriously match a param whose name merely contains a sensitive substring', () => {
    // "nodecode" is one segment; it must not match the "code" family.
    assert.equal(redactUrl('https://a.gov/p?nodecode=yes'), 'https://a.gov/p?nodecode=yes');
    assert.equal(redactUrl('https://a.gov/p?keyword=hello'), 'https://a.gov/p?keyword=hello');
  });

  test('honors a per-target denylist extension', () => {
    assert.equal(
      redactUrl('https://a.gov/p?ssn=123', { denyParams: ['ssn'] }),
      `https://a.gov/p?ssn=${REDACTED}`
    );
    // Without the denylist the same param is untouched.
    assert.equal(redactUrl('https://a.gov/p?ssn=123'), 'https://a.gov/p?ssn=123');
  });

  test('strips fragment and redacts query together', () => {
    assert.equal(
      redactUrl('https://a.gov/p?token=SECRET#frag'),
      `https://a.gov/p?token=${REDACTED}`
    );
  });

  test('is idempotent', () => {
    const once = redactUrl('https://a.gov/p?token=SECRET&page=1#frag');
    assert.equal(redactUrl(once), once);
  });

  test('leaves bare flag params alone', () => {
    assert.equal(redactUrl('https://a.gov/p?debug&page=1'), 'https://a.gov/p?debug&page=1');
  });

  test('returns non-string input unchanged', () => {
    assert.equal(redactUrl(null), null);
    assert.equal(redactUrl(undefined), undefined);
    assert.equal(redactUrl(''), '');
  });
});

describe('redactBugUrls', () => {
  const bug = {
    pattern_id: 'VS-abc',
    url: 'https://a.gov/home?token=SECRET#x',
    affected_pages: ['https://a.gov/a?sid=XYZ', 'https://a.gov/b#frag'],
    examples: [
      { url: 'https://a.gov/ex?apikey=KKK', html_snippet: '<a>hi</a>' },
      { url: 'https://a.gov/ex2', html_snippet: '<b>ok</b>' },
    ],
    frequency: { pages_affected: 2 },
  };

  test('redacts url, affected_pages, and examples[].url', () => {
    const out = redactBugUrls(bug);
    assert.equal(out.url, `https://a.gov/home?token=${REDACTED}`);
    assert.deepEqual(out.affected_pages, [`https://a.gov/a?sid=${REDACTED}`, 'https://a.gov/b']);
    assert.equal(out.examples[0].url, `https://a.gov/ex?apikey=${REDACTED}`);
    assert.equal(out.examples[1].url, 'https://a.gov/ex2');
  });

  test('preserves non-URL fields and example html_snippet', () => {
    const out = redactBugUrls(bug);
    assert.equal(out.pattern_id, 'VS-abc');
    assert.equal(out.examples[0].html_snippet, '<a>hi</a>');
    assert.equal(out.frequency.pages_affected, 2);
  });

  test('does not mutate the input', () => {
    const before = JSON.stringify(bug);
    redactBugUrls(bug);
    assert.equal(JSON.stringify(bug), before);
  });

  test('handles bugs missing optional URL fields', () => {
    const out = redactBugUrls({ pattern_id: 'VS-x', frequency: {} });
    assert.equal(out.pattern_id, 'VS-x');
  });
});

describe('redactBugs', () => {
  test('maps over an array', () => {
    const out = redactBugs([{ url: 'https://a.gov/p?token=S' }, { url: 'https://a.gov/q' }]);
    assert.equal(out[0].url, `https://a.gov/p?token=${REDACTED}`);
    assert.equal(out[1].url, 'https://a.gov/q');
  });

  test('returns non-array input unchanged', () => {
    assert.equal(redactBugs(null), null);
  });
});

describe('deepRedactUrls', () => {
  test('redacts nested url fields at any depth', () => {
    const input = {
      a: { b: [{ url: 'https://x.gov/p?token=SECRET#f' }] },
      series: [{ clusters: { drift_pages: [{ url: 'https://x.gov/y?sid=Z' }] } }],
    };
    const out = deepRedactUrls(input);
    assert.equal(out.a.b[0].url, `https://x.gov/p?token=${REDACTED}`);
    assert.equal(out.series[0].clusters.drift_pages[0].url, `https://x.gov/y?sid=${REDACTED}`);
  });

  test('redacts a urls[] array of strings', () => {
    const out = deepRedactUrls({ urls: ['https://x.gov/a?apikey=K', 'https://x.gov/b#f'] });
    assert.deepEqual(out.urls, [`https://x.gov/a?apikey=${REDACTED}`, 'https://x.gov/b']);
  });

  test('does not mutate input and leaves non-url data intact', () => {
    const input = { url: 'https://x.gov/p#f', count: 3, name: 'ok' };
    const before = JSON.stringify(input);
    const out = deepRedactUrls(input);
    assert.equal(JSON.stringify(input), before);
    assert.equal(out.count, 3);
    assert.equal(out.name, 'ok');
    assert.equal(out.url, 'https://x.gov/p');
  });

  test('passes primitives through', () => {
    assert.equal(deepRedactUrls(5), 5);
    assert.equal(deepRedactUrls('hello'), 'hello');
    assert.equal(deepRedactUrls(null), null);
  });
});
