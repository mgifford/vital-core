import { ProfileParser } from '../../src/engine/parser';
import { TargetDiscoveryEngine } from '../../src/engine/discovery';

async function runVerification() {
  try {
    console.log('⏳ Running discovery smoke validation...');

    const profile = ProfileParser.loadProfile('profiles/us-health.yml');
    const cmsTarget = profile.targets.find(t => t.id === 'cms-gov');

    if (!cmsTarget) {
      throw new Error("Could not locate 'cms-gov' target within profile.");
    }

    const executionQueue = await TargetDiscoveryEngine.discoverUrls(cmsTarget);

    console.log('\n==============================================');
    console.log(`🚀 RESOLVED SCAN TARGETS FOR: ${cmsTarget.name}`);
    console.log(`📊 Total Pages Slated for Execution: ${executionQueue.length}`);
    console.log('==============================================');

    executionQueue.forEach((url, index) => {
      console.log(` [${index + 1}] -> ${url}`);
    });

    if (executionQueue.length === 0) {
      throw new Error('Failure: The resolved execution matrix came back empty.');
    }

    const prioritySeedFound = executionQueue.some(url => url === 'https://www.cms.gov/medicare/physician-fee-schedule/search');
    if (!prioritySeedFound) {
      throw new Error('Failure: Specific seed requirements were dropped or out-prioritized.');
    }

    console.log('\n✅ Discovery smoke validation passed.');
  } catch (error: any) {
    console.error('\n❌ Discovery smoke validation exception:', error.message);
    process.exit(1);
  }
}

runVerification();
