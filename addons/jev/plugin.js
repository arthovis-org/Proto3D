// plugin.js — install(proto): everything the add-on attaches to the running core through
// window.__proto. (1) isolation: the core's autosave, Start panel and first-run tour are inert on
// this page (isolate.js patched the prototypes before boot; here the instances are finished off)
// and nothing under proto3d.tabs.* / proto3d.autosave.* / proto3d.tour.v1 is written. (2) own
// persistence: the add-on world lives in localStorage `proto3d.jev.world.v1`, the chosen demo in
// `proto3d.jev.demo.v1`. (3) the Jev ▾ menu in the core menu bar, (4) the status pill, (5) the
// Smart Add bar and the movable tutorial, (6) window.__jev for tests.
import { buildExample } from '../../src/examples/index.js';
import { loadWorld } from '../../src/serialize.js';
import { ui } from '../../src/ai/ui-hooks.js';
import { vault } from '../../src/ai/vault.js';
import { fmtUSD } from '../../src/ai/pricing.js';
import { client } from './jev-client.js';
import { demos, DEFAULT, demoById, named } from './scenes/index.js';
import { SmartAdd } from './smart-add.js';
import { Tutorial } from './tutorial.js';
import { JEV_TYPES } from './components/index.js';
import { makeFramer } from './frame.js';

export const WORLD_KEY = 'proto3d.jev.world.v1';
export const DEMO_KEY = 'proto3d.jev.demo.v1';
const TITLE = 'Jev add-on — Proto3D';
const LIVE_URL = 'https://arthovis-org.github.io/Proto3D/addons/jev/';
const $ = (id) => document.getElementById(id);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } };

export function install(proto) {
  if (!proto) throw new Error('jev: window.__proto missing — boot.js must import ../../src/main.js first');
  const { world, engine, ws, history, selection, overlays, tabs, menubar, start, tour, hintBar, interaction } = proto;
  const toast = (t, ms) => overlays?.toast?.(t, ms);
  const extras = () => ({ camera: ws.camera, controls: ws.controls });
  // framing keeps the blocks out from under the add-on's own layers (tutorial card, Ask bar); both exist after step 3
  let smartAdd = null, tutorial = null;
  const frame = makeFramer(proto, () => [tutorial?.isOpen && tutorial.el.getBoundingClientRect(), smartAdd?.isOpen && smartAdd.el.getBoundingClientRect()].filter(Boolean));

  /* ---- 1. isolation, finished on the live instances ---- */
  tabs.autosaveOn = false; clearTimeout(tabs._t); tabs._t = 0; tabs._setStatus?.('off', { reason: 'addon' });
  start.hide?.('addon'); hintBar?.hide?.();
  document.title = TITLE;
  tabs.onChange(() => setTimeout(() => { document.title = TITLE; }, 0));

  /* ---- 2. scenes and persistence ---- */
  let current = demoById(lsGet(DEMO_KEY)) || demoById(DEFAULT);
  let saveT = 0;
  let building = false;   // no write while a demo is being built: the half-built world must never reach storage
  const saveNow = () => { clearTimeout(saveT); saveT = 0; if (building) return false; try { const doc = proto.serialize(); delete doc.wiring; lsSet(WORLD_KEY, JSON.stringify(doc)); return true; } catch (_) { return false; } };   // no `wiring`: restoring must not touch the core's wiring preference
  world.onChange((what) => { if (what === 'detach' || what === 'attach' || building) return; clearTimeout(saveT); saveT = setTimeout(saveNow, 800); });
  window.addEventListener('pagehide', () => { if (saveT) saveNow(); });
  function frameDemo(demo, n) {
    const f = demo.focus ? demo.focus(n).filter(Boolean) : [];
    if (f.length) frame(f, { instant: true, fill: 0.92 }); else proto.frameAll({ instant: true });
  }
  function loadDemo(id) {
    const demo = demoById(id) || demoById(DEFAULT);
    interaction?.cancel?.(); selection.clear(); history.clear();
    building = true;
    let n;
    try { n = buildExample(world, demo, extras()); engine.evaluate(); } finally { building = false; }
    current = demo; lsSet(DEMO_KEY, demo.id);
    tutorial?.setDemo(demo.id);   // first: the card's step (and so its height) is what the framing keeps clear of
    frameDemo(demo, n);
    if (tabs.active) tabs.rename?.(tabs.activeId, demo.label);
    saveNow();
    return n;
  }
  let restored = false;
  try {
    const doc = JSON.parse(lsGet(WORLD_KEY) || 'null');
    if (doc && Array.isArray(doc.nodes) && doc.nodes.length) {
      selection.clear(); history.clear();
      loadWorld(world, doc, extras()); engine.evaluate();
      if (!doc.camera) frameDemo(current, named(world, current));
      if (tabs.active) tabs.rename?.(tabs.activeId, current.label);
      restored = true;
    }
  } catch (e) { console.warn('jev: saved world ignored:', e.message); }

  /* ---- 3. Smart Add and the tutorial ---- */
  smartAdd = new SmartAdd(proto, { toast, frame });
  tutorial = new Tutorial({ proto, loadDemo, currentDemo: () => current.id, smartAdd, frame });
  if (!restored) loadDemo(current.id);
  // the core's tour and Start panel would write core storage or 404 on thumbnails: both open the tutorial here instead
  tour.start = () => tutorial.open();
  start.open = () => tutorial.open();

  /* ---- 4. the Jev ▾ menu (menus are data; the bar rebuilds from them) ---- */
  const jevMenu = { id: 'jev', label: 'Jev', items: () => [
    { sep: true, label: 'Demos' },
    ...demos.map((d) => ({ label: d.label, hint: d.description.length > 70 ? d.description.slice(0, 69) + '…' : d.description, radio: true, checked: current.id === d.id, run: () => { loadDemo(d.id); tutorial.open(); } })),
    { label: 'Reset demo', hint: 'rebuild the current scene', run: () => { loadDemo(current.id); toast(`${current.label} rebuilt`, 1400); } },
    { sep: true },
    { label: 'Tutorial', hint: 'the movable step-by-step card', checked: tutorial.isOpen, run: () => tutorial.toggle() },
    { label: 'Ask to add…', shortcut: 'Ctrl+J', hint: 'describe a component; Jev picks and links it', run: () => smartAdd.open() },
    { sep: true },
    { label: 'Use simulated Jev', hint: client.hasKey() ? 'the offline decider, no calls' : 'no key yet — always simulated', radio: true, checked: !client.isLive(), disabled: !client.hasKey(), run: () => { client.setForceSimulated(true); toast('Simulated Jev · no calls leave the browser', 1600); } },
    { label: 'Use live Jev', hint: client.hasKey() ? 'calls api.typesafe.ai with your key' : 'add a key in Connections… first', radio: true, checked: client.isLive(), disabled: !client.hasKey(), run: () => { client.setForceSimulated(false); toast('Live Jev · decisions go to api.typesafe.ai', 1600); } },
    { label: 'Connections…', hint: 'TypeSafe key and proxy', run: () => ui.openConnections('jev') },
    { sep: true },
    { label: 'About this add-on', run: () => openAbout() },
    { label: 'Open Proto3D core', hint: 'the main page, in a new tab', run: () => window.open('../../', '_blank', 'noopener') },
  ] };
  const at = menubar.menus.findIndex((m) => m.id === 'help');
  menubar.menus.splice(at < 0 ? menubar.menus.length : at, 0, jevMenu);
  menubar._build();   // private: the bar renders its titles once in the constructor

  /* ---- 5. status pill: Simulated / Live, decisions, latency, spend ---- */
  const pill = $('jev-status'); pill.hidden = false; pill.title = 'Jev status · click for the Jev menu';
  pill.addEventListener('click', () => menubar.open('jev'));
  function renderPill() {
    const live = client.isLive(), s = client.stats;
    const n = s.count ? ` · ${s.count} decision${s.count === 1 ? '' : 's'} · avg ${Math.round(client.avgLatency)} ms` : '';
    const spendText = live && s.cost ? ` · ${fmtUSD(s.cost)}` : '';
    pill.innerHTML = `<i class="${live ? 'live' : 'sim'}"></i><b>Jev:</b> ${live ? `Live (${s.lastModel && s.lastModel !== 'simulated' ? s.lastModel : 'jev-latest'})` : 'Simulated'}${n}${spendText}${s.lastError ? ' · <em>error</em>' : ''}`;
    pill.classList.toggle('live', live); pill.classList.toggle('err', !!s.lastError);
  }
  client.onChange(renderPill); vault.onChange(renderPill); renderPill();

  /* ---- 6. about ---- */
  function openAbout() {
    const bd = document.createElement('div'); bd.className = 'modal-backdrop jev-about';
    bd.innerHTML = `<div class="modal" style="width:min(560px,100%)"><header class="modal-head"><span class="modal-icon">${proto.icons.jev}</span><div><h2>Jev for Proto3D</h2><p>A decision layer for the node system: routing, gating, scoring, ranking and "ask to add", on TypeSafe AI's System One model.</p></div><button type="button" class="modal-close" aria-label="Close">${proto.icons.close}</button></header>
      <div class="modal-body"><p>Five components in the <b>Jev</b> category — Route by meaning, Yes / no check, Score on a rubric, Rank a list, Ask Jev — plus Smart Add (Ctrl+J). Nothing in the core changed: the add-on registers a provider and components before boot and installs against <code>window.__proto</code>. It keeps its own storage (<code>proto3d.jev.*</code>) and never writes the core's projects.</p>
      <p>Without a key every decision comes from a deterministic <b>simulated</b> decider (keyword overlap, softmax), clearly badged. With a key from <a href="https://console.typesafe.ai/keys" target="_blank" rel="noopener">console.typesafe.ai</a> in Connections the same nodes call <code>POST api.typesafe.ai/v1/systemone</code> at $0.042 per million input tokens.</p>
      <p><a href="${LIVE_URL}" target="_blank" rel="noopener">${LIVE_URL}</a> · <a href="https://docs.typesafe.ai/" target="_blank" rel="noopener">docs.typesafe.ai</a> · <a href="README.md" target="_blank" rel="noopener">README</a></p></div></div>`;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const close = () => { bd.remove(); window.removeEventListener('keydown', onKey, true); };   // however it closes, the key listener goes with it
    bd.querySelector('.modal-close').addEventListener('click', close);
    bd.addEventListener('pointerdown', (e) => { if (e.target === bd) close(); });
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(bd);
  }

  /* ---- 7. for tests and the console ---- */
  const api = {
    client, demos, tutorial, smartAdd, loadDemo, saveNow, JEV_TYPES,
    setSimulated: (v) => client.setForceSimulated(v),
    current: () => current.id,
    named: () => named(world, current),
    keys: { WORLD_KEY, DEMO_KEY },
  };
  window.__jev = api;
  return api;
}
