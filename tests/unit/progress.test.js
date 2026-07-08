import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekDeltas, weekDeltaCounts } from '../../src/lib/progress.js';

// A small synthetic ledger as it would stand when rendering 2026-W24, with the
// previous scanned week being 2026-W23.
function ledger() {
  return {
    findings: {
      // first seen this week -> new
      NEW: { severity: 'Serious', firstSeen: '2026-W24', lastSeen: '2026-W24', _weeks: ['2026-W24'], weeksSeen: 1 },
      // present last week, gone now -> fixed
      FIXED: { severity: 'Critical', firstSeen: '2026-W20', lastSeen: '2026-W23', _weeks: ['2026-W20', '2026-W21', '2026-W22', '2026-W23'], weeksSeen: 4 },
      // seen before, absent last week, back now -> regressed
      REGRESSED: { severity: 'Moderate', firstSeen: '2026-W18', lastSeen: '2026-W24', _weeks: ['2026-W18', '2026-W19', '2026-W24'], weeksSeen: 3 },
      // present continuously incl. last week and now -> none of the three
      PERSISTENT: { severity: 'Minor', firstSeen: '2026-W10', lastSeen: '2026-W24', _weeks: ['2026-W23', '2026-W24'], weeksSeen: 2 },
      // gone two weeks ago -> fixed last week, NOT this week
      OLD_FIXED: { severity: 'Serious', firstSeen: '2026-W15', lastSeen: '2026-W22', _weeks: ['2026-W15', '2026-W22'], weeksSeen: 2 },
    },
  };
}

test('weekDeltas classifies new / fixed / regressed against the previous week', () => {
  const d = weekDeltas(ledger(), '2026-W24', '2026-W23');
  assert.deepEqual(d.new.map((x) => x.id), ['NEW']);
  assert.deepEqual(d.fixed.map((x) => x.id), ['FIXED']);
  assert.deepEqual(d.regressed.map((x) => x.id), ['REGRESSED']);
  // entries carry the finding fields through
  assert.equal(d.new[0].severity, 'Serious');
  assert.equal(d.fixed[0].severity, 'Critical');
});

test('weekDeltaCounts returns the three bucket sizes', () => {
  assert.deepEqual(weekDeltaCounts(ledger(), '2026-W24', '2026-W23'), { new: 1, fixed: 1, regressed: 1 });
});

test('coverage-expansion findings are not counted as new', () => {
  const l = { findings: { CN: { severity: 'Minor', firstSeen: '2026-W24', lastSeen: '2026-W24', _weeks: ['2026-W24'], weeksSeen: 1, _coverageNew: true } } };
  assert.equal(weekDeltas(l, '2026-W24', '2026-W23').new.length, 0);
});

test('first recorded week: everything present is new, nothing fixed/regressed', () => {
  const l = { findings: {
    A: { severity: 'Serious', firstSeen: '2026-W24', lastSeen: '2026-W24', _weeks: ['2026-W24'], weeksSeen: 1 },
    B: { severity: 'Minor', firstSeen: '2026-W24', lastSeen: '2026-W24', _weeks: ['2026-W24'], weeksSeen: 1 },
  } };
  const d = weekDeltas(l, '2026-W24', null);
  assert.equal(d.new.length, 2);
  assert.equal(d.fixed.length, 0);
  assert.equal(d.regressed.length, 0);
});

test('empty / missing ledger yields empty buckets', () => {
  assert.deepEqual(weekDeltas(null, '2026-W24', '2026-W23'), { new: [], fixed: [], regressed: [] });
  assert.deepEqual(weekDeltas({ findings: {} }, '2026-W24', '2026-W23'), { new: [], fixed: [], regressed: [] });
});
