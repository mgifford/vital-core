import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { runOfflineResilience } from '../../src/engines/offline-resilience.js';

// runOfflineResilience toggles a real Playwright context's network state,
// so it needs a real browser and a real HTTP origin — a single shared
// browser for the whole file, one throwaway HTTP server per test.
let browser;

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

function startServer(html) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('reachable origin without a service worker: offline navigation fails, no caches found', async () => {
  const server = await startServer('<!doctype html><html><body>hi</body></html>');
  const port = server.address().port;
  try {
    const result = await runOfflineResilience(browser, `http://127.0.0.1:${port}`, 'vital-test/0.1', 3000);
    assert.equal(result.engine, 'offline-resilience');
    assert.equal(result.total, 2);

    const offline = result.checks.find((c) => c.id === 'offline-fallback');
    assert.equal(offline.pass, false);
    assert.match(offline.detail, /offline/i);

    const cache = result.checks.find((c) => c.id === 'cache-storage-in-use');
    assert.equal(cache.pass, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('completely unreachable origin does not throw', async () => {
  // 127.0.0.1:1 is a guaranteed-refused low port; no server ever binds it.
  const result = await runOfflineResilience(browser, 'http://127.0.0.1:1', 'vital-test/0.1', 2000);
  assert.equal(result.engine, 'offline-resilience');
  const offline = result.checks.find((c) => c.id === 'offline-fallback');
  assert.equal(offline.pass, false);
  assert.match(offline.detail, /unreachable/i);
});

test('cache-storage-in-use reports evidence when the page itself populates Cache Storage', async () => {
  // Playwright's browser.newContext() is an isolated storage partition
  // (like a fresh incognito profile) — Cache Storage populated in one
  // context is NOT visible from another, even for the same origin, so the
  // cache must be written during the engine's OWN navigation of its OWN
  // context. A top-level `await` inside a <script type="module"> blocks
  // the page's load event until the cache write resolves, which makes
  // this deterministic — no race with the engine's later offline/online
  // reload of the same context.
  const html = `<!doctype html><html><body><script type="module">
    const cache = await caches.open('v1-shell');
    await cache.put('/', new Response('cached'));
  </script></body></html>`;
  const server = await startServer(html);
  const port = server.address().port;
  const baseOrigin = `http://127.0.0.1:${port}`;
  try {
    const result = await runOfflineResilience(browser, baseOrigin, 'vital-test/0.1', 5000);
    const cache = result.checks.find((c) => c.id === 'cache-storage-in-use');
    assert.equal(cache.pass, true);
    assert.match(cache.detail, /v1-shell/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
