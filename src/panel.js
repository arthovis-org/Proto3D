// panel.js — the properties panel (right column, Blender N-panel / Unreal Details style).
// Always describes the selection: a component (Transform, Component with registry-driven param
// controls, Ports with live values), several items (shared transform), a group, a connection,
// or the workspace when nothing is selected. Fields are bound live and write back through the
// History so every edit is undoable.
import { registry } from './core/registry.js';
import { formatValue, compatiblePorts, typeInfo, portTypeText, portTypeName, mismatchReason } from './core/types.js';
import { hex, getTheme, setTheme, sizes } from './theme.js';
import { describeLink } from './pm/relations.js';
import * as cmd from './core/commands.js';
import { icons } from './icons.js';
import { nav } from './controls/navigation.js';
import { PRESET_IDS } from './controls/presets.js';

const RAD = 180 / Math.PI;

export class Panel {
  /**
   * @param {object} o { el, world, engine, ws, gizmo, history, selection, flow: { isEnabled, setEnabled, getSpeed, setSpeed }, interaction }
   */
  constructor(o) {
    Object.assign(this, o);
    this.items = [];
    this.live = [];
    this.body = this.el.querySelector('#panel-body');
    this.selection.onChange((sel) => this.setSelection(sel.items));
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
  _row(parent, label) { const r = this._h('div', 'row'); r.appendChild(this._h('label', null, label)); parent.appendChild(r); return r; }
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
    const upd = () => { if (document.activeElement !== i) { const v = get(); i.value = typeof v === 'number' ? (+v.toFixed(3)).toString() : ''; } }; upd(); this.live.push(upd);
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
  _area(parent, label, get, set, attr, rows = 3) {
    const r = this._row(parent, label); r.classList.add('tall');
    const t = this._h('textarea', 'plain'); t.rows = rows; if (attr) t.dataset.param = attr;
    t.addEventListener('input', () => set(t.value));
    r.appendChild(t);
    const upd = () => { if (document.activeElement !== t) t.value = get() ?? ''; }; upd(); this.live.push(upd);
    return t;
  }
  _date(parent, label, get, set, attr) {
    const r = this._row(parent, label);
    const i = this._h('input'); i.type = 'date'; if (attr) i.dataset.param = attr;
    i.addEventListener('input', () => set(i.value));
    r.appendChild(i);
    const upd = () => { if (document.activeElement !== i) i.value = get() || ''; }; upd(); this.live.push(upd);
    return i;
  }
  _json(parent, label, get, set, attr) {
    const r = this._row(parent, label); r.classList.add('tall');
    const t = this._h('textarea'); t.rows = 4; if (attr) t.dataset.param = attr;
    t.addEventListener('input', () => { try { set(JSON.parse(t.value)); t.classList.remove('bad'); } catch (_) { t.classList.add('bad'); } });
    r.appendChild(t);
    const upd = () => { if (document.activeElement !== t) t.value = JSON.stringify(get(), null, 1); }; upd(); this.live.push(upd);
    return t;
  }
  _color(parent, label, get, set, attr) {
    const r = this._row(parent, label);
    const i = this._h('input'); i.type = 'color'; if (attr) i.dataset.param = attr;
    i.addEventListener('input', () => set(i.value));
    r.appendChild(i);
    const upd = () => { if (document.activeElement !== i) i.value = get() || '#000000'; }; upd(); this.live.push(upd);
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
    options.forEach((o) => { const op = this._h('option', null, String(o)); op.value = String(o); s.appendChild(op); });
    s.addEventListener('change', () => set(s.value));
    r.appendChild(s);
    const upd = () => { if (document.activeElement !== s) s.value = String(get()); }; upd(); this.live.push(upd);
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
  _action(parent, text, fn, id) { const b = this._h('button', 'wide', text); b.type = 'button'; if (id) b.id = id; b.addEventListener('click', fn); parent.appendChild(b); return b; }
  _dot(color) { const i = this._h('i', 'dot'); i.style.background = hex(color); return i; }

  /* ---------- selection ---------- */
  setSelection(items) { this.items = items || []; this.build(); }

  build() {
    this.body.innerHTML = '';
    this.live = [];
    const items = this.items;
    if (!items.length) this._buildWorkspace();
    else if (items.length > 1) this._buildMulti(items);
    else if (items[0].kind === 'connection') this._buildConnection(items[0]);
    else if (items[0].kind === 'group') this._buildGroup(items[0]);
    else this._buildBlock(items[0]);
    this.refresh();
  }
  /** Update all live fields (called ~10×/s). A stale updater (its block just left the world) never breaks the frame. */
  refresh() { for (const fn of this.live) { try { fn(); } catch (_) { /* rebuilt on the next selection change */ } } }

  _header(iconName, name, sub, onRename, tools = null) {
    const h = this._h('div', 'panel-head');
    const ic = this._h('span', 'icon'); ic.innerHTML = icons[iconName] || icons.node; h.appendChild(ic);
    if (onRename) {
      const i = this._h('input', 'name-field'); i.type = 'text'; i.value = name; i.id = 'prop-name';
      i.addEventListener('input', () => onRename(i.value));
      h.appendChild(i);
    } else h.appendChild(this._h('span', 'name-field static', name));
    if (tools) h.appendChild(tools);
    h.appendChild(this._h('span', 'sub', sub));
    this.body.appendChild(h);
    return h;
  }
  /** The eye in a block's header: cycles follow global → shown → hidden for this block's ports. */
  _portsEye(b) {
    const box = this._h('span', 'head-tools');
    const btn = this._h('button'); btn.type = 'button'; btn.id = 'btn-ports-eye';
    const upd = () => {
      const o = b.showPorts;
      btn.innerHTML = b.portsVisible ? icons.eye : icons.eyeOff;
      btn.classList.toggle('on', o === true); btn.classList.toggle('forced-off', o === false);
      btn.title = o === null ? `Ports follow the Wiring switch (${b.portsVisible ? 'shown' : 'hidden'}) · click to always show them on this block` : o ? 'Ports always shown on this block · click to always hide' : 'Ports always hidden on this block · click to follow the Wiring switch';
      btn.setAttribute('aria-label', 'Ports visibility');
    };
    btn.addEventListener('click', () => { this.history.execute(cmd.setShowPorts(this.world, [b], b.showPorts === null ? true : b.showPorts === true ? false : null)); upd(); });
    upd(); this.live.push(upd);
    box.appendChild(btn);
    return box;
  }

  _buildWorkspace() {
    const { world, ws, gizmo, flow, engine, history } = this;
    this._header('workspace', 'Workspace', 'nothing selected');
    const s = this._section('Workspace');
    this._select(s, 'theme', ['dark', 'light'], () => getTheme(), (v) => setTheme(v));
    if (this.wiring) {
      this._check(s, 'wiring (P)', () => this.wiring.isOn(), (v) => this.wiring.set(v), 'wiring');
      s.appendChild(this._h('div', 'panel-note', 'Wiring off hides every port and cable. Drop a component onto another to link them; a block can still show its own ports (eye icon in its header).'));
    }
    this._check(s, 'grid', () => ws.isGridVisible(), (v) => ws.setGridVisible(v));
    if (this.plan) {
      this._check(s, '2D editing mode (2)', () => this.plan.isOn(), (v) => this.plan.set(v));
      this._check(s, 'snap to grid', () => this.plan.snap.on, (v) => this.plan.snap.set(v));
    }
    this._check(s, 'flow animation', () => flow.isEnabled(), (v) => flow.setEnabled(v));
    this._num(s, 'flow speed', () => flow.getSpeed(), (v) => flow.setSpeed(v), { step: 0.1, min: 0, max: 5 });
    this._num(s, 'LOD distance', () => sizes.lod.far, (v) => { sizes.lod.far = Math.max(10, v); }, { step: 2, min: 10, max: 200 });
    this._buildControls();
    const g = this._section('Gizmo');
    this._check(g, 'enabled (G)', () => gizmo.enabled, (v) => { gizmo.setEnabled(v); this.onGizmoToggle?.(); });
    this._buttons(g, 'mode', [['translate', 'Move', 'W'], ['rotate', 'Rotate', 'E'], ['scale', 'Scale', 'R']], () => gizmo.mode, (v) => gizmo.setMode(v));
    const sum = this._section('Scene');
    this._readonly(sum, 'components', () => `${world.nodes.length} (${world.nodes.filter((b) => b.kind === 'device').length} devices)`);
    this._readonly(sum, 'connections', () => `${world.connections.length} (${world.connections.filter((c) => !c.valid).length} invalid)`);
    this._readonly(sum, 'groups', () => String(world.groups.length));
    this._readonly(sum, 'carrying data', () => String(world.connections.filter((c) => c.value !== undefined).length));
    this._readonly(sum, 'evaluations', () => String(engine.evaluations));
    this._readonly(sum, 'history', () => `${history.undoStack.length} undo · ${history.redoStack.length} redo`);
    const reg = this._section('Registry', false);
    this._readonly(reg, 'component types', () => String(registry.all().length));
    registry.categories().forEach((c) => this._readonly(reg, c.label, () => c.components.map((d) => d.label).join(', ')));
  }

  /** Navigation presets (Blender default, Unreal, Maya, Simple) and their per-preset settings. */
  _buildControls() {
    const c = this._section('Controls');
    const sel = this._select(c, 'preset', PRESET_IDS, () => nav.presetId, (v) => { nav.setPreset(v); this.build(); }, 'navPreset');
    sel.querySelectorAll('option').forEach((o) => { o.textContent = nav.presets[o.value].label; });
    c.appendChild(this._h('div', 'panel-note', nav.preset.description));
    const S = () => nav.settings;
    this._check(c, 'invert orbit', () => S().invertOrbit, (v) => nav.setSetting('invertOrbit', v), 'invertOrbit');
    this._check(c, 'invert zoom', () => S().invertZoom, (v) => nav.setSetting('invertZoom', v), 'invertZoom');
    this._num(c, 'orbit sensitivity', () => S().orbitSpeed, (v) => nav.setSetting('orbitSpeed', Math.min(4, Math.max(0.1, v))), { step: 0.1, min: 0.1, max: 4, attr: 'orbitSpeed' });
    this._num(c, 'pan sensitivity', () => S().panSpeed, (v) => nav.setSetting('panSpeed', Math.min(4, Math.max(0.1, v))), { step: 0.1, min: 0.1, max: 4, attr: 'panSpeed' });
    this._check(c, 'zoom to cursor', () => S().zoomToCursor, (v) => nav.setSetting('zoomToCursor', v), 'zoomToCursor');
    if (nav.preset.fly) this._num(c, 'fly speed', () => S().flySpeed, (v) => nav.setSetting('flySpeed', Math.min(10, Math.max(0.1, v))), { step: 0.1, min: 0.1, max: 10, attr: 'flySpeed' });
    this._readonly(c, 'orbit', () => nav.binding('orbit') || '—');
    this._readonly(c, 'pan', () => nav.binding('pan') || '—');
    this._readonly(c, 'zoom', () => nav.binding('dolly') || 'Wheel');
    this._action(c, 'Reset settings', () => { nav.resetSettings(); this.build(); });
    this._action(c, 'Full cheat sheet (help below)', () => { const h = document.getElementById('help'); if (h) { h.open = true; h.scrollIntoView({ block: 'start' }); } });
  }

  _transformSection(nodes) {
    const t = this._section('Transform');
    const single = nodes.length === 1;
    const centroid = (axis) => nodes.reduce((a, n) => a + n.position[axis], 0) / nodes.length;
    const moveAxis = (axis, v) => {
      const before = nodes.map(cmd.snapshot);
      const delta = v - centroid(axis);
      nodes.forEach((n) => { n.position[axis] += delta; if (axis === 'y') n.position.y = Math.max(n.kind === 'device' ? 0 : 0.2, n.position.y); });
      this.world.bumpLayout();
      this.history.executeCoalesced(`move:${axis}`, cmd.transform(this.world, nodes, before, nodes.map(cmd.snapshot)));
    };
    ['x', 'y', 'z'].forEach((axis) => this._num(t, `${single ? 'position' : 'centre'} ${axis}`, () => centroid(axis), (v) => moveAxis(axis, v), { step: 0.5 }));
    if (single) {
      const b = nodes[0];
      this._num(t, 'rotation y°', () => b.rotation.y * RAD, (v) => { const before = [cmd.snapshot(b)]; b.rotation.y = v / RAD; this.history.executeCoalesced('rot', cmd.transform(this.world, [b], before, [cmd.snapshot(b)])); }, { step: 5 });
      this._num(t, 'scale', () => b.scale.x, (v) => { const before = [cmd.snapshot(b)]; b.scale.setScalar(Math.min(Math.max(v, 0.2), 4)); this.history.executeCoalesced('scale', cmd.transform(this.world, [b], before, [cmd.snapshot(b)])); }, { step: 0.1, min: 0.2, max: 4 });
    }
    if (this.gizmo.enabled) this._buttons(t, 'gizmo', [['translate', 'Move', 'W'], ['rotate', 'Rotate', 'E'], ['scale', 'Scale', 'R']], () => this.gizmo.mode, (v) => this.gizmo.setMode(v));
    return t;
  }

  _buildBlock(b) {
    const def = b.def;
    const cat = registry.category(def.category);
    this._header(def.id in icons ? def.id : def.category, b.title, `${def.label} · ${cat.label}`, (v) => this.history.executeCoalesced(`title:${b.uid}`, cmd.setTitle(this.world, b, v)), this._portsEye(b));
    this._transformSection([b]);

    const n = this._section('Component');
    this._readonly(n, 'type', () => `${def.label} (${def.id})`);
    this._readonly(n, 'about', () => def.description);
    this._check(n, 'enabled', () => b.enabled, (v) => this.history.execute(cmd.setEnabled(this.world, b, v)), 'enabled');
    this._readonly(n, 'state', () => b.derivedState + (b.rt?.error ? ` · ${b.rt.error}` : ''));
    if (b.group) this._readonly(n, 'group', () => b.group?.title || '—');
    const setP = (key) => (v) => { this.history.executeCoalesced(`param:${b.uid}:${key}`, cmd.setParam(this.world, b, key, v)); };
    for (const p of def.params) {
      if (p.hidden) continue;   // edited by the component's own panel section (boards, checklists)
      const get = () => b.params[p.key];
      switch (p.type) {
        case 'number': this._num(n, p.label, get, setP(p.key), { step: p.step ?? 0.1, min: p.min, max: p.max, attr: p.key }); break;
        case 'boolean': this._check(n, p.label, get, setP(p.key), p.key); break;
        case 'select': this._select(n, p.label, p.options, get, setP(p.key), p.key); break;
        case 'json': this._json(n, p.label, get, setP(p.key), p.key); break;
        case 'color': this._color(n, p.label, get, setP(p.key), p.key); break;
        default: this._text(n, p.label, () => String(get() ?? ''), setP(p.key), p.key);
      }
    }
    if (b.footerText !== undefined) this._readonly(n, 'footer', () => b.footerText || '—');
    // Component-owned editors (Kanban cards / columns, timeline tasks, checklist items…)
    if (def.panel) { try { def.panel(this._api(b), b); } catch (e) { this._readonly(n, 'panel error', () => e.message); } }

    const p = this._section('Ports');
    const list = this._h('ul', 'ports'); p.appendChild(list);
    b.ports.forEach((port) => {
      const li = this._h('li');
      li.appendChild(this._dot(port.color));
      li.appendChild(this._h('span', 'pdir', port.dir === 'in' ? '→ in' : 'out →'));
      li.appendChild(this._h('span', 'pname', `${port.label}${port.multi ? ' *' : ''}`));
      const val = this._h('span', 'pval'); li.appendChild(val);
      const cnt = this._h('span', 'pcount'); li.appendChild(cnt);
      li.title = `${portTypeText(port)}${port.multi ? ' (accepts several cables)' : ''}${port.optional ? ', optional' : ''}`;
      list.appendChild(li);
      this.live.push(() => {
        val.textContent = formatValue(port.value, 22);
        const k = this.world.connectionsOf(port).length;
        cnt.textContent = k ? `${k} link${k > 1 ? 's' : ''}` : portTypeName(port);
        li.querySelector('.dot').style.background = hex(port.color);
      });
    });
  }

  /** The small API handed to def.panel(api, block): DOM helpers bound to this panel + undoable writes. */
  _api(b) {
    const self = this;
    return {
      block: b, world: this.world, history: this.history, selection: this.selection, panel: this, icons,
      h: (tag, cls, text) => self._h(tag, cls, text),
      section: (title, open = true) => self._section(title, open),
      row: (parent, label) => self._row(parent, label),
      readonly: (parent, label, get) => self._readonly(parent, label, get),
      num: (parent, label, get, set, o) => self._num(parent, label, get, set, o),
      text: (parent, label, get, set, attr) => self._text(parent, label, get, set, attr),
      area: (parent, label, get, set, attr, rows) => self._area(parent, label, get, set, attr, rows),
      date: (parent, label, get, set, attr) => self._date(parent, label, get, set, attr),
      check: (parent, label, get, set, attr) => self._check(parent, label, get, set, attr),
      select: (parent, label, options, get, set, attr) => self._select(parent, label, options, get, set, attr),
      buttons: (parent, label, options, get, set) => self._buttons(parent, label, options, get, set),
      action: (parent, text, fn, id) => self._action(parent, text, fn, id),
      color: (parent, label, get, set, attr) => self._color(parent, label, get, set, attr),
      live: (fn) => self.live.push(fn),
      exec: (c) => self.history.execute(c),
      /** Undoable param write; `coalesce` merges rapid edits (typing) under one history entry. */
      setParam: (key, value, coalesce) => (coalesce ? self.history.executeCoalesced(`param:${b.uid}:${key}:${coalesce}`, cmd.setParam(self.world, b, key, value)) : self.history.execute(cmd.setParam(self.world, b, key, value))),
      rebuild: () => self.build(),
      persons: () => self.world.nodes.filter((n) => n.typeId === 'person'),
    };
  }

  _buildMulti(items) {
    const nodes = items.filter((i) => i.kind === 'node' || i.kind === 'device');
    const groups = items.filter((i) => i.kind === 'group');
    const conns = items.filter((i) => i.kind === 'connection');
    this._header('group', `${items.length} selected`, [nodes.length && `${nodes.length} components`, groups.length && `${groups.length} groups`, conns.length && `${conns.length} links`].filter(Boolean).join(' · '));
    if (nodes.length) this._transformSection(nodes);
    const a = this._section('Selection');
    this._action(a, 'Group (Ctrl+G)', () => this.interaction.groupSelection(), 'btn-group-sel');
    this._action(a, 'Duplicate (Ctrl+D)', () => this.interaction.duplicateSelection());
    this._action(a, 'Delete', () => this.interaction.deleteSelection());
    const l = this._section('Items');
    items.forEach((i) => this._readonly(l, i.kind, () => (i.kind === 'connection' ? `${i.from.owner.title} → ${i.to?.owner.title}` : i.title)));
  }

  _buildGroup(g) {
    this._header('group', g.title, `group · ${g.members.length} components`, (v) => this.history.executeCoalesced(`gtitle:${g.uid}`, cmd.setGroupTitle(this.world, g, v)));
    const s = this._section('Group');
    this._check(s, 'collapsed (C)', () => g.collapsed, (v) => this.history.execute(cmd.setCollapsed(this.world, g, v)), 'collapsed');
    this._readonly(s, 'members', () => g.members.map((m) => m.title).join(', '));
    this._readonly(s, 'size', () => `${g.bounds.w.toFixed(1)} × ${g.bounds.d.toFixed(1)} units`);
    this._action(s, 'Ungroup (Ctrl+Shift+G)', () => this.interaction.ungroupSelection(), 'btn-ungroup');
    if (g.collapsed) {
      const p = this._section('Exposed ports');
      const list = this._h('ul', 'ports'); p.appendChild(list);
      g.ports.forEach((port) => {
        const li = this._h('li'); li.appendChild(this._dot(port.color));
        li.appendChild(this._h('span', 'pdir', port.dir === 'in' ? '→ in' : 'out →'));
        li.appendChild(this._h('span', 'pname', port.label)); list.appendChild(li);
      });
    }
  }

  _buildConnection(c) {
    this._header('connection', 'Connection', `${portTypeName(c.from)} link`);
    const s = this._section('Connection');
    const meaning = describeLink(c);
    if (meaning) { const m = this._h('div', 'pm-hint link-meaning', meaning); m.id = 'link-meaning'; s.appendChild(m); }
    this._readonly(s, 'from', () => `${c.from.owner.title} · ${c.from.label}`);
    this._readonly(s, 'to', () => (c.to ? `${c.to.owner.title} · ${c.to.label}` : '—'));
    this._readonly(s, 'type', () => {
      const k = c.to ? compatiblePorts(c.from, c.to) : 'ok';
      const a = portTypeText(c.from), b = c.to ? portTypeText(c.to) : '';
      return k === 'invalid' ? `${a} → ${b} (${mismatchReason(c.from, c.to)})` : `${a}${c.to && b !== a ? ` → ${b}${k === 'coerce' ? ' (converted)' : ''}` : ''}`;
    });
    this._readonly(s, 'state', () => c.derivedState);
    this._readonly(s, 'value', () => formatValue(c.value, 40));
    this._readonly(s, 'changes / s', () => (c.from.rate || 0).toFixed(1));
    this._readonly(s, 'flow velocity', () => `${c.velocity.toFixed(2)} u/s`);
    const ty = this._h('div', 'row'); ty.appendChild(this._h('label', null, 'colour')); ty.appendChild(this._dot(c.color.getHex())); s.appendChild(ty);
    this._action(s, 'Disconnect (Del)', () => this.interaction.deleteSelection());
  }
}
