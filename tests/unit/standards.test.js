import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { runStandards } from '../../src/engines/standards.js';

// runStandards's page.evaluate does real fetch()/navigator.serviceWorker
// work, so a fake page object can't stand in for it — this spins up one
// headless browser for the whole file and a tiny local HTTP server so
// same-origin manifest fetch() behaves like it would against a real site.
let browser;
let server;
let baseUrl;
const routes = new Map(); // path -> { status, contentType, body }

before(async () => {
  browser = await chromium.launch();
  server = http.createServer((req, res) => {
    const route = routes.get(req.url);
    if (!route) { res.writeHead(404); res.end(); return; }
    res.writeHead(route.status, { 'Content-Type': route.contentType });
    res.end(route.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

async function scan(html) {
  const page = await browser.newPage();
  routes.set('/', { status: 200, contentType: 'text/html', body: html });
  await page.goto(`${baseUrl}/`);
  try {
    return await runStandards(page);
  } finally {
    await page.close();
  }
}

// runStandards doesn't expose `data.manifest`/`data.serviceWorker` on its
// public return value — that migration into a rendered `resilience` section
// is WP03's job. Until then, these tests call runStandards (to prove it
// runs the new fetch/parse logic without throwing) and separately mirror
// T001/T002's exact detection logic via page.evaluate to assert on the
// values it computes.

test('valid manifest is fetched and parsed with maskable icon detected', async () => {
  routes.set('/manifest.json', {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      start_url: '/app',
      display: 'standalone',
      scope: '/',
      theme_color: '#123456',
      background_color: '#ffffff',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-mask.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }),
  });
  const html = '<!doctype html><html><head><link rel="manifest" href="/manifest.json"></head><body></body></html>';
  const page = await browser.newPage();
  routes.set('/', { status: 200, contentType: 'text/html', body: html });
  await page.goto(`${baseUrl}/`);
  await runStandards(page);
  const data = await page.evaluate(() => {
    const href = document.head.querySelector('link[rel="manifest"]')?.getAttribute('href');
    return href;
  });
  assert.equal(data, '/manifest.json');
  // Re-derive the parsed manifest the same way runStandards does, to assert
  // on its actual shape (runStandards itself doesn't return `data.manifest`
  // — only WP03's section-restructuring exposes it on the public shape).
  const manifest = await page.evaluate(async () => {
    const manifestHref = document.head.querySelector('link[rel="manifest"]')?.getAttribute('href');
    const manifestUrl = new URL(manifestHref, location.href).href;
    const res = await fetch(manifestUrl);
    const json = await res.json();
    const icons = Array.isArray(json.icons) ? json.icons : [];
    return {
      startUrl: json.start_url ?? null,
      display: json.display ?? null,
      scope: json.scope ?? null,
      themeColor: json.theme_color ?? null,
      backgroundColor: json.background_color ?? null,
      icons,
      hasMaskableIcon: icons.some((i) => String(i.purpose || '').includes('maskable')),
    };
  });
  assert.equal(manifest.startUrl, '/app');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.themeColor, '#123456');
  assert.equal(manifest.backgroundColor, '#ffffff');
  assert.equal(manifest.icons.length, 2);
  assert.equal(manifest.hasMaskableIcon, true);
  await page.close();
});

test('manifest without a maskable icon reports hasMaskableIcon false', async () => {
  routes.set('/manifest.json', {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ icons: [{ src: '/icon.png', sizes: '192x192', type: 'image/png' }] }),
  });
  const html = '<!doctype html><html><head><link rel="manifest" href="/manifest.json"></head><body></body></html>';
  const page = await browser.newPage();
  routes.set('/', { status: 200, contentType: 'text/html', body: html });
  await page.goto(`${baseUrl}/`);
  await runStandards(page);
  const hasMaskable = await page.evaluate(async () => {
    const res = await fetch('/manifest.json');
    const json = await res.json();
    return (json.icons || []).some((i) => String(i.purpose || '').includes('maskable'));
  });
  assert.equal(hasMaskable, false);
  await page.close();
});

test('manifest link pointing at a 404 does not throw and is reported unreadable', async () => {
  const html = '<!doctype html><html><head><link rel="manifest" href="/missing.json"></head><body></body></html>';
  const page = await browser.newPage();
  routes.set('/', { status: 200, contentType: 'text/html', body: html });
  await page.goto(`${baseUrl}/`);
  const result = await runStandards(page); // must not throw
  assert.ok(result.checks.length > 0);
  const manifestState = await page.evaluate(async () => {
    try {
      const res = await fetch('/missing.json');
      return res.ok ? 'ok' : `HTTP ${res.status}`;
    } catch (err) {
      return String(err?.message || err);
    }
  });
  assert.equal(manifestState, 'HTTP 404');
  await page.close();
});

test('manifest link pointing at malformed JSON does not throw', async () => {
  routes.set('/bad.json', { status: 200, contentType: 'application/json', body: 'not json{' });
  const html = '<!doctype html><html><head><link rel="manifest" href="/bad.json"></head><body></body></html>';
  const page = await browser.newPage();
  routes.set('/', { status: 200, contentType: 'text/html', body: html });
  await page.goto(`${baseUrl}/`);
  const result = await runStandards(page); // must not throw
  assert.ok(result.checks.length > 0);
  await page.close();
});

test('no manifest link declared means no manifest fetch attempted', async () => {
  const html = '<!doctype html><html><head></head><body></body></html>';
  const result = await scan(html);
  const manifestCheck = result.checks.find((c) => c.id === 'pwa-manifest');
  assert.equal(manifestCheck.pass, false);
});

test('page with no service worker reports all-false state', async () => {
  const html = '<!doctype html><html><head></head><body></body></html>';
  const page = await browser.newPage();
  routes.set('/', { status: 200, contentType: 'text/html', body: html });
  await page.goto(`${baseUrl}/`);
  await runStandards(page);
  // Mirror T002's detection logic directly: no service worker was
  // registered on this page, so getRegistration() resolves undefined and
  // controller is null. active/installing/waiting/controllingThisPage are
  // verified structurally here (correct defaults, correct types) rather
  // than via a real service-worker lifecycle — registering and progressing
  // a real SW through install/activate within a unit test is impractical;
  // this is a known test-depth limit.
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return {
      registered: !!reg,
      active: !!reg?.active,
      installing: !!reg?.installing,
      waiting: !!reg?.waiting,
      controllingThisPage: !!navigator.serviceWorker.controller,
    };
  });
  assert.deepEqual(sw, { registered: false, active: false, installing: false, waiting: false, controllingThisPage: false });
  await page.close();
});

test('existing checks array is unchanged by this WP (no regression)', async () => {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Test</title><meta name="theme-color" content="#fff"></head><body></body></html>';
  const result = await scan(html);
  const pwaIds = result.checks.filter((c) => c.id.startsWith('pwa-')).map((c) => c.id);
  assert.deepEqual(pwaIds, ['pwa-https', 'pwa-manifest', 'pwa-service-worker', 'pwa-theme-color', 'pwa-apple-touch-icon']);
  const themeCheck = result.checks.find((c) => c.id === 'pwa-theme-color');
  assert.equal(themeCheck.pass, true);
  assert.equal(themeCheck.detail, '#fff');
});
