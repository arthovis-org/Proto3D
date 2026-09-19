// interaction.js — pointer + keyboard model for the 3D workspace.
//   hover: ports > faces > bodies > connections > group frames
//   click: select (Shift adds / toggles) · click empty: clear · double-click: focus
//   drag body: move every selected node (Shift: vertically) · drag from an out-port: connect
//   sub pickables (cards, tiles, handles owned by a Shape3D body) are picked right after ports:
//   the owning block gets down / drag / drop / click through body3d.onSubPointer
//   Shift+drag on empty floor: marquee select · drag on a live face: the component handles it
//   keys: Del, Esc, F focus, Home frame all, Ctrl+D duplicate, Ctrl+Z / Ctrl+Shift+Z undo / redo,
//         Ctrl+G group, Ctrl+Shift+G ungroup, Ctrl+A select all
// Every edit goes through the History so it can be undone. Yields to the gizmo while it is hot.
import * as THREE from 'three';
import { Connection3D } from './connection3d.js';
import { Group3D } from './groups.js';
import * as cmd from './core/commands.js';

/** True when the key event comes from a text field (panel) — ignore shortcuts then. */
export const isTyping = (e) => {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
};
const _v = new THREE.Vector3();

export class Interaction {
  constructor({ camera, renderer, controls, world, selection, history, gizmo = null, createInstance, onHoverConnection = () => {}, onFocus = () => {}, onFrameAll = () => {} }) {
    Object.assign(this, { camera, renderer, controls, world, selection, history, gizmo, createInstance, onHoverConnection, onFocus, onFrameAll });
    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hovered = null;
    this.drag = null;        // { nodes, plane, offsets, before, moved }
    this.connect = null;     // { from, preview, plane }
    this.marquee = null;     // { x0, y0, el }
    this.faceDrag = null;    // { block, mesh }
    this.pressFace = null;   // { block, u, v } for click detection
    this.subDrag = null;     // { block, sub } while a child pickable is pressed
    this.hoveredSub = null;
    this.downPos = new THREE.Vector2();
    this.shift = false;
    this.marqueeEl = document.getElementById('marquee');

    const el = renderer.domElement;
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('dblclick', (e) => this.onDblClick(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => { if (e.key === 'Shift') this.shift = false; });
    selection.onChange(() => { if (this.gizmo) this.gizmo.setTarget(selection.nodes[selection.nodes.length - 1] || null); });
  }

  get gizmoBusy() { return !!(this.gizmo && (this.gizmo.dragging || this.gizmo.hot)); }

  /* ---------- picking ---------- */
  _setPointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.camera);
  }
  _visibleNodes() { return this.world.nodes.filter((n) => n.visible); }
  _portMeshes() {
    const out = [];
    for (const n of this._visibleNodes()) for (const p of n.ports) out.push(p.mesh);
    for (const g of this.world.groups) if (g.collapsed) for (const p of g.ports) out.push(p.mesh);
    return out;
  }
  _faceMeshes() { return this._visibleNodes().filter((n) => n.face?.mesh).map((n) => n.face.mesh); }
  _subMeshes() { return this._visibleNodes().flatMap((n) => (n.subMeshes ? n.subMeshes() : [])); }
  _bodyMeshes() { return this._visibleNodes().flatMap((n) => (n.meshes ? n.meshes.filter((m) => m !== n.face?.mesh) : [n.body, n.header])); }
  _tubeMeshes() { return this.world.connections.filter((c) => c.visible).map((c) => c.tube); }
  _groupMeshes() { return this.world.groups.flatMap((g) => (g.collapsed && g.slab ? [g.slab.body, g.slab.header] : [g.fill, g.edge])); }

  /** { kind: 'port'|'sub'|'face'|'block'|'connection'|'group', target, point, uv, sub } or null. */
  pick() {
    let hits = this.ray.intersectObjects(this._portMeshes(), false);
    if (hits.length) return { kind: 'port', target: hits[0].object.userData.port, point: hits[0].point };
    hits = this.ray.intersectObjects(this._subMeshes(), false);
    if (hits.length) { const sub = hits[0].object.userData.sub; return { kind: 'sub', target: sub.block, sub, point: hits[0].point, mesh: hits[0].object }; }
    hits = this.ray.intersectObjects(this._faceMeshes(), false);
    if (hits.length) return { kind: 'face', target: hits[0].object.userData.block, point: hits[0].point, uv: hits[0].uv, mesh: hits[0].object };
    hits = this.ray.intersectObjects(this._bodyMeshes(), false);
    if (hits.length) return { kind: 'block', target: hits[0].object.userData.block, point: hits[0].point };
    hits = this.ray.intersectObjects(this._tubeMeshes(), false);
    if (hits.length) return { kind: 'connection', target: hits[0].object.userData.connection, point: hits[0].point };
    hits = this.ray.intersectObjects(this._groupMeshes(), false);
    if (hits.length) return { kind: 'group', target: hits[0].object.userData.group, point: hits[0].point };
    return null;
  }
  /** Where the pointer ray meets the floor (y = 0), or null. */
  floorPoint(y = 0) {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(plane, p) ? p : null;
  }
  /** Canvas-style uv (origin top-left) on a face mesh from the current ray. */
  _faceUV(mesh) {
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
    const origin = mesh.getWorldPosition(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(plane, hit)) return null;
    mesh.worldToLocal(hit);
    const { w, h } = mesh.userData.face.face;
    return { u: hit.x / w + 0.5, v: 0.5 - hit.y / h };
  }

  _setHover(item) {
    if (this.hovered === item) return;
    if (this.hovered) {
      this.hovered.setHover(false);
      if (this.hovered.kind === 'connection') { this.world.connections.forEach((c) => c.setDim(false)); this.onHoverConnection(null); }
    }
    this.hovered = item;
    if (item) {
      item.setHover(true);
      if (item.kind === 'connection') { this.world.connections.forEach((c) => c.setDim(c !== item)); this.onHoverConnection(item); }
    }
    this.renderer.domElement.style.cursor = item ? (item.mesh && item.dir ? 'crosshair' : 'pointer') : this.hoveredSub ? 'pointer' : '';
  }
  _setHoverSub(sub) {
    if (this.hoveredSub === sub) return;
    if (this.hoveredSub) this.hoveredSub.block.setSubHover(null);
    this.hoveredSub = sub;
    if (sub) sub.block.setSubHover(sub);
  }
  _subEvent(type, extra = {}) { return { type, sub: this.subDrag?.sub, ray: this.ray.ray, history: this.history, selection: this.selection, shift: this.shift, ...extra }; }

  /* ---------- selection helpers ---------- */
  select(item, { toggle = false } = {}) {
    if (!item) { this.selection.clear(); return; }
    if (toggle) this.selection.toggle(item); else this.selection.set([item]);
  }
  /** Nodes affected by a move: selected nodes + members of selected groups. */
  _movableNodes() {
    const set = new Set(this.selection.nodes);
    this.selection.groups.forEach((g) => g.members.forEach((m) => set.add(m)));
    return [...set];
  }

  /* ---------- pointer ---------- */
  onMove(e) {
    this._setPointer(e);
    if (this.gizmo && this.gizmo.dragging) return;
    if (this.marquee) { this._updateMarquee(e); return; }
    if (this.faceDrag) {
      const uv = this._faceUV(this.faceDrag.mesh);
      if (uv) this.faceDrag.block.onFacePointer({ type: 'drag', ...uv, button: 0 });
      return;
    }
    if (this.subDrag) {
      const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) > 4;
      if (moved) { this.subDrag.moved = true; this.subDrag.block.onSubPointer(this._subEvent('drag')); }
      return;
    }
    if (this.drag) {
      const hit = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(this.drag.plane, hit)) {
        this.drag.moved = true;
        this.drag.nodes.forEach((n, i) => {
          const p = hit.clone().add(this.drag.offsets[i]);
          if (!this.shift) p.y = n.position.y; else { p.x = n.position.x; p.z = n.position.z; }
          p.y = Math.max(n.kind === 'device' ? 0 : 0.2, p.y);
          n.position.copy(p);
        });
        this.world.bumpLayout();
      }
      return;
    }
    if (this.connect) {
      const hit = this.pick();
      if (hit && hit.kind === 'port' && hit.target.dir === 'in' && hit.target.owner !== this.connect.from.owner && !hit.target.proxy) {
        this._setHover(hit.target);
        this.connect.preview.setTargetPort(hit.target);
        this.connect.preview.setDerivedState(this.world.canConnect(this.connect.from, hit.target) ? 'idle' : 'invalid');
      } else {
        this._setHover(null);
        const p = new THREE.Vector3();
        if (this.ray.ray.intersectPlane(this.connect.plane, p)) this.connect.preview.setPreviewTarget(p);
        this.connect.preview.setDerivedState('idle');
      }
      return;
    }
    if (this.gizmo && this.gizmo.hot) { this._setHover(null); this._setHoverSub(null); return; }
    const hit = this.pick();
    this._setHoverSub(hit && hit.kind === 'sub' ? hit.sub : null);
    this._setHover(hit && hit.kind !== 'sub' ? hit.target : null);
  }

  onDown(e) {
    if (e.button !== 0) return;
    if (this.gizmoBusy) return;
    this.shift = e.shiftKey;
    this._setPointer(e);
    this.downPos.set(e.clientX, e.clientY);
    this.pressFace = null;
    const hit = this.pick();

    if (!hit) {
      if (e.shiftKey) { this._startMarquee(e); }
      return;
    }
    if (hit.kind === 'port') {
      const port = hit.target;
      if (port.dir !== 'out' || port.owner.kind === 'group') return;
      const start = port.getWorldPosition(new THREE.Vector3());
      const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, start);
      const preview = new Connection3D(port, start.clone());
      this.world.scene.add(preview);
      this.connect = { from: port, preview, plane };
      this.controls.enabled = false;
      return;
    }
    if (hit.kind === 'sub') {
      // a child pickable: the owning block captures the press (cards drag inside their board)
      const block = hit.target;
      this.subDrag = { block, sub: hit.sub, moved: false };
      this.controls.enabled = false;
      if (!this.selection.has(block)) this.selection.set([block]);
      block.onSubPointer(this._subEvent('down', { point: hit.point, mesh: hit.mesh }));
      return;
    }
    if (hit.kind === 'face') {
      const block = hit.target;
      const uv = { u: hit.uv.x, v: 1 - hit.uv.y };
      this.pressFace = { block, ...uv };
      if (block.onFacePointer({ type: 'down', ...uv, button: 0 })) {
        this.faceDrag = { block, mesh: hit.mesh };
        this.controls.enabled = false;
        if (!this.selection.has(block)) this.select(block, { toggle: e.shiftKey });
        return;
      }
      this._beginBlockDrag(block, hit.point, e);
      return;
    }
    if (hit.kind === 'block') { this._beginBlockDrag(hit.target, hit.point, e); return; }
    if (hit.kind === 'group') {
      const g = hit.target;
      if (e.shiftKey) this.selection.toggle(g); else if (!this.selection.has(g)) this.selection.set([g]);
      this._beginMove(this._movableNodes(), hit.point, e);
      return;
    }
    if (hit.kind === 'connection') this.select(hit.target, { toggle: e.shiftKey });
  }
  _beginBlockDrag(block, point, e) {
    if (block.subSelection) { block.subSelection = null; block.faceDirty = true; if (this.selection.has(block)) this.selection.refresh(); }
    if (e.shiftKey) this.selection.toggle(block);
    else if (!this.selection.has(block)) this.selection.set([block]);
    if (!this.selection.has(block)) return;
    this._beginMove(this._movableNodes(), point, e);
  }
  _beginMove(nodes, point, e) {
    if (!nodes.length) return;
    const anchor = nodes[nodes.length - 1];
    const normal = e.shiftKey && nodes.length === 1
      ? this.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize().negate()
      : new THREE.Vector3(0, 1, 0);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, anchor.position);
    const planeHit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(plane, planeHit)) planeHit.copy(point);
    const offsets = nodes.map((n) => n.position.clone().sub(planeHit));
    nodes.forEach((n) => { n.dragging = true; });
    this.drag = { nodes, plane, offsets, before: nodes.map(cmd.snapshot), moved: false };
    this.controls.enabled = false;
  }

  onUp(e) {
    if (this.gizmo && this.gizmo.dragging) return;
    this.controls.enabled = true;
    const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) > 4;
    if (this.marquee) { this._endMarquee(e); return; }
    if (this.subDrag) {
      const d = this.subDrag; this.subDrag = null;
      this._setPointer(e);
      d.block.onSubPointer({ type: d.moved && moved ? 'drop' : 'click', sub: d.sub, ray: this.ray.ray, history: this.history, selection: this.selection, shift: e.shiftKey });
      this.selection.refresh();
      return;
    }
    if (this.faceDrag) {
      const uv = this._faceUV(this.faceDrag.mesh) || this.pressFace;
      this.faceDrag.block.onFacePointer({ type: 'up', u: uv.u, v: uv.v, button: 0 });
      if (!moved) this.faceDrag.block.onFacePointer({ type: 'click', u: uv.u, v: uv.v, button: 0 });
      this.faceDrag = null; this.pressFace = null;
      return;
    }
    if (this.connect) {
      const { from, preview } = this.connect;
      const target = this.hovered && this.hovered.dir === 'in' ? this.hovered : null;
      this.world.scene.remove(preview); preview.dispose();
      this.connect = null;
      if (target && this.world.canConnect(from, target)) {
        const c = this.history.execute(cmd.connect(this.world, from, target));
        this.selection.set([this.world.connections.find((x) => x.from === from && x.to === target)].filter(Boolean));
      } else if (target) {
        // an incompatible drop still creates the link so the mismatch is visible (red, dashed) and fixable
        this.history.execute(cmd.connect(this.world, from, target));
        this.selection.set([this.world.connections.find((x) => x.from === from && x.to === target)].filter(Boolean));
      }
      return;
    }
    if (this.drag) {
      const d = this.drag; this.drag = null;
      d.nodes.forEach((n) => { n.dragging = false; });
      if (d.moved && moved) this.history.execute(cmd.transform(this.world, d.nodes, d.before, d.nodes.map(cmd.snapshot)));
      else if (this.pressFace && !moved) this.pressFace.block.onFacePointer({ type: 'click', u: this.pressFace.u, v: this.pressFace.v, button: 0 });
      this.pressFace = null;
      return;
    }
    // Click on empty space (no orbit movement) clears the selection
    if (!moved && !this.gizmoBusy && !e.shiftKey) { this._setPointer(e); if (!this.pick()) this.selection.clear(); }
  }

  onDblClick(e) {
    this._setPointer(e);
    const hit = this.pick();
    if (hit && (hit.kind === 'block' || hit.kind === 'face')) this.onFocus([hit.target]);
    else if (hit && hit.kind === 'group') this.onFocus(hit.target.collapsed ? [hit.target] : hit.target.members);
  }

  /* ---------- marquee ---------- */
  _startMarquee(e) {
    this.marquee = { x0: e.clientX, y0: e.clientY };
    this.controls.enabled = false;
    if (this.marqueeEl) { this.marqueeEl.hidden = false; this._updateMarquee(e); }
  }
  _updateMarquee(e) {
    const m = this.marquee; if (!this.marqueeEl) return;
    const x = Math.min(m.x0, e.clientX), y = Math.min(m.y0, e.clientY);
    Object.assign(this.marqueeEl.style, { left: x + 'px', top: y + 'px', width: Math.abs(e.clientX - m.x0) + 'px', height: Math.abs(e.clientY - m.y0) + 'px' });
  }
  _endMarquee(e) {
    const m = this.marquee; this.marquee = null;
    if (this.marqueeEl) this.marqueeEl.hidden = true;
    const x0 = Math.min(m.x0, e.clientX), x1 = Math.max(m.x0, e.clientX), y0 = Math.min(m.y0, e.clientY), y1 = Math.max(m.y0, e.clientY);
    if (x1 - x0 < 4 && y1 - y0 < 4) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const inside = this._visibleNodes().filter((n) => {
      _v.copy(n.position); if (n.kind === 'device') _v.y += n.height / 2;
      _v.project(this.camera);
      const sx = r.left + (_v.x + 1) / 2 * r.width, sy = r.top + (1 - _v.y) / 2 * r.height;
      return _v.z < 1 && sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
    });
    this.selection.set([...this.selection.items.filter((i) => i.kind !== 'connection'), ...inside]);
  }

  /* ---------- editing operations (also used by menus) ---------- */
  deleteSelection() {
    const nodes = this.selection.nodes, groups = this.selection.groups, conns = this.selection.connections;
    if (!nodes.length && !groups.length && !conns.length) return;
    const cmds = [];
    conns.forEach((c) => cmds.push(cmd.disconnect(this.world, c)));
    const groupNodes = groups.flatMap((g) => g.members);
    groups.forEach((g) => cmds.push(cmd.removeGroup(this.world, g)));
    const all = [...new Set([...nodes, ...groupNodes])];
    if (all.length) cmds.push(cmd.removeNodes(this.world, all));
    this.selection.clear();
    if (this.hovered) { this.hovered = null; this.onHoverConnection(null); }
    this.history.execute(cmd.composite('Delete', cmds));
  }
  duplicateSelection() {
    const nodes = this._movableNodes();
    if (!nodes.length) return;
    const c = cmd.duplicate(this.world, nodes, this.createInstance);
    this.history.execute(c);
    this.selection.set(c.copies);
  }
  groupSelection() {
    const nodes = this._movableNodes().filter((n) => !n.group);
    if (nodes.length < 1) return null;
    const g = new Group3D({ title: `Group ${this.world.groups.length + 1}`, members: nodes });
    this.history.execute(cmd.addGroup(this.world, g));
    this.selection.set([g]);
    return g;
  }
  ungroupSelection() {
    const groups = new Set(this.selection.groups);
    this.selection.nodes.forEach((n) => { if (n.group) groups.add(n.group); });
    if (!groups.size) return;
    const members = [...groups].flatMap((g) => g.members);
    this.history.execute(cmd.composite('Ungroup', [...groups].map((g) => cmd.removeGroup(this.world, g))));
    this.selection.set(members);
  }
  toggleCollapseSelection() {
    const groups = new Set(this.selection.groups);
    this.selection.nodes.forEach((n) => { if (n.group) groups.add(n.group); });
    groups.forEach((g) => this.history.execute(cmd.setCollapsed(this.world, g, !g.collapsed)));
  }
  focusSelection() {
    const items = this.selection.items.length ? this.selection.items : this.world.nodes;
    const targets = items.flatMap((i) => (i.kind === 'group' ? (i.collapsed ? [i] : i.members) : i.kind === 'connection' ? [i.from.owner, i.to?.owner].filter(Boolean) : [i]));
    if (targets.length) this.onFocus(targets);
  }
  cancel() {
    if (this.connect) { this.world.scene.remove(this.connect.preview); this.connect.preview.dispose(); this.connect = null; }
    if (this.drag) { this.drag.nodes.forEach((n, i) => { n.dragging = false; n.position.fromArray(this.drag.before[i].p); }); this.drag = null; }
    if (this.marquee) { this.marquee = null; if (this.marqueeEl) this.marqueeEl.hidden = true; }
    if (this.subDrag) { this.subDrag.block.onSubPointer(this._subEvent('cancel')); this.subDrag = null; }
    this.faceDrag = null; this.pressFace = null;
    this.controls.enabled = true;
  }

  /* ---------- keyboard ---------- */
  onKey(e) {
    if (e.key === 'Shift') this.shift = true;
    if (isTyping(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) this.history.redo(); else this.history.undo(); this.selection.prune(this.world); return; }
    if (mod && k === 'y') { e.preventDefault(); this.history.redo(); this.selection.prune(this.world); return; }
    if (mod && k === 'd') { e.preventDefault(); this.duplicateSelection(); return; }
    if (mod && k === 'g') { e.preventDefault(); if (e.shiftKey) this.ungroupSelection(); else this.groupSelection(); return; }
    if (mod && k === 'a') { e.preventDefault(); this.selection.set(this._visibleNodes()); return; }
    if (mod) return;
    switch (e.key) {
      case 'Escape': this.cancel(); this.selection.clear(); break;
      case 'Delete': case 'Backspace': this.deleteSelection(); break;
      case 'f': case 'F': this.focusSelection(); break;
      case 'Home': this.onFrameAll(); break;
      case 'c': case 'C': this.toggleCollapseSelection(); break;
      default: break;
    }
  }
}
