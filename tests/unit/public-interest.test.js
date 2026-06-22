import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// We test the internal helpers indirectly by exercising runPublicInterest
// against a local fixture server. Since we don't have a fixture here we
// test the shape of the returned object and the graceful-failure path by
// pointing at a non-existent host (which will timeout/error on each check).

const { runPublicInterest } = await import('../../src/engines/public-interest.js');

describe('runPublicInterest', () => {
  it('returns the expected shape even when all checks fail/timeout', async () => {
    // Use a localhost port that nothing is listening on — every safeFetch
    // returns null and we should get graceful unknown/fail results, not throws.
    const result = await runPublicInterest('http://127.0.0.1:19999', '127.0.0.1', 'vital-test/0.1');

    assert.equal(result.engine, 'public-interest');
    assert.ok(typeof result.checkedAt === 'string');

    // Accessibility statement.
    assert.ok(['pass', 'fail', 'unknown'].includes(result.a11yStatement.result));
    assert.ok('url' in result.a11yStatement);
    assert.ok('checkedAt' in result.a11yStatement);

    // carbon.txt.
    assert.ok(['pass', 'fail', 'unknown'].includes(result.carbonTxt.result));
    assert.ok('valid' in result.carbonTxt);
    assert.ok('fields' in result.carbonTxt);

    // Green Web Foundation.
    assert.ok(['pass', 'fail', 'unknown'].includes(result.greenWebFoundation.result));
    assert.ok('green' in result.greenWebFoundation);
    assert.ok('hostedBy' in result.greenWebFoundation);

    // Sitemaps.
    assert.ok('xml' in result.sitemaps);
    assert.ok('human' in result.sitemaps);
    assert.ok(typeof result.sitemaps.xml.found === 'boolean');
    assert.ok(typeof result.sitemaps.human.found === 'boolean');
  });

  it('does not throw when origin is completely unreachable', async () => {
    // Should resolve (not reject) with graceful unknowns.
    const result = await runPublicInterest('http://192.0.2.1', '192.0.2.1', 'vital-test/0.1');
    assert.equal(result.engine, 'public-interest');
    // All checks graceful.
    for (const key of ['a11yStatement', 'carbonTxt', 'greenWebFoundation']) {
      assert.ok(['pass', 'fail', 'unknown'].includes(result[key].result), `${key}.result should be a known value`);
    }
  });
});
