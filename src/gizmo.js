// gizmo.js — TransformControls wrapper: translate / rotate / scale the selected block.
// Off by default; when on, it attaches to whatever block is selected and is never visible
// without a selection. Disables orbit while dragging and reports changes.
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export class Gizmo {
  constructor({ camera, renderer, scene, controls, onChange = () => {}, onModeChange = () => {} }) {
    this.controls = controls;
    this.onChange = onChange;
    this.onModeChange = onModeChange;
    this.enabled = false;
    this.mode = 'translate';
    this.target = null;
    this.dragging = false;

    this.control = new TransformControls(camera, renderer.domElement);
    this.control.setSize(0.85);
    this.control.enabled = false;
    this.control.visible = false;
    this.control.addEventListener('dragging-changed', (e) => {
      this.dragging = e.value;
      this.controls.enabled = !e.value;
    });
    this.control.addEventListener('objectChange', () => {
      const b = this.target;
      if (!b) return;
      // keep blocks above the floor and scale sensible
      const minY = b.kind === 'node' ? 0.2 : 0;
      if (b.position.y < minY) b.position.y = minY;
      const s = Math.min(Math.max(b.scale.x, 0.2), 4);
      if (this.mode === 'scale') b.scale.setScalar(s); // uniform scale keeps the node anatomy intact
      this.onChange(b);
    });
    scene.add(this.control);
  }

  /** True while the pointer hovers a gizmo handle (so picking must yield). */
  get hot() { return this.enabled && this.control.visible && !!this.control.axis; }

  setEnabled(on) {
    this.enabled = !!on;
    this.control.enabled = this.enabled;
    this._sync();
  }
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
    if (this.enabled && this.target) { this.control.attach(this.target); this.control.visible = true; }
    else { this.control.detach(); this.control.visible = false; }
  }
}
