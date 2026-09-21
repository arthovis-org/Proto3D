// sdk/testing/headless-engine.js — run add-on node definitions on the REAL core Engine in Node.
// `src/core/engine.js` imports only `core/types.js`, so it loads without a DOM or Three. The
// World and Block3D classes do need Three (scene objects), so this file provides the minimal
// stand-ins the engine reads: a world with `nodes` / `connections` / `onChange`, nodes with
// `def`, `inputs` / `outputs` port arrays (key, type, multi, owner, value, pulse…), `params`,
// `state`, `enabled`, `rt`, `getPort(key, dir)`, `setDerivedState(s)`, `afterEvaluate(ctx, t)`
// (which also evaluates `def.footer` the way Block3D does), and connections with `from` / `to`
// / `valid` / `value` / `setDerivedState`. Nothing here re-implements evaluation: ordering,
// pulses, coercion and error handling are the core's.
import { Engine } from '../../../src/core/engine.js';
import { registry as coreRegistry } from '../../../src/core/registry.js';
import { defaultParams } from '../../../src/core/component.js';

let uidSeq = 0;

class HeadlessPort {
  constructor(owner, spec) {
    Object.assign(this, { key: spec.key, label: spec.label, type: spec.type, subtype: spec.subtype || null, dir: spec.dir, multi: !!spec.multi, optional: !!spec.optional, loose: !!spec.loose });
    this.owner = owner; this.value = undefined; this.pulse = null; this.changedAt = undefined; this.lastPulseAt = undefined; this.pulses = 0; this.changes = 0; this.rate = 0;
  }
}

export class HeadlessNode {
  constructor(def, { title, params, state, uid, enabled = true } = {}) {
    this.def = def; this.typeId = def.id; this.kind = def.device ? 'device' : 'node';
    this.uid = uid || `h${++uidSeq}`; this.title = title || def.label;
    this.params = { ...defaultParams(def), ...(params || {}) };
    this.state = state || {};
    this.enabled = enabled; this.rt = {}; this.derivedState = 'idle'; this.visible = true; this.group = null; this.world = null;
    this.position = { x: 0, y: 0, z: 0 }; this.faceDirty = false;   // what layout code and faces touch on a Block3D
    this.inputs = def.inputs.map((p) => new HeadlessPort(this, p));
    this.outputs = def.outputs.map((p) => new HeadlessPort(this, p));
    this.ports = [...this.inputs, ...this.outputs];
    this.footerText = ''; this.states = [];
    def.onCreate?.(this);
  }
  getPort(key, dir) { return (dir === 'in' ? this.inputs : dir === 'out' ? this.outputs : this.ports).find((p) => p.key === key) || null; }
  setDerivedState(s) { if (this.derivedState !== s) this.states.push(s); this.derivedState = s; }
  emit(key, payload) { return this.world?.engine ? this.world.engine.emit(this, key, payload) : false; }
  /** What Block3D does after each evaluation, minus the canvas: footer text from def.footer. */
  afterEvaluate(ctx) {
    if (this.def.footer) { try { this.footerText = this.def.footer({ ...ctx, outputs: this.rt.outputs || {}, inputs: ctx?.inputs || {}, params: this.params, state: this.state, instance: this }); } catch (e) { this.footerText = `footer error: ${e.message}`; } }
  }
  dispose() { this.def.onDestroy?.(this); }
  serialize() { return { uid: this.uid, type: this.typeId, title: this.title, params: JSON.parse(JSON.stringify(this.params)), state: JSON.parse(JSON.stringify(this.state)), enabled: this.enabled }; }
  get out() { return Object.fromEntries(this.outputs.map((p) => [p.key, p.value])); }
}

class HeadlessConnection {
  constructor(from, to) { this.from = from; this.to = to; this.kind = 'connection'; this.valid = true; this.value = undefined; this.derivedState = 'idle'; this.uid = `c${++uidSeq}`; }
  setDerivedState(s) { this.derivedState = s; }
  get type() { return this.from.type; }
}

/**
 * A world + engine pair. `registry` defaults to the real core registry (definitions registered
 * through a fake host land there when the fake host is created with the same registry).
 */
export function createHeadlessWorld({ registry = coreRegistry, toasts = [] } = {}) {
  const listeners = new Set();
  const world = {
    nodes: [], connections: [], groups: [], engine: null, version: 0, named: {},
    overlays: { toast(text, ms) { toasts.push({ text, ms }); }, setEmptyHint() {} },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    changed(what = 'change') { world.version += 1; listeners.forEach((cb) => cb(what, world)); },
    nodeByUid(uid) { return world.nodes.find((n) => n.uid === uid) || null; },
    connectionsOfNode(node) { return world.connections.filter((c) => c.from.owner === node || c.to.owner === node); },
    clear() { const ns = world.nodes.slice(); world.nodes = []; world.connections = []; world.groups = []; ns.forEach((n) => n.dispose()); world.changed('clear'); },
  };
  const engine = new Engine(world);
  const settle = () => new Promise((r) => setImmediate(r));

  const api = {
    world, engine, toasts, registry,
    /** Add a node of a registered type. */
    add(typeId, params = {}, opts = {}) {
      const def = typeof typeId === 'string' ? registry.get(typeId) : typeId;
      if (!def) throw new Error(`headless: unknown component "${typeId}" (registered: ${registry.ids().join(', ')})`);
      const n = new HeadlessNode(def, { ...opts, params });
      n.world = world; world.nodes.push(n); world.changed('add-node');
      return n;
    },
    remove(node) {
      const conns = world.connectionsOfNode(node); conns.forEach((c) => api.disconnect(c));
      world.nodes = world.nodes.filter((n) => n !== node); world.changed('remove-node');
      return { node, connections: conns };
    },
    connect(a, outKey, b, inKey) {
      const from = a.getPort(outKey, 'out'), to = b.getPort(inKey, 'in');
      if (!from || !to) throw new Error(`headless: no port ${outKey} → ${inKey} between ${a.typeId} and ${b.typeId}`);
      const existing = world.connections.find((c) => c.from === from && c.to === to); if (existing) return existing;
      const c = new HeadlessConnection(from, to); world.connections.push(c); world.changed('connect');
      return c;
    },
    disconnect(c) { world.connections = world.connections.filter((x) => x !== c); world.changed('disconnect'); },
    group(title, members) { const g = { title, members, collapsed: false }; members.forEach((n) => { n.group = g; }); world.groups.push(g); world.changed('group'); return g; },
    /** Synchronous frames. */
    tick(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) engine.tick(dt); return engine.time; },
    /** Frames as the browser sees them: everything in flight lands (microtasks, resolved promises), then the frame evaluates. */
    async run(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { await settle(); await settle(); engine.tick(dt); } await settle(); return engine.time; },
    /** Pulse an event input from outside (the mini toolbar's Run); seen on the next tick. */
    trigger(node, key = 'trigger', payload = 'test') { return engine.trigger(node, key, payload); },
    /** Pulse an event output from outside (a button press). */
    emit(node, key, payload) { return engine.emit(node, key, payload); },
    /** Build an example object ({ build({ add, connect, group }) }) into this world. */
    buildExample(example) {
      world.clear();
      const b = { add: (typeId, _pos, { title, params, state } = {}) => api.add(typeId, params, { title, state }), connect: api.connect, group: api.group };
      world.named = example.build(b) || {};
      world.changed('example');
      return world.named;
    },
  };
  return api;
}
