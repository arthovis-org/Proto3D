// panel.js — the properties panel (right column, Blender N-panel / Unreal Details style).
// Shows the selected object's header, Transform, Node / Device / Connection sections and Ports;
// with nothing selected it shows workspace properties and a scene summary. Fields are bound
// live: they read from the world every refresh (unless focused) and write back on input.
import { blockTypes, formatValue } from './graph.js';
import { portTypes, hex, getTheme, setTheme } from './theme.js';

const ICONS = { node: '▣', device: '▭', connection: '⟶', workspace: '⌂' };
const RAD = 180 / Math.PI;

export class Panel {
  /**
   * @param {object} o
   * @param {HTMLElement} o.el          the <aside id="panel">
   * @param {object} o.world
   * @param {object} o.graph
   * @param {object} o.ws               workspace (grid toggle)
   * @param {object} o.gizmo
   * @param {object} o.flow             { isEnabled, setEnabled, getSpeed, setSpeed }
   * @param {function} o.onRename       (block, name) => void
   * @param {function} o.onModeChange   (block) => void  (state override changed)
   */
  constructor(o) {
    Object.assign(this, o);
    this.item = null;
    this.live = [];
    this.body = this.el.querySelector('#panel-body');
    this.build();
  }

  /* ---------- tiny DOM helpers ---------- */
  _h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  _section(title, open = true) {
    const d = this._h('details', 'sec'); d.open = open;
    d.appendChild(this._h('summary', null, title));
    const b = this._h('div', 'sec-body'); d.appendChild(b);
    this.body.appendChild(d);
    return b;
  }
  _row(parent, label) {
    const r = this._h('div', 'row');
    r.appendChild(this._h('label', null, label));
    parent.appendChild(r);
    return r;
  }
  _readonly(parent, label, get) {
    const r = this._row(parent, label);
    const v = this._h('span', 'val'); r.appendChild(v);
    const upd = () => { v.textContent = get(); }; upd(); this.live.push(upd);
    return v;
  }
  _num(parent, label, get, set, { step = 0.1, min, max, attr } = {}) {
    const r = this._row(parent, label);
    const i = this._h('input'); i.type = 'number'; i.step = step;
    if (min !== undefined) i.min = min; if (max !== undefined) i.max = max;
    if (attr) i.dataset.param = attr;
    i.addEventListener('input', () => { const v = parseFloat(i.value); if (Number.isFinite(v)) set(v); });
    r.appendChild(i);
    const upd = () => { if (document.activeElement !== i) i.value = (+get().toFixed(3)).toString(); }; upd(); this.live.push(upd);
    return i;
  }
  _text(parent, label, get, set, attr) {
    const r = this._row(parent, label);
    const i = this._h('input'); i.type = 'text'; if (attr) i.dataset.param = attr;
    i.addEventListener('input', () => set(i.value));
    r.appendChild(i);
    const upd = () => { if (document.activeElement !== i) i.value = get(); }; upd(); this.live.push(upd);
    return i;
  }
  _check(parent, label, get, set, attr) {
    const r = this._row(parent, label);
    const i = this._h('input'); i.type = 'checkbox'; if (attr) i.dataset.param = attr;
    i.addEventListener('change', () => set(i.checked));
    r.appendChild(i);
    const upd = () => { i.checked = !!get(); }; upd(); this.live.push(upd);
    return i;
  }
  _select(parent, label, options, get, set, attr) {
    const r = this._row(parent, label);
    const s = this._h('select'); if (attr) s.dataset.param = attr;
    options.forEach((o) => { const op = this._h('option', null, o); op.value = o; s.appendChild(op); });
    s.addEventListener('change', () => set(s.value));
    r.appendChild(s);
    const upd = () => { if (document.activeElement !== s) s.value = get(); }; upd(); this.live.push(upd);
    return s;
  }
  _buttons(parent, label, options, get, set) {
    const r = this._row(parent, label);
    const g = this._h('div', 'btn-group');
    const btns = options.map(([value, text, title]) => {
      const b = this._h('button', null, text); b.type = 'button'; b.title = title || value; b.dataset.value = value;
      b.addEventListener('click', () => set(value)); g.appendChild(b); return b;
    });
    r.appendChild(g);
    const upd = () => btns.forEach((b) => b.classList.toggle('on', b.dataset.value === get())); upd(); this.live.push(upd);
    return g;
  }
  _dot(color) { const i = this._h('i', 'dot'); i.style.background = hex(color); return i; }

  /* ---------- selection ---------- */
  setSelection(item) { this.item = item; this.build(); }

  build() {
    this.body.innerHTML = '';
    this.live = [];
    const item = this.item;
    if (!item) this._buildWorkspace();
    else if (item.kind === 'connection') this._buildConnection(item);
    else this._buildBlock(item);
    this.refresh();
  }

  /** Update all live fields (called at the graph rate). */
  refresh() { this.live.forEach((fn) => fn()); }

  _header(kind, name, sub, onRename) {
    const h = this._h('div', 'panel-head');
    h.appendChild(this._h('span', 'icon', ICONS[kind] || '•'));
    if (onRename) {
      const i = this._h('input', 'name-field'); i.type = 'text'; i.value = name; i.id = 'prop-name';
      i.addEventListener('input', () => onRename(i.value));
      h.appendChild(i);
    } else h.appendChild(this._h('span', 'name-field static', name));
    h.appendChild(this._h('span', 'sub', sub));
    this.body.appendChild(h);
  }

  _buildWorkspace() {
    const { world, ws, gizmo, flow } = this;
    this._header('workspace', 'Workspace', 'nothing selected');
    const s = this._section('Workspace');
    this._select(s, 'theme', ['dark', 'light'], () => getTheme(), (v) => setTheme(v));
    this._check(s, 'grid', () => ws.isGridVisible(), (v) => ws.setGridVisible(v));
    this._check(s, 'flow animation', () => flow.isEnabled(), (v) => flow.setEnabled(v));
    this._num(s, 'flow speed', () => flow.getSpeed(), (v) => flow.setSpeed(v), { step: 0.1, min: 0, max: 5 });
    const g = this._section('Gizmo');
    this._check(g, 'enabled (G)', () => gizmo.enabled, (v) => gizmo.setEnabled(v));
    this._buttons(g, 'mode', [['translate', 'Move', 'W'], ['rotate', 'Rotate', 'E'], ['scale', 'Scale', 'R']], () => gizmo.mode, (v) => gizmo.setMode(v));
    const sum = this._section('Scene');
    this._readonly(sum, 'nodes', () => String(world.blocks.filter((b) => b.kind === 'node').length));
    this._readonly(sum, 'devices', () => String(world.blocks.filter((b) => b.kind === 'device').length));
    this._readonly(sum, 'connections', () => `${world.connections.length} (${world.connections.filter((c) => c.state === 'invalid').length} invalid)`);
    this._readonly(sum, 'carrying data', () => String(world.connections.filter((c) => c.value !== undefined).length));
    this._readonly(sum, 'evaluations', () => String(this.graph.evaluations));
  }

  _buildBlock(b) {
    const type = blockTypes[b.typeId] || {};
    this._header(b.kind, b.title, b.kind === 'node' ? `${type.category || b.category || ''} node` : `${b.type} device`, (v) => this.onRename(b, v));

    // Transform
    const t = this._section('Transform');
    const pos = (axis) => this._num(t, `position ${axis}`, () => b.position[axis], (v) => { b.position[axis] = axis === 'y' ? Math.max(b.kind === 'node' ? 0.2 : 0, v) : v; }, { step: 0.5 });
    pos('x'); pos('y'); pos('z');
    this._num(t, 'rotation y°', () => b.rotation.y * RAD, (v) => { b.rotation.y = v / RAD; }, { step: 5 });
    this._num(t, 'scale', () => b.scale.x, (v) => b.scale.setScalar(Math.min(Math.max(v, 0.2), 4)), { step: 0.1, min: 0.2, max: 4 });
    if (this.gizmo.enabled) this._buttons(t, 'gizmo', [['translate', 'Move', 'W'], ['rotate', 'Rotate', 'E'], ['scale', 'Scale', 'R']], () => this.gizmo.mode, (v) => this.gizmo.setMode(v));

    // Node / Device
    const n = this._section(b.kind === 'node' ? 'Node' : 'Device');
    this._readonly(n, 'type', () => type.title || b.typeId || '—');
    if (b.kind === 'node') this._readonly(n, 'category', () => type.category || b.category);
    else this._readonly(n, 'kind', () => b.type);
    this._select(n, 'state', ['auto', 'disabled', 'error'], () => b.mode || 'auto', (v) => { b.mode = v; this.onModeChange?.(b); });
    this._readonly(n, 'current', () => b.derivedState || b.state);
    if (b.evalError !== undefined) this._readonly(n, 'error', () => b.evalError || '—');
    const params = type.params || {};
    for (const [key, spec] of Object.entries(params)) {
      const label = spec.label || key;
      const set = (v) => { b.params[key] = v; this.graph.evaluate(); };
      if (spec.type === 'number') this._num(n, label, () => b.params[key] ?? spec.default, set, { step: spec.step ?? 0.1, min: spec.min, max: spec.max, attr: key });
      else if (spec.type === 'boolean') this._check(n, label, () => b.params[key], set, key);
      else if (spec.type === 'select') this._select(n, label, spec.options, () => b.params[key], set, key);
      else this._text(n, label, () => String(b.params[key] ?? ''), set, key);
    }
    if (b.kind === 'device') {
      this._readonly(n, 'screen', () => (b.screenLines && b.screenLines.length ? b.screenLines.join(' | ') : '—'));
    }
    if (b.kind === 'node') this._readonly(n, 'footer', () => b.footerText || '—');

    // Ports
    const p = this._section('Ports');
    const list = this._h('ul', 'ports'); p.appendChild(list);
    b.ports.forEach((port) => {
      const li = this._h('li');
      li.appendChild(this._dot(port.color));
      li.appendChild(this._h('span', 'pdir', port.dir === 'in' ? '→ in' : 'out →'));
      li.appendChild(this._h('span', 'pname', port.name));
      const val = this._h('span', 'pval'); li.appendChild(val);
      const cnt = this._h('span', 'pcount'); li.appendChild(cnt);
      list.appendChild(li);
      this.live.push(() => {
        val.textContent = formatValue(port.value, 22);
        const k = this.world.connectionsOf(port).length;
        cnt.textContent = k ? `${k} link${k > 1 ? 's' : ''}` : 'unlinked';
        li.querySelector('.dot').style.background = hex(port.color);
      });
    });
  }

  _buildConnection(c) {
    this._header('connection', 'Connection', `${c.type} link`);
    const s = this._section('Connection');
    this._readonly(s, 'from', () => `${c.from.owner.title} · ${c.from.name}`);
    this._readonly(s, 'to', () => (c.to ? `${c.to.owner.title} · ${c.to.name}` : '—'));
    this._readonly(s, 'type', () => `${c.from.type}${c.to && c.to.type !== c.from.type ? ` → ${c.to.type} (mismatch)` : ''}`);
    this._readonly(s, 'state', () => c.derivedState || c.state);
    this._readonly(s, 'value', () => formatValue(c.value, 40));
    this._readonly(s, 'changes / s', () => (c.rate || 0).toFixed(1));
    this._readonly(s, 'flow velocity', () => `${c.velocity.toFixed(2)} u/s`);
    const ty = this._h('div', 'row'); ty.appendChild(this._h('label', null, 'colour')); ty.appendChild(this._dot((portTypes[c.type] || portTypes.signal).color)); s.appendChild(ty);
  }
}
