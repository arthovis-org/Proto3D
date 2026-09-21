// sdk/testing/fake-host.js — a Node-only stand-in for `createHost` with the same surface. No DOM,
// no Three, no core boot: node definitions go to a registry (the real core registry by default,
// so the headless engine can run them), menus / panel sections / toasts / error handlers are
// recorded for assertions, drawing helpers are no-ops, storage is an in-memory namespaced map.
// Give it a headless world (`createHeadlessWorld()`) and `host.engine` / `host.world` bind to it.
import { validateManifest, nodePrefix, ownsNodeId, storageNamespace } from '../manifest.js';
import { SDK_VERSION, HostError, readPosition } from '../host.js';
import { registry as coreRegistry } from '../../../src/core/registry.js';

/** A palette with the fields faces read, so face renderers can be exercised against a fake canvas. */
export const FAKE_PALETTE = Object.freeze({ faceBg: '#111', faceCard: '#222', faceText: '#eee', faceDim: '#999', faceLine: '#333', faceAccent: '#4f8cff', faceGood: '#3c9', faceWarn: '#fb4', faceBad: '#f45' });

/** A 2D-context double that records calls (enough for `def.face.render` smoke tests). */
export function fakeCanvasContext() {
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); };
  const g = { calls, fillStyle: '', strokeStyle: '', font: '', textAlign: 'left', textBaseline: 'top', lineWidth: 1 };
  for (const k of ['fillRect', 'clearRect', 'fill', 'stroke', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'quadraticCurveTo', 'bezierCurveTo', 'rect', 'save', 'restore', 'translate', 'scale', 'rotate', 'clip', 'fillText', 'strokeText', 'setLineDash']) g[k] = rec(k);
  g.measureText = (t) => ({ width: String(t).length * 7 });
  return g;
}

export function createFakeHost(manifest, { registry = coreRegistry, headless = null, storage = new Map(), proto = null } = {}) {
  const m = validateManifest(manifest);
  const prefix = nodePrefix(m);
  const ns = storageNamespace(m);
  const rec = { defs: [], menus: [], sections: [], toasts: [], errorHandlers: [], worldListeners: [], icons: {}, examples: [], stylesheets: [], warnings: [], layouts: [], commands: [], fieldOpens: [] };
  const ownIds = new Set();
  const world = headless?.world || null;
  const engine = headless?.engine || null;
  const need = (what, v) => { if (!v) throw new HostError(`fake host: ${what} needs a headless world — createFakeHost(manifest, { headless: createHeadlessWorld() })`); return v; };

  const host = Object.freeze({
    version: SDK_VERSION, manifest: m, booted: true, _rec: rec,
    nodes: Object.freeze({
      register(def) {
        if (!ownsNodeId(m, def?.id)) throw new HostError(`nodes.register: id "${def?.id}" must start with "${prefix}"`);
        if (registry.has(def.id)) throw new HostError(`nodes.register: "${def.id}" is already registered`);
        const d = registry.register(def); rec.defs.push(d); ownIds.add(d.id); return d;
      },
      get: (id) => registry.get(id), has: (id) => registry.has(id), ids: () => [...ownIds], owns: (id) => ownsNodeId(m, id), onRegister: (cb) => registry.onRegister(cb),
      unregisterAll() { throw new HostError('nodes.unregisterAll: not supported by the core registry'); },
    }),
    engine: Object.freeze({
      onError(cb) { const e = need('engine.onError', engine); const prev = e.onError; const mine = (n, err) => { try { prev?.(n, err); } finally { cb(n, err); } }; e.onError = mine; rec.errorHandlers.push(cb); return () => { if (e.onError === mine) e.onError = prev; }; },
      emit: (i, k, p) => need('engine.emit', engine).emit(i, k, p),
      trigger: (i, k, p) => need('engine.trigger', engine).trigger(i, k, p),
      order: () => need('engine.order', engine).order(),
      evaluate: () => need('engine.evaluate', engine).evaluate(),
      get time() { return need('engine.time', engine).time; },
    }),
    world: Object.freeze({
      onChange(cb) { const un = need('world.onChange', world).onChange(cb); rec.worldListeners.push(cb); return un; },
      nodes: () => [...need('world.nodes', world).nodes],
      connections: () => [...need('world.connections', world).connections],
      get: () => need('world.get', world),
    }),
    ui: Object.freeze({
      menu(spec) { if (!spec?.id || !spec?.label || typeof spec.items !== 'function') throw new HostError('ui.menu({ id, label, items })'); const entry = { id: `${m.id}:${spec.id}`, label: spec.label, items: spec.items }; rec.menus.push(entry); return { id: entry.id, remove() { rec.menus = rec.menus.filter((x) => x !== entry); } }; },
      panelSection(title, build, opts = {}) { const body = fakeElement('div'); const details = fakeElement('details'); details.open = opts.open !== false; details.title = title; details.body = body; rec.sections.push({ title, details, body }); build?.(body, fakeElement); return details; },
      toast(text, ms) { rec.toasts.push({ text, ms }); },
      togglePanel() {}, frameBlocks() {}, hideStart() {}, stylesheet(href) { rec.stylesheets.push(href); },
      wiring(on) { if (on !== undefined) rec.wiring = !!on; return !!rec.wiring; },
      plan(on) { if (on !== undefined) rec.plan = !!on; return !!rec.plan; },
    }),
    selection: Object.freeze({ clear() {}, set() {}, nodes: () => [] }),
    draw: Object.freeze({
      clear() {}, drawText() { return { px: 12, lines: 1 }; }, roundRect() {}, font: (px, weight = 500, mono = false) => `${weight} ${px}px ${mono ? 'monospace' : 'sans-serif'}`,
      // the rest of the face design language (faces.js), as no-ops that return what callers measure with;
      // beginFields is the real thing (a few lines) so tests can read `instance._fields` after a render
      beginFields(instance) { const list = []; if (instance) instance._fields = list; const cur = instance?._editing || null; return { list, add(spec) { spec.editing = cur === spec.id; list.push(spec); return spec; }, editing: (id) => cur === id }; },
      drawCaps: (g, text) => String(text).length * 7, drawDivider() {}, drawTile() {}, drawChip: (g, text) => String(text).length * 7 + 18, drawBar() {}, drawStat() {}, drawAvatar() {},
      fitLine: (g, text) => String(text ?? ''), wrapLines: (g, text) => String(text).split('\n'), tabular() {}, jsonLines: (v) => [JSON.stringify(v)],
      PAD: 24, GRID: 8, RADIUS: 18,
    }),
    theme: Object.freeze({ palette: { ...FAKE_PALETTE }, current: () => 'dark', onChange: () => () => {} }),
    icons: Object.freeze({ set(name, svg) { rec.icons[name] = String(svg); return svg; }, get: (name) => rec.icons[name] || '', has: (name) => name in rec.icons }),
    examples: Object.freeze({ build(example) { rec.examples.push(example); return headless ? headless.buildExample(example) : null; } }),
    storage: Object.freeze({
      namespace: ns,
      get(key, fallback = null) { const v = storage.get(ns + key); if (v === undefined) return fallback; try { return JSON.parse(v); } catch (_) { return fallback; } },
      set(key, value) { storage.set(ns + key, JSON.stringify(value)); return true; },
      remove(key) { storage.delete(ns + key); return true; },
      keys() { return [...storage.keys()].filter((k) => k.startsWith(ns)).map((k) => k.slice(ns.length)); },
      /** Test-only: the raw backing map. */
      raw: storage,
    }),
    commands: Object.freeze({
      /** Direct write in Node (no history); recorded. */
      setParam(block, key, value, label = null) { block.params[key] = value; block.faceDirty = true; rec.commands.push({ kind: 'setParam', uid: block.uid, key, value, label }); world?.changed('param'); return { label: label || `Set ${key}` }; },
      setTitle(block, title) { block.title = String(title ?? ''); rec.commands.push({ kind: 'setTitle', uid: block.uid, title }); return { label: 'Rename' }; },
      execute(cmd) { cmd.do?.(); rec.commands.push({ kind: 'execute', label: cmd.label }); return cmd; },
    }),
    fields: Object.freeze({
      /** No editor in Node: records the request and marks the block as editing that field. */
      open(block, field) { const f = typeof field === 'string' ? (block._fields || []).find((x) => x.id === field) : field; if (!f) return false; block._editing = f.id; rec.fieldOpens.push({ uid: block.uid, id: f.id, kind: f.kind }); return true; },
      editing: () => ({ block: null, open: null }), leave() {},
    }),
    layout: Object.freeze({
      graph() { const w = need('layout.graph', world); return { nodes: w.nodes.map((n) => ({ uid: n.uid, type: n.typeId, size: n.def?.size || 'S', w: n.width || 0, d: n.height || 0, h: n.height || 0, x: n.position?.x ?? 0, y: n.position?.y ?? 0, z: n.position?.z ?? 0 })), connections: w.connections.map((c) => ({ from: c.from.owner.uid, to: c.to.owner.uid, fromKey: c.from.key, toKey: c.to.key })) }; },
      /** Records the call and writes `position` on the headless nodes (no history in Node): [x, z] keeps y, [x, y, z] / { x, y, z } sets it. */
      apply(positions, opts = {}) {
        const w = need('layout.apply', world); const entries = positions instanceof Map ? [...positions.entries()] : Object.entries(positions || {});
        let moved = 0;
        for (const [uid, pos] of entries) { const n = w.nodes.find((x) => x.uid === uid); if (!n) continue; const { x, y, z } = readPosition(pos); if (!Number.isFinite(x) || !Number.isFinite(z)) continue; n.position = { x, y: Number.isFinite(y) ? y : (n.position?.y ?? 0), z }; moved += 1; }
        rec.layouts.push({ positions: entries, opts, moved }); if (moved) w.changed('move');
        return moved;
      },
    }),
    persist: Object.freeze({ serialize: () => ({ app: 'proto3d', nodes: world ? world.nodes.map((n) => n.serialize()) : [] }), load: () => ({ skipped: [] }) }),
  });
  void proto;
  return host;
}

/** A tiny DOM-less element: enough for add-on panel builders that append children and set text. */
export function fakeElement(tag, cls, text) {
  const el = { tag, className: cls || '', textContent: text ?? '', children: [], attributes: {}, dataset: {}, style: {}, listeners: {}, hidden: false,
    appendChild(c) { el.children.push(c); c.parent = el; return c; }, append(...cs) { cs.forEach((c) => el.appendChild(c)); }, insertBefore(c) { el.children.unshift(c); return c; },
    addEventListener(t, fn) { (el.listeners[t] ||= []).push(fn); }, removeEventListener() {}, setAttribute(k, v) { el.attributes[k] = v; }, querySelector() { return null; }, querySelectorAll() { return []; },
    get innerHTML() { return el._html || ''; }, set innerHTML(v) { el._html = v; el.children = []; }, classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } }, remove() {}, scrollIntoView() {}, focus() {}, blur() {},
  };
  return el;
}
