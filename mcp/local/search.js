import fs from 'node:fs';
import path from 'node:path';
import { assertPathWithinRoot } from '../security/path-allowlist.js';
import { isIgnoredDir, isIgnoredFile } from './default-ignore.js';

const DEFAULT_MAX_FILES = 5000;
const DEFAULT_MAX_FILE_SIZE_BYTES = 1_000_000; // 1 MB
const DEFAULT_RESULT_CAP = 20;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tierFor(distinctTypeCount) {
  if (distinctTypeCount >= 3) return 'high';
  if (distinctTypeCount === 2) return 'medium';
  return 'low'; // distinctTypeCount === 1 (0 means the file wasn't a candidate at all)
}

export function searchForSignals(repositoryRoot, signals, options = {}) {
  const {
    maxFiles = DEFAULT_MAX_FILES,
    maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE_BYTES,
    ignorePatterns = [],
    resultCap = DEFAULT_RESULT_CAP,
  } = options;

  if (signals.length === 0) return [];

  // Resolve the root to its realpath once, up front. `repositoryRoot` may
  // be a symlink (e.g. on macOS, os.tmpdir()-derived paths resolve through
  // /var -> /private/var), and assertPathWithinRoot always returns
  // realpath-resolved paths — computing path.relative() against an
  // unresolved root would then produce a bogus "../../.." result instead
  // of a clean root-relative path (spec.md FR-006).
  const resolvedRoot = fs.realpathSync(repositoryRoot);

  // Precompute a regex per signal for literal matching (escaped — never
  // interpreted as a user-controlled regex, spec.md NFR-04).
  const compiledSignals = signals.map((s) => ({ ...s, re: new RegExp(escapeRegex(s.value)) }));

  const results = []; // { relPath, matchedSignals: [...], types: Set }
  let filesVisited = 0;
  const stack = [resolvedRoot];

  while (stack.length > 0 && filesVisited < maxFiles) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir — skip, don't crash the whole search
    }
    for (const entry of entries) {
      if (filesVisited >= maxFiles) break;
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (isIgnoredDir(entry.name, ignorePatterns)) continue;
        // Boundary check on every directory descended into — cheap
        // relative to the cost of a full walk, and closes any gap where
        // a directory-level symlink could otherwise be traversed before
        // a file-level check catches it.
        try {
          assertPathWithinRoot(entryPath, resolvedRoot);
        } catch {
          continue; // outside the root (e.g. symlink escape) — skip silently, do not throw and abort the whole search
        }
        stack.push(entryPath);
        continue;
      }

      if (!entry.isFile()) continue; // skip other types (sockets, devices, etc.)
      if (isIgnoredFile(entry.name)) continue;

      filesVisited++;

      let resolvedPath;
      try {
        resolvedPath = assertPathWithinRoot(entryPath, resolvedRoot);
      } catch {
        continue; // symlink escape at the file level — skip
      }

      let stat;
      try {
        stat = fs.statSync(resolvedPath);
      } catch {
        continue;
      }
      if (stat.size > maxFileSizeBytes) continue;

      let content;
      try {
        content = fs.readFileSync(resolvedPath, 'utf8');
      } catch {
        continue; // e.g. genuinely binary despite extension check, or a permissions error
      }

      const matchedTypes = new Set();
      const matchedSignals = [];
      for (const sig of compiledSignals) {
        if (sig.re.test(content)) {
          matchedTypes.add(sig.type);
          matchedSignals.push({ type: sig.type, value: sig.value });
        }
      }
      if (matchedSignals.length > 0) {
        results.push({
          path: path.relative(resolvedRoot, resolvedPath),
          confidence: tierFor(matchedTypes.size),
          matched_signals: matchedSignals,
          _distinctTypeCount: matchedTypes.size, // sort key only, stripped before return
        });
      }
    }
  }

  const TIER_RANK = { high: 0, medium: 1, low: 2 };
  results.sort((a, b) => {
    const t = TIER_RANK[a.confidence] - TIER_RANK[b.confidence];
    if (t !== 0) return t;
    return b._distinctTypeCount - a._distinctTypeCount;
  });

  return results.slice(0, resultCap).map(({ _distinctTypeCount, ...r }) => r);
}
