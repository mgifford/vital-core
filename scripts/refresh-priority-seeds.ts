import { ProfileParser } from '../src/engine/parser';
import { PrioritySeedStore } from '../src/engine/priority-seeds';

async function main() {
  const profilePath = process.argv[2] || 'profiles/us-health.yml';

  const profile = ProfileParser.loadProfile(profilePath);
  const summary = await PrioritySeedStore.initialize(profile.targets, {
    forceRefresh: true,
    maxAgeDays: 0,
    perTargetLimit: 20
  });

  console.log(
    `Refreshed priority URL seeds for ${summary.targetCount} targets. Generated at ${summary.generatedAt}.`
  );
}

main().catch((error: any) => {
  console.error('Priority seed refresh failed:', error.message);
  process.exit(1);
});
