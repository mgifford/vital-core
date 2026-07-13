// Directories never searched, regardless of local.ignore_patterns config
// (that config adds to this list, never replaces it) — spec.md FR-009.
export const DEFAULT_IGNORE_DIRS = ['node_modules', '.git', '.svn', 'vendor', 'dist', 'build'];

// File extensions skipped without reading content (binary/asset files —
// never the source of a project's own markup) — spec.md FR-009.
export const DEFAULT_IGNORE_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.zip', '.tar', '.gz', '.pdf',
  '.mp4', '.mp3', '.webm',
];

export function isIgnoredDir(dirName, extraPatterns = []) {
  return DEFAULT_IGNORE_DIRS.includes(dirName) || extraPatterns.includes(dirName);
}

export function isIgnoredFile(fileName) {
  const ext = fileName.slice(fileName.lastIndexOf('.'));
  return DEFAULT_IGNORE_EXTENSIONS.includes(ext.toLowerCase());
}
