// ui/mini-toolbar.js — the small floating toolbar above the selection. An HTML overlay (not a
// 3D object) anchored to the selection's projected bounding box, re-placed every frame from the
// world AABBs, clamped to the viewport, flipped below the selection when there is no room above,
// and pushed clear of the job tray / stats. Hidden while a block, cable, marquee, face, sub or
// gizmo drag is in flight, while a face field is pressed, and while the camera moves; fades in
// over 120 ms once things are still. It stays up in edit mode (the pencil reads Done).
//
//   Edit (one block with fields: enter / leave edit mode, ui/field-editor.js) · Duplicate · Delete · Ports (follow / show / hide, per-block override) · Auto-layout (two or
//   more blocks) · Collapse / expand
//   (groups, or the group the block is in) · Run (components with a run / trigger: Generate faces,
//   Input buttons and toggles, Flow Terminals, Actions and anything with an event input named
//   run / trigger / in / start) · Frame · More (the properties panel focused on the block).
//
// A multi-selection shows only the actions that apply to every item. Every edit goes through
// the same code path as its menu item or key, so it lands in History and undoes.
import * as THREE from 'three';
import * as cmd from '../core/commands.js';
import { icons } from '../icons.js';
import { shortcutText } from './menubar.js';
import { uiScale } from './ui-prefs.js';

const _box = new THREE.Box3(), _tmp = new THREE.Box3(), _v = new THREE.Vector3();
const GAP = 10;      // px between the selection box and the toolbar
const MARGIN = 8;    // px kept from the viewport edges
const RUN_INPUTS = ['run', 'trigger', 'in', 'start'];

/** What "Run" means for a block, or null when it has no run / trigger. Returns { label, hint, run() }. */
export function runSpecFor(node, engine) {
  if (!node || node.kind === 'group') return null;
  const def = node.def; if (!def) return null;
  if (def.category === 'generate' && Array.isArray(node._hits) && node.face) {
    const hit = node._hits.find((h) => h.action === 'run' || h.action === 'stop');
    if (!hit) return null;
    const u = (hit.x + hit.w / 2) / node.face.cw, v = (hit.y + hit.h / 2) / node.face.ch;
    const stop = hit.action === 'stop';
    return { label: stop ? 'Stop' : 'Run', hint: stop ? 'Stop the running generation' : 'Generate — the face\'s Run button', icon: stop ? 'stop' : 'play', run: () => node.onFacePointer({ type: 'click', u, v }) };
  }
  if (def.id === 'input' && (node.params.mode === 'button' || node.params.mode === 'toggle')) {
    const toggle = node.params.mode === 'toggle';
    return { label: toggle ? 'Toggle' : 'Tap', hint: toggle ? 'Flip the toggle — fires trigger' : `Press ${node.params.label || 'the button'} — fires trigger`, icon: 'play', run: () => node.onFacePointer({ type: 'click', u: 0.5, v: 0.45 }) };
  }
  if (def.id === 'flow-terminal' && node.params.mode === 'start' && node.onSubPointer) {
    return { label: 'Run', hint: 'Start the flow — the terminal\'s Run button', icon: 'play', run: () => node.onSubPointer({ type: 'click', sub: { kind: 'run' } }) };
  }
  const port = node.inputs?.find((p) => p.type === 'event' && RUN_INPUTS.includes(p.key));
  if (port && engine) return { label: 'Trigger', hint: `Pulse the ${port.label} input`, icon: 'play', run: () => engine.trigger(node, port.key) };
  return null;
}

export class MiniToolbar {
  /**
   * @param {object} o { el, ws, world, engine, selection, interaction, history, gizmo, avoid: () => HTMLElement[], onMore(items) }
   */
  constructor({ el, ws, world, engine, selection, interaction, history, gizmo = null, avoid = () => [], onMore = () => {}, onLayout = null }) {
    Object.assign(this, { el, ws, world, engine, selection, interaction, history, gizmo, avoid, onMore, onLayout });
    this.el.setAttribute('role', 'toolbar'); this.el.setAttribute('aria-label', 'Selection');
    this.sig = '';           // what the buttons were built for
    this.visible = false;    // shown (fading in or settled)
    this.flipped = false;    // placed below the selection
    this.rect = null;        // last projected selection rect (screen px)
    this._pendingShow = 0;
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());   // never starts a marquee or deselects
    selection.onChange(() => { this.sig = ''; });
    world.onChange(() => { this.sig = ''; });
  }

  /* ---------- state ---------- */
  /** Something is in flight: the toolbar keeps out of the way. */
  get busy() {
    const I = this.interaction, C = this.ws.controls;
    return !!(I.drag || I.connect || I.marquee || I.subDrag || I.faceDrag || I.pendingDetach || I.pressField || (this.gizmo && (this.gizmo.dragging || this.gizmo.hot)) || C.drag || C.moving || this.ws.inFlight?.());
  }
  _items() { return this.selection.items.filter((i) => i.kind !== 'connection'); }

  /** The actions that apply to every selected item. */
  actions(items = this._items()) {
    if (!items.length) return [];
    const nodes = items.filter((i) => i.kind !== 'group');
    const groupsOf = items.map((i) => (i.kind === 'group' ? i : i.group)).filter(Boolean);
    const allInGroups = groupsOf.length === items.length;
    const list = [];
    const sc = shortcutText;
    const FE = this.interaction.fieldEditor;
    if (FE && items.length === 1 && nodes.length === 1 && FE.editable(nodes[0])) {
      const on = FE.editBlock === nodes[0];
      list.push({ id: 'edit', icon: 'edit', label: on ? 'Done' : 'Edit', text: on, hint: on ? 'leave edit mode' : 'edit the text on this block where it is drawn (double-click does too)', shortcut: on ? 'Esc' : 'Enter', on, run: () => FE.toggleEdit(nodes[0]) });
    }
    list.push({ id: 'duplicate', icon: 'copy', label: 'Duplicate', shortcut: sc('Ctrl+D'), run: () => this.interaction.duplicateSelection() });
    list.push({ id: 'delete', icon: 'trash', label: 'Delete', shortcut: 'Del', danger: true, run: () => this.interaction.deleteSelection() });
    if (nodes.length === items.length) {
      const v = nodes.every((n) => n.showPorts === nodes[0].showPorts) ? nodes[0].showPorts : 'mixed';
      const next = v === null ? true : v === true ? false : null;
      const state = v === 'mixed' ? 'Ports differ per block' : v === null ? `Ports follow the Wiring switch (${nodes[0].portsVisible ? 'shown' : 'hidden'})` : v ? 'Ports always shown' : 'Ports always hidden';
      const to = next === null ? 'follow the Wiring switch' : next ? 'always show' : 'always hide';
      list.push({ id: 'ports', icon: v === true ? 'eye' : v === false ? 'eyeOff' : 'flow', label: 'Ports', hint: `${state} · click to ${to}`, on: v === true, off: v === false, run: () => this.history.execute(cmd.setShowPorts(this.world, nodes, next)) });
    }
    const blocks = items.flatMap((i) => (i.kind === 'group' ? (i.collapsed ? [] : i.members) : [i]));
    if (this.onLayout && blocks.length > 1) list.push({ id: 'layout', icon: 'autoLayout', label: 'Auto-layout', hint: `arrange these ${blocks.length} blocks left to right along their cables`, shortcut: 'L', run: () => this.onLayout(blocks) });
    if (allInGroups) {
      const collapsed = groupsOf.every((g) => g.collapsed);
      list.push({ id: 'collapse', icon: collapsed ? 'expand' : 'collapse', label: collapsed ? 'Expand group' : 'Collapse group', shortcut: 'C', run: () => this.interaction.toggleCollapseSelection() });
    }
    const runs = items.map((i) => runSpecFor(i, this.engine));
    if (runs.length && runs.every(Boolean)) {
      const same = runs.every((r) => r.label === runs[0].label);
      list.push({ id: 'run', icon: runs[0].icon, label: same ? runs[0].label : 'Run', hint: runs.length === 1 ? runs[0].hint : `${runs.length} blocks`, accent: true, run: () => runs.forEach((r) => r.run()) });
    }
    list.push({ id: 'frame', icon: 'frame', label: 'Frame', shortcut: 'F', run: () => this.interaction.focusSelection() });
    list.push({ id: 'more', icon: 'more', label: 'More', hint: 'properties panel', shortcut: 'N', run: () => this.onMore(items) });
    return list;
  }

  /* ---------- DOM ---------- */
  _build(items) {
    this.el.innerHTML = '';
    for (const a of this.actions(items)) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'mtb-btn'; b.dataset.action = a.id;
      if (a.danger) b.classList.add('danger'); if (a.accent) b.classList.add('accent'); if (a.on) b.classList.add('on'); if (a.off) b.classList.add('off');
      b.innerHTML = `${icons[a.icon] || icons.node}${a.id === 'run' || a.text ? `<span class="mtb-text">${a.label}</span>` : ''}`;
      b.title = `${a.label}${a.hint ? ` · ${a.hint}` : ''}${a.shortcut ? ` (${a.shortcut})` : ''}`;
      b.setAttribute('aria-label', a.label);
      b.addEventListener('click', (e) => { e.stopPropagation(); a.run(); this.sig = ''; });
      this.el.appendChild(b);
    }
  }
  _signature(items) {
    const EB = this.interaction.fieldEditor?.editBlock;
    return items.map((i) => `${i.uid}:${i === EB ? 'E' : '-'}${i.kind === 'group' ? (i.collapsed ? 'c' : 'e') : `${i.showPorts}/${i.portsVisible ? 1 : 0}/${i.group ? (i.group.collapsed ? 'c' : 'e') : '-'}/${runSpecFor(i, this.engine)?.label || ''}`}`).join('|');
  }

  /* ---------- geometry ---------- */
  /** Union AABB of the selection in world space (groups: members, or the collapsed slab). */
  bounds(items, box = _box) {
    box.makeEmpty();
    for (const i of items) {
      if (i.kind === 'group') {
        if (i.collapsed && i.slab) { const b = i.bounds, h = i.slab.userData.h || 2; _tmp.min.set(b.minX, 0, b.minZ); _tmp.max.set(b.maxX, h + 0.4, b.maxZ); box.union(_tmp); }
        else for (const m of i.members) box.union(m.getAABB(_tmp));
      } else if (i.getAABB) box.union(i.getAABB(_tmp));
    }
    return box;
  }
  /** Screen-space rect of a world box (px, in page coordinates) or null when it is behind the camera. */
  projectBox(box, camera = this.ws.camera) {
    const r = this.ws.renderer.domElement.getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = 0; k < 8; k++) {
      _v.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).project(camera);
      if (_v.z > 1) return null;
      const x = r.left + (_v.x + 1) / 2 * r.width, y = r.top + (1 - _v.y) / 2 * r.height;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { left: minX, top: minY, right: maxX, bottom: maxY, cx: (minX + maxX) / 2 };
  }

  /* ---------- per frame ---------- */
  update() {
    const items = this._items();
    if (!items.length || this.busy || document.body.classList.contains('placing')) { this._hide(); return; }
    const box = this.bounds(items);
    if (box.isEmpty()) { this._hide(); return; }
    const rect = this.projectBox(box);
    const vp = this.ws.renderer.domElement.getBoundingClientRect();
    if (!rect || rect.right < vp.left || rect.left > vp.right || rect.bottom < vp.top || rect.top > vp.bottom) { this._hide(); return; }
    this.rect = rect;
    const sig = this._signature(items);
    if (sig !== this.sig) { this.sig = sig; this._build(items); }
    if (this.el.hidden) { this.el.hidden = false; this.el.classList.remove('show'); this._pendingShow = 2; }
    const s = uiScale(), w = this.el.offsetWidth * s, h = this.el.offsetHeight * s;   // drawn at the UI scale: its size on screen
    // above the selection, clamped; below it when there is no room above
    let x = Math.min(Math.max(rect.cx - w / 2, vp.left + MARGIN), vp.right - w - MARGIN);
    let y = rect.top - GAP - h;
    this.flipped = y < vp.top + MARGIN;
    if (this.flipped) y = rect.bottom + GAP;
    y = Math.min(Math.max(y, vp.top + MARGIN), vp.bottom - h - MARGIN);
    // never over the job tray / stats
    for (const el of this.avoid()) {
      if (!el || el.hidden) continue;
      const a = el.getBoundingClientRect(); if (!a.width || !a.height) continue;
      if (x < a.right && x + w > a.left && y < a.bottom && y + h > a.top) {
        if (a.top - GAP - h >= vp.top + MARGIN) y = a.top - GAP - h;
        else x = Math.max(vp.left + MARGIN, a.left - GAP - w);
      }
    }
    this.el.style.transform = `translate(${(x / s).toFixed(1)}px, ${(y / s).toFixed(1)}px)`;
    this.el.dataset.placement = this.flipped ? 'below' : 'above';
    if (this._pendingShow > 0 && --this._pendingShow === 0) this.el.classList.add('show');   // a frame later, so the fade runs
    this.visible = true;
  }
  _hide() {
    if (!this.el.hidden) { this.el.hidden = true; this.el.classList.remove('show'); }
    this.visible = false; this.rect = null; this._pendingShow = 0;
  }
  /** The toolbar's screen rect (null when hidden). */
  get screenRect() { if (this.el.hidden) return null; const r = this.el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }
}
