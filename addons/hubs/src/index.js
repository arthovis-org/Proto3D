// index.js — the add-on entry the SDK shell (and the tests) call:
//   register(host)  before the core boots: the three hub- node types and their icons
//   install(host)   after the core booted: the CSS3D live layer, the Hubs menu / panel section /
//                   flow bar, hooks (open a page → interact, generate → create nodes), the CTL OS
//                   demo on an empty page, and the api under window.__addon.api (tests use it)
// Only ../sdk/** and this directory are imported; the core is reached through `host`, plus the
// documented off-contract seams in live-layer.js / arrange.js / generate.js (window.__proto).
import { registerNodes, setHooks, isHubNode, HUB_TYPES, openPage } from './nodes.js';
import { generate } from './generate.js';
import { makeExamples } from './examples.js';
import { FLOWS, FLOW_IDS } from './flows.js';
import { setEmbedHeight, embedHeight, DEFAULT_EMBED_HEIGHT, EMBED_HEIGHT } from './sizing.js';

const DEFAULTS = Object.freeze({ budget: 8, live: true, flow: 'delivery', client: null, embedHeight: DEFAULT_EMBED_HEIGHT });
let registered = false;

export function register(host) {
  if (registered) return;
  registered = true;
  setEmbedHeight(host.storage.get('settings.v1', {})?.embedHeight);   // before the core restores an autosaved graph: cards build at the saved height
  registerNodes(host);
}

/**
 * @param {object} host  the SDK host
 * @param {object} opts  { sample: true } builds the CTL OS demo when the page is empty (browser only)
 */
export async function install(host, { sample = true } = {}) {
  if (!registered) register(host);
  const dom = typeof document !== 'undefined' && typeof window !== 'undefined' && !!window.__proto;
  const settings = { ...DEFAULTS, ...(host.storage.get('settings.v1', {}) || {}) };
  if (!FLOW_IDS.includes(settings.flow)) settings.flow = DEFAULTS.flow;
  settings.embedHeight = setEmbedHeight(settings.embedHeight);
  const examples = makeExamples(host);
  const resolve = (x) => (typeof x === 'string' ? host.world.nodes().find((n) => n.uid === x) || null : x || null);

  const api = {
    host, settings, examples, flows: FLOWS, HUB_TYPES, live: null, ui: null,
    saveSettings() { host.storage.set('settings.v1', { budget: settings.budget, live: settings.live, flow: settings.flow, client: settings.client, embedHeight: settings.embedHeight }); },
    /** The global embed height (world units): every hub-page without its own `height` re-bakes its body and face on the next frame. Not a history entry. */
    setEmbedHeight(h, { save = true } = {}) {
      settings.embedHeight = setEmbedHeight(h);
      for (const n of host.world.nodes()) if (n.typeId === 'hub-page') n.faceDirty = true;
      if (save) api.saveSettings();
      api.ui?.refresh();
      return settings.embedHeight;
    },
    embedHeight: () => embedHeight(), EMBED_HEIGHT,
    /** Load a demo scene by id (hub-cal-tenant-law, hub-petrock, hub-hoy, hub-dorum-lifestyle, hub-compare, hub-new-client) or client slug. */
    loadDemo(id) {
      const ex = examples.find((e) => e.id === id || e.client === id); if (!ex) return null;
      api.live?.reset();
      const named = host.examples.build(ex, { name: ex.label, frame: ex.id !== 'hub-compare' });
      settings.flow = ex.id === 'hub-compare' ? 'compare' : 'delivery'; settings.client = null; api.saveSettings();
      if (ex.id === 'hub-compare' && dom) import('./arrange.js').then(({ frameFrom }) => frameFrom(host, host.world.nodes().filter(isHubNode), { duration: 0 }));   // the stacked grid from its higher pose
      api.ui?.refresh();
      return named;
    },
    /** Frame every hub node for the current flow (stacked flows from a higher elevation). */
    async frame(flowId = settings.flow) { if (!dom) return null; const { frameFlow } = await import('./arrange.js'); return frameFlow(host, flowId, host.world.nodes().filter(isHubNode)); },
    /** Arrange the hub nodes (optionally one client) into a flow; undoable. */
    async arrange(flowId, opts = {}) {
      if (!dom) return null;
      const { arrangeFlow } = await import('./arrange.js');
      const res = arrangeFlow(host, flowId, { client: settings.client, ...opts });
      if (res) { settings.flow = flowId; api.saveSettings(); host.ui.toast(`${res.flow.label} flow · ${res.nodes.length} blocks · Ctrl+Z undoes`, 1800); api.ui?.refresh(); }
      return res;
    },
    generate(node) { const n = resolve(node); return n && n.typeId === 'hub-blueprint' ? generate(host, n) : null; },
    interact(node) { const n = resolve(node); return n ? openPage(n, 'api') : false; },
    leaveInteract() { return api.live ? api.live.leave() : false; },
    selectedPage() { return host.selection.nodes().find((n) => n.typeId === 'hub-page') || null; },
    selectedBlueprint() { return host.selection.nodes().find((n) => n.typeId === 'hub-blueprint') || null; },
    setBudget(n) { settings.budget = Math.max(0, Math.round(+n) || 0); api.live?.setBudget(settings.budget); api.saveSettings(); api.ui?.refresh(); return settings.budget; },
    setLive(on) { settings.live = !!on; api.live?.setEnabled(settings.live); api.saveSettings(); api.ui?.refresh(); return settings.live; },
    counts() {
      if (api.live) return api.live.counts();
      const pages = host.world.nodes().filter((n) => n.typeId === 'hub-page');
      return { pages: pages.length, eligible: pages.filter((n) => n.params.status === 'live' && n.params.live !== false).length, live: 0, loaded: 0, budget: settings.budget, enabled: settings.live, interactive: null };
    },
  };

  if (dom) {
    const { createLiveLayer } = await import('./live-layer.js');
    api.live = createLiveLayer(host, { budget: settings.budget, enabled: settings.live, onChange: () => api.ui?.refresh() });
    api.live.start();
    const { installUI } = await import('./ui.js');
    api.ui = installUI(host, api);
  }
  // browser behaviour behind the nodes: a page opens into interact mode, a blueprint generates real nodes
  setHooks({
    open: dom ? (inst) => api.live?.interact(inst) : null,
    generate: dom ? (inst) => generate(host, inst) : null,
  });

  /* ---- hooks: blueprints re-count their pages, the layer drops elements of gone nodes, the UI refreshes ---- */
  host.world.onChange((what) => {
    if (what === 'add-node' || what === 'remove-node' || what === 'clear' || what === 'load' || what === 'example' || what === 'param' || what === 'attach') {
      for (const n of host.world.nodes()) if (n.typeId === 'hub-blueprint') n.faceDirty = true;
    }
    if (what === 'clear' || what === 'load' || what === 'example' || what === 'detach' || what === 'attach') api.live?.reset();
    api.ui?.refresh();
  });
  host.engine.onError((node, e) => { if (isHubNode(node)) host.ui.toast(`${node.title}: ${e.message}`, 2400); });

  /* ---- a fresh page gets the CTL OS demo ---- */
  if (sample && dom && host.world.nodes().length === 0) api.loadDemo('hub-cal-tenant-law');

  if (typeof window !== 'undefined') window.__hubs = api;
  return api;
}

export { HUB_TYPES, FLOWS };
