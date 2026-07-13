import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertPathWithinRoot } from '../../../mcp/security/path-allowlist.js';

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vital-path-allowlist-test-'));
}

test('path-allowlist: allows a file genuinely inside the root', () => {
  const root = makeTempRoot();
  try {
    const file = path.join(root, 'inside.txt');
    fs.writeFileSync(file, 'hello');
    const resolved = assertPathWithinRoot(file, root);
    assert.equal(resolved, fs.realpathSync(file));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('path-allowlist: allows the root itself', () => {
  const root = makeTempRoot();
  try {
    const resolved = assertPathWithinRoot(root, root);
    assert.equal(resolved, fs.realpathSync(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('path-allowlist: blocks a ../ traversal outside the root', () => {
  const root = makeTempRoot();
  try {
    const outside = path.join(path.dirname(root), 'outside-sibling.txt');
    fs.writeFileSync(outside, 'secret');
    try {
      const traversal = path.join(root, '..', path.basename(outside));
      assert.throws(() => assertPathWithinRoot(traversal, root), /Filesystem access blocked/);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('path-allowlist: blocks a symlink inside the root pointing outside it', () => {
  const root = makeTempRoot();
  const outsideDir = makeTempRoot();
  try {
    const secretFile = path.join(outsideDir, 'secret.txt');
    fs.writeFileSync(secretFile, 'do not read me');
    const linkPath = path.join(root, 'escape-link');
    fs.symlinkSync(secretFile, linkPath);
    assert.throws(() => assertPathWithinRoot(linkPath, root), /Filesystem access blocked/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('path-allowlist: blocks a sibling directory with a similar name prefix (no false-accept)', () => {
  // /repo vs /repo-evil — a naive string-prefix check without a trailing
  // separator would incorrectly accept this.
  const parent = makeTempRoot();
  try {
    const root = path.join(parent, 'repo');
    const evilSibling = path.join(parent, 'repo-evil');
    fs.mkdirSync(root);
    fs.mkdirSync(evilSibling);
    const evilFile = path.join(evilSibling, 'secret.txt');
    fs.writeFileSync(evilFile, 'secret');
    assert.throws(() => assertPathWithinRoot(evilFile, root), /Filesystem access blocked/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('path-allowlist: throws a clear error for a path that does not exist', () => {
  const root = makeTempRoot();
  try {
    const missing = path.join(root, 'does-not-exist.txt');
    assert.throws(() => assertPathWithinRoot(missing, root), /Filesystem access blocked/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
