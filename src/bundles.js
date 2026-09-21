// bundles.js — cable management: cables that run roughly parallel and close together merge into
// one thicker, neutral trunk and split back into their own coloured cables near the pins.
//
//   BundleManager  regroups when the layout, the routes or the cable settings change (debounced
//                  0.15 s after the last change): two cables bundle when at least 40 % of the
//                  samples of each run within `cables.bundleDistance` of the other with roughly
//                  parallel tangents (union-find over all pairs), or when they share a RouteNode (a
//                  manual bundle, whatever their distance). A cable with a private waypoint routes
//                  itself and never joins an automatic bundle. Off = every cable on its own.
//   Bundle         one group of members: the trunk is routed like a cable (the current style, the
//                  members' shared nodes as waypoints) from the mean of the members' start points to
//                  the mean of their end points, trimmed by `sizes.connection.fan` at both ends; its
//                  radius grows with the square root of the member count (capped). Each member's
//                  drawn curve leaves its pin, joins the trunk in the fan region, rides on the trunk's
//                  surface at its own angle (so the members read as thin coloured stripes on the
//                  neutral trunk, their flow sheen and chips intact) and fans out to its pin at the
//                  far end. The trunk dims with its members and is a drop target for a waypoint
//                  handle (interaction.js: the dropped cable joins the bundle through a shared node).
import * as THREE from 'three';
import { palette, sizes, onThemeChange } from './theme.js';
import { cables } from './cables.js';
import { isPlanOn, PLAN_CABLE_Y } from './plan.js';
import { routePath, polyCurve, trimPolyline, polylineLength, manhattanLeg, cleanPolyline } from './routing.js';

const SAMPLES = 16;          // per cable, for the closeness test
const MIN_OVERLAP = 0.4;     // fraction of a cable that must run beside the other
const MIN_TRUNK = 5;         // units: shorter trunks are not worth a bundle
const TRUNK_SAMPLES = 40;
const REGROUP_DELAY = 0.15;  // seconds after the last change
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _box = new THREE.Box3();
const X = new THREE.Vector3(1, 0, 0);

export class Bundle extends THREE.Group {
  constructor(members, world) {
    super();
    this.kind = 'bundle';
    this.members = members;
    this.world = world;
    this.curve = null;          // the trimmed trunk
    this.radius = 0;
    this.memberCurves = new Map();
    this.far = false;
    this.hovered = false;
    this._key = '';
    this._dim = 1;
    this.trunk = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: palette.cableTrunk, roughness: 0.55, metalness: 0.05, transparent: true, opacity: 0.92 }));
    this.trunk.userData.bundle = this;
    this.add(this.trunk);
    this.pickTube = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false }));
    this.pickTube.userData.bundle = this; this.pickTube.visible = false;
    this.add(this.pickTube);
    this._offTheme = onThemeChange(() => this.trunk.material.color.setHex(palette.cableTrunk));
    this.visible = false;
  }
  get complete() { return true; }
  /** The trunk's middle (chips, hover). */
  midpoint(target = new THREE.Vector3()) { return this.curve ? this.curve.getPoint(0.5, target) : target.set(0, 0, 0); }
  chipPoint(target) { return this.midpoint(target); }
  /** The emphasis of the most emphasised member. */
  get dimTarget() { return Math.max(...this.members.map((m) => m.dimTarget)); }
  setHover(on) { this.hovered = !!on; }
  setFar(on) { this.far = !!on; }
  /** The curve a member cable draws (its own curve until the trunk exists). */
  memberCurve(c) { this._ensureTrunk(); return this.memberCurves.get(c) || c.ownCurve; }
  /** The shared RouteNodes among the members, left to right. */
  sharedNodes() {
    const seen = new Set();
    for (const m of this.members) for (const n of m.route) if (n.sharedIn(this.world)) seen.add(n);
    return [...seen].sort((p, q) => p.position.x - q.position.x);
  }
  /** Where a handle dropped at `p` would join: the trunk point nearest to it. */
  nearestPoint(p, target = new THREE.Vector3()) {
    if (!this.curve) return target.copy(p);
    let bd = Infinity;
    for (let i = 0; i <= 32; i++) { this.curve.getPoint(i / 32, _a); const d = _a.distanceToSquared(p); if (d < bd) { bd = d; target.copy(_a); } }
    return target;
  }
  /** Re-route the trunk and every member when anything they depend on changed (cheap key compare otherwise). */
  _ensureTrunk() {
    const W = this.world, planar = isPlanOn();
    const key = `${W.layoutVersion}|${W.version}|${cables.version}|${planar}|${this.members.map((m) => `${m.uid}:${m.routeVersion}:${m.far ? 1 : 0}`).join()}`;
    if (key === this._key) return;
    this._key = key;
    const M = this.members, n = M.length;
    M.forEach((m) => m._computeOwn());
    const p0 = new THREE.Vector3(), p3 = new THREE.Vector3();
    M.forEach((m) => { p0.add(m._p0); p3.add(m._p3); }); p0.divideScalar(n); p3.divideScalar(n);
    const fromBox = new THREE.Box3(), toBox = new THREE.Box3();
    for (const m of M) { const b = m._endBoxes(); if (b.fromBox) fromBox.union(b.fromBox); if (b.toBox) toBox.union(b.toBox); }
    const style = cables.style, cr = cables.cornerRadius;
    // an orthogonal trunk runs at one height no member's pins are below (never above a member's ports)
    const height = style === 'orthogonal' && !planar ? Math.min(...M.flatMap((m) => [m._p0.y, m._p3.y])) : null;
    const full = routePath(p0, p3, { style, cornerRadius: cr, planar, height, waypoints: this.sharedNodes().map((r) => r.position), fromBox: fromBox.isEmpty() ? null : fromBox, toBox: toBox.isEmpty() ? null : toBox });
    const len = full.getLength();
    this.memberCurves.clear();
    if (len < MIN_TRUNK) { this.curve = null; this.visible = false; return; }
    const fan = Math.min(sizes.connection.fan, len * 0.3);
    const R = sizes.connection.radius.idle * cables.thicknessScale * Math.min(2.6, 0.9 + 0.75 * Math.sqrt(n));
    this.radius = R;
    // the trimmed trunk: a polyline for the polyline styles, a spline through spaced samples for smooth
    let trunkPts, trunkCurve;
    if (full.polyline && style === 'orthogonal') {
      // the horizontal runs only (no stubs, no drops), trimmed by the fan where there is room; a
      // degenerate trunk (pins level and in one row: a straight line) keeps its middle stretch
      let runs = full.polyline.length >= 6 ? full.polyline.slice(2, -2) : full.polyline.length >= 4 ? full.polyline.slice(1, -1) : null;
      if (!runs || runs.length < 2) { const ta = fan / len; runs = [full.getPointAt(ta), full.getPointAt(1 - ta)]; }
      const L = polylineLength(runs), f = Math.min(fan, L / 3);
      trunkPts = L > 0.5 ? trimPolyline(runs, f, L - f) : runs.map((p) => p.clone());
      if (trunkPts.length < 2) trunkPts = runs.map((p) => p.clone());
      trunkCurve = polyCurve(trunkPts, cr);
    } else if (full.polyline && style !== 'smooth') { trunkPts = trimPolyline(full.polyline, fan, len - fan); if (trunkPts.length < 2) trunkPts = [full.getPointAt(fan / len), full.getPointAt(1 - fan / len)]; trunkCurve = polyCurve(trunkPts, 0); }
    else {
      const ta = fan / len, tb = 1 - ta;
      trunkPts = []; for (let i = 0; i < TRUNK_SAMPLES; i++) trunkPts.push(full.getPointAt(ta + (tb - ta) * i / (TRUNK_SAMPLES - 1)));
      trunkCurve = new THREE.CatmullRomCurve3(trunkPts, false, 'chordal');
    }
    this.curve = trunkCurve;
    // members ride on the trunk surface: side by side across its width in the plan and in a tray (orthogonal), around it in 3D otherwise
    const flat = planar || style === 'orthogonal';
    const offsets = M.map((_, i) => (flat ? new THREE.Vector3(0, 0, n > 1 ? R * (2 * i / (n - 1) - 1) : 0) : new THREE.Vector3(0, R * Math.cos(2 * Math.PI * i / n + 0.6), R * Math.sin(2 * Math.PI * i / n + 0.6))));
    const stub = sizes.connection.stub;
    M.forEach((m, i) => {
      const d = offsets[i], a = m._p0, b = m._p3;
      const inner = trunkPts.map((p) => p.clone().add(d));
      let curve;
      if (style === 'smooth') {
        const pts = [a.clone(), new THREE.Vector3(a.x + 0.8, planar ? PLAN_CABLE_Y : a.y, a.z), ...inner, new THREE.Vector3(b.x - 0.8, planar ? PLAN_CABLE_Y : b.y, b.z), b.clone()];
        curve = new THREE.CatmullRomCurve3(dedupe(pts), false, 'centripetal', 0.5);
      } else if (style === 'straight') {
        const pts = [a.clone()];
        if (planar) pts.push(new THREE.Vector3(a.x + 0.5, PLAN_CABLE_Y, a.z));
        pts.push(...inner);
        if (planar) pts.push(new THREE.Vector3(b.x - 0.5, PLAN_CABLE_Y, b.z));
        pts.push(b.clone());
        curve = polyCurve(pts, 0);
      } else {
        // orthogonal: stub, a drop beside the pin to the trunk's height, horizontal legs onto and along the trunk, a rise beside the far pin
        const s0 = new THREE.Vector3(a.x + stub, a.y, a.z), s3 = new THREE.Vector3(b.x - stub, b.y, b.z);
        const Y = inner[0].y;
        const pts = [a.clone(), s0, new THREE.Vector3(s0.x, Y, s0.z)];
        const dir = () => (pts.length > 1 && pts[pts.length - 1].distanceToSquared(pts[pts.length - 2]) > 1e-8 ? new THREE.Vector3().subVectors(pts[pts.length - 1], pts[pts.length - 2]).normalize() : X);
        // join the trunk at the first point ahead of the drop and leave it at the last point before the rise (in the trunk's x direction), so no leg doubles back
        const fwd = inner[inner.length - 1].x >= inner[0].x;
        let j = inner.findIndex((p) => (fwd ? p.x >= s0.x + 0.3 : p.x <= s0.x - 0.3)); if (j < 0) j = 0;
        let k = inner.length - 1; while (k > j && (fwd ? inner[k].x > s3.x - 0.3 : inner[k].x < s3.x + 0.3)) k--;
        pts.push(...manhattanLeg(pts[2], inner[j], dir(), null));
        pts.push(...inner.slice(j, k + 1));
        const end = new THREE.Vector3(s3.x, Y, s3.z);
        pts.push(...manhattanLeg(inner[k], end, dir(), X));
        pts.push(s3, b.clone());
        curve = polyCurve(cleanPolyline(pts), cr);
        curve.routeY = Y;
      }
      this.memberCurves.set(m, curve);
    });
    const segs = Math.max(16, Math.min(160, Math.round(len * (style === 'orthogonal' ? 6 : 4))));
    this.trunk.geometry.dispose(); this.trunk.geometry = new THREE.TubeGeometry(trunkCurve, segs, R, 10, false);
    this.pickTube.geometry.dispose(); this.pickTube.geometry = new THREE.TubeGeometry(trunkCurve, Math.max(8, segs >> 1), R * 1.6, 6, false);
    this.visible = true;
  }
  update(dt) {
    this._ensureTrunk();
    const shown = !!this.curve && this.members.some((m) => m.visible);
    this.visible = shown;
    if (!shown) return;
    const t = this.dimTarget;
    if (Math.abs(this._dim - t) > 0.004) this._dim += (t - this._dim) * Math.min(1, dt / 0.15); else this._dim = t;
    this.trunk.material.opacity = 0.92 * (0.3 + 0.7 * this._dim);
  }
  dispose() {
    this._offTheme?.();
    this.trunk.geometry.dispose(); this.trunk.material.dispose();
    this.pickTube.geometry.dispose(); this.pickTube.material.dispose();
  }
}
const dedupe = (pts) => { const out = []; for (const p of pts) if (!out.length || out[out.length - 1].distanceToSquared(p) > 1e-8) out.push(p); return out; };

export class BundleManager {
  /** @param {World} world  @param {THREE.Scene} scene */
  constructor(world, scene) {
    this.world = world; this.scene = scene;
    this.bundles = [];
    world.bundles = this.bundles;
    this._key = '';
    this._wait = 0;
    this._pending = true;
  }
  /** Per frame, before the connections update: regroup when due, then let every bundle follow the layout. */
  update(dt) {
    const W = this.world;
    if (!cables.bundle) { if (this.bundles.length) this.clear(); this._key = ''; return; }
    const key = `${W.layoutVersion}|${W.version}|${cables.version}|${isPlanOn()}|${W.connections.map((c) => c.routeVersion).join()}`;
    if (key !== this._key) { this._key = key; this._wait = REGROUP_DELAY; this._pending = true; }
    if (this._pending) { this._wait -= dt; if (this._wait <= 0) { this._pending = false; this.regroup(); } }
    for (const b of this.bundles) b.update(dt);
  }
  /** Regroup now (tests). */
  regroup() {
    const W = this.world;
    const cands = W.connections.filter((c) => c.complete && c.visible && c.route.every((n) => n.sharedIn(W)));
    cands.forEach((c) => c._computeOwn());
    const smp = cands.map((c) => { const pts = [], tg = []; for (let i = 0; i < SAMPLES; i++) { const t = i / (SAMPLES - 1); pts.push(c.ownCurve.getPoint(t, new THREE.Vector3())); tg.push(c.ownCurve.getTangent(t, new THREE.Vector3())); } return { pts, tg, box: new THREE.Box3().setFromPoints(pts) }; });
    const D2 = cables.bundleDistance * cables.bundleDistance;
    const close = (i, j) => {
      let k = 0;
      for (let a = 0; a < SAMPLES; a++) {
        let bd = Infinity, bi = 0;
        for (let b = 0; b < SAMPLES; b++) { const d = smp[i].pts[a].distanceToSquared(smp[j].pts[b]); if (d < bd) { bd = d; bi = b; } }
        if (bd <= D2 && smp[i].tg[a].dot(smp[j].tg[bi]) > 0.6) k++;
      }
      return k / SAMPLES;
    };
    const parent = cands.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const shareNode = (a, b) => a.route.some((n) => b.route.includes(n));
    for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) {
      if (find(i) === find(j)) continue;
      const manual = shareNode(cands[i], cands[j]);
      if (!manual) { _box.copy(smp[i].box).expandByScalar(cables.bundleDistance); if (!_box.intersectsBox(smp[j].box)) continue; }
      if (manual || (close(i, j) >= MIN_OVERLAP && close(j, i) >= MIN_OVERLAP)) parent[find(j)] = find(i);
    }
    const groups = new Map();
    cands.forEach((c, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); });
    const wanted = [...groups.values()].filter((g) => g.length > 1 && (g.some((c) => c.route.length) || meanSpan(g) >= MIN_TRUNK));
    // reconcile: keep a bundle whose member set is unchanged, dispose the rest, create the new ones
    const keyOf = (g) => g.map((c) => c.uid).sort().join();
    const have = new Map(this.bundles.map((b) => [keyOf(b.members), b]));
    const next = [];
    for (const g of wanted) { const k = keyOf(g); if (have.has(k)) { next.push(have.get(k)); have.delete(k); } else { const b = new Bundle(g, W); this.scene.add(b); next.push(b); } }
    for (const b of have.values()) { b.members.forEach((m) => { if (m.bundle === b) m.bundle = null; }); this.scene.remove(b); b.dispose(); }
    for (const c of W.connections) if (c.bundle && !next.includes(c.bundle)) c.bundle = null;
    for (const b of next) for (const m of b.members) m.bundle = b;
    this.bundles.length = 0; this.bundles.push(...next);
  }
  /** Drop every bundle (the setting went off, the world changed tab). */
  clear() {
    for (const b of this.bundles) { b.members.forEach((m) => { if (m.bundle === b) m.bundle = null; }); this.scene.remove(b); b.dispose(); }
    this.bundles.length = 0;
  }
}
/** Distance between the mean start and the mean end of a group of cables. */
function meanSpan(g) {
  _a.set(0, 0, 0); _b.set(0, 0, 0);
  for (const c of g) { _a.add(c._p0); _b.add(c._p3); }
  return _a.divideScalar(g.length).distanceTo(_b.divideScalar(g.length));
}
