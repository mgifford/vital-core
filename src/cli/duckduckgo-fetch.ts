// src/cli/duckduckgo-fetch.ts
/**
 * Simple CLI utility to fetch top URLs from DuckDuckGo for a given domain.
 * Usage:
 *   ts-node src/cli/duckduckgo-fetch.ts --domain=example.com [--limit=20]
 *
 * This leverages the same logic used by PrioritySeedStore.fetchLiveUrls
 * but does not require a full TargetConfig profile.
 */
import { PrioritySeedStore } from '../engine/priority-seeds';

function parseArgs() {
  const args = process.argv.slice(2);
  const result: { domain?: string; limit?: number } = {};
  args.forEach(arg => {
    if (arg.startsWith('--domain=')) {
      result.domain = arg.split('=')[1];
    } else if (arg.startsWith('--limit=')) {
      const val = parseInt(arg.split('=')[1], 10);
      if (!isNaN(val)) result.limit = val;
    }
  });
  return result;
}

(async () => {
  const { domain, limit } = parseArgs();
  if (!domain) {
    console.error('❌ Missing required --domain argument');
    process.exit(1);
  }
  const mockTarget = {
    id: `duckduckgo-${domain}`,
    base_url: `https://${domain}`,
    name: domain,
    priority_urls: [],
    // The fields required by fetchLiveUrls are limited to id and base_url.
  } as any;

  const urls = await PrioritySeedStore.fetchLiveUrls(mockTarget, limit ?? 20);
  console.log(`🦆 DuckDuckGo discovered ${urls.length} URLs for ${domain}:`);
  urls.forEach(u => console.log(u));
})();
