// graph.js — the functional layer: a small dataflow engine.
// Every block type (node or device) declares its ports, its editable params and an
// evaluate(inputs, params, ctx) function. The Graph evaluates the world's blocks in
// topological order (cycles are ignored), pushes values along valid connections and
// derives the "active" / "error" states from the data. The world (blocks, connections,
// params) stays the single source of truth; this module only reads and annotates it.

const TAU = Math.PI * 2;
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Format any value compactly for footers, screens and the properties panel. */
export function formatValue(v, max = 26) {
  let s;
  if (v === undefined || v === null) s = '—';
  else if (typeof v === 'number') s = Math.abs(v) >= 1000 ? v.toFixed(0) : (+v.toFixed(2)).toString();
  else if (typeof v === 'boolean') s = v ? 'true' : 'false';
  else if (typeof v === 'string') s = `"${v}"`;
  else if (typeof v === 'object' && v.__signal) s = `↯ ${v.count}`;
  else if (typeof v === 'object') {
    s = '{' + Object.entries(v).map(([k, x]) => `${k}: ${formatValue(x, 10).replace(/^"|"$/g, '')}`).join(', ') + '}';
  } else s = String(v);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Signals are counters wrapped in a tiny object so the type stays distinct from numbers. */
const signal = (count) => ({ __signal: true, count: Math.floor(count) });

const P = {
  number: (d, extra = {}) => ({ type: 'number', default: d, step: 0.1, ...extra }),
  text: (d) => ({ type: 'text', default: d }),
  bool: (d) => ({ type: 'boolean', default: d }),
  select: (d, options) => ({ type: 'select', default: d, options }),
};

/**
 * Block types. `kind` is 'node' or 'device'. `display(outputs, inputs, params, memory)` returns
 * the footer string (nodes) or the screen lines (devices); it defaults to the outputs.
 */
export const blockTypes = {
  sensor: {
    kind: 'node', title: 'Sensor Input', category: 'source',
    outputs: [{ name: 'reading', type: 'number' }, { name: 'tick', type: 'signal' }],
    params: { frequency: P.number(0.4, { min: 0.05, max: 5, step: 0.05, label: 'frequency (Hz)' }), amplitude: P.number(1, { min: 0, max: 100 }) },
    evaluate(_in, p, ctx) {
      return { reading: Math.sin(ctx.time * TAU * p.frequency) * p.amplitude, tick: signal(ctx.time * p.frequency) };
    },
  },
  constant: {
    kind: 'node', title: 'Constant', category: 'source',
    outputs: [{ name: 'value', type: 'number' }],
    params: { value: P.number(0.25) },
    evaluate(_in, p) { return { value: p.value }; },
  },
  transform: {
    kind: 'node', title: 'Transform', category: 'process',
    inputs: [{ name: 'value', type: 'number' }],
    outputs: [{ name: 'value', type: 'number' }],
    params: { scale: P.number(10), offset: P.number(20) },
    evaluate(i, p) { return i.value === undefined ? {} : { value: i.value * p.scale + p.offset }; },
  },
  filter: {
    kind: 'node', title: 'Filter', category: 'process', width: 4.6,
    inputs: [{ name: 'value', type: 'number' }, { name: 'threshold', type: 'number' }],
    outputs: [{ name: 'passed', type: 'boolean' }, { name: 'value', type: 'number' }],
    params: { threshold: P.number(0, { label: 'threshold (fallback)' }), invert: P.bool(false) },
    evaluate(i, p) {
      if (i.value === undefined) return {};
      const th = i.threshold !== undefined ? i.threshold : p.threshold;
      let passed = i.value > th; if (p.invert) passed = !passed;
      return { passed, value: passed ? i.value : undefined };
    },
    display(o, i) { return `${formatValue(o.passed)} · ${o.value !== undefined ? formatValue(o.value) : 'blocked'}${i.threshold !== undefined ? ` @ ${formatValue(i.threshold)}` : ''}`; },
  },
  merge: {
    kind: 'node', title: 'Merge', category: 'process', width: 4.4,
    inputs: [{ name: 'number', type: 'number' }, { name: 'text', type: 'string' }, { name: 'flag', type: 'boolean' }],
    outputs: [{ name: 'merged', type: 'data' }],
    params: { includeTime: P.bool(false) },
    evaluate(i, p, ctx) {
      if (i.number === undefined && i.text === undefined && i.flag === undefined) return {};
      const merged = {};
      if (i.number !== undefined) merged.value = +i.number.toFixed(2);
      if (i.text !== undefined) merged.text = i.text;
      if (i.flag !== undefined) merged.flag = i.flag;
      if (p.includeTime) merged.t = +ctx.time.toFixed(1);
      return { merged };
    },
  },
  format: {
    kind: 'node', title: 'Format', category: 'process',
    inputs: [{ name: 'value', type: 'number' }],
    outputs: [{ name: 'text', type: 'string' }],
    params: { template: P.text('T = {value} °C'), decimals: P.number(1, { min: 0, max: 6, step: 1 }) },
    evaluate(i, p) {
      if (i.value === undefined) return {};
      return { text: String(p.template).replace(/\{value\}/g, i.value.toFixed(Math.max(0, Math.round(p.decimals)))) };
    },
  },
  output: {
    kind: 'node', title: 'Output', category: 'sink', width: 4.2,
    inputs: [{ name: 'text', type: 'string' }, { name: 'data', type: 'data' }, { name: 'enable', type: 'boolean' }],
    outputs: [{ name: 'done', type: 'signal' }],
    params: { requireEnable: P.bool(false) },
    evaluate(i, p, ctx) {
      const enabled = p.requireEnable ? i.enable === true : i.enable !== false;
      const m = ctx.memory;
      const key = enabled ? `${i.text ?? ''}|${i.data ? JSON.stringify(i.data) : ''}` : m.lastKey;
      if (key !== m.lastKey) { m.lastKey = key; m.count = (m.count || 0) + 1; }
      m.shown = enabled ? (i.text !== undefined ? i.text : i.data !== undefined ? i.data : undefined) : undefined;
      return { done: signal(m.count || 0) };
    },
    display(_o, i, p, m) { return m.shown === undefined ? (i.enable === false ? 'gated' : 'no input') : formatValue(m.shown); },
  },
  logger: {
    kind: 'node', title: 'Logger', category: 'sink', width: 3.4,
    inputs: [{ name: 'in', type: 'data' }],
    params: { keep: P.number(5, { min: 1, max: 20, step: 1 }) },
    evaluate(i, p, ctx) {
      const m = ctx.memory; m.log = m.log || [];
      if (i.in !== undefined) {
        const s = JSON.stringify(i.in);
        if (m.lastKey !== s) { m.lastKey = s; m.log.push(i.in); while (m.log.length > Math.max(1, p.keep)) m.log.shift(); }
      }
      return {};
    },
    display(_o, _i, _p, m) { const log = m.log || []; return log.length ? `${log.length} logged · ${formatValue(log[log.length - 1], 18)}` : 'empty'; },
  },

  /* ---- devices: sources and sinks with a screen ---- */
  phone: {
    kind: 'device', device: 'phone', title: 'Phone',
    outputs: [{ name: 'motion', type: 'number' }, { name: 'tap', type: 'signal' }],
    params: { source: P.select('accelerometer', ['accelerometer', 'battery']), tapEvery: P.number(3, { min: 0.5, max: 30, step: 0.5, label: 'tap every (s)' }) },
    evaluate(_i, p, ctx) {
      const t = ctx.time;
      const motion = p.source === 'battery'
        ? 100 - (t * 0.02) % 100
        : +(0.5 + 0.5 * Math.sin(t * 1.7) * Math.cos(t * 0.31) + 0.15 * Math.sin(t * 7.3)).toFixed(3);
      return { motion, tap: signal(t / p.tapEvery) };
    },
    display(o, _i, p) { return [`${p.source}`, formatValue(o.motion), `taps ${o.tap ? o.tap.count : 0}`]; },
  },
  desktop: {
    kind: 'device', device: 'desktop', title: 'Desktop',
    outputs: [{ name: 'dataset', type: 'data' }],
    params: { host: P.text('studio-pc'), rate: P.number(0.5, { min: 0.1, max: 5, step: 0.1, label: 'update rate (Hz)' }) },
    evaluate(_i, p, ctx) {
      const step = Math.floor(ctx.time * p.rate);
      const cpu = Math.round(35 + 30 * Math.abs(Math.sin(step * 0.7)));
      return { dataset: { host: p.host, cpu, mem: Math.round(40 + 20 * Math.abs(Math.cos(step * 0.4))) } };
    },
    display(o) { const d = o.dataset || {}; return [`host ${d.host ?? '—'}`, `cpu ${d.cpu ?? '—'} %`, `mem ${d.mem ?? '—'} %`]; },
  },
  laptop: {
    kind: 'device', device: 'laptop', title: 'Laptop',
    inputs: [{ name: 'display', type: 'string' }, { name: 'feed', type: 'data' }],
    params: { caption: P.text('') },
    evaluate() { return {}; },
    display(_o, i, p) {
      const lines = [];
      if (p.caption) lines.push(p.caption);
      if (i.display !== undefined) lines.push(String(i.display));
      if (i.feed !== undefined) Object.entries(i.feed).forEach(([k, v]) => lines.push(`${k}: ${formatValue(v, 16).replace(/^"|"$/g, '')}`));
      return lines;
    },
  },
  tablet: {
    kind: 'device', device: 'tablet', title: 'Tablet',
    inputs: [{ name: 'view', type: 'data' }],
    params: { caption: P.text('') },
    evaluate() { return {}; },
    display(_o, i, p) {
      const lines = p.caption ? [p.caption] : [];
      if (i.view !== undefined) Object.entries(i.view).forEach(([k, v]) => lines.push(`${k}: ${formatValue(v, 16).replace(/^"|"$/g, '')}`));
      return lines;
    },
  },
};

/** Default param values for a type. */
export function defaultParams(typeId) {
  const t = blockTypes[typeId]; const out = {};
  if (t && t.params) for (const [k, s] of Object.entries(t.params)) out[k] = s.default;
  return out;
}

function equal(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

/** How long after a change a port / connection / node still counts as "active" (s). */
export const ACTIVE_WINDOW = 0.6;

export class Graph {
  /**
   * @param {object} world  { blocks, connections }
   * @param {object} [opts] { interval: seconds between evaluations (default 0.1) }
   */
  constructor(world, opts = {}) {
    this.world = world;
    this.interval = opts.interval ?? 0.1;
    this.time = 0;
    this._acc = this.interval; // evaluate on the first frame
    this.evaluations = 0;
  }

  /** Per frame: advance time, evaluate at the configured rate, refresh derived states. */
  tick(dt) {
    this.time += dt;
    this._acc += dt;
    if (this._acc >= this.interval) { this.evaluate(); this._acc = 0; }
    this._applyStates();
  }

  /** Connection carries data only when both ends exist and the port types match. */
  static isValid(c) { return !!(c.to && c.from.type === c.to.type); }

  /** Blocks in evaluation order (Kahn); blocks caught in cycles are appended as-is. */
  order() {
    const blocks = this.world.blocks;
    const indeg = new Map(blocks.map((b) => [b, 0]));
    const out = new Map(blocks.map((b) => [b, []]));
    for (const c of this.world.connections) {
      if (!Graph.isValid(c)) continue;
      const a = c.from.owner, b = c.to.owner;
      if (a === b || !indeg.has(a) || !indeg.has(b)) continue;
      out.get(a).push(b); indeg.set(b, indeg.get(b) + 1);
    }
    const queue = blocks.filter((b) => indeg.get(b) === 0), sorted = [];
    while (queue.length) {
      const b = queue.shift(); sorted.push(b);
      for (const n of out.get(b)) { indeg.set(n, indeg.get(n) - 1); if (indeg.get(n) === 0) queue.push(n); }
    }
    for (const b of blocks) if (!sorted.includes(b)) sorted.push(b); // cycles: evaluate with stale inputs
    return sorted;
  }

  /** One full evaluation pass. Safe to call directly after a param edit. */
  evaluate() {
    const { world } = this;
    const t = this.time;
    // first valid connection into each input wins
    const inbound = new Map();
    for (const c of world.connections) {
      if (Graph.isValid(c) && !inbound.has(c.to)) inbound.set(c.to, c);
    }
    const invalidBlocks = new Set();
    for (const c of world.connections) if (c.to && !Graph.isValid(c)) { invalidBlocks.add(c.from.owner); invalidBlocks.add(c.to.owner); }

    for (const block of this.order()) {
      const type = blockTypes[block.typeId];
      block.memory = block.memory || {};
      block.params = block.params || defaultParams(block.typeId);
      const inputs = {};
      for (const port of block.inputs) {
        const c = inbound.get(port);
        const v = c ? c.from.value : undefined;
        this._setPortValue(port, v, t);
        inputs[port.name] = v;
      }
      let outputs = {};
      block.evalError = null;
      if (block.mode !== 'disabled' && type) {
        try { outputs = type.evaluate(inputs, block.params, { time: t, dt: this.interval, memory: block.memory, block }) || {}; }
        catch (e) { block.evalError = e.message || String(e); outputs = {}; }
      }
      for (const port of block.outputs) this._setPortValue(port, outputs[port.name], t);
      block.outputsSnapshot = outputs;
      block.inputsSnapshot = inputs;
      block.hasInvalid = invalidBlocks.has(block);

      // Display: footer for nodes, screen lines for devices
      if (type) {
        const disp = type.display
          ? type.display(outputs, inputs, block.params, block.memory)
          : block.outputs.map((p) => `${block.outputs.length > 1 ? p.name + ' ' : ''}${formatValue(p.value, 18)}`).join(' · ') || (block.inputs.length ? block.inputs.map((p) => formatValue(p.value, 18)).join(' · ') : '');
        if (block.kind === 'node') block.setFooter?.(block.mode === 'disabled' ? 'disabled' : disp || '—');
        else block.setScreen?.(block.mode === 'disabled' ? [] : disp);
      }
    }

    for (const c of world.connections) {
      const valid = Graph.isValid(c);
      c.value = valid ? c.from.value : undefined;
      c.setActivity?.({ hasValue: c.value !== undefined, rate: valid ? c.from.rate || 0 : 0, changedAt: c.from.changedAt || -1 });
    }
    this.evaluations += 1;
  }

  _setPortValue(port, v, t) {
    const changed = !equal(port.value, v);
    port.value = v;
    if (changed) { port.changedAt = t; port.changes = (port.changes || 0) + 1; }
    // changes per second, smoothed
    const inst = changed ? 1 / this.interval : 0;
    port.rate = (port.rate || 0) * 0.75 + inst * 0.25;
  }

  /** Derived states: disabled (user) > error (invalid link / throw) > active (recent change) > idle. */
  _applyStates() {
    const t = this.time;
    for (const b of this.world.blocks) {
      let s = 'idle';
      if (b.mode === 'disabled') s = 'disabled';
      else if (b.mode === 'error' || b.evalError || b.hasInvalid) s = 'error';
      else if (b.outputs.some((p) => p.value !== undefined && t - (p.changedAt ?? -1e9) < ACTIVE_WINDOW)
        || (b.kind === 'device' && b.inputs.some((p) => p.value !== undefined && t - (p.changedAt ?? -1e9) < ACTIVE_WINDOW))) s = 'active';
      this._derive(b, s);
    }
    for (const c of this.world.connections) {
      let s = 'idle';
      if (!Graph.isValid(c)) s = 'invalid';
      else if (c.value !== undefined && t - (c.from.changedAt ?? -1e9) < ACTIVE_WINDOW) s = 'active';
      this._derive(c, s);
    }
  }
  _derive(item, s) {
    item.derivedState = s;
    if (item.state === 'selected') { item._prevState = s; return; }
    if (item.state !== s) item.setState(s);
  }
}
