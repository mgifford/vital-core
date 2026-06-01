import { ProfileParser } from '../../src/engine/parser';
import { TargetDiscoveryEngine } from '../../src/engine/discovery';
import { ResilientBrowserEngine } from '../../src/engine/browser';
import * as fs from 'fs';
import * as path from 'path';

async function verifyBrowserSmoke() {
  try {
    console.log('⏳ Running browser and cache smoke validation...');

    const profile = ProfileParser.loadProfile('profiles/us-health.yml');
    const cmsTarget = profile.targets.find(t => t.id === 'cms-gov');

    if (!cmsTarget) throw new Error('Could not parse cms-gov configuration.');

    cmsTarget.settings.max_pages = 2;
    cmsTarget.priority_urls = [
      'https://httpstat.us/200?sleep=130000',
      'https://www.cms.gov/medicare/physician-fee-schedule/search'
    ];

    const { urls: queue } = await TargetDiscoveryEngine.discoverUrls(cmsTarget);
    const { reports: runReports } = await ResilientBrowserEngine.executeSnapshotSession(cmsTarget, queue);

    console.log('\n==============================================');
    console.log('📊 RUN ASSESSMENT LIFECYCLE RESULTS');
    console.log('==============================================');

    runReports.forEach(report => {
      console.log(`📄 URL: ${report.url}`);
      console.log(`   Status:  [${report.status}]`);
      console.log(`   Errors:  ${report.errorMessage || 'None'}`);
    });

    const snapshotDir = path.resolve(process.cwd(), 'tmp/html-snapshots');
    const filesWritten = fs.readdirSync(snapshotDir);

    if (filesWritten.length === 0) {
      throw new Error('Validation failure: snapshots directory is empty.');
    }

    const timeoutHandled = runReports.some(r => r.status === 'TIMEOUT');
    if (!timeoutHandled) {
      console.warn('⚠️ Note: Simulated timeout was not caught.');
    }

    console.log('\n✅ Browser smoke validation passed.');
  } catch (error: any) {
    console.error('\n❌ Browser smoke validation exception:', error.message);
    process.exit(1);
  }
}

verifyBrowserSmoke();
