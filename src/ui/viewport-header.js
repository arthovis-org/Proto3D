// ui/viewport-header.js — the viewport header: a compact floating bar centred at the top of the
// viewport (Blender's 3D-viewport header) that holds Wiring (with the cable settings), Snap and Gizmo. Each group is an
// icon button plus a caret that opens a popover with that group's settings (Blender's "Snap To"
// panel). Every control calls the same functions the View menu and the keys call (main.js
// toggleSnap / setSnapOption / setGizmo / gizmo.setMode / setCableOption), so the menu, the keys
// and this bar never disagree; `sync()` re-reads the state (main.js calls it from syncToolbar,
// snap.onChange and cables.onChange). Presentation only: no state of its own but the open popover.
import { icons } from '../icons.js';
import { attachScrub } from './scrub.js';
import { uiScale } from './ui-prefs.js';

const MODES = [['translate', 'Move', 'W', 'move'], ['rotate', 'Rotate', 'E', 'rotate'], ['scale', 'Scale', 'R', 'scale']];
const MARGIN = 8;
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

export class ViewportHeader {
  /**
   * @param {object} o { el, viewport, snap, cables, gizmo, isPlanOn(), toggleSnap(), setSnapOption(k, v), setGizmo(on),
   *   setGizmoMode(m), setCableOption(k, v), isWiringOn(), toggleWiring(), portsOnSelection() → { n, v: true | false | null },
   *   setPortsOnSelection(v), isFlowEnabled(), setFlowEnabled(on), GRID_SIZES, ROTATION_STEPS, SCALE_STEPS, CABLE_STYLES, THICKNESSES, fmtDeg, fmtScale }
   */
  constructor(o) {
    Object.assign(this, o);
    this.open = null;   // the group whose popover is open
    this.live = [];     // the open popover's refreshers
    const el = this.el;
    el.setAttribute('role', 'toolbar'); el.setAttribute('aria-label', 'Viewport header: wiring, snap, gizmo');
    this.groups = {};
    this._group('wiring', icons.flow, 'Wiring', () => this.toggleWiring());
    this._group('snap', icons.magnet, 'Snap', () => this.toggleSnap());
    this._group('gizmo', icons.move, 'Gizmo', () => this.setGizmo(!this.gizmo.enabled));
    this.pop = h('div', 'vph-pop'); this.pop.hidden = true; this.pop.setAttribute('role', 'group');
    el.appendChild(this.pop);
    document.addEventListener('pointerdown', (e) => { if (this.open && !el.contains(e.target)) this.close(); }, true);
    window.addEventListener('keydown', (e) => { if (this.open && e.key === 'Escape' && !el.querySelector('input.scrubbing')) { e.preventDefault(); e.stopPropagation(); this.close(true); } }, true);
    window.addEventListener('resize', () => this._place());
    this.snap.onChange(() => this.sync());
    this.cables.onChange(() => this.sync());
    this.sync();
  }

  /* ---------- the bar ---------- */
  _group(id, icon, label, onClick, isToggle = true) {
    const g = h('div', 'vph-group'); g.dataset.group = id;
    const b = h('button', 'vph-btn'); b.type = 'button'; b.id = `vph-${id}`; b.innerHTML = `<i>${icon}</i>`; b.setAttribute('aria-label', label);
    if (isToggle) b.setAttribute('aria-pressed', 'false'); else b.setAttribute('aria-haspopup', 'true');
    b.addEventListener('click', onClick);
    const c = h('button', 'vph-caret'); c.type = 'button'; c.innerHTML = icons.chevron; c.title = `${label} settings`;
    c.setAttribute('aria-label', `${label} settings`); c.setAttribute('aria-haspopup', 'true'); c.setAttribute('aria-expanded', 'false');
    c.addEventListener('click', () => this.toggle(id));
    g.append(b, c); this.el.appendChild(g);
    this.groups[id] = { g, b, c };
  }
  /** Re-read snap / gizmo / cable state into the buttons and the open popover. */
  sync() {
    const { snap, gizmo, cables } = this, plan = this.isPlanOn();
    const wr = this.groups.wiring, wOn = this.isWiringOn();
    wr.b.classList.toggle('on', wOn); wr.b.setAttribute('aria-pressed', String(wOn));
    wr.b.title = 'Wiring — show or hide ports and cables (P). Cables are optional: drop a component onto another to link them';
    const sn = this.groups.snap;
    sn.b.classList.toggle('on', snap.on); sn.b.setAttribute('aria-pressed', String(snap.on));
    sn.b.title = `${snap.summary()} · M toggles · Shift while dragging skips it, Ctrl halves the grid`;
    const gz = this.groups.gizmo, mode = MODES.find(([m]) => m === gizmo.mode) || MODES[0];
    gz.b.classList.toggle('on', gizmo.enabled && !plan); gz.b.setAttribute('aria-pressed', String(gizmo.enabled));
    gz.b.disabled = plan; gz.c.disabled = plan; gz.b.dataset.mode = gizmo.mode;
    gz.b.querySelector('i').innerHTML = icons[mode[3]];
    gz.b.title = plan ? 'Gizmo — hidden in the 2D editing mode: drag blocks to move them' : `${mode[1]} gizmo (G) · W move, E rotate, R scale`;
    if (plan && this.open === 'gizmo') this.close();
    if (this.open === 'wiring') this.groups.wiring.c.title = `Wiring settings · ${cables.summary()}`;
    this.live.forEach((f) => f());
  }

  /* ---------- popovers ---------- */
  toggle(id) { if (this.open === id) this.close(); else this.openPopover(id); }
  openPopover(id) {
    if (id === 'gizmo' && this.isPlanOn()) return;
    this.open = id; this.live = [];
    this.pop.innerHTML = ''; this.pop.dataset.group = id; this.pop.setAttribute('aria-label', `${id} settings`);
    ({ wiring: this._popWiring, snap: this._popSnap, gizmo: this._popGizmo })[id].call(this, this.pop);
    this.pop.hidden = false; this.el.classList.add('open');
    for (const [k, gr] of Object.entries(this.groups)) { gr.g.classList.toggle('open', k === id); gr.c.setAttribute('aria-expanded', String(k === id)); }
    this._place(); this.sync();
  }
  close(refocus = false) {
    if (!this.open) return;
    const id = this.open; this.open = null; this.live = [];
    this.pop.hidden = true; this.pop.innerHTML = ''; this.el.classList.remove('open');
    for (const gr of Object.values(this.groups)) { gr.g.classList.remove('open'); gr.c.setAttribute('aria-expanded', 'false'); }
    if (refocus) this.groups[id].c.focus({ preventScroll: true });
  }
  /** Under its group's left edge, clamped inside the viewport. */
  _place() {
    if (!this.open) return;
    const { g } = this.groups[this.open];
    this.pop.style.left = `${g.offsetLeft}px`;
    const pr = this.pop.getBoundingClientRect(), vp = (this.viewport || document.body).getBoundingClientRect();
    let dx = 0;
    if (pr.right > vp.right - MARGIN) dx = vp.right - MARGIN - pr.right;
    if (pr.left + dx < vp.left + MARGIN) dx = vp.left + MARGIN - pr.left;
    this.pop.style.left = `${g.offsetLeft + dx / uiScale()}px`;   // dx is screen px; the header is drawn at the UI scale
  }

  _title(p, text) { p.appendChild(h('div', 'vph-title', text)); }
  _sep(p) { p.appendChild(h('div', 'vph-sep')); }
  _note(p, text) { p.appendChild(h('div', 'vph-note', text)); }
  _row(p, label) { const r = h('div', 'row vph-row'); r.appendChild(h('label', null, label)); p.appendChild(r); return r; }
  _check(p, label, get, set, hint) {
    const b = h('button', 'vph-row vph-check'); b.type = 'button'; b.setAttribute('role', 'menuitemcheckbox');
    b.innerHTML = `<i class="vph-tick">${icons.check}</i>`; b.appendChild(h('span', 'vph-lbl', label)); if (hint) b.title = hint;
    b.addEventListener('click', () => set(!get()));
    p.appendChild(b);
    this.live.push(() => { const on = !!get(); b.classList.toggle('checked', on); b.setAttribute('aria-checked', String(on)); });
    return b;
  }
  _seg(p, label, options, get, set, { stack = false, enabled = () => true } = {}) {
    const r = this._row(p, label), g = h('div', 'btn-group'); if (stack) r.classList.add('stack'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
    const btns = options.map(([value, text, title]) => { const b = h('button', null, text); b.type = 'button'; b.title = title || text; b.dataset.value = String(value); b.addEventListener('click', () => set(value)); g.appendChild(b); return b; });
    r.appendChild(g);
    this.live.push(() => { const v = String(get()), en = enabled(); r.classList.toggle('off', !en); btns.forEach((b) => { const on = b.dataset.value === v; b.disabled = !en; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); });
    return g;
  }
  _num(p, label, get, set, { step, min, max, enabled = () => true }) {
    const r = this._row(p, label), i = h('input'); i.type = 'number'; i.step = step; i.min = min; i.max = max; i.setAttribute('aria-label', label);
    i.addEventListener('input', () => { const v = parseFloat(i.value); if (Number.isFinite(v)) set(v); });
    attachScrub(i, { step, min, max, get, set });
    r.appendChild(i);
    this.live.push(() => { i.disabled = !enabled(); r.classList.toggle('off', i.disabled); if (document.activeElement !== i) { const v = get(); i.value = typeof v === 'number' ? String(+v.toFixed(3)) : ''; } });
    return i;
  }

  _popWiring(p) {
    const PORTS = { follow: null, show: true, hide: false };
    this._title(p, 'Wiring');
    this._check(p, 'Wiring (P)', () => this.isWiringOn(), () => this.toggleWiring(), 'show or hide every port and cable');
    this._seg(p, 'ports on selection', [['follow', 'Follow switch', 'the selected blocks show ports when Wiring is on'], ['show', 'Always show', 'the selected blocks keep their ports'], ['hide', 'Always hide', 'the selected blocks never show ports']],
      () => { const { v } = this.portsOnSelection(); return v === true ? 'show' : v === false ? 'hide' : 'follow'; }, (k) => this.setPortsOnSelection(PORTS[k]), { stack: true, enabled: () => this.portsOnSelection().n > 0 });
    this._check(p, 'Flow animation', () => this.isFlowEnabled(), (v) => this.setFlowEnabled(v), 'animated flow along the cables');
    this._sep(p);
    this._title(p, 'Cables');
    this._cableRows(p);
    this._note(p, 'Cables are optional: drop a component onto another to link them · drop a cable on empty space to add a component');
  }
  /** The cable settings (cables.js) as rows of the Wiring popover; every write goes through setCableOption like View → Cables. */
  _cableRows(p) {
    const C = this.cables, set = (k) => (v) => this.setCableOption(k, v);
    this._seg(p, 'style', this.CABLE_STYLES.map(([id, l, d]) => [id, l, d]), () => C.style, set('style'), { stack: true });
    this._num(p, 'corner rounding', () => C.cornerRadius, set('cornerRadius'), { step: 0.05, min: 0, max: 1, enabled: () => C.style === 'orthogonal' });
    this._seg(p, 'thickness', this.THICKNESSES.map(([id, l]) => [id, l, `${l} cables`]), () => C.thickness, set('thickness'));
    this._check(p, 'Bundle parallel cables', () => C.bundle, set('bundle'), 'cables running side by side merge into one trunk');
    this._num(p, 'bundle distance', () => C.bundleDistance, set('bundleDistance'), { step: 0.1, min: 0.2, max: 4, enabled: () => !!C.bundle });
    this._check(p, 'Show waypoints', () => C.showWaypoints, set('showWaypoints'), 'always show the route handles · else on hover and selection');
  }
  _popSnap(p) {
    const S = this.snap, set = (k) => (v) => this.setSnapOption(k, v), deg = this.fmtDeg, sc = this.fmtScale;
    this._title(p, 'Snap to');
    this._check(p, 'Grid', () => S.grid, set('grid'), 'blocks land on grid steps · Ctrl halves it');
    this._seg(p, 'grid size', this.GRID_SIZES.map((g) => [g, String(g), `${g} unit${g === 1 ? '' : 's'}`]), () => S.gridSize, (v) => set('gridSize')(+v));
    this._check(p, 'Objects', () => S.objects, set('objects'), 'edges and centres line up with neighbours');
    this._check(p, 'Ports', () => S.ports, set('ports'), 'a pin lands level with the pin it is wired to · cables run straight');
    this._sep(p);
    this._check(p, 'Rotation', () => S.rotation, set('rotation'), 'stepped rotation on the gizmo (E)');
    this._seg(p, 'step', this.ROTATION_STEPS.map((d) => [d, deg(d), `${deg(d)} per gizmo step`]), () => S.rotationStep, (v) => set('rotationStep')(+v), { stack: true });
    this._num(p, 'custom (°)', () => S.rotationStep, set('rotationStep'), { step: 5, min: 0.5, max: 180 });
    this._sep(p);
    this._check(p, 'Scale', () => S.scale, set('scale'), 'stepped scaling on the gizmo (R)');
    this._seg(p, 'step', this.SCALE_STEPS.map((x) => [x, sc(x), `${sc(x)} per gizmo step`]), () => S.scaleStep, (v) => set('scaleStep')(+v), { stack: true });
    this._num(p, 'custom', () => S.scaleStep, set('scaleStep'), { step: 0.05, min: 0.01, max: 4 });
    this._note(p, 'M toggles snapping · Shift while dragging skips it · Ctrl halves the grid');
  }
  _popGizmo(p) {
    const G = this.gizmo;
    this._title(p, 'Gizmo');
    this._check(p, 'Gizmo (G)', () => G.enabled, (v) => this.setGizmo(v), 'move / rotate / scale handles on the selection');
    this._seg(p, 'mode', MODES.map(([m, l, k]) => [m, l, `${l} (${k})`]), () => G.mode, (m) => this.setGizmoMode(m));
    this._note(p, 'W move · E rotate · R scale');
  }

}
