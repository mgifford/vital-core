import { resolve } from 'path';
import { promises as fs } from 'fs';

// Resolve Playwright Chromium "Chrome for Testing" binary path
const chromePath = resolve('node_modules/.bin/playwright');
// The actual binary is hidden inside the Playwright cache; we locate it via a small helper.
async function getChromiumPath() {
  // Use Playwright to print the path (same as scripts/get-chromium-path.mjs)
  const { execFile } = await import('node:child_process');
  const { stdout } = await new Promise((resolve, reject) => {
    execFile('node', ['scripts/get-chromium-path.mjs'], (err, out, errout) => {
      if (err) reject(err);
      else resolve({ stdout: out.toString() });
    });
  });
  return stdout.trim();
}

async function createSymlink() {
  try {
    const target = await getChromiumPath();
    const binDir = resolve(process.env.HOME, 'bin');
    await fs.mkdir(binDir, { recursive: true });
    const linkPath = resolve(binDir, 'google-chrome');
    // Remove existing symlink/file if present
    try { await fs.unlink(linkPath); } catch (_) {}
    await fs.symlink(target, linkPath);
    console.log(`✅ Symlink created: ${linkPath} → ${target}`);
  } catch (e) {
    console.error('Failed to create symlink:', e);
    process.exit(1);
  }
}

createSymlink();
