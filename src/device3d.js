// device3d.js — Device3D: low-detail stand-ins for phone, tablet, laptop, desktop.
// Rounded body + glowing screen plane. Shares the node port anatomy (createPort) so a
// device connects with the same language as a node.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { palette, states, sizes, materials, makeLabel, makeShadowBlob } from './theme.js';
import { createPort } from './node3d.js';

let nextId = 1000;

export class Device3D extends THREE.Group {
  /**
   * @param {object} o
   * @param {'phone'|'tablet'|'laptop'|'desktop'} o.type
   * @param {string} [o.label]
   * @param {{name:string,type:string}[]} [o.inputs]  ports on the left face
   * @param {{name:string,type:string}[]} [o.outputs] ports on the right face
   */
  constructor(o = {}) {
    super();
    this.kind = 'device';
    this.uid = nextId++;
    this.type = o.type || 'phone';
    this.title = o.label || this.type[0].toUpperCase() + this.type.slice(1);
    this.state = 'idle';
    this.hovered = false;
    this.inputs = [];
    this.outputs = [];
    this.meshes = [];   // pickable body parts
    this.screens = [];

    const spec = sizes.device[this.type];
    this.width = spec.w; this.height = spec.h; this.depth = spec.d;
    this._build(spec);

    // Rim shell around the screen slab for hover / selected / error
    this.rim = new THREE.Mesh(
      new RoundedBoxGeometry(spec.w + 0.12, spec.h + 0.12, spec.d + 0.12, 3, 0.18), materials.rim());
    this.rim.position.copy(this.slab.position);
    this.rim.rotation.copy(this.slab.rotation);
    this.rim.visible = false;
    this.add(this.rim);

    // Ports: vertically centered on the slab's left/right faces
    const cy = this.slab.position.y;
    const place = (list, dir, x) => list.forEach((p, i) => {
      const port = createPort(this, { ...p, dir });
      const y = cy + ((list.length - 1) / 2 - i) * sizes.port.gap;
      port.group.position.set(x, y, this.slab.position.z);
      this.add(port.group);
      (dir === 'in' ? this.inputs : this.outputs).push(port);
    });
    place(o.inputs || [], 'in', -spec.w / 2);
    place(o.outputs || [], 'out', spec.w / 2);

    // Title floats above the device
    this.titleLabel = makeLabel(this.title, { size: sizes.label.small * 1.15, color: palette.textDim, weight: 600 });
    this.titleLabel.position.set(0, this.height + 0.35, 0);
    this.add(this.titleLabel);

    this.shadow = makeShadowBlob(spec.w, Math.max(spec.d, spec.baseDepth || 0.6));
    this.add(this.shadow);
    this.applyVisual();
  }

  get ports() { return [...this.inputs, ...this.outputs]; }

  _part(geo, mat) {
    const m = new THREE.Mesh(geo, mat);
    m.userData.block = this;
    this.meshes.push(m);
    this.add(m);
    return m;
  }
  _screen(w, h) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), materials.screen());
    s.userData.block = this;
    this.meshes.push(s);
    this.screens.push(s);
    this.add(s);
    return s;
  }

  _build(s) {
    const frame = materials.device(palette.deviceFrame);
    const body = materials.device(palette.deviceBody);
    switch (this.type) {
      case 'phone':
      case 'tablet': {
        // Upright slab standing on the floor, screen facing +Z
        this.slab = this._part(new RoundedBoxGeometry(s.w, s.h, s.d, 4, this.type === 'phone' ? 0.22 : 0.16), frame);
        this.slab.position.y = s.h / 2;
        const scr = this._screen(s.w - 0.24, s.h - 0.34);
        scr.position.set(0, s.h / 2, s.d / 2 + 0.005);
        break;
      }
      case 'laptop': {
        // Base + tilted lid; ports live on the lid
        const base = this._part(new RoundedBoxGeometry(s.w, 0.14, s.baseDepth, 3, 0.05), body);
        base.position.set(0, 0.07, 0.3);
        const kb = this._part(new THREE.PlaneGeometry(s.w - 0.6, s.baseDepth - 1.0), materials.device(0x121824));
        kb.rotation.x = -Math.PI / 2; kb.position.set(0, 0.145, 0.45);
        this.slab = this._part(new RoundedBoxGeometry(s.w, s.h, s.d, 3, 0.08), frame);
        this.slab.rotation.x = -0.2;
        this.slab.position.set(0, s.h / 2 * Math.cos(0.2) + 0.14, -s.baseDepth / 2 + 0.35 + s.h / 2 * Math.sin(0.2) * -1);
        const scr = this._screen(s.w - 0.26, s.h - 0.3);
        scr.rotation.x = -0.2;
        scr.position.copy(this.slab.position).add(new THREE.Vector3(0, 0, s.d / 2 + 0.005).applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.2));
        this.height = this.slab.position.y + s.h / 2;
        break;
      }
      case 'desktop': {
        // All-in-one monitor on a stand + a small tower beside it
        const foot = this._part(new RoundedBoxGeometry(2.0, 0.1, 1.2, 2, 0.04), body);
        foot.position.y = 0.05;
        const neck = this._part(new THREE.CylinderGeometry(0.16, 0.2, s.standH, 12), body);
        neck.position.y = s.standH / 2 + 0.1;
        this.slab = this._part(new RoundedBoxGeometry(s.w, s.h, s.d, 3, 0.1), frame);
        this.slab.position.y = s.standH + s.h / 2 - 0.1;
        const scr = this._screen(s.w - 0.3, s.h - 0.3);
        scr.position.set(0, this.slab.position.y, s.d / 2 + 0.005);
        const tower = this._part(new RoundedBoxGeometry(0.9, 2.4, 2.2, 2, 0.06), body);
        tower.position.set(s.w / 2 + 0.9, 1.2, 0);
        const led = this._part(new THREE.SphereGeometry(0.06, 10, 8), materials.port('signal'));
        led.position.set(s.w / 2 + 0.9, 2.2, 1.11);
        this.height = this.slab.position.y + s.h / 2;
        break;
      }
    }
  }

  setState(name) { this.state = name; this.applyVisual(); }
  setHover(on) { this.hovered = on; this.applyVisual(); }

  applyVisual() {
    const s = this.state;
    const disabled = s === 'disabled';
    this.screens.forEach((scr) => {
      scr.material.emissiveIntensity = disabled ? 0.08 : s === 'active' ? 0.85 : 0.6;
    });
    this.ports.forEach((p) => p.setDisabled(disabled));
    let rim = null, opacity = 0.35;
    if (s === 'error') { rim = states.error; opacity = 0.6; }
    else if (s === 'selected') { rim = states.selected; opacity = 0.55; }
    else if (this.hovered && !disabled) { rim = states.hover; opacity = 0.3; }
    this.rim.visible = rim !== null;
    if (rim !== null) { this.rim.material.color.setHex(rim); this.rim.material.opacity = opacity; }
  }

  update(time) {
    if (this.state === 'active') {
      const pulse = 0.5 + 0.5 * Math.sin(time * 3.0);
      this.screens.forEach((scr) => { scr.material.emissiveIntensity = 0.65 + 0.35 * pulse; });
    }
    this.shadow.position.y = -this.position.y + 0.005;
  }

  dispose() {
    this.traverse((obj) => {
      obj.geometry?.dispose?.();
      if (obj.material?.map) obj.material.map.dispose();
      obj.material?.dispose?.();
    });
  }
}
