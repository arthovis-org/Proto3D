// groups.js — Group3D: a first-class container for related components. Expanded it is a
// translucent rounded frame on the floor under its members with a title at the front edge;
// selecting the frame selects the group and dragging moves every member. Collapsed it becomes
// a single slab at the members' centroid: members and internal links hide, and every link that
// crosses the boundary re-attaches to a proxy port on the slab (same port anatomy), so a large
// system folds into one tidy block without losing its interfaces.
import * as THREE from 'three';
import { palette, states, sizes, materials, makeLabel, refreshLabel, setLabelText, onThemeChange } from './theme.js';
import { createPort, genUid } from './block3d.js';
import { panelGeometry, slabGeometry, outlineGeometry } from './geometry.js';
import { isWiringOn, onWiringChange } from './wiring.js';
import { isPlanOn, onPlanChange } from './plan.js';

const PAD = 1.2;
const _box = new THREE.Box3();

export class Group3D extends THREE.Group {
  constructor({ uid, title = 'Group', members = [], collapsed = false } = {}) {
    super();
    this.kind = 'group';
    this.uid = uid || genUid();
    this.title = title;
    this.members = [...new Set(members)];
    this.collapsed = false;
    this.hovered = false;
    this.selected = false;
    this.far = false;
    this.farBlend = 0;
    this.world = null;
    this.center = new THREE.Vector3();
    this.bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, w: 0, d: 0 };
    this.proxies = [];      // [{ inner, proxy }]
    this.inputs = []; this.outputs = [];
    this._size = { w: -1, d: -1 };

    this.fill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: palette.groupFill, transparent: true, opacity: palette.groupFillAlpha, depthWrite: false }));
    this.fill.userData.group = this;
    this.fill.renderOrder = 0;
    this.edge = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: palette.groupEdge, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
    this.edge.userData.group = this;
    this.edge.rotation.x = -Math.PI / 2;
    this.edge.position.y = 0.03;
    this.add(this.fill, this.edge);

    this.titleLabel = makeLabel(this.title, { size: 0.42, color: 'textDim', weight: 600 });
    this.add(this.titleLabel);
    this.slab = null;
    this._offTheme = onThemeChange(() => this.refreshTheme());
    this._offWiring = onWiringChange(() => this._applyWiring());
    this._offPlan = onPlanChange(() => this._applyPlan());
    this._applyPlan();
    this.updateBounds(true);
    if (collapsed) this._pendingCollapse = true;
  }
  /** 2D editing mode: the title lies flat at the frame's top-left, a collapsed slab lies flat at its spot. */
  _applyPlan() {
    const on = isPlanOn();
    this.titleLabel.rotation.x = on ? -Math.PI / 2 : 0;
    if (this.slab) this.slab.rotation.x = on ? -Math.PI / 2 : 0;
    this.updateBounds(true);
  }

  get ports() { return this.proxies.map((p) => p.proxy); }
  has(n) { return this.members.includes(n); }
  addMember(n) { if (!this.has(n)) this.members.push(n); n.group = this; this.updateBounds(true); }
  removeMember(n) { this.members = this.members.filter((m) => m !== n); if (n.group === this) n.group = null; this.updateBounds(true); }
  setTitle(t) { this.title = String(t); setLabelText(this.titleLabel, this.title); if (this.slab) setLabelText(this.slab.titleLabel, this.title); }

  /* ---------- bounds / frame ---------- */
  updateBounds(force = false) {
    if (!this.members.length) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    this.center.set(0, 0, 0);
    const plan = isPlanOn();
    for (const m of this.members) {
      if (plan && m.getAABB) { const b = m.getAABB(_box); minX = Math.min(minX, b.min.x); maxX = Math.max(maxX, b.max.x); minZ = Math.min(minZ, b.min.z); maxZ = Math.max(maxZ, b.max.z); }
      else {
        const f = m.footprint();
        minX = Math.min(minX, m.position.x - f.w / 2); maxX = Math.max(maxX, m.position.x + f.w / 2);
        minZ = Math.min(minZ, m.position.z - f.d / 2); maxZ = Math.max(maxZ, m.position.z + f.d / 2);
      }
      this.center.add(m.position);
    }
    this.center.divideScalar(this.members.length);
    minX -= PAD; maxX += PAD; minZ -= PAD; maxZ += PAD;
    const w = maxX - minX, d = maxZ - minZ;
    Object.assign(this.bounds, { minX, maxX, minZ, maxZ, w, d });
    if (force || Math.abs(w - this._size.w) > 0.05 || Math.abs(d - this._size.d) > 0.05) {
      this._size = { w, d };
      this.fill.geometry.dispose();
      this.fill.geometry = slabGeometry(w, d, 0.05, { radius: 0.6, bevel: 0.01 });
      this.edge.geometry.dispose();
      this.edge.geometry = ringGeometry(w, d, 0.5, 0.1);
    }
    this.fill.position.set((minX + maxX) / 2, 0.025, (minZ + maxZ) / 2);
    this.edge.position.set((minX + maxX) / 2, 0.035, (minZ + maxZ) / 2);
    if (plan) this.titleLabel.position.set(minX + 0.5 + this.titleLabel.userData.worldW * this.titleLabel.scale.x / 2, 0.12, minZ + 0.35 + this.titleLabel.userData.worldH / 2);   // flat, top-left inside the frame
    else this.titleLabel.position.set(minX + 0.5 + this.titleLabel.userData.worldW * this.titleLabel.scale.x / 2, 0.32 + 0.2 * this.farBlend, maxZ + 0.02);
    if (this.slab) { this.slab.position.set(this.center.x, this.slab.userData.h / 2 + 0.4, this.center.z); }
  }

  /* ---------- collapse ---------- */
  setCollapsed(on, world = this.world) {
    on = !!on;
    if (on === this.collapsed) return;
    this.collapsed = on;
    if (on) {
      this._buildSlab();
      this.members.forEach((m) => { m.visible = false; });
      this.refreshProxies(world);
    } else {
      this.members.forEach((m) => { m.visible = true; });
      this._clearProxies(world);
      if (this.slab) { this.remove(this.slab); disposeTree(this.slab); this.slab = null; }
      world?.connections.forEach((c) => { c.visible = true; });
    }
    this.fill.visible = !on; this.edge.visible = !on; this.titleLabel.visible = !on;
    world?.bumpLayout();
  }
  _buildSlab() {
    if (this.slab) { this.remove(this.slab); disposeTree(this.slab); }
    const label = makeLabel(this.title, { size: 0.5, color: 'textOnHeader', weight: 600 });
    const w = Math.max(6, label.userData.worldW + 2.4), h = 3.0, d = 0.7;
    const slab = new THREE.Group();
    slab.userData.h = h;
    const body = new THREE.Mesh(panelGeometry(w, h, d, { radius: 0.32 }), materials.body());
    body.userData.group = this;
    // slim accent line along the top edge instead of a header band
    const header = new THREE.Mesh(new THREE.BoxGeometry(w - 0.6, 0.045, 0.012), new THREE.MeshBasicMaterial({ color: palette.groupFill }));
    header.position.set(0, h / 2 - 0.1, d / 2 + 0.016); header.userData.group = this;
    label.position.set(0, h / 2 - 0.62, d / 2 + 0.05);
    const sub = makeLabel(`${this.members.length} components`, { size: 0.24, color: 'textDim', weight: 500 });
    sub.position.set(0, -0.2, d / 2 + 0.02);
    const rim = new THREE.Mesh(outlineGeometry(w, h, d, sizes.outline.grow, { radius: 0.32 }), materials.rim());
    rim.visible = false;
    slab.add(body, header, label, sub, rim);
    slab.titleLabel = label; slab.body = body; slab.rim = rim; slab.header = header; slab.sub = sub;
    slab.userData.w = w; slab.userData.d = d;
    slab.rotation.x = isPlanOn() ? -Math.PI / 2 : 0;   // flat in the plan
    this.slab = slab;
    this.add(slab);
    this.updateBounds(true);
    this.applyVisual();
  }
  /** Boundary-crossing links attach to proxy ports on the slab; internal links hide. */
  refreshProxies(world) {
    if (!this.collapsed || !this.slab || !world) return;
    this._clearProxies(world);
    const ins = [], outs = [];
    for (const c of world.connections) {
      if (!c.to) continue;
      const a = this.has(c.from.owner), b = this.has(c.to.owner);
      if (a && b) { c.visible = false; continue; }
      c.visible = true;
      if (b && !ins.includes(c.to)) ins.push(c.to);
      if (a && !outs.includes(c.from)) outs.push(c.from);
    }
    const { w, d } = this.slab.userData;
    const h = this.slab.userData.h;
    const place = (list, dir, x) => list.forEach((inner, i) => {
      const proxy = createPort(this, { key: `${inner.owner.uid}:${inner.key}`, label: `${inner.owner.title} · ${inner.label}`, type: inner.type, subtype: inner.subtype, loose: inner.loose, dir, multi: inner.multi });
      const y = h / 2 - 1.2 - i * sizes.port.gap;
      proxy.group.position.set(x, y, 0);
      proxy.setConnected(true);
      if (dir === 'in') proxy.setLinkCount(world.connections.filter((c) => c.to === inner && !this.has(c.from.owner)).length);
      this.slab.add(proxy.group);
      const lbl = makeLabel(proxy.label, { size: sizes.label.port, color: 'textDim', weight: 500, maxWidth: w / 2 - 0.6 });
      const inset = 0.22 + lbl.userData.worldW / 2;
      lbl.position.set(dir === 'in' ? x + inset : x - inset, y, d / 2 + 0.02);
      this.slab.add(lbl);
      proxy.labelMesh = lbl;
      inner.proxy = proxy;
      this.proxies.push({ inner, proxy });
      (dir === 'in' ? this.inputs : this.outputs).push(proxy);
    });
    place(ins, 'in', -w / 2);
    place(outs, 'out', w / 2);
    this._applyWiring();
    const rows = Math.max(ins.length, outs.length);
    const needH = 1.2 + rows * sizes.port.gap + 0.9;
    if (needH > h) { // grow the slab body for many ports
      this.slab.userData.h = needH;
      this.slab.body.geometry.dispose(); this.slab.body.geometry = panelGeometry(w, needH, d, { radius: 0.32 });
      this.slab.rim.geometry.dispose(); this.slab.rim.geometry = outlineGeometry(w, needH, d, sizes.outline.grow, { radius: 0.32 });
      this.slab.header.position.y = needH / 2 - 0.1; this.slab.titleLabel.position.y = needH / 2 - 0.62;
      this.slab.sub.position.y = -needH / 2 + 0.4;
      let ii = 0, oi = 0;
      for (const { proxy } of this.proxies) {
        const i = proxy.dir === 'in' ? ii++ : oi++;
        proxy.group.position.y = needH / 2 - 1.2 - i * sizes.port.gap;
        proxy.labelMesh.position.y = proxy.group.position.y;
      }
    }
    this.updateBounds(true);
    world.bumpLayout();
  }
  _clearProxies(world) {
    for (const { inner, proxy } of this.proxies) {
      inner.proxy = null;
      this.slab?.remove(proxy.group); disposeTree(proxy.group);
      if (proxy.labelMesh) { this.slab?.remove(proxy.labelMesh); disposeTree(proxy.labelMesh); }
    }
    this.proxies = []; this.inputs = []; this.outputs = [];
  }

  /** Proxy ports follow the global wiring switch (a collapsed group's cables are hidden with it). */
  _applyWiring() {
    const on = isWiringOn();
    for (const { proxy } of this.proxies) { proxy.group.visible = on; if (proxy.labelMesh) proxy.labelMesh.visible = on; }
  }

  /* ---------- look ---------- */
  setHover(on) { this.hovered = on; this.applyVisual(); }
  setSelected(on) { this.selected = on; this.applyVisual(); }
  applyVisual() {
    const base = palette.groupFillAlpha;
    this.fill.material.color.setHex(palette.groupFill);
    this.fill.material.opacity = this.selected ? base * 2.4 : this.hovered ? base * 1.7 : base;
    this.edge.material.color.setHex(this.selected ? states.selected : this.hovered ? states.hover : palette.groupEdge);
    this.edge.material.opacity = this.selected ? 0.9 : this.hovered ? 0.7 : 0.45;
    if (this.slab) {
      const rim = this.selected ? states.selected : this.hovered ? states.hover : null;
      this.slab.rim.visible = rim !== null;
      if (rim !== null) { this.slab.rim.material.color.setHex(rim); this.slab.rim.material.opacity = this.selected ? 0.55 : 0.3; }
      this.slab.header.material.color.setHex(this.selected ? states.selected : palette.groupFill);
    }
  }
  setFar(on, distance = 0) { this.far = on; this.farDistance = distance; }
  update(dt) {
    const target = this.far ? 1 : 0;
    if (Math.abs(this.farBlend - target) > 0.002) this.farBlend += (target - this.farBlend) * Math.min(1, dt * 6);
    this.titleLabel.scale.setScalar(1 + (THREE.MathUtils.clamp(this.farDistance / 45, 1.6, 4) - 1) * this.farBlend);
    if (this.slab) this.slab.titleLabel.scale.setScalar(1 + (THREE.MathUtils.clamp(this.farDistance / 50, 1.3, 3.4) - 1) * this.farBlend);
    this.updateBounds();
  }
  refreshTheme() {
    refreshLabel(this.titleLabel);
    if (this.slab) { refreshLabel(this.slab.titleLabel); refreshLabel(this.slab.sub); this.proxies.forEach(({ proxy }) => { proxy.refreshTheme(); refreshLabel(proxy.labelMesh); }); }
    this.applyVisual();
  }
  serialize() { return { uid: this.uid, title: this.title, members: this.members.map((m) => m.uid), collapsed: this.collapsed }; }
  dispose() { this._offTheme?.(); this._offWiring?.(); this._offPlan?.(); disposeTree(this); }
}

/** Flat rounded-rectangle ring (frame border) in the XY plane, rotated onto the floor by the caller. */
function ringGeometry(w, d, r, t) {
  const outer = roundedRectShape(w, d, r);
  const inner = roundedRectShape(w - 2 * t, d - 2 * t, Math.max(0.05, r - t));
  outer.holes.push(inner);
  return new THREE.ShapeGeometry(outer, 12);
}
function roundedRectShape(w, h, r) {
  const s = new THREE.Shape(); const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function disposeTree(obj) {
  obj.traverse?.((o) => { o.geometry?.dispose?.(); if (o.material) { o.material.map?.dispose?.(); o.material.dispose?.(); } });
}
