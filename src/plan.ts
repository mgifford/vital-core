import { ProfileParser } from './engine/parser';
import { TargetDiscoveryEngine } from './engine/discovery';
import { PageStateCache } from './engine/reporters/page-state-cache';
import { PrioritySeedStore } from './engine/priority-seeds';
import { UrlManifestStore } from './engine/url-manifest';

function parseCliArgs(argv: string[]): { profilePath: string; targetId: string } {
  const args = [...argv];
  let profilePath = 'profiles/us-health.yml';
  let targetId = process.env.VITAL_TARGET_ID || '';

  if (args.length > 0 && !args[0].startsWith('--')) {
    profilePath = args.shift() as string;
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--target' || arg === '-t') {
      targetId = args[index + 1] || targetId;
      index += 1;
      continue;
    }

    if (arg.startsWith('--target=')) {
      targetId = arg.slice('--target='.length) || targetId;
    }
  }

  return { profilePath, targetId };
}

async function main(): Promise<void> {
  const { profilePath, targetId } = parseCliArgs(process.argv.slice(2));

  console.log(`🗺️  Planning discovery queue from profile: ${profilePath}`);
  if (targetId) {
    console.log(`🎯 Planning queue for target "${targetId}" only.`);
  }

  const profile = ProfileParser.loadProfile(profilePath);
  const activeTargets = targetId
    ? profile.targets.filter(target => target.id === targetId)
    : profile.targets;

  if (targetId && activeTargets.length === 0) {
    throw new Error(`Target not found in profile: ${targetId}`);
  }

  const pageState = PageStateCache.load();
  const previouslyScannedUrls = new Set(Object.keys(pageState));

  await PrioritySeedStore.initialize(profile.targets, {
    forceRefresh: false,
    maxAgeDays: 90,
    perTargetLimit: 12
  });

  for (const target of activeTargets) {
    console.log(`\n===== Planning Target: ${target.name} (${target.id}) =====`);
    const urlManifest = UrlManifestStore.load(target.id);

    const discoveryResult = await TargetDiscoveryEngine.discoverUrls(target, {
      pageState,
      previouslyScannedUrls,
      skipPreviouslyScanned: true,
      revalidateAfterDays: 7,
      updatedWithinDays: 7,
      updatedRecheckHours: 12,
      urlManifest,
      rescanWindowDays: 7,
      includeQuarantined: false
    });

    console.log(
      `📊 Planned ${discoveryResult.urls.length} URL(s) for ${target.id}: ` +
        `${JSON.stringify(discoveryResult.queueComposition)}`
    );
  }
}

main().catch(error => {
  console.error(`❌ Planning phase failed:`, error instanceof Error ? error.message : String(error));
  process.exit(1);
});