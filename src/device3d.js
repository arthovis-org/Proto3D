// device3d.js — Device3D: phone, tablet, laptop, monitor built from a component definition
// (def.device names the form factor). Rounded body + a screen that is the component's face
// (canvas texture: whatever arrives at the "screen" input, drawn by faces.drawScreen). Shares
// the node port anatomy: inputs on the left of the screen slab, outputs on the right.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { palette, states, sizes, materials, makeLabel, makeShadowBlob } from './theme.js';
import { Block3D } from './block3d.js';

export class Device3D extends Block3D {
  constructor(def, o = {}) {
    super(def, o);
    this.type = def.device;
    this.portLabelSide = 'outside';   // names sit beside the pins, off the screen
    this.meshes = [];      // pickable body parts
    this.themedParts = []; // [mesh, paletteKey]
    const spec = sizes.device[this.type] || sizes.device.phone;
    this.width = spec.w; this.height = spec.h; this.depth = spec.d;
    this._build(spec);

    // Rim shell around the screen slab for hover / selected / error
    this.rim = new THREE.Mesh(new RoundedBoxGeometry(spec.w + 0.12, spec.h + 0.12, spec.d + 0.12, 3, 0.18), materials.rim());
    this.rim.position.copy(this.slab.position);
    this.rim.rotation.copy(this.slab.rotation);
    this.rim.visible = false;
    this.add(this.rim);

    // Ports: vertically centred on the slab's left/right faces
    const cy = this.slab.position.y;
    const place = (list, x) => list.forEach((p, i) => {
      const y = cy + ((list.length - 1) / 2 - i) * sizes.port.gap;
      this._addLabelledPort(p, x, y, this.slab.position.z, this.slab.position.z + spec.d / 2 + 0.02);
    });
    place(def.inputs, -spec.w / 2);
    place(def.outputs, spec.w / 2);

    // Title floats above the device
    this.titleLabel = makeLabel(this.title, { size: sizes.label.small * 1.15, color: 'textDim', weight: 600 });
    this.titleLabel.position.set(0, this.height + 0.35, 0);
    this.add(this.titleLabel); this.labels.push(this.titleLabel);

    this.shadow = makeShadowBlob(spec.w, Math.max(spec.d, spec.baseDepth || 0.6));
    this.add(this.shadow);
    this.applyVisual();
    def.onCreate?.(this);
  }

  _part(geo, mat, paletteKey) {
    const m = new THREE.Mesh(geo, mat);
    m.userData.block = this;
    this.meshes.push(m);
    if (paletteKey) this.themedParts.push([m, paletteKey]);
    this.add(m);
    return m;
  }
  _screen(w, h) {
    const plane = this._initFace(w, h, { emissive: 0.75 });
    this.meshes.push(plane);
    this.add(plane);
    return plane;
  }

  _build(s) {
    const frame = () => materials.device(palette.deviceFrame);
    const body = () => materials.device(palette.deviceBody);
    switch (this.type) {
      case 'phone':
      case 'tablet': {
        this.slab = this._part(new RoundedBoxGeometry(s.w, s.h, s.d, 4, this.type === 'phone' ? 0.22 : 0.16), frame(), 'deviceFrame');
        this.slab.position.y = s.h / 2;
        const scr = this._screen(s.w - 0.24, s.h - 0.34);
        scr.position.set(0, s.h / 2, s.d / 2 + 0.005);
        break;
      }
      case 'laptop': {
        const base = this._part(new RoundedBoxGeometry(s.w, 0.14, s.baseDepth, 3, 0.05), body(), 'deviceBody');
        base.position.set(0, 0.07, 0.3);
        const kb = this._part(new THREE.PlaneGeometry(s.w - 0.6, s.baseDepth - 1.0), materials.device(palette.keyboard), 'keyboard');
        kb.rotation.x = -Math.PI / 2; kb.position.set(0, 0.145, 0.45);
        this.slab = this._part(new RoundedBoxGeometry(s.w, s.h, s.d, 3, 0.08), frame(), 'deviceFrame');
        this.slab.rotation.x = -0.2;
        this.slab.position.set(0, s.h / 2 * Math.cos(0.2) + 0.14, -s.baseDepth / 2 + 0.35 - s.h / 2 * Math.sin(0.2));
        const scr = this._screen(s.w - 0.26, s.h - 0.3);
        scr.rotation.x = -0.2;
        scr.position.copy(this.slab.position).add(new THREE.Vector3(0, 0, s.d / 2 + 0.005).applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.2));
        this.height = this.slab.position.y + s.h / 2;
        break;
      }
      case 'monitor':
      default: {
        const foot = this._part(new RoundedBoxGeometry(2.0, 0.1, 1.2, 2, 0.04), body(), 'deviceBody');
        foot.position.y = 0.05;
        const neck = this._part(new THREE.CylinderGeometry(0.16, 0.2, s.standH, 12), body(), 'deviceBody');
        neck.position.y = s.standH / 2 + 0.1;
        this.slab = this._part(new RoundedBoxGeometry(s.w, s.h, s.d, 3, 0.1), frame(), 'deviceFrame');
        this.slab.position.y = s.standH + s.h / 2 - 0.1;
        const scr = this._screen(s.w - 0.3, s.h - 0.3);
        scr.position.set(0, this.slab.position.y, s.d / 2 + 0.005);
        this.height = this.slab.position.y + s.h / 2;
        break;
      }
    }
  }

  applyVisual() {
    const disabled = this.derivedState === 'disabled';
    if (this.face?.mesh) this.face.mesh.material.emissiveIntensity = disabled ? 0.1 : this.derivedState === 'active' ? 0.95 : 0.75;
    super.applyVisual();
  }

  _applyLOD() {
    super._applyLOD();
    const k = this.lodBlend;
    const far = this._farTitleScale() * 2.0;
    this.titleLabel.scale.setScalar(1 + (far - 1) * k);
    this.titleLabel.position.y = this.height + 0.35 + 0.3 * far * k;
  }

  update(time, dt) {
    if (this.derivedState === 'active' && this.face?.mesh) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 3.0);
      this.face.mesh.material.emissiveIntensity = 0.75 + 0.25 * pulse;
    }
    this._updateLOD(dt);
    this._updateShadow();
  }

  refreshTheme() {
    this.themedParts.forEach(([m, key]) => m.material.color.setHex(palette[key]));
    super.refreshTheme();
  }
}
