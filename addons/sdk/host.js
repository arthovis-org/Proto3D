// sdk/host.js — the versioned host API an add-on programs against. This is the ONLY file in the
// add-on system that knows core internals: `window.__proto` (src/main.js exposes it after boot)
// plus a handful of core modules loaded by `loadCore()` (registry, icons, theme palette, face
// drawing helpers, the example builder). Everything is wrapped, namespaced and defensive: when a
// core seam has moved, the add-on gets an Error naming the seam and the SDK version instead of a
// random TypeError deep inside its own code. The SDK contract test (test/contract.test.js) checks
// the same seams against the core sources, so core drift fails there first, with the same names.
//
//   const core = await loadCore();                     // browser only (needs the import map)
//   const host = createHost(() => window.__proto, manifest, core);
//   addon.register(host);   // before core boots: host.nodes / draw / theme / icons / storage
//   addon.install(host);    // after  core boots: everything else
//
// `proto` may be the __proto object or a getter returning it, so one frozen host serves both
// phases; a member that needs the booted core throws `HostError('core not booted yet …')` early.
import { SDK_VERSION, validateManifest, nodePrefix, ownsNodeId, storageNamespace } from './manifest.js';

export { SDK_VERSION };

export class HostError extends Error {
  constructor(message, seam = null) { super(`[addon-sdk v${SDK_VERSION}] ${message}`); this.name = 'HostError'; this.seam = seam; }
}

/**
 * Load the core modules the host wraps. Dynamic imports so this module itself can be imported in
 * Node (the SDK's own tests inject a fake `core`); in the browser the import map must be in place.
 */
export async function loadCore() {
  const [registryMod, iconsMod, themeMod, facesMod, examplesMod] = await Promise.all([
    import('../../src/core/registry.js'),
    import('../../src/icons.js'),
    import('../../src/theme.js'),
    import('../../src/faces.js'),
    import('../../src/examples/index.js'),
  ]);
  return {
    registry: registryMod.registry,
    icons: iconsMod.icons,
    palette: themeMod.palette,
    getTheme: themeMod.getTheme,
    onThemeChange: themeMod.onThemeChange,
    faces: {
      clear: facesMod.clear, drawText: facesMod.drawText, roundRect: facesMod.roundRect, font: facesMod.font,
      // additive (SDK 1.1): the rest of the face design language, so add-on faces read like core faces
      beginFields: facesMod.beginFields, drawCaps: facesMod.drawCaps, drawDivider: facesMod.drawDivider, drawTile: facesMod.drawTile, drawChip: facesMod.drawChip,
      drawBar: facesMod.drawBar, drawStat: facesMod.drawStat, drawAvatar: facesMod.drawAvatar, fitLine: facesMod.fitLine, wrapLines: facesMod.wrapLines, tabular: facesMod.tabular, jsonLines: facesMod.jsonLines,
      PAD: facesMod.PAD, GRID: facesMod.GRID, RADIUS: facesMod.RADIUS,
    },
    buildExample: examplesMod.buildExample,
  };
}

/** Every core binding `createHost` needs and its expected type: checked up front, named in errors. */
const CORE_SHAPE = {
  'registry.register': 'function', 'registry.get': 'function', 'registry.has': 'function', 'registry.ids': 'function', 'registry.onRegister': 'function',
  icons: 'object', palette: 'object', getTheme: 'function', onThemeChange: 'function',
  'faces.clear': 'function', 'faces.drawText': 'function', 'faces.roundRect': 'function', 'faces.font': 'function',
  buildExample: 'function',
};
/** Members of window.__proto the host relies on, checked lazily when first used. */
const PROTO_SHAPE = {
  world: 'object', engine: 'object', ws: 'object', history: 'object', selection: 'object', overlays: 'object', menubar: 'object', tabs: 'object', start: 'object',
  togglePanel: 'function', serialize: 'function', load: 'function',
  'engine.emit': 'function', 'engine.trigger': 'function', 'engine.order': 'function', 'engine.evaluate': 'function',
  'world.onChange': 'function', 'overlays.toast': 'function', 'ws.frameBlocks': 'function',
  'menubar.menus': 'object', 'menubar._build': 'function', 'tabs.replaceActive': 'function', 'start.hide': 'function',
  'selection.clear': 'function', 'selection.set': 'function', 'history.clear': 'function',
};

/** Draw helpers the host passes through when faces.js exports them (checked lazily: a missing one throws a named HostError when called). */
const OPTIONAL_DRAW = ['beginFields', 'drawCaps', 'drawDivider', 'drawTile', 'drawChip', 'drawBar', 'drawStat', 'drawAvatar', 'fitLine', 'wrapLines', 'tabular', 'jsonLines'];

const pick = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function checkShape(obj, shape, what) {
  for (const [path, type] of Object.entries(shape)) {
    const v = pick(obj, path);
    const ok = type === 'object' ? v !== null && (typeof v === 'object' || typeof v === 'function') : typeof v === type;
    if (!ok) throw new HostError(`core seam missing: ${what}.${path} (expected ${type}, got ${v === null ? 'null' : typeof v}). The core moved under the SDK; update addons/sdk/host.js and the contract test.`, `${what}.${path}`);
  }
}

/**
 * Build the frozen host for one add-on.
 * @param {object|Function} proto  window.__proto, or a getter returning it (undefined until the core booted)
 * @param {object} manifest        the add-on's validated (or raw) addon.json
 * @param {object} core            result of loadCore() (or a test double with the same shape)
 */
export function createHost(proto, manifest, core) {
  const m = validateManifest(manifest);
  if (m.sdk !== SDK_VERSION) throw new HostError(`add-on "${m.id}" targets SDK ${m.sdk}; this host implements SDK ${SDK_VERSION}`);
  if (!core) throw new HostError('createHost(proto, manifest, core): core bindings missing — pass the result of loadCore()');
  checkShape(core, CORE_SHAPE, 'core');
  const getProto = typeof proto === 'function' ? proto : () => proto;
  let checked = false;
  /** The booted core, or a clear error while it is not there yet. */
  const P = (member = 'this call') => {
    const p = getProto();
    if (!p) throw new HostError(`core not booted yet: ${member} needs window.__proto; use register(host) only for nodes / draw / theme / icons / storage`, 'window.__proto');
    if (!checked) { checkShape(p, PROTO_SHAPE, 'window.__proto'); checked = true; }
    return p;
  };
  const prefix = nodePrefix(m);
  const ownIds = new Set();
  const warnOnce = (() => { const seen = new Set(); return (k, msg) => { if (seen.has(k)) return; seen.add(k); try { console.warn(`[addon-sdk:${m.id}] ${msg}`); } catch (_) { /* no console */ } }; })();

  /* ---------------- nodes ---------------- */
  const nodes = Object.freeze({
    /** Register a component definition; its id must start with "<prefix>-". Returns the frozen definition. */
    register(def) {
      if (!def || typeof def !== 'object') throw new HostError('nodes.register(def): def must be an object');
      if (!ownsNodeId(m, def.id)) throw new HostError(`nodes.register: id "${def.id}" must start with "${prefix}" (manifest.prefix of "${m.id}")`);
      if (core.registry.has(def.id)) throw new HostError(`nodes.register: "${def.id}" is already registered (registry.unregister does not exist; reload the page — see "Proposed core seams" in addons/README.md)`);
      const d = core.registry.register(def);
      ownIds.add(d.id);
      return d;
    },
    get: (id) => core.registry.get(id),
    has: (id) => core.registry.has(id),
    /** Ids this host registered (not the whole registry). */
    ids: () => [...ownIds],
    owns: (id) => ownsNodeId(m, id),
    /** Fires for every registration in the registry (core and add-ons); returns unsubscribe. */
    onRegister: (cb) => core.registry.onRegister(cb),
    /** The registry has no remove: definitions stay for the page's life. Kept as a named, explained failure. */
    unregisterAll() { throw new HostError('nodes.unregisterAll: the core registry cannot remove definitions (proposed seam: registry.unregister(id), see addons/README.md); tests get a fresh registry per process instead'); },
  });

  /* ---------------- engine ---------------- */
  const engine = Object.freeze({
    /** Chain onto engine.onError without clobbering another handler. cb(instance, error). Returns unsubscribe. */
    onError(cb) {
      const e = P('engine.onError').engine;
      const prev = e.onError;
      const mine = (node, err) => { try { prev?.(node, err); } finally { cb(node, err); } };
      e.onError = mine;
      return () => { if (e.onError === mine) e.onError = prev; };
    },
    emit: (instance, key, payload) => P('engine.emit').engine.emit(instance, key, payload),
    trigger: (instance, key, payload) => P('engine.trigger').engine.trigger(instance, key, payload),
    order: () => P('engine.order').engine.order(),
    evaluate: () => P('engine.evaluate').engine.evaluate(),
    get time() { return P('engine.time').engine.time; },
  });

  /* ---------------- world ---------------- */
  const world = Object.freeze({
    /** cb(what, world) for add-node | remove-node | connect | disconnect | clear | load | example | param | … Returns unsubscribe. */
    onChange: (cb) => P('world.onChange').world.onChange(cb),
    nodes: () => [...P('world.nodes').world.nodes],
    connections: () => [...P('world.connections').world.connections],
    /** Escape hatch: the raw World. Logged once so its use is visible in the console. */
    get() { warnOnce('world.get', 'host.world.get() hands out the raw World; prefer the wrapped API so core changes surface in the SDK contract test'); return P('world.get').world; },
  });

  /* ---------------- ui ---------------- */
  const ui = Object.freeze({
    /**
     * Add a top-level menu to the menu bar. `items()` returns [{ label, run|action, hint?, shortcut?, disabled?, checked?, items? } | { sep: true } | { separator: true }].
     * The MenuBar is declarative (a `menus` array rebuilt by `_build()`), so the menu survives re-renders and shows up in the command palette too.
     */
    menu({ id, label, items }) {
      if (!id || !label || typeof items !== 'function') throw new HostError('ui.menu({ id, label, items }): id, label and an items() function are required');
      const mb = P('ui.menu').menubar;
      const menuId = `${m.id}:${id}`;
      const adapt = (list) => list.map((it) => (it.sep || it.separator ? { sep: true, label: it.label } : { ...it, run: it.run || it.action, items: typeof it.items === 'function' ? () => adapt(it.items()) : Array.isArray(it.items) ? adapt(it.items) : undefined }));
      const entry = { id: menuId, label, items: () => adapt(items() || []), addon: m.id };
      mb.menus = mb.menus.filter((x) => x.id !== menuId).concat(entry);
      mb._build();
      return { id: menuId, remove() { mb.menus = mb.menus.filter((x) => x !== entry); mb._build(); } };
    },
    /**
     * A collapsible section in the properties panel that survives every panel rebuild: inserted into
     * <aside id="panel"> outside #panel-body (panel.build() clears only #panel-body). build(body, h) fills it.
     */
    panelSection(title, build, { open = true, id = null, before = 'help' } = {}) {
      P('ui.panelSection');
      const panel = document.getElementById('panel');
      if (!panel) throw new HostError('ui.panelSection: <aside id="panel"> not found in the page', '#panel');
      const details = document.createElement('details'); details.className = `sec addon-sec ${m.id}-sec`; details.open = !!open; if (id) details.id = id;
      details.dataset.addon = m.id;
      const summary = document.createElement('summary'); summary.textContent = title; details.appendChild(summary);
      const body = document.createElement('div'); body.className = 'sec-body'; details.appendChild(body);
      const anchor = before ? panel.querySelector(`#${before}`) : null;
      if (anchor && anchor.parentElement === panel) panel.insertBefore(details, anchor); else panel.appendChild(details);
      build?.(body, h);
      return details;
    },
    toast: (text, ms) => P('ui.toast').overlays.toast(text, ms),
    togglePanel: (force) => P('ui.togglePanel').togglePanel(force),
    /** Frame blocks in the viewport (instant or animated), keeping the Add rail's width out of the framing. */
    frameBlocks(blocks, opts = {}) { const p = P('ui.frameBlocks'); return p.ws.frameBlocks(blocks, { insetLeft: p.leftBar?.isOpen ? 300 : 0, ...opts }); },
    hideStart: () => P('ui.hideStart').start.hide('addon'),
    /** Add a stylesheet to the page. Pass an absolute URL (e.g. new URL('./x.css', import.meta.url).href): the shell sets <base> to the core root, so a page-relative href would resolve there, not in the add-on directory. */
    stylesheet(href) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); return l; },
  });
  const selection = Object.freeze({
    clear: () => P('selection.clear').selection.clear(),
    set: (items) => P('selection.set').selection.set(items),
    nodes: () => [...(P('selection.nodes').selection.nodes || [])],
  });

  /* ---------------- drawing / theme / icons ---------------- */
  /**
   * Face drawing helpers (faces.js): the four originals plus, when the core provides them,
   * beginFields / drawCaps / drawDivider / drawTile / drawChip / drawBar / drawStat / drawAvatar /
   * fitLine / wrapLines / tabular / jsonLines and the PAD / GRID / RADIUS constants. A helper the
   * core lacks is a HostError naming it, not an undefined call.
   */
  const draw = Object.freeze({ ...core.faces, ...Object.fromEntries(OPTIONAL_DRAW.filter((k) => !(k in core.faces)).map((k) => [k, () => { throw new HostError(`core seam missing: faces.${k} (optional draw helper) — this core does not export it`, `faces.${k}`); }])) });
  const theme = Object.freeze({
    /** The live palette object (mutated in place on theme change — read fields at draw time). */
    palette: core.palette,
    current: () => core.getTheme(),
    onChange: (cb) => core.onThemeChange(cb),
  });
  const icons = Object.freeze({
    /** Register an SVG icon under `name` (a node id, a category id). Core icons cannot be replaced. */
    set(name, svg) {
      if (typeof name !== 'string' || !name) throw new HostError('icons.set(name, svg): name required');
      if (name in core.icons && !ownIcons.has(name)) throw new HostError(`icons.set: "${name}" is a core icon; add-ons may only add icons (try "${prefix}${name}")`);
      core.icons[name] = String(svg); ownIcons.add(name); return svg;
    },
    get: (name) => core.icons[name] || core.icons.node || '',
    has: (name) => name in core.icons,
  });
  const ownIcons = new Set();

  /* ---------------- examples ---------------- */
  const examples = Object.freeze({
    /**
     * Build an example graph ({ id, label, build({ add, connect, group }), camera?, focus? }) into the
     * active tab through the tabs manager (so autosave and the tab name follow), then frame it.
     */
    build(example, { name = example?.label || m.name, frame = true } = {}) {
      const p = P('examples.build');
      let named = null;
      const fill = () => { named = core.buildExample(p.world, example, { camera: p.ws.camera, controls: p.ws.controls }); p.engine.evaluate(); };
      const tab = p.tabs.replaceActive(fill, { name });
      if (!tab) { p.selection.clear(); p.history.clear(); fill(); }
      p.start.hide('addon');
      if (frame) { const focus = example.focus ? example.focus(named || {}).filter(Boolean) : []; if (focus.length) ui.frameBlocks(focus, { instant: true, fill: 0.72 }); else p.frameAll?.({ instant: true }); }
      return named;
    },
  });

  /* ---------------- storage ---------------- */
  const ns = storageNamespace(m);
  const backing = () => { try { return globalThis.localStorage || null; } catch (_) { return null; } };
  const storage = Object.freeze({
    namespace: ns,
    /** JSON value under the add-on's namespace, or `fallback` when missing / unparsable / storage blocked. */
    get(key, fallback = null) { const s = backing(); if (!s) return fallback; try { const raw = s.getItem(ns + key); return raw === null ? fallback : JSON.parse(raw); } catch (_) { return fallback; } },
    set(key, value) { const s = backing(); if (!s) return false; try { s.setItem(ns + key, JSON.stringify(value)); return true; } catch (_) { return false; } },
    remove(key) { const s = backing(); if (!s) return false; try { s.removeItem(ns + key); return true; } catch (_) { return false; } },
    keys() { const s = backing(); if (!s) return []; const out = []; try { for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.startsWith(ns)) out.push(k.slice(ns.length)); } } catch (_) { /* blocked */ } return out; },
  });

  /* ---------------- persistence ---------------- */
  const persist = Object.freeze({
    serialize: () => P('persist.serialize').serialize(),
    load: (doc) => P('persist.load').load(doc),
  });

  return Object.freeze({
    version: SDK_VERSION, manifest: m, nodes, engine, world, ui, selection, draw, theme, icons, examples, storage, persist,
    /** True once window.__proto exists (install phase). */
    get booted() { return !!getProto(); },
  });
}

/** Tiny element helper handed to panelSection builders: h(tag, className?, text?). */
export function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
