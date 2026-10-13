// Naming and guard rules for persisting crawl state as GitHub Release
// assets in CI (scripts/state-release.js). Kept pure so they can be unit
// tested without GitHub access. Local scans never use this: they read and
// write state/<key>/crawl.json on disk.

export const STATE_RELEASE_TAG = 'scan-state';

export function stateAssetName(key) {
  return `${key}.crawl.json.gz`;
}

// VA (hf_only) pages can capture CSRF/OAuth tokens, so their state must
// never leave the machine that scans them. The scan.yml matrix filter is
// the primary guard; this is the second one.
export function assertReleasable(target) {
  if (target.hf_only) {
    throw new Error(`${target.domain} is hf_only; its crawl state must never be uploaded.`);
  }
}

// gh prints these for a missing release / no matching asset. Anything else
// (auth, rate limit, network) is a real failure and must not be treated as
// "seed fresh", or a transient error would overwrite good state.
export function isNotFound(stderr) {
  return /release not found|no assets match|HTTP 404/i.test(String(stderr));
}
