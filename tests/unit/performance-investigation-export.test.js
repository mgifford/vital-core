import { test } from 'node:test';
import assert from 'node:assert/strict';
import { investigationsToCsv } from '../../src/lib/performance-investigation-export.js';
test('exports investigation candidates as CSV without inventing values', () => {
  const csv = investigationsToCsv({ candidates: [{ id: 'x', category: 'shared-expensive-resource', resource: { key: 'https://e/a.js', type: 'script', third_party: true, pages: 3, transfer_bytes: 9 }, status: 'investigation-candidate', hypothesis: 'may be adding work' }] });
  assert.match(csv, /^id,category,resource,type,third_party,pages,transfer_bytes,status,hypothesis/);
  assert.match(csv, /x,shared-expensive-resource,https:\/\/e\/a\.js,script,true,3,9,investigation-candidate/);
});
