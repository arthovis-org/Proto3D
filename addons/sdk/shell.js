// sdk/shell.js — page bootstrap for an add-on page. The add-on's index.html is a near-empty
// document that loads this module; the shell then
//   1. reads `addon.json` next to the page and validates it,
//   2. installs storage isolation (localStorage / sessionStorage / IndexedDB prefixed per add-on),
//   3. fetches the CORE ../../index.html, copies its import map (dynamically inserted import maps
//      work in Chromium as long as the mapped specifiers have not been resolved yet — the shell
//      injects before any `import('three')`), its stylesheets (hrefs rewritten to the core root)
//      and its <body> skeleton (#menubar, #tabstrip, #panel, overlays…); sets <base> to the core root so
//      page-relative core URLs (assets/…) keep working from the add-on directory,
//   4. imports the add-on entry and calls its `register(host)` so node types exist BEFORE the
//      core boots (an autosaved graph with add-on nodes is restored, not skipped),
//   5. imports ../../src/main.js (the untouched core), waits for window.__proto,
//   6. calls the entry's `install(host)`.
// The add-on page is therefore immune to core DOM skeleton changes: it never carries its own copy.
import { validateManifest } from './manifest.js';
import { installStorageIsolation } from './storage.js';

const SDK_DIR = new URL('./', import.meta.url);
const CORE_ROOT = new URL('../../', import.meta.url);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 20000, every = 25 } = {}) {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > timeout) throw new Error('timed out'); await sleep(every); }
}
async function fetchText(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text(); }

/** Wait for a stylesheet (or give up after `timeout` ms: a blocked font CDN must not stall boot). */
function loadStylesheet(href, { crossOrigin = null, timeout = 4000 } = {}) {
  return new Promise((resolve) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; if (crossOrigin) l.crossOrigin = crossOrigin;
    const done = () => resolve(l);
    l.addEventListener('load', done); l.addEventListener('error', done); setTimeout(done, timeout);
    document.head.appendChild(l);
  });
}

function badge(manifest) {
  const style = document.createElement('style');
  style.textContent = `
    #addon-badge { position: fixed; z-index: 5; left: calc(var(--rail-w, 60px) + 24px); bottom: 52px; display: inline-flex; align-items: center; gap: 8px;
      font: 500 11px/1 Inter, system-ui, sans-serif; color: var(--dim, #9aa3b2); text-decoration: none; background: var(--panel, rgba(20,24,32,.85));
      border: 1px solid var(--border, #333); border-radius: 999px; padding: 6px 12px; backdrop-filter: blur(8px); }
    #addon-badge b { color: var(--text, #eee); font-weight: 600; } #addon-badge i { width: 8px; height: 8px; border-radius: 50%; background: var(--accent, #4f8cff); display: inline-block; }
    #addon-badge .link { color: var(--accent, #4f8cff); } #addon-badge:hover { border-color: var(--accent, #4f8cff); }
    body.rail-hidden #addon-badge { left: 24px; }`;
  document.head.appendChild(style);
  const a = document.createElement('a'); a.id = 'addon-badge'; a.href = CORE_ROOT.href; a.title = 'This page runs an add-on on top of the unchanged Proto3D core. Click to open the core app.';
  a.innerHTML = `<i></i><span>Add-on: <b></b> · SDK <span class="sdk"></span></span><span class="link">← core app</span>`;
  a.querySelector('b').textContent = manifest.name; a.querySelector('.sdk').textContent = String(manifest.sdk);
  document.body.appendChild(a);
  return a;
}

function keepTitle(manifest) {
  const suffix = ` · ${manifest.name}`;
  const apply = () => { if (!document.title.includes(manifest.name)) document.title = `${document.title || 'Proto3D'}${suffix}`; };
  document.title = `${manifest.name} · Proto3D`;
  const titleEl = document.querySelector('title') || document.head.appendChild(document.createElement('title'));
  new MutationObserver(apply).observe(titleEl, { childList: true, characterData: true, subtree: true });
}

function showFailure(step, err) {
  console.error(`[addon shell] failed at "${step}":`, err);
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;inset:16px;z-index:99;margin:0;padding:16px;overflow:auto;background:#1a1114;color:#ffb4bd;border:1px solid #a33;border-radius:10px;font:12px/1.5 Menlo,monospace;white-space:pre-wrap';
  box.textContent = `Add-on page failed to boot at step "${step}".\n\n${err && err.stack ? err.stack : err}`;
  document.body.appendChild(box);
}

export async function boot({ pageUrl = location.href } = {}) {
  const pageDir = new URL('./', pageUrl);
  const result = { steps: [], manifest: null, host: null, module: null };
  const step = (name) => { result.steps.push(name); result.step = name; };
  try {
    step('manifest');
    const manifest = validateManifest(await (await fetch(new URL('addon.json', pageDir), { cache: 'no-cache' })).json());
    result.manifest = manifest;
    document.documentElement.dataset.addon = manifest.id;

    step('storage');
    result.storage = installStorageIsolation(manifest.id, { passthrough: ['proto3d.theme'] });
    try { const t = localStorage.getItem('proto3d.theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (_) { /* blocked */ }

    step('core skeleton');
    // core code resolves page-relative URLs (the Start panel's assets/templates/*.png) against the document:
    // give this document the core root as its base. Add-on code resolves its own files from import.meta.url / the manifest.
    if (!document.querySelector('base')) { const base = document.createElement('base'); base.href = CORE_ROOT.href; document.head.prepend(base); }
    const coreDoc = new DOMParser().parseFromString(await fetchText(new URL('index.html', CORE_ROOT)), 'text/html');
    const im = coreDoc.querySelector('script[type="importmap"]');
    if (!im) throw new Error('core index.html has no <script type="importmap"> (seam: import map)');
    if (!document.querySelector('script[type="importmap"]')) {
      const s = document.createElement('script'); s.type = 'importmap'; s.textContent = im.textContent; document.head.appendChild(s);
      result.importMap = 'injected';
    } else result.importMap = 'static';
    for (const meta of coreDoc.querySelectorAll('head meta[name="viewport"]')) if (!document.querySelector('meta[name="viewport"]')) document.head.appendChild(document.importNode(meta, true));
    const sheets = [];
    for (const link of coreDoc.querySelectorAll('head link[rel="stylesheet"]')) sheets.push(loadStylesheet(new URL(link.getAttribute('href'), CORE_ROOT).href, { crossOrigin: link.crossOrigin }));
    for (const href of manifest.styles) sheets.push(loadStylesheet(new URL(href, pageDir).href));
    const skeleton = [...coreDoc.body.children].filter((el) => el.tagName !== 'SCRIPT');
    if (!skeleton.some((el) => el.id === 'viewport')) throw new Error('core index.html body has no #viewport (seam: app skeleton)');
    for (const el of skeleton) document.body.appendChild(document.importNode(el, true));
    await Promise.all(sheets);

    step('add-on entry');
    const entryUrl = new URL(manifest.entry, pageDir).href;
    const mod = await import(entryUrl);
    result.module = mod;
    const { createHost, loadCore } = await import(new URL('host.js', SDK_DIR).href);
    const core = await loadCore();
    const host = createHost(() => window.__proto, manifest, core);
    result.host = host;
    if (typeof mod.register === 'function') await mod.register(host);

    step('core boot');
    await import(new URL('src/main.js', CORE_ROOT).href);
    await waitFor(() => window.__proto);

    step('install');
    if (typeof mod.install === 'function') result.api = await mod.install(host);
    keepTitle(manifest);
    badge(manifest);
    step('ready');
    window.__addon = Object.freeze({ manifest, host, module: mod, api: result.api, storage: result.storage, importMap: result.importMap });
    document.documentElement.dataset.addonReady = 'true';
    return result;
  } catch (err) {
    showFailure(result.step, err);
    window.__addonError = { step: result.step, message: err?.message || String(err) };
    throw err;
  }
}

if (typeof document !== 'undefined' && !globalThis.__addonShellNoAuto) {
  boot().catch(() => { /* reported by showFailure */ });
}
