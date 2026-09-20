// _template/addon.js — the smallest complete add-on. Two exports, both optional, both called by
// the SDK shell (and by tests through the fake host):
//
//   register(host)  runs BEFORE the core boots: register node types, icons, read settings.
//                   Only host.nodes / host.draw / host.theme / host.icons / host.storage /
//                   host.manifest are usable here (the rest throws "core not booted yet").
//   install(host)   runs AFTER the core booted: menus, panel sections, engine / world hooks.
//
// Import only from ../sdk/** and this directory — the drift guard test fails the build otherwise.
// Node ids MUST start with "<prefix>-" from addon.json ("tpl-" here); the host refuses others.

const ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v4l3 2"/></svg>';

/** Small per-add-on settings kept under proto3d.addon.template.* (JSON in, JSON out). */
const settings = (host) => ({ get: () => host.storage.get('settings.v1', { step: 1 }), set: (v) => host.storage.set('settings.v1', v) });

export function register(host) {
  host.icons.set('template', ICON);          // category icon for the Add rail
  host.icons.set('tpl-counter', ICON);       // node icon (panel header, menus)

  host.nodes.register({
    id: 'tpl-counter', category: 'template', label: 'Counter', icon: ICON, size: 'S',
    description: 'Counts the pulses it receives; the step comes from the add-on settings',
    inputs: [{ key: 'tick', label: 'tick', type: 'event' }, { key: 'reset', label: 'reset', type: 'event', optional: true }],
    outputs: [{ key: 'count', label: 'count', type: 'number' }, { key: 'changed', label: 'changed', type: 'event' }],
    params: [{ key: 'label', label: 'label', type: 'text', default: 'Pulses' }],
    onEvent(ctx, key) {
      if (key === 'reset') ctx.state.count = 0;
      if (key === 'tick') { ctx.state.count = (ctx.state.count || 0) + settings(host).get().step; ctx.emit('changed', ctx.state.count); }
    },
    evaluate({ state }) { return { count: state.count || 0 }; },
    footer: ({ params, state }) => `${params.label}: ${state.count || 0}`,
    face: {
      render(g, w, h, { params, state }) {
        const { clear, drawText } = host.draw; const { palette } = host.theme;
        clear(g, w, h);
        drawText(g, params.label, 16, 12, w - 32, 36, { size: 24, weight: 600, color: palette.faceDim, align: 'left' });
        drawText(g, String(state.count || 0), 16, 48, w - 32, h - 64, { size: 72, weight: 700, mono: true, color: palette.faceAccent });
      },
    },
  });
}

export function install(host) {
  const api = { runs: 0 };
  // a top-level menu; items are rebuilt every time the menu opens, so labels can be live
  host.ui.menu({ id: 'main', label: host.manifest.name, items: () => [
    { label: 'Pulse every counter', hint: 'fires the tick input of each tpl-counter in the graph', action: () => { api.runs += 1; for (const n of host.world.nodes()) if (n.typeId === 'tpl-counter') host.engine.trigger(n, 'tick', 'menu'); host.ui.toast(`Pulsed ${host.world.nodes().filter((n) => n.typeId === 'tpl-counter').length} counter(s)`); } },
    { separator: true },
    { label: `Step: ${settings(host).get().step}`, hint: 'cycles 1 → 2 → 5', action: () => { const s = settings(host).get(); s.step = { 1: 2, 2: 5 }[s.step] || 1; settings(host).set(s); host.ui.toast(`Step ${s.step}`); } },
  ] });
  // a section in the properties panel that survives every rebuild
  host.ui.panelSection(host.manifest.name, (body, h) => {
    body.appendChild(h('div', 'tpl-hint', `SDK ${host.version} · nodes: ${host.nodes.ids().join(', ')} · storage: ${host.storage.namespace}*`));
  }, { id: 'tpl-section' });
  // hooks: release resources of removed nodes, react to engine errors of your own nodes
  host.world.onChange((what) => { if (what === 'remove-node') api.lastRemoveAt = Date.now(); });
  host.engine.onError((node, e) => { if (host.nodes.owns(node.typeId)) host.ui.toast(`${node.title}: ${e.message}`, 2400); });
  return api;
}
