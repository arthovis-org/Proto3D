// device3d.js — Device3D: phone, tablet, laptop, monitor built from a component definition
// (def.device names the form factor). Thin extruded slabs with a tiny bevel and slim bezels; the
// screen is the component's face (canvas texture: whatever arrives at the "screen" input, drawn
// by faces.drawScreen). Shares the node port anatomy: inputs on the left of the screen slab,
// outputs on the right, names outside beside the pins (off the screen).
import * as THREE from 'three';
import { faceLayer } from './layers.js';
import { palette, sizes, materials, makeLabel, makeShadowBlob } from './theme.js';
import { panelGeometry, slabGeometry, outlineGeometry } from './geometry.js';
import { Block3D } from './block3d.js';

export class Device3D extends Block3D {
  constructor(def, o = {}) {
    super(def, o);
    this.type = def.device;
    this.meshes = [];      // pickable body parts
    this.themedParts = []; // [mesh, paletteKey]
    const spec = sizes.device[this.type] || sizes.device.phone;
    this.width = spec.w; this.height = spec.h; this.depth = spec.d;
    this._build(spec);

    // Thin outline shell around the screen slab for hover / selected / error
    this.rim = new THREE.Mesh(outlineGeometry(spec.w, spec.h, spec.d, sizes.outline.grow, { radius: spec.radius }), materials.rim());
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
    this._wiringOn = this.portsVisible;
    this.applyWiring();
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
    const plane = this._initFace(w, h, { emissive: 0.75, transparent: false });
    this.meshes.push(plane);
    this.add(plane);
    return plane;
  }

  _build(s) {
    const frame = () => materials.device(palette.deviceFrame);
    const body = () => materials.device(palette.deviceBody);
    const bz = s.bezel;
    switch (this.type) {
      case 'phone':
      case 'tablet': {
        this.slab = this._part(panelGeometry(s.w, s.h, s.d, { radius: s.radius, bevel: 0.02 }), frame(), 'deviceFrame');
        this.slab.position.y = s.h / 2;
        const scr = this._screen(s.w - 2 * bz, s.h - 2 * bz - (this.type === 'phone' ? 0.1 : 0));
        scr.position.set(0, s.h / 2, s.d / 2 + faceLayer(1));
        break;
      }
      case 'laptop': {
        const base = this._part(slabGeometry(s.w, s.baseDepth, 0.12, { radius: 0.12, bevel: 0.02 }), body(), 'deviceBody');
        base.position.set(0, 0.06, 0.3);
        const kb = this._part(new THREE.PlaneGeometry(s.w - 0.7, s.baseDepth - 1.1), materials.device(palette.keyboard), 'keyboard');
        kb.rotation.x = -Math.PI / 2; kb.position.set(0, 0.125, 0.4);
        this.slab = this._part(panelGeometry(s.w, s.h, s.d, { radius: s.radius, bevel: 0.015 }), frame(), 'deviceFrame');
        this.slab.rotation.x = -0.2;
        this.slab.position.set(0, s.h / 2 * Math.cos(0.2) + 0.12, -s.baseDepth / 2 + 0.35 - s.h / 2 * Math.sin(0.2));
        const scr = this._screen(s.w - 2 * bz, s.h - 2 * bz);
        scr.rotation.x = -0.2;
        scr.position.copy(this.slab.position).add(new THREE.Vector3(0, 0, s.d / 2 + faceLayer(1)).applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.2));
        this.height = this.slab.position.y + s.h / 2;
        break;
      }
      case 'monitor':
      default: {
        const foot = this._part(slabGeometry(2.0, 1.2, 0.08, { radius: 0.2, bevel: 0.015 }), body(), 'deviceBody');
        foot.position.y = 0.04;
        const neck = this._part(new THREE.CylinderGeometry(0.12, 0.16, s.standH, 16), body(), 'deviceBody');
        neck.position.y = s.standH / 2 + 0.08;
        this.slab = this._part(panelGeometry(s.w, s.h, s.d, { radius: s.radius, bevel: 0.015 }), frame(), 'deviceFrame');
        this.slab.position.y = s.standH + s.h / 2 - 0.1;
        const scr = this._screen(s.w - 2 * bz, s.h - 2 * bz);
        scr.position.set(0, this.slab.position.y, s.d / 2 + faceLayer(1));
        this.height = this.slab.position.y + s.h / 2;
        break;
      }
    }
  }

  /** In the plan the screen slab lies flat, centred on the origin and lifted clear of the floor and the cables (the stand hangs below it on screen). */
  planPivot() { const p = this.slab ? this.slab.position : new THREE.Vector3(0, this.height / 2, 0); return { x: p.x, y: p.y, z: p.z + this.depth / 2, lift: 1.2 }; }

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
