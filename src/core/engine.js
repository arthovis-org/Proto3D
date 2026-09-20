// core/engine.js — evaluates the graph every frame in topological order, pulls values along
// connections (single inputs: most recently changed upstream value wins; multi inputs: array
// in connection order), coerces across compatible types, and runs an event bus so pulses
// emitted by Input / Action / device components propagate downstream within the same pass.
// Cycles are broken by treating back-edges as previous-frame values. Values are cached on
// connections for display; every output tracks `changedAt` to drive active / inactive looks.
import { compatiblePorts, coerce, equal, makePulse, isPulse } from './types.js';

/** How long after a change an output / connection / node still counts as "active" (s). */
export const ACTIVE_WINDOW = 1.5;

export class Engine {
  constructor(world) {
    this.world = world;
    this.time = 0;
    this.frame = 0;
    this.dt = 1 / 60;
    this.evaluations = 0;
    this.pending = [];          // external pulses: { port, payload }
    this.onError = null;        // optional (instance, error) hook
    world.engine = this;
  }

  /* ---------------- events ---------------- */
  /** Emit a pulse on an output port from outside the evaluation (a click, a key, a timer). */
  emit(instance, key, payload) {
    const port = instance.getPort?.(key, 'out');
    if (!port) return false;
    this.pending.push({ port, payload });
    return true;
  }
  /**
   * Pulse an event *input* from outside the graph (the mini toolbar's Run on an Action): the node
   * sees the pulse on the next pass exactly as if an upstream output had fired, once.
   */
  trigger(instance, key, payload) {
    const port = instance.getPort?.(key, 'in');
    if (!port || port.type !== 'event') return false;
    this.pending.push({ port, payload, external: true });
    return true;
  }
  _pulse(port, payload, external = false) {
    const p = makePulse(this.time, payload);
    p.frame = this.frame;
    if (external) p.external = true;
    port.pulse = p;
    port.lastPulseAt = this.time;
    port.pulses = (port.pulses || 0) + 1;
    this._setPortValue(port, p);
  }

  /* ---------------- ordering ---------------- */
  /** Kahn over valid connections; nodes caught in cycles are appended (back-edges → previous values). */
  order() {
    const nodes = this.world.nodes;
    const indeg = new Map(nodes.map((n) => [n, 0]));
    const out = new Map(nodes.map((n) => [n, []]));
    for (const c of this.world.connections) {
      if (!c.valid) continue;
      const a = c.from.owner, b = c.to.owner;
      if (a === b || !indeg.has(a) || !indeg.has(b)) continue;
      out.get(a).push(b); indeg.set(b, indeg.get(b) + 1);
    }
    const queue = nodes.filter((n) => indeg.get(n) === 0), sorted = [];
    const inSorted = new Set();
    while (queue.length) {
      const n = queue.shift(); sorted.push(n); inSorted.add(n);
      for (const m of out.get(n)) { indeg.set(m, indeg.get(m) - 1); if (indeg.get(m) === 0) queue.push(m); }
    }
    for (const n of nodes) if (!inSorted.has(n)) sorted.push(n);
    return sorted;
  }

  /* ---------------- evaluation ---------------- */
  tick(dt) {
    this.dt = dt;
    this.time += dt;
    this.evaluate();
    this._applyStates();
  }

  evaluate() {
    const { world } = this;
    const t = this.time;
    this.frame += 1;

    // connection validity + inbound map (connections per input port, in world order)
    const inbound = new Map();
    const invalidNodes = new Set();
    for (const c of world.connections) {
      c.valid = !!(c.to && compatiblePorts(c.from, c.to) !== 'invalid');
      if (!c.valid) { if (c.to) { invalidNodes.add(c.from.owner); invalidNodes.add(c.to.owner); } c.value = undefined; continue; }
      if (!inbound.has(c.to)) inbound.set(c.to, []);
      inbound.get(c.to).push(c);
    }

    // external pulses: one per port per pass, the rest wait for the next pass
    if (this.pending.length) {
      const taken = new Set(), rest = [];
      for (const e of this.pending) {
        if (taken.has(e.port)) { rest.push(e); continue; }
        taken.add(e.port); this._pulse(e.port, e.payload, e.external);
      }
      this.pending = rest;
    }

    const order = this.order();
    for (const node of order) {
      const def = node.def;
      node.rt = node.rt || {};
      // pulses this node emitted in an earlier pass have been seen by everyone downstream
      for (const p of node.outputs) if (p.pulse && p.pulse.frame < this.frame) p.pulse = null;

      const inputs = {};
      const pulsed = [];
      for (const port of node.inputs) {
        const conns = inbound.get(port) || [];
        let value;
        if (port.type === 'event') {
          // an event input fires when any upstream output pulsed since it was last seen
          const pulses = conns.map((c) => c.from.pulse).filter(Boolean);
          if (port.pulse?.external && port.pulse.frame === this.frame) pulses.push(port.pulse);   // engine.trigger()
          conns.forEach((c) => { c.value = c.from.pulse || c.from.value; });
          if (pulses.length) { value = pulses.reduce((a, b) => (b.n > a.n ? b : a)); pulsed.push([port, value]); }
          port.pulse = value || null;
        } else if (port.multi) {
          value = [];
          for (const c of conns) { const v = coerce(c.from.value, c.from.type, port.type); c.value = v; if (v !== undefined) value.push(v); }
          if (!conns.length) value = undefined;
        } else {
          // several links into one input: the most recently changed upstream value wins
          let best = null, bestT = -Infinity;
          for (const c of conns) {
            const v = coerce(c.from.value, c.from.type, port.type); c.value = v;
            const ct = Math.max(c.from.changedAt ?? -Infinity, c.from.lastPulseAt ?? -Infinity);
            if (v !== undefined && (best === null || ct > bestT)) { best = c; bestT = ct; }
          }
          value = best ? best.value : undefined;
          if (isPulse(value) && conns.some((c) => c.from.pulse && c.value === value)) pulsed.push([port, value]);
        }
        this._setPortValue(port, value);
        inputs[port.key] = value;
      }

      const emitted = new Set();
      const ctx = {
        inputs, params: node.params, state: node.state, time: t, dt: this.dt, instance: node, engine: this,
        emit: (key, payload) => { const p = node.getPort(key, 'out'); if (p) { this._pulse(p, payload); emitted.add(p); } },
        touch: (key) => { const p = node.getPort(key, 'out'); if (p) p._touch = true; },
        // relationships, not values: which instances (and their ports) sit on the other end of a port's cables
        upstream: (key) => { const p = node.getPort(key, 'in'); return p ? (inbound.get(p) || []).map((c) => ({ node: c.from.owner, port: c.from, key: c.from.key, connection: c })) : []; },
        downstream: (key) => { const p = node.getPort(key, 'out'); return p ? world.connections.filter((c) => c.valid && c.from === p).map((c) => ({ node: c.to.owner, port: c.to, key: c.to.key, connection: c })) : []; },
      };
      node.rt.ctx = ctx;
      node.rt.inputs = inputs;
      let outputs = {};
      node.rt.error = null;
      if (node.enabled !== false) {
        try {
          if (def.onEvent) for (const [port, pulse] of pulsed) def.onEvent(ctx, port.key, pulse);
          outputs = def.evaluate(ctx) || {};
        } catch (e) {
          node.rt.error = e && e.message ? e.message : String(e);
          outputs = {};
          this.onError?.(node, e);
        }
      }
      for (const port of node.outputs) {
        if (port.type === 'event') {
          // returning a value for an event output is shorthand for emit(key, value)
          if (outputs[port.key] !== undefined && !emitted.has(port)) this._pulse(port, outputs[port.key]);
          continue;
        }
        this._setPortValue(port, outputs[port.key]);
      }
      node.rt.outputs = outputs;
      node.rt.hasInvalid = invalidNodes.has(node);
      node.afterEvaluate?.(ctx, t);
    }
    this.evaluations += 1;
  }

  _setPortValue(port, v) {
    const t = this.time;
    const changed = port._touch || !equal(port.value, v);
    port._touch = false;
    port.value = v;
    if (changed) { port.changedAt = t; port.changes = (port.changes || 0) + 1; }
    const inst = changed ? 1 / Math.max(this.dt, 1 / 240) : 0;
    port.rate = (port.rate || 0) * 0.9 + inst * 0.1;
  }

  /** Recent activity on a port (change or pulse within ACTIVE_WINDOW). */
  isActive(port) {
    if (!port) return false;
    const last = Math.max(port.changedAt ?? -1e9, port.lastPulseAt ?? -1e9);
    return port.value !== undefined && this.time - last < ACTIVE_WINDOW;
  }

  /** Derived states: disabled > error > active > idle. Written on nodes and connections. */
  _applyStates() {
    for (const n of this.world.nodes) {
      let s = 'idle';
      if (n.enabled === false) s = 'disabled';
      else if (n.rt?.error || n.rt?.hasInvalid) s = 'error';
      else if (n.outputs.some((p) => this.isActive(p)) || (!n.outputs.length || n.def.device) && n.inputs.some((p) => this.isActive(p))) s = 'active';
      n.setDerivedState(s);
    }
    for (const c of this.world.connections) {
      let s = 'idle';
      if (!c.valid) s = 'invalid';
      else if (c.value === undefined) s = 'inactive';
      else if (this.isActive(c.from)) s = 'active';
      c.setDerivedState(s);
    }
  }
}
