// interaction.js — raycast picking: hover, select, drag blocks, drag-to-connect, keyboard.
// `world` is the model: { scene, blocks, connections, addConnection(from,to), removeConnection(c), removeBlock(b) }
// An optional gizmo (TransformControls wrapper) takes priority over picking while its handles are hot.
import * as THREE from 'three';
import { Connection3D } from './connection3d.js';

/** True when the key event comes from a text field (panel) — ignore shortcuts then. */
export const isTyping = (e) => {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
};

export class Interaction {
  constructor({ camera, renderer, controls, world, gizmo = null, onSelect = () => {} }) {
    this.camera = camera; this.renderer = renderer; this.controls = controls;
    this.world = world; this.onSelect = onSelect; this.gizmo = gizmo;
    this.ray = new THREE.Raycaster();
    this.ray.params.Line = { threshold: 0.2 };
    this.pointer = new THREE.Vector2();
    this.hovered = null;         // block | port | connection
    this.selected = null;        // block | connection
    this.drag = null;            // { block, plane, offset }
    this.connect = null;         // { from, preview }
    this.downPos = new THREE.Vector2();
    this.shift = false;

    const el = renderer.domElement;
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => { if (e.key === 'Shift') this.shift = false; });
  }

  setGizmo(gizmo) { this.gizmo = gizmo; }
  get gizmoBusy() { return !!(this.gizmo && (this.gizmo.dragging || this.gizmo.hot)); }

  /* ---------- picking ---------- */
  _setPointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.camera);
  }
  _portMeshes() { return this.world.blocks.flatMap((b) => b.ports.map((p) => p.mesh)); }
  _bodyMeshes() { return this.world.blocks.flatMap((b) => b.kind === 'node' ? [b.body, b.header] : b.meshes); }
  _tubeMeshes() { return this.world.connections.map((c) => c.tube); }

  /** Returns { kind: 'port'|'block'|'connection', target, point } or null. Ports win. */
  pick() {
    let hits = this.ray.intersectObjects(this._portMeshes(), false);
    if (hits.length) return { kind: 'port', target: hits[0].object.userData.port, point: hits[0].point };
    hits = this.ray.intersectObjects(this._bodyMeshes(), false);
    if (hits.length) return { kind: 'block', target: hits[0].object.userData.block, point: hits[0].point };
    hits = this.ray.intersectObjects(this._tubeMeshes(), false);
    if (hits.length) return { kind: 'connection', target: hits[0].object.userData.connection, point: hits[0].point };
    return null;
  }

  _setHover(item) {
    if (this.hovered === item) return;
    if (this.hovered) this.hovered.setHover(false);
    this.hovered = item;
    if (item) item.setHover(true);
    this.renderer.domElement.style.cursor = item ? (item.mesh ? 'crosshair' : 'pointer') : '';
  }

  select(item) {
    if (this.selected && this.selected !== item && this.selected.state === 'selected') this.selected.setState(this.selected._prevState || 'idle');
    this.selected = item;
    if (item) {
      item._prevState = item.state === 'selected' ? item._prevState : (item.derivedState || item.state);
      item.setState('selected');
    }
    this.gizmo?.setTarget(item);
    this.onSelect(item);
  }
  deselect() {
    if (this.selected) this.selected.setState(this.selected._prevState || 'idle');
    this.selected = null;
    this.gizmo?.setTarget(null);
    this.onSelect(null);
  }

  /* ---------- pointer ---------- */
  onMove(e) {
    this._setPointer(e);
    if (this.gizmo && this.gizmo.dragging) return;
    if (this.drag) {
      const hit = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(this.drag.plane, hit)) {
        hit.add(this.drag.offset);
        if (!this.shift) hit.y = this.drag.block.position.y; else { hit.x = this.drag.block.position.x; hit.z = this.drag.block.position.z; }
        hit.y = Math.max(0.2, hit.y);
        this.drag.block.position.copy(hit);
      }
      return;
    }
    if (this.connect) {
      const hit = this.pick();
      if (hit && hit.kind === 'port' && hit.target.dir === 'in' && hit.target.owner !== this.connect.from.owner) {
        this._setHover(hit.target);
        this.connect.preview.setTargetPort(hit.target);
        this.connect.preview.setState(hit.target.type === this.connect.from.type ? 'idle' : 'invalid');
      } else {
        this._setHover(null);
        const p = new THREE.Vector3();
        if (this.ray.ray.intersectPlane(this.connect.plane, p)) this.connect.preview.setPreviewTarget(p);
        this.connect.preview.setState('idle');
      }
      return;
    }
    if (this.gizmo && this.gizmo.hot) { this._setHover(null); return; }
    const hit = this.pick();
    this._setHover(hit ? hit.target : null);
  }

  onDown(e) {
    if (e.button !== 0) return;
    if (this.gizmoBusy) return; // the gizmo handles this press
    this.shift = e.shiftKey;
    this._setPointer(e);
    this.downPos.set(e.clientX, e.clientY);
    const hit = this.pick();
    if (!hit) return;

    if (hit.kind === 'port' && hit.target.dir === 'out') {
      // Start a connection: preview tube from the port to a camera-facing plane through it
      const start = hit.target.getWorldPosition(new THREE.Vector3());
      const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, start);
      const preview = new Connection3D(hit.target, start.clone());
      this.world.scene.add(preview);
      this.connect = { from: hit.target, preview, plane };
      this.controls.enabled = false;
      return;
    }
    if (hit.kind === 'block') {
      const block = hit.target;
      this.select(block);
      // Drag plane: horizontal through the block (Shift: vertical, camera-facing)
      const normal = this.shift
        ? this.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize().negate()
        : new THREE.Vector3(0, 1, 0);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, block.position);
      const offset = block.position.clone().sub(hit.point);
      // project offset so the block does not jump: use the plane hit instead of the mesh hit
      const planeHit = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(plane, planeHit)) offset.copy(block.position).sub(planeHit);
      this.drag = { block, plane, offset };
      this.controls.enabled = false;
      return;
    }
    if (hit.kind === 'connection') { this.select(hit.target); }
  }

  onUp(e) {
    if (this.gizmo && this.gizmo.dragging) return;
    this.controls.enabled = true;
    if (this.connect) {
      const { from, preview } = this.connect;
      const target = this.hovered && this.hovered.dir === 'in' ? this.hovered : null;
      this.world.scene.remove(preview); preview.dispose();
      this.connect = null;
      if (target && target.owner !== from.owner) {
        const c = this.world.addConnection(from, target);
        this.select(c);
      }
      return;
    }
    if (this.drag) { this.drag = null; return; }
    // Click on empty space (no orbit movement) clears the selection
    const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) > 4;
    if (!moved && !this.gizmoBusy) { this._setPointer(e); if (!this.pick()) this.deselect(); }
  }

  /* ---------- keyboard ---------- */
  onKey(e) {
    if (e.key === 'Shift') this.shift = true;
    if (isTyping(e)) return;
    if (e.key === 'Escape') {
      if (this.connect) { this.world.scene.remove(this.connect.preview); this.connect.preview.dispose(); this.connect = null; this.controls.enabled = true; }
      if (this.drag) { this.drag = null; this.controls.enabled = true; }
      this.deselect();
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
      const s = this.selected;
      this.selected = null; this.gizmo?.setTarget(null); this.onSelect(null);
      if (this.hovered === s) this.hovered = null;
      if (s.kind === 'connection') this.world.removeConnection(s); else this.world.removeBlock(s);
    }
  }
}
