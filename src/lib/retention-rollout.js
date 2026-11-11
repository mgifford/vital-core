/**
 * Read-only prune-readiness gate.
 *
 * This answers "is every source week covered by a verified archive?" without
 * deleting anything. It is the safety check an operator runs before authorizing
 * a separate, destructive prune; this module never calls prune.js.
 */

import { archiveState } from './retention-archive-index.js';
import { verifyArchive } from './retention-archive.js';

export async function evaluatePruneReadiness({ plan, archiveIndex, backend = null, now = new Date(), verifyObject = true }) {
  const entries = [];
  for (const entry of plan?.entries ?? []) {
    if (entry.action === 'keep_live' || entry.action === 'already_pruned') {
      entries.push({ week: entry.week, ready: false, status: entry.action, reason: entry.reason });
      continue;
    }
    if (entry.action !== 'archive_candidate') {
      entries.push({ week: entry.week, ready: false, status: entry.action, reason: entry.reason });
      continue;
    }
    const archive = (archiveIndex?.archives ?? []).find((candidate) => candidate.week === entry.week);
    if (!archive) {
      entries.push({ week: entry.week, ready: false, status: 'blocked', reason: 'no archive index entry' });
      continue;
    }
    const state = archiveState(archive, now);
    if (state !== 'available') {
      entries.push({ week: entry.week, ready: false, status: `blocked-${state}`, reason: `archive state is ${state}` });
      continue;
    }
    if (!archive.zip_sha256 || !archive.key) {
      entries.push({ week: entry.week, ready: false, status: 'blocked', reason: 'archive index is missing key or checksum' });
      continue;
    }
    if (verifyObject && backend) {
      try {
        const downloaded = await backend.get(archive.key);
        const verified = verifyArchive(downloaded, { expectedSha256: archive.zip_sha256 });
        if (!verified.ok) {
          entries.push({ week: entry.week, ready: false, status: 'blocked-checksum', reason: verified.errors.join('; ') });
          continue;
        }
      } catch (error) {
        entries.push({ week: entry.week, ready: false, status: 'blocked-backend', reason: error.message });
        continue;
      }
    } else if (verifyObject) {
      entries.push({ week: entry.week, ready: false, status: 'blocked-unverified', reason: 'no archive backend configured to verify the object' });
      continue;
    }
    entries.push({ week: entry.week, ready: true, status: 'ready', reason: 'verified archive covers this week' });
  }
  const candidates = entries.filter((entry) => entry.status !== 'keep_live' && entry.status !== 'already_pruned');
  return {
    domain: plan?.domainKey ?? archiveIndex?.domain ?? null,
    destructiveActionsPerformed: 0,
    ready: candidates.length > 0 && candidates.every((entry) => entry.ready),
    entries,
  };
}
