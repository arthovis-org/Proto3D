// interaction.js — pointer + keyboard model for the 3D workspace.
//   hover: ports > sub pickables > faces > bodies > connections (ends first) > group frames
//   click: select (Shift adds / toggles) · click empty: clear · double-click: focus
//   drag body: move every selected node (Shift: vertically)
//   ports: hovering one explains it (tooltip: name, type, value, links) and lights every
//          compatible port on other blocks while the rest dim; dragging from an output (or
//          backwards from an empty input) pulls a preview cable that snaps to compatible ports,
//          shows a red ring on incompatible ones and fades out when dropped on empty space
//   cable ends: the tube near either end (and the end ring) is a grab handle — drag it to
//          re-route the link onto another compatible port, drop on empty space to disconnect,
//          Esc to put it back; a connected single input picks up its existing cable the same way
//   selection: a selected block brightens its cables (others dim to 25 %, their flow slows) and labels their far
//          ends; a selected cable makes both ports pulse
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
import { formatValue, compatiblePorts, portTypeText, portTypeName, mismatchReason } from './core/types.js';
import { hex, sizes } from './theme.js';
import { describeLink, dropLinkCandidates } from './pm/relations.js';
import { nav } from './controls/navigation.js';

/** True when the key event comes from a text field (panel) — ignore shortcuts then. */
export const isTyping = (e) => {
  const t = e.target;
  // a focused field, or anything inside an open modal (Connections, model browser): the workspace keeps its hands off
  return !!(t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.closest?.('.modal-backdrop')));
};
const _v = new THREE.Vector3();
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const portName = (p) => `${p.owner.title}.${p.label}`;
const FADE = 0.28;

export class Interaction {
  constructor({ camera, renderer, controls, world, selection, history, gizmo = null, createInstance, overlays = null, onHoverConnection = () => {}, onFocus = () => {}, onFrameAll = () => {}, onGizmoMode = () => {}, onTogglePanel = () => {}, onOpenPanel = () => {} }) {
    Object.assign(this, { camera, renderer, controls, world, selection, history, gizmo, createInstance, overlays, onHoverConnection, onFocus, onFrameAll, onGizmoMode, onTogglePanel, onOpenPanel });
    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hovered = null;
    this.hoveredEnd = null;  // 'from' | 'to' while over a cable's grab handle
    this.drag = null;        // { nodes, plane, offsets, before, moved }
    this.connect = null;     // cable drag: { need, fixed, side, preview, plane, detached, origin, snapped, reject }
    this.pendingDetach = null; // { conn, end } pressed but not yet moved
    this.marquee = null;     // { x0, y0, el }
    this.faceDrag = null;    // { block, mesh }
    this.pressFace = null;   // { block, u, v } for click detection
    this.subDrag = null;     // { block, sub } while a child pickable is pressed
    this.hoveredSub = null;
    this.fading = [];        // preview cables fading out after a cancelled drag
    this.glowPorts = [];     // ports pulsing this frame
    this.cursor = '';
    this.downPos = new THREE.Vector2();
    this.lastPointer = { x: 0, y: 0 };
    this.shift = false;
    this.marqueeEl = document.getElementById('marquee');

    const el = renderer.domElement;
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointerleave', () => { if (!this.connect && !this.drag) { this._setHover(null); this._setHoverSub(null); } });
    el.addEventListener('dblclick', (e) => this.onDblClick(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => { if (e.key === 'Shift') this.shift = false; });
    selection.onChange(() => { if (this.gizmo) this.gizmo.setTarget(selection.nodes[selection.nodes.length - 1] || null); this.applySelectionEmphasis(); });
    world.onChange(() => this.applySelectionEmphasis());
  }

  get gizmoBusy() { return !!(this.gizmo && (this.gizmo.dragging || this.gizmo.hot)); }
  _cursor(name) { if (this.cursor !== name) { this.cursor = name; this.renderer.domElement.style.cursor = name; } }

  /* ---------- picking ---------- */
  _setPointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.camera);
  }
  _visibleNodes() { return this.world.nodes.filter((n) => n.visible); }
  /** Ports that can be picked: only on blocks that show them (wiring switch or per-block override). */
  _allPorts() {
    const out = [];
    for (const n of this._visibleNodes()) if (n.portsVisible) for (const p of n.ports) out.push(p);
    for (const g of this.world.groups) if (g.collapsed) for (const p of g.ports) out.push(p);
    return out;
  }
  _portMeshes() { return this._allPorts().flatMap((p) => p.pickMeshes || [p.mesh, p.shell]); }
  _faceMeshes() { return this._visibleNodes().filter((n) => n.face?.mesh).map((n) => n.face.mesh); }
  _subMeshes() { return this._visibleNodes().flatMap((n) => (n.subMeshes ? n.subMeshes() : [])); }
  _bodyMeshes() { return this._visibleNodes().flatMap((n) => (n.meshes ? n.meshes.filter((m) => m !== n.face?.mesh) : [n.body, n.header].filter(Boolean))); }
  _tubeMeshes() { return this.world.connections.filter((c) => c.visible).flatMap((c) => [c.pickTube, ...c.rings]); }
  _groupMeshes() { return this.world.groups.flatMap((g) => (g.collapsed && g.slab ? [g.slab.body, g.slab.header] : [g.fill, g.edge])); }

  /** { kind: 'port'|'sub'|'face'|'block'|'connection'|'group', target, point, uv, sub, end } or null. */
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
    if (hits.length) {
      const c = hits[0].object.userData.connection;
      const end = hits[0].object.userData.end || c.endNear(hits[0].point);
      return { kind: 'connection', target: c, point: hits[0].point, end };
    }
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

  /* ---------- hover ---------- */
  _setHover(item, end = null) {
    if (this.hovered === item && this.hoveredEnd === end) return;
    if (this.hovered) {
      this.hovered.setHover(false);
      if (this.hovered.kind === 'connection') { this.world.connections.forEach((c) => c.setDim(false)); this.onHoverConnection(null); }
    }
    this.hovered = item; this.hoveredEnd = end;
    this.overlays?.hideTip();
    if (item) {
      item.setHover(true);
      if (item.kind === 'connection') {
        this.world.connections.forEach((c) => c.setDim(c !== item));
        item.setEndHover(end);
        if (end) this.overlays?.tip('<b>Cable end</b><span class="d">drag to re-route · drop on empty space to disconnect</span>', { anchor: item.endPosition(end), offset: [16, -34] });
        this.onHoverConnection(end ? null : item);
      } else if (item.kind === 'port') this._tipPort(item);
      else if (item.kind === 'node' || item.kind === 'device') this._tipBlock(item);
    }
    this._recomputeEmphasis();
    this._cursor(this._hoverCursor(item, end));
  }
  _hoverCursor(item, end) {
    if (!item) return this.hoveredSub ? 'pointer' : '';
    if (item.kind === 'port') return 'crosshair';
    if (item.kind === 'connection') return end ? 'grab' : 'pointer';
    if (item.kind === 'group') return 'grab';
    return 'grab';
  }
  _setHoverSub(sub) {
    if (this.hoveredSub === sub) return;
    if (this.hoveredSub) this.hoveredSub.block.setSubHover(null);
    this.hoveredSub = sub;
    if (sub) sub.block.setSubHover(sub);
  }
  _subEvent(type, extra = {}) { return { type, sub: this.subDrag?.sub, ray: this.ray.ray, history: this.history, selection: this.selection, shift: this.shift, x: this.lastPointer.x, y: this.lastPointer.y, ...extra }; }

  /** Tooltip for a port: name, type, value, links and what dragging will do. */
  _tipPort(p) {
    if (!this.overlays) return;
    const links = this.world.connectionsOf(p);
    const other = (c) => (p.dir === 'out' ? c.to : c.from);
    const rows = links.filter((c) => other(c)).map((c) => `<span class="c">${p.dir === 'out' ? '→' : '←'} ${esc(portName(other(c)))}</span>`).join('');
    const hint = p.owner.kind === 'group' ? '' : p.dir === 'out' ? 'drag to connect' + (links.length ? ' another' : '') : links.length && !p.multi ? 'drag to re-route this cable' : p.multi ? 'accepts several cables · drag to add one' : 'drag to connect';
    const html = `<b style="color:${hex(p.color)}">${esc(p.label)}</b><span class="t">${esc(portTypeText(p))} · ${p.dir === 'in' ? 'input' : 'output'}${p.optional ? ' · optional' : ''}</span>`
      + `<span class="v">${esc(formatValue(p.value, 40))}</span>${rows}${hint ? `<span class="d">${hint}</span>` : ''}`;
    this.overlays.tip(html, { anchor: p.getWorldPosition(new THREE.Vector3()), offset: [16, -12], cls: 'port-tip' });
  }
  _tipBlock(b) {
    if (!this.overlays) return;
    const top = b.position.clone(); top.y += (b.kind === 'device' ? b.height : b.height / 2) + 0.2;
    this.overlays.tip(`<b>${esc(b.def.label)}</b><span class="t">${esc(b.title)}</span><span class="d">${esc(b.def.description)}</span>`, { anchor: top, offset: [0, -56], cls: 'block-tip', delay: 500 });
  }

  /** Port emphasis from scratch: selected cable → both ports glow; hovered / dragged port → compatible glow, others dim, rejected red. */
  _recomputeEmphasis() {
    const map = new Map();
    for (const c of this.selection.connections) { if (c.from) map.set(c.from, 'glow'); if (c.to) map.set(c.to, 'glow'); }
    const src = this.connect ? this.connect.fixed : this.hovered?.kind === 'port' ? this.hovered : null;
    if (src && src.owner.kind !== 'group') {
      const compat = new Set(this.world.compatiblePorts(src));
      for (const n of this._visibleNodes()) {
        if (n === src.owner) continue;
        for (const p of n.ports) map.set(p, compat.has(p) ? 'glow' : map.get(p) === 'glow' ? 'glow' : 'dim');
      }
      if (this.connect?.reject) map.set(this.connect.reject, 'reject');
    }
    // port names: hidden by default; shown on the hovered port, on the ports of a hovered cable, on
    // compatible targets while a port is hovered or a cable dragged (dimmed on incompatible ones
    // during a drag); a selected block shows all of its own (Block3D._nameTarget)
    const named = new Set();
    const hc = this.hovered?.kind === 'connection' ? this.hovered : null;
    if (hc) { if (hc.from) named.add(hc.from); if (hc.to) named.add(hc.to); }
    if (this.connect?.fixed) named.add(this.connect.fixed);
    const glow = [];
    for (const p of this._allPorts()) {
      const m = map.get(p) || null; p.setEmphasis(m); if (m === 'glow') glow.push(p);
      p.setNameShown(named.has(p) || m === 'glow' || m === 'reject' ? 'full' : m === 'dim' && this.connect ? 'dim' : null);
    }
    this.glowPorts = glow;
    // a hovered port (or cable end) brightens its cables even while another block's selection dims them
    const lit = new Set();
    if (this.hovered?.kind === 'port') for (const c of this.world.connectionsOf(this.hovered)) lit.add(c);
    if (hc) lit.add(hc);
    for (const c of this.world.connections) c.setHighlight(lit.has(c));
  }
  /** Selection focus: a selected block's cables stay bright with far-end labels, the rest dim to 25 %; a selected cable lights its ports. */
  applySelectionEmphasis() {
    const S = new Set(this._movableNodes());
    const selConns = this.selection.connections;
    const labels = [];
    for (const c of this.world.connections) {
      if (!c.complete) continue;
      const a = S.has(c.from.owner), b = S.has(c.to.owner);
      let dim = false;
      if (S.size) {
        dim = !(a || b);
        if (a && !b) labels.push({ conn: c, end: 'to', text: `→ ${portName(c.to)}`, color: hex(c.color.getHex()) });
        else if (b && !a) labels.push({ conn: c, end: 'from', text: `${portName(c.from)} →`, color: hex(c.color.getHex()) });
      } else if (selConns.length) dim = !selConns.includes(c);
      c.setDimSelect(dim);
    }
    this.overlays?.setEndLabels(labels);
    this._recomputeEmphasis();
  }

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
    if (this.gizmo && this.gizmo.dragging) { this._cursor('move'); return; }
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
      this._updateBlockDrop();
      this._cursor('grabbing');
      return;
    }
    if (this.pendingDetach && Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) > 4) this._beginDetach(this.pendingDetach);
    if (this.connect) { this._updateConnect(e); return; }
    if (this.gizmo && this.gizmo.hot) { this._setHover(null); this._setHoverSub(null); this._cursor('move'); return; }
    const hit = this.pick();
    this._setHoverSub(hit && hit.kind === 'sub' ? hit.sub : null);
    this._setHover(hit && hit.kind !== 'sub' ? hit.target : null, hit?.kind === 'connection' ? hit.end : null);
    if (hit?.kind === 'face' && hit.target.def.face?.onPointer) this._cursor('pointer');
  }

  onDown(e) {
    if (this.gizmoBusy) return;
    const action = nav.resolveMouse(e);
    if (e.button !== 0) {
      // right-click under a preset that uses it for selection: select the block and open its properties
      if (action === 'contextSelect') {
        this._setPointer(e);
        const hit = this.pick();
        const target = hit && (hit.kind === 'block' || hit.kind === 'face' || hit.kind === 'sub') ? hit.target : hit?.kind === 'group' || hit?.kind === 'connection' ? hit.target : null;
        if (target) { this.selection.set([target]); this.onOpenPanel(target); }
      }
      return;
    }
    if (this.keyDrag) return;   // a Shift+D duplicate follows the pointer until the next release
    this.shift = e.shiftKey;
    this.add = nav.isAddModifier(e);
    this._setPointer(e);
    this.downPos.set(e.clientX, e.clientY);
    this.pressFace = null; this.pendingDetach = null;
    const hit = this.pick();

    if (!hit) {
      // empty space: the preset decides between a box select and a camera move
      if (action === 'marquee' || action === 'marqueeAdd') { this._startMarquee(e, action === 'marqueeAdd'); }
      return;
    }
    if (hit.kind === 'port') {
      const port = hit.target;
      if (port.owner.kind === 'group') return;
      if (port.dir === 'out') { this._beginConnect(port); return; }
      const links = this.world.connectionsOf(port);
      if (links.length && !port.multi) { this.pendingDetach = { conn: links[links.length - 1], end: 'to' }; this.controls.enabled = false; return; }
      this._beginConnect(port);   // empty (or multi) input: drag backwards to an output
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
        if (!this.selection.has(block)) this.select(block, { toggle: this.add });
        return;
      }
      this._beginBlockDrag(block, hit.point, e);
      return;
    }
    if (hit.kind === 'block') { this._beginBlockDrag(hit.target, hit.point, e); return; }
    if (hit.kind === 'group') {
      const g = hit.target;
      if (this.add) this.selection.toggle(g); else if (!this.selection.has(g)) this.selection.set([g]);
      this._beginMove(this._movableNodes(), hit.point, e);
      return;
    }
    if (hit.kind === 'connection') {
      this.select(hit.target, { toggle: this.add });
      if (hit.end && hit.target.complete) { this.pendingDetach = { conn: hit.target, end: hit.end }; this.controls.enabled = false; }
    }
  }
  _beginBlockDrag(block, point, e) {
    if (block.subSelection) { block.subSelection = null; block.faceDirty = true; if (this.selection.has(block)) this.selection.refresh(); }
    if (this.add) this.selection.toggle(block);
    else if (!this.selection.has(block)) this.selection.set([block]);
    if (!this.selection.has(block)) return;
    this._beginMove(this._movableNodes(), point, e);
  }
  /**
   * A single dragged block over something that accepts it: a child pickable (a Person over a
   * card → assign) or another block with a compatible relationship (a Person over a board →
   * its people slot, a Board over a Timeline → tasks; pm/relations.js dropLinkCandidates). The
   * target lights up and the drag label says what the drop will do; cables stay optional.
   */
  _updateBlockDrop() {
    const d = this.drag;
    let target = null;
    if (d.nodes.length === 1) {
      const dragged = d.nodes[0];
      const hits = this.ray.intersectObjects(this._subMeshes().filter((m) => m.userData.sub.block !== dragged), false);
      const sub = hits[0]?.object.userData.sub;
      const B = sub?.block.def.body3d;
      if (sub && B?.acceptsDrop?.(sub.block, sub, dragged)) target = { block: sub.block, sub, dragged };
      if (!target) {
        const others = this._visibleNodes().filter((n) => n !== dragged);
        const meshes = others.flatMap((n) => [...(n.meshes ? n.meshes : [n.body, n.header]), n.face?.mesh].filter(Boolean));
        const bh = this.ray.intersectObjects(meshes, false)[0];
        const block = bh?.object.userData.block || bh?.object.userData.face;
        if (block && block !== dragged) {
          const links = dropLinkCandidates(dragged, block, this.world);
          if (links.length) target = { block, sub: null, dragged, links, point: bh.point.clone() };
        }
      }
    }
    const same = d.dropTarget && target && d.dropTarget.block === target.block && d.dropTarget.sub === target.sub;
    if (!same) {
      if (d.dropTarget) { d.dropTarget.block.setSubHover?.(null); if (!d.dropTarget.sub) d.dropTarget.block.setDropTarget(false); }
      d.dropTarget = target;
      if (target) { if (target.sub) target.block.setSubHover?.(target.sub); else target.block.setDropTarget(true); }
    }
    if (target?.sub) this.overlays?.dragLabel(`<b>${esc(target.dragged.title)}</b> → ${esc(target.block.def.body3d.dropLabel?.(target.block, target.sub, target.dragged) || 'drop here')}`, this.lastPointer.x, this.lastPointer.y);
    else if (target) {
      const L = target.links;
      const html = L.length === 1 ? `<b>${esc(L[0].sentence)}</b><span class="d">drop to link · no cable needed</span>` : `<b>${esc(target.dragged.title)}</b> → ${esc(target.block.title)}<span class="d">${L.length} ways to link · choose on drop</span>`;
      this.overlays?.dragLabel(html, this.lastPointer.x, this.lastPointer.y);
    } else this.overlays?.dragLabel(null);
  }
  /** Create the relationship a drop asked for (undoable) and say what it means. */
  _linkByDrop(link, dragged) {
    this.history.execute(cmd.connect(this.world, link.from, link.to));
    const made = this.world.connections.find((x) => x.from === link.from && x.to === link.to);
    this.overlays?.toast(link.sentence, 2400);
    if (dragged) this.selection.set([dragged]);
    return made;
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
    this.overlays?.hideTip();
    this._cursor('grabbing');
  }

  /* ---------- cables ---------- */
  _cameraPlaneAt(point) {
    const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
  }
  /** Start a new cable from a port: forwards from an output, backwards from an input. */
  _beginConnect(port) {
    const start = port.getWorldPosition(new THREE.Vector3());
    const need = port.dir === 'out' ? 'in' : 'out';
    const preview = need === 'in' ? new Connection3D(port, start.clone()) : new Connection3D(start.clone(), port);
    this.world.scene.add(preview);
    this.connect = { need, fixed: port, side: need === 'in' ? 'to' : 'from', preview, plane: this._cameraPlaneAt(start), detached: null, origin: null, snapped: null, reject: null };
    this.controls.enabled = false;
    this._setHover(null);
    this._recomputeEmphasis();
    this._cursor('grabbing');
  }
  /** Lift one end of an existing link off its port; the cable follows the pointer until dropped. */
  _beginDetach({ conn, end }) {
    this.pendingDetach = null;
    if (!this.world.connections.includes(conn)) return;
    this._setHover(null);
    this.world.removeConnection(conn);          // no history yet: the drop decides (re-route / disconnect / put back)
    this.selection.prune(this.world);
    const fixed = end === 'to' ? conn.from : conn.to;
    const origin = end === 'to' ? conn.to : conn.from;
    const start = origin.getWorldPosition(new THREE.Vector3());
    const preview = end === 'to' ? new Connection3D(fixed, start.clone()) : new Connection3D(start.clone(), fixed);
    preview.setDerivedState(conn.derivedState === 'invalid' ? 'idle' : conn.derivedState);
    this.world.scene.add(preview);
    this.connect = { need: end === 'to' ? 'in' : 'out', fixed, side: end, preview, plane: this._cameraPlaneAt(start), detached: conn, origin, snapped: null, reject: null };
    this.controls.enabled = false;
    this._recomputeEmphasis();
    this._cursor('grabbing');
  }
  _canLink(C, p) { return C.need === 'in' ? this.world.canConnect(C.fixed, p) : this.world.canConnect(p, C.fixed); }
  _updateConnect(e) {
    const C = this.connect;
    const hit = this.pick();
    let snapped = null, reject = null;
    if (hit?.kind === 'port') {
      const p = hit.target;
      if (p !== C.fixed && p.owner.kind !== 'group' && !p.proxy) {
        if (p.dir === C.need && this._canLink(C, p)) snapped = p;
        else reject = p;   // wrong side, same block or a type mismatch
      }
    }
    if (!snapped && !reject) {
      // magnetic snap: the nearest compatible port close to the pointer ray
      let bd = sizes.connection.snapReach;
      for (const p of this.world.compatiblePorts(C.fixed)) {
        const d = this.ray.ray.distanceToPoint(p.getWorldPosition(_v));
        if (d < bd) { bd = d; snapped = p; }
      }
    }
    if (C.snapped !== snapped) { C.snapped?.setHover(false); snapped?.setHover(true); C.snapped = snapped; }
    C.reject = reject;
    if (snapped) { C.preview.setPreviewPort(C.side, snapped); C.preview.setDerivedState('idle'); }
    else {
      const p = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(C.plane, p)) C.preview.setPreviewPoint(C.side, p);
      C.preview.setDerivedState(reject ? 'invalid' : 'idle');
    }
    this._recomputeEmphasis();
    this._cursor(reject ? 'not-allowed' : snapped ? 'crosshair' : 'grabbing');
    if (this.overlays) {
      const t = portTypeName(C.fixed);
      let html = `<b style="color:${hex(C.fixed.color)}">${esc(t)}</b> · ${C.need === 'in' ? 'from' : 'into'} ${esc(portName(C.fixed))}`;
      const pair = (p) => (C.need === 'in' ? [C.fixed, p] : [p, C.fixed]);
      if (reject) html += `<br><em>${reject.dir !== C.need ? (reject.owner === C.fixed.owner ? 'same block' : `needs an ${C.need === 'in' ? 'input' : 'output'}`) : esc(mismatchReason(...pair(reject)))}</em>`;
      else if (snapped) html += `<br>→ ${esc(portName(snapped))}${compatiblePorts(...pair(snapped)) === 'coerce' ? ' (converted)' : ''}`;
      else html += `<br><span class="d">${C.detached ? 'drop on empty space to disconnect · Esc puts it back' : 'drop on a lit port'}</span>`;
      this.overlays.dragLabel(html, e.clientX, e.clientY, reject ? 'bad' : '');
    }
  }
  _endConnect(e) {
    const C = this.connect; this.connect = null;
    const { fixed, snapped, reject, detached, origin, preview, need } = C;
    snapped?.setHover(false);
    this.overlays?.dragLabel(null);
    const drop = (fade) => { if (fade) this.fading.push({ preview, k: 0 }); else { this.world.scene.remove(preview); preview.dispose(); } };
    const putBack = () => { this.world.addConnection(detached.from, detached.to, { instance: detached }); this.selection.set([detached]); };
    if (snapped) {
      const from = need === 'in' ? fixed : snapped, to = need === 'in' ? snapped : fixed;
      if (detached) {
        if (snapped === origin) putBack();
        else {
          const c = cmd.reroute(this.world, detached, from, to);
          this.history.execute(c);
          if (c.connection) this.selection.set([c.connection]);
          this.overlays?.toast(`Re-routed to ${portName(to)}`);
        }
      } else {
        this.history.execute(cmd.connect(this.world, from, to));
        const made = this.world.connections.find((x) => x.from === from && x.to === to);
        this.selection.set([made].filter(Boolean));
        // say what the link means ("Maya's tasks appear on Website relaunch"), not just that it exists
        if (made) this.overlays?.toast(describeLink(made) || `Connected ${portName(from)} → ${portName(to)}`, 2000);
      }
      drop(false);
    } else if (detached) {
      if (reject) { putBack(); this.overlays?.toast('Not connected: incompatible port'); drop(false); }
      else { this.history.execute(cmd.disconnect(this.world, detached)); this.overlays?.toast('Disconnected · Ctrl+Z to undo'); drop(true); }
    } else {
      if (reject) this.overlays?.toast(reject.dir !== need ? 'Connect an output to an input' : mismatchReason(...(need === 'in' ? [fixed, reject] : [reject, fixed])));
      drop(true);
    }
    this._recomputeEmphasis();
    this._cursor('');
  }

  onUp(e) {
    if (this.gizmo && this.gizmo.dragging) return;
    if (e.button !== 0 && !this.keyDrag) return;
    this.controls.enabled = true;
    this.pendingDetach = null;
    if (this.keyDrag && this.drag) {
      // Shift+D: the copies followed the pointer; this click drops them
      const d = this.drag; this.drag = null; this.keyDrag = false;
      d.nodes.forEach((n) => { n.dragging = false; });
      this.history.execute(cmd.transform(this.world, d.nodes, d.before, d.nodes.map(cmd.snapshot)));
      this._cursor('');
      return;
    }
    const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) > 4;
    if (this.marquee) { this._endMarquee(e); return; }
    if (this.subDrag) {
      const d = this.subDrag; this.subDrag = null;
      this._setPointer(e);
      d.block.onSubPointer({ type: d.moved && moved ? 'drop' : 'click', sub: d.sub, ray: this.ray.ray, history: this.history, selection: this.selection, shift: e.shiftKey, x: e.clientX, y: e.clientY });
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
    if (this.connect) { this._endConnect(e); return; }
    if (this.drag) {
      const d = this.drag; this.drag = null;
      d.nodes.forEach((n) => { n.dragging = false; });
      if (d.dropTarget) {
        // dropped on a card (assign) or on a block (link): the dragged block springs back and the target acts
        const { block, sub, dragged, links } = d.dropTarget;
        block.setSubHover?.(null); block.setDropTarget(false); this.overlays?.dragLabel(null);
        d.nodes.forEach((n, i) => { n.position.fromArray(d.before[i].p); }); this.world.bumpLayout();
        if (sub) block.def.body3d.onDropBlock?.(block, sub, dragged, { history: this.history, selection: this.selection, overlays: this.overlays });
        else if (links?.length === 1) this._linkByDrop(links[0], dragged);
        else if (links?.length > 1) this.overlays?.chooser(links.map((l) => ({ label: l.sentence, value: l })), { x: e.clientX, y: e.clientY, title: `Link ${dragged.title} to ${block.title}` }, (l) => { if (l) this._linkByDrop(l, dragged); });
      } else if (d.moved && moved) this.history.execute(cmd.transform(this.world, d.nodes, d.before, d.nodes.map(cmd.snapshot)));
      else if (this.pressFace && !moved) this.pressFace.block.onFacePointer({ type: 'click', u: this.pressFace.u, v: this.pressFace.v, button: 0 });
      this.pressFace = null;
      this._cursor(this._hoverCursor(this.hovered, this.hoveredEnd));
      return;
    }
    // Click on empty space (no camera movement) clears the selection
    if (!moved && !this.gizmoBusy && !nav.isAddModifier(e)) { this._setPointer(e); if (!this.pick()) this.selection.clear(); }
  }

  onDblClick(e) {
    this._setPointer(e);
    const hit = this.pick();
    if (hit && (hit.kind === 'block' || hit.kind === 'face')) this.onFocus([hit.target]);
    else if (hit && hit.kind === 'group') this.onFocus(hit.target.collapsed ? [hit.target] : hit.target.members);
  }

  /** Per frame: pulsing compatible ports, fading previews. */
  update(time, dt) {
    for (const p of this.glowPorts) p.pulseTick(time);
    if (this.fading.length) {
      for (const f of [...this.fading]) {
        f.k += dt / FADE;
        const a = Math.max(0, 1 - f.k);
        f.preview.uniforms.dim.value = a;
        f.preview.rings.forEach((r) => { r.material.opacity = 0.9 * a; });
        if (f.k >= 1) { this.world.scene.remove(f.preview); f.preview.dispose(); this.fading.splice(this.fading.indexOf(f), 1); }
      }
    }
  }

  /* ---------- marquee ---------- */
  _startMarquee(e, add = false) {
    this.marquee = { x0: e.clientX, y0: e.clientY, add };
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
    const kept = m.add ? this.selection.items.filter((i) => i.kind !== 'connection') : [];
    this.selection.set([...kept, ...inside]);
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
    if (this.hovered) { this._setHover(null); }
    this.history.execute(cmd.composite('Delete', cmds));
  }
  duplicateSelection({ move = false } = {}) {
    const nodes = this._movableNodes();
    if (!nodes.length) return;
    const c = cmd.duplicate(this.world, nodes, this.createInstance, move ? new THREE.Vector3(0, 0, 0) : undefined);
    this.history.execute(c);
    this.selection.set(c.copies);
    if (move) this._beginKeyMove(c.copies);
  }
  /** Blender's Shift+D: the copies follow the pointer on the floor plane until the next click. */
  _beginKeyMove(nodes) {
    if (!nodes.length) return;
    const anchor = nodes[nodes.length - 1];
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -anchor.position.y);
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((this.lastPointer.x - r.left) / r.width) * 2 - 1, -((this.lastPointer.y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(plane, hit)) hit.copy(anchor.position);
    const offsets = nodes.map((n) => n.position.clone().sub(hit));
    nodes.forEach((n) => { n.dragging = true; });
    this.drag = { nodes, plane, offsets, before: nodes.map(cmd.snapshot), moved: true };
    this.keyDrag = true;
    this.controls.enabled = false;
    this._cursor('grabbing');
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
    const targets = items.flatMap((i) => (i.kind === 'group' ? (i.collapsed ? [i] : i.members) : i.kind === 'connection' ? [i.from?.owner, i.to?.owner].filter(Boolean) : [i]));
    if (targets.length) this.onFocus(targets);
  }
  /** Esc: abandon whatever is in flight. A detached cable goes back where it was. */
  cancel() {
    this.pendingDetach = null;
    if (this.connect) {
      const C = this.connect; this.connect = null;
      C.snapped?.setHover(false);
      this.world.scene.remove(C.preview); C.preview.dispose();
      if (C.detached && !this.world.connections.includes(C.detached)) this.world.addConnection(C.detached.from, C.detached.to, { instance: C.detached });
      this.overlays?.dragLabel(null);
      this._recomputeEmphasis();
    }
    if (this.drag) { this.drag.dropTarget?.block.setSubHover?.(null); this.drag.dropTarget?.block.setDropTarget(false); this.overlays?.dragLabel(null); this.drag.nodes.forEach((n, i) => { n.dragging = false; n.position.fromArray(this.drag.before[i].p); }); this.drag = null; this.keyDrag = false; }
    if (this.marquee) { this.marquee = null; if (this.marqueeEl) this.marqueeEl.hidden = true; }
    if (this.subDrag) { this.subDrag.block.onSubPointer(this._subEvent('cancel')); this.subDrag = null; }
    this.faceDrag = null; this.pressFace = null;
    this.controls.enabled = true;
    this._cursor('');
  }

  /* ---------- keyboard ---------- */
  /** Keys bound by the navigation preset (controls/presets.js): views, focus, select all, delete, duplicate + move, gizmo modes, panel. */
  _presetKey(e) {
    const a = nav.keyAction(e);
    if (!a) return false;
    const C = this.controls;
    const D = Math.PI / 12;
    switch (a) {
      case 'focus': this.focusSelection(); break;
      case 'frameAll': this.onFrameAll(); break;
      case 'viewFront': C.viewTo(0, Math.PI / 2 - 0.02); break;
      case 'viewBack': C.viewTo(Math.PI, Math.PI / 2 - 0.02); break;
      case 'viewRight': C.viewTo(Math.PI / 2, Math.PI / 2 - 0.02); break;
      case 'viewLeft': C.viewTo(-Math.PI / 2, Math.PI / 2 - 0.02); break;
      case 'viewTop': C.viewTo(C.azimuth, 0.02); break;
      case 'viewBottom': C.viewTo(C.azimuth + Math.PI, 0.02); break;   // the floor is opaque: the mirrored top view stands in for "bottom"
      case 'ortho': C.setOrtho(!C.isOrtho); this.overlays?.toast(C.isOrtho ? 'Orthographic view' : 'Perspective view', 1200); break;
      case 'rotLeft': C.rotateBy(D, 0); break;
      case 'rotRight': C.rotateBy(-D, 0); break;
      case 'rotUp': C.rotateBy(0, -D); break;
      case 'rotDown': C.rotateBy(0, D); break;
      case 'selectAll': this.selection.set(this._visibleNodes()); break;
      case 'selectNone': this.selection.clear(); break;
      case 'delete': this.deleteSelection(); break;
      case 'duplicateMove': this.duplicateSelection({ move: true }); break;
      case 'gizmoMove': this.onGizmoMode('translate'); break;
      case 'gizmoRotate': this.onGizmoMode('rotate'); break;
      case 'gizmoScale': this.onGizmoMode('scale'); break;
      case 'panel': this.onTogglePanel(); break;
      default: return false;
    }
    e.preventDefault();
    return true;
  }
  onKey(e) {
    if (e.key === 'Shift') this.shift = true;
    if (isTyping(e)) return;
    if (this._presetKey(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) this.history.redo(); else this.history.undo(); this.selection.prune(this.world); return; }
    if (mod && k === 'y') { e.preventDefault(); this.history.redo(); this.selection.prune(this.world); return; }
    if (mod && k === 'd') { e.preventDefault(); this.duplicateSelection(); return; }
    if (mod && k === 'g') { e.preventDefault(); if (e.shiftKey) this.ungroupSelection(); else this.groupSelection(); return; }
    if (mod && k === 'a') { e.preventDefault(); this.selection.set(this._visibleNodes()); return; }
    if (mod) return;
    switch (e.key) {
      case 'Escape': { const wasDragging = !!this.connect; this.cancel(); if (!wasDragging) this.selection.clear(); break; }
      case 'Delete': case 'Backspace': this.deleteSelection(); break;
      case 'f': case 'F': this.focusSelection(); break;
      case 'Home': this.onFrameAll(); break;
      case 'c': case 'C': this.toggleCollapseSelection(); break;
      default: break;
    }
  }
}
