// gizmo.js — TransformControls wrapper: translate / rotate / scale the primary selected block.
// Off by default; when on, it attaches to the selection and is never visible without one.
// Disables orbit while dragging and records one undoable transform per drag. Follows the snap
// settings (plan.js): rotation in 15° steps, scale in 0.25 steps, translation on the grid pitch.
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import * as cmd from './core/commands.js';
import { snap, ROTATION_STEP, SCALE_STEP } from './plan.js';

export class Gizmo {
  constructor({ camera, renderer, scene, controls, world, history, onChange = () => {}, onModeChange = () => {} }) {
    Object.assign(this, { controls, world, history, onChange, onModeChange });
    this.enabled = false;
    this.suspended = false;   // hidden while the 2D editing mode is on (moves are drags there)
    this.mode = 'translate';
    this.target = null;
    this.dragging = false;
    this._before = null;

    this.control = new TransformControls(camera, renderer.domElement);
    this.control.setSize(0.85);
    this.control.enabled = false;
    this.control.visible = false;
    this.control.addEventListener('dragging-changed', (e) => {
      this.dragging = e.value;
      this.controls.enabled = !e.value;
      if (e.value && this.target) this._before = [cmd.snapshot(this.target)];
      else if (!e.value && this.target && this._before && this.history) {
        const after = [cmd.snapshot(this.target)];
        if (JSON.stringify(after) !== JSON.stringify(this._before)) this.history.execute(cmd.transform(this.world, [this.target], this._before, after));
        this._before = null;
      }
    });
    this.control.addEventListener('objectChange', () => {
      const b = this.target;
      if (!b) return;
      const minY = b.kind === 'node' ? 0.2 : 0;
      if (b.position.y < minY) b.position.y = minY;
      const s = Math.min(Math.max(b.scale.x, 0.2), 4);
      if (this.mode === 'scale') b.scale.setScalar(s);
      this.world?.bumpLayout();
      this.onChange(b);
    });
    scene.add(this.control);
    this.applySnap();
    snap.onChange(() => this.applySnap());
  }
  /** Read the snap settings into the TransformControls steps (null = free). */
  applySnap() {
    this.control.rotationSnap = snap.active('rotation') ? ROTATION_STEP : null;
    this.control.scaleSnap = snap.active('scale') ? SCALE_STEP : null;
    this.control.translationSnap = snap.active('grid') ? snap.gridSize : null;
  }

  /** True while the pointer hovers a gizmo handle (so picking must yield). */
  get hot() { return this.enabled && this.control.visible && !!this.control.axis; }

  setEnabled(on) { this.enabled = !!on; this.control.enabled = this.enabled && !this.suspended; this._sync(); }
  /** Keep the setting but hide the handles (2D editing mode). */
  setSuspended(on) { this.suspended = !!on; this.control.enabled = this.enabled && !this.suspended; this._sync(); }
  /** Follow the selection: attach to a node / device, detach for connections or nothing. */
  setTarget(block) {
    this.target = block && (block.kind === 'node' || block.kind === 'device') ? block : null;
    this._sync();
  }
  setMode(mode) {
    if (!['translate', 'rotate', 'scale'].includes(mode)) return;
    this.mode = mode;
    this.control.setMode(mode);
    this.onModeChange(mode);
  }
  _sync() {
    if (this.enabled && !this.suspended && this.target && this.target.visible) { this.control.attach(this.target); this.control.visible = true; }
    else { this.control.detach(); this.control.visible = false; }
  }
}
