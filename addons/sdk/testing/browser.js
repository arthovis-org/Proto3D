// sdk/testing/browser.js — Playwright helpers for add-on browser tests. Serves the repo root
// with node:http (no dependencies, the same relative paths GitHub Pages serves), launches
// Chromium (from PLAYWRIGHT_BROWSERS_PATH, defaulting to /opt/pw-browsers when that exists),
// routes the core's CDN import map (unpkg three@0.160.0) to the local `node_modules/three` so the
// tests are hermetic — no network, no CDN trust issues — blocks Google Fonts the same way, and
// collects `pageerror` events and console errors per page.
//
//   const h = await createHarness();
//   const { page, errors } = await h.open('/addons/gateway-credits/');
//   …
//   await h.close();
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const THREE_VERSION = '0.160.0';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json' };

/** Static file server for `root`; directories serve index.html. Returns { url, port, close() }. */
export function startServer(root = REPO_ROOT) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p;
      try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (_) { res.writeHead(400); res.end(); return; }
      let file = path.join(root, p);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); } catch (_) { /* fallthrough */ }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end(`not found: ${p}`); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }));
  });
}

function threeDir() {
  const local = path.join(REPO_ROOT, 'node_modules', 'three');
  if (fs.existsSync(path.join(local, 'build', 'three.module.js'))) return local;
  try { return path.dirname(createRequire(import.meta.url).resolve('three/package.json')); } catch (_) { return null; }
}

/** Route unpkg three → node_modules/three and swallow Google Fonts, so the page never leaves localhost. */
export async function routeCdn(page) {
  const dir = threeDir();
  await page.route(`https://unpkg.com/three@${THREE_VERSION}/**`, (route) => {
    const rel = new URL(route.request().url()).pathname.replace(`/three@${THREE_VERSION}/`, '');
    const file = dir ? path.join(dir, rel) : null;
    if (file && fs.existsSync(file)) route.fulfill({ path: file, contentType: 'text/javascript' });
    else route.fulfill({ status: 404, contentType: 'text/plain', body: `three not vendored: ${rel} (run npm install)` });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: route.request().url().includes('css') ? 'text/css' : 'font/woff2', body: '' }));
}

/** Console noise that is not an application error (software WebGL in headless Chromium). */
const IGNORE = [/SwiftShader/i, /GPU stall/i, /Automatic fallback to software WebGL/i, /WebGL.*deprecated/i, /GroupMarkerNotSet/i];

/** Attach error collection to a page: `errors` gets pageerror messages and console.error lines. */
export function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') { const t = msg.text(); if (!IGNORE.some((re) => re.test(t))) errors.push(`console.error: ${t}`); } });
  page.on('requestfailed', (req) => { const u = req.url(); if (u.startsWith('http://127.0.0.1')) errors.push(`requestfailed: ${u} ${req.failure()?.errorText || ''}`); });
  page.on('response', (res) => { if (res.status() >= 400 && res.url().startsWith('http://127.0.0.1')) errors.push(`http ${res.status()}: ${new URL(res.url()).pathname}`); });
  return errors;
}

/**
 * Server + browser + a fresh context per open(). `open(path)` returns { page, errors, url }.
 * `persistent: true` keeps one context across opens so storage is shared between pages (the
 * isolation tests need the core page and the add-on page to see the same origin storage).
 */
export async function createHarness({ root = REPO_ROOT, viewport = { width: 1440, height: 900 }, persistent = true } = {}) {
  const { chromium } = await import('playwright');
  const server = await startServer(root);
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'] });
  let context = null;
  const contexts = [];
  const ctx = async () => { if (persistent && context) return context; const c = await browser.newContext({ viewport, ignoreHTTPSErrors: true }); contexts.push(c); if (persistent) context = c; return c; };
  return {
    server, browser, url: server.url,
    async open(p = '/', { waitUntil = 'load' } = {}) {
      const c = await ctx();
      const page = await c.newPage();
      const errors = collectErrors(page);
      await routeCdn(page);
      await page.goto(server.url + p, { waitUntil });
      return { page, errors, url: server.url + p };
    },
    /** Wait until the core booted (window.__proto) on a page. */
    async waitForCore(page, timeout = 30000) { await page.waitForFunction(() => !!window.__proto?.world, null, { timeout }); },
    /** Wait until an add-on page finished its shell boot (window.__addon) or failed (window.__addonError). */
    async waitForAddon(page, timeout = 30000) {
      await page.waitForFunction(() => !!window.__addon || !!window.__addonError, null, { timeout });
      const err = await page.evaluate(() => window.__addonError || null);
      if (err) throw new Error(`add-on shell failed at step "${err.step}": ${err.message}`);
    },
    async close() { for (const c of contexts) await c.close().catch(() => {}); await browser.close(); await server.close(); },
  };
}
