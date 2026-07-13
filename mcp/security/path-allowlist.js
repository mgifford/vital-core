import fs from 'node:fs';
import path from 'node:path';

// Every file the local-search logic opens goes through this first — no
// call site is allowed to skip it (spec.md C-004). Symlink-safe: a
// symlink inside `allowedRoot` that resolves outside it is caught here,
// not silently followed (spec.md FR-004).
export function assertPathWithinRoot(targetPath, allowedRoot) {
  let resolvedRoot;
  try {
    resolvedRoot = fs.realpathSync(allowedRoot);
  } catch (err) {
    throw new Error(`Filesystem access blocked: configured repository root "${allowedRoot}" does not exist or is not readable (${err.code ?? err.message}).`);
  }
  let resolvedTarget;
  try {
    resolvedTarget = fs.realpathSync(targetPath);
  } catch (err) {
    throw new Error(`Filesystem access blocked: "${targetPath}" does not exist or is not readable (${err.code ?? err.message}).`);
  }
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Filesystem access blocked: "${targetPath}" is outside the configured repository root "${allowedRoot}".`);
  }
  return resolvedTarget;
}
