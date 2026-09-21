// frame.js — framing for the add-on. The core's `ws.frameBlocks` fits the union box of the blocks
// into the canvas minus an open flyout. The demos are wide, flat rows seen from 35° up, so the
// union box's near corners are empty floor and the blocks come out small; and the tutorial card,
// the Ask bar and the bottom pills cover parts of the canvas. This helper projects every block's
// own box, cuts the covered rectangles off the canvas on the side that keeps the blocks largest,
// fits the hull into what is left and flies there with the core's own `flyTo`. The 2D plan keeps
// the core's framing (it is orthographic and has its own pose).
import * as THREE from 'three';
import { isPlanOn } from '../../src/plan.js';

const ELEVATION = THREE.MathUtils.degToRad(35);   // the core's framing elevation (workspace.js)
const FLYOUT_W = 300;                              // the Add flyout (styles.css .flyout)
const PILLS_H = 56;                                // status pill · jobs tray · badge row along the bottom
const EDGE = 12, MIN_SIDE = 120;

/**
 * The part of the canvas nothing covers, in canvas pixels. `covers` are viewport rects (DOM
 * `getBoundingClientRect()`s) of the add-on's own layers; each is cut off on the side that leaves
 * the most room for a hull of `aspect` (width / height).
 */
export function visibleRect(proto, covers = [], aspect = 2) {
  const canvas = proto.ws.renderer.domElement.getBoundingClientRect();
  const r = { left: proto.leftBar?.isOpen ? FLYOUT_W : 0, top: 0, right: canvas.width, bottom: canvas.height - PILLS_H };
  const room = (o) => Math.min((o.right - o.left) / aspect, o.bottom - o.top);   // the hull height that fits
  for (const c of covers) {
    if (!c || !(c.width > 0) || !(c.height > 0)) continue;
    const L = c.left - canvas.left, T = c.top - canvas.top, R = c.right - canvas.left, B = c.bottom - canvas.top;
    if (R <= r.left || L >= r.right || B <= r.top || T >= r.bottom) continue;
    const cuts = [
      { ...r, left: Math.max(r.left, R + EDGE) },
      { ...r, right: Math.min(r.right, L - EDGE) },
      { ...r, top: Math.max(r.top, B + EDGE) },
      { ...r, bottom: Math.min(r.bottom, T - EDGE) },
    ].filter((o) => o.right - o.left >= MIN_SIDE && o.bottom - o.top >= MIN_SIDE);
    if (cuts.length) Object.assign(r, cuts.sort((a, b) => room(b) - room(a))[0]);
  }
  return r;
}

/**
 * Fly so that the blocks' projected hull fills `fill` of the uncovered canvas, at the current
 * azimuth and the core's elevation. Returns the camera distance (or the core's answer in the plan).
 */
export function frameFocus(proto, blocks, { fill = 0.9, instant = false, covers = [], minRadius = 3 } = {}) {
  const { ws } = proto;
  const list = (blocks || []).filter(Boolean);
  const insetLeft = proto.leftBar?.isOpen ? FLYOUT_W : 0;
  if (!list.length || isPlanOn()) return ws.frameBlocks(list, { fill, instant, insetLeft });
  const controls = ws.controls, camera = ws.perspective;
  const box = new THREE.Box3(), tmp = new THREE.Box3(), corners = [];
  for (const b of list) {
    if (b.getAABB) { b.getAABB(tmp).expandByScalar(minRadius * 0.2); box.union(tmp); for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(i & 1 ? tmp.max.x : tmp.min.x, i & 2 ? tmp.max.y : tmp.min.y, i & 4 ? tmp.max.z : tmp.min.z)); }
    else if (b.center) { box.expandByPoint(b.center); corners.push(b.center.clone()); }
  }
  if (!corners.length) return ws.frameBlocks(list, { fill, instant, insetLeft });
  const center = box.getCenter(new THREE.Vector3());
  const cur = controls.camera.position.clone().sub(controls.target);
  const az = Math.atan2(cur.x, cur.z || 1e-6);
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(ELEVATION), Math.sin(ELEVATION), Math.cos(az) * Math.cos(ELEVATION));
  const el = ws.renderer.domElement, W = el.clientWidth || 1, H = el.clientHeight || 1;
  const cam = new THREE.PerspectiveCamera(camera.fov, W / H, camera.near, camera.far);
  const ndc = new THREE.Vector3();
  const extents = (dist) => {
    cam.position.copy(center).addScaledVector(dir, dist); cam.lookAt(center); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    let minX = 1, maxX = -1, minY = 1, maxY = -1;
    for (const c of corners) { ndc.copy(c).project(cam); minX = Math.min(minX, ndc.x); maxX = Math.max(maxX, ndc.x); minY = Math.min(minY, ndc.y); maxY = Math.max(maxY, ndc.y); }
    return { pxW: (maxX - minX) / 2 * W, pxH: (maxY - minY) / 2 * H, minX, maxX, minY, maxY };
  };
  let dist = Math.max(8, box.getSize(new THREE.Vector3()).length());
  const e0 = extents(dist);
  const vis = visibleRect(proto, covers, e0.pxW / Math.max(1, e0.pxH));
  const visW = vis.right - vis.left, visH = vis.bottom - vis.top;
  for (let i = 0; i < 5; i++) {
    const e = extents(dist);
    dist = THREE.MathUtils.clamp(dist * Math.max(e.pxW / (visW * fill), e.pxH / (visH * fill)), 6, controls.maxDistance);
  }
  // centre the hull in the uncovered rectangle (shift the target sideways / up in view space)
  const e = extents(dist);
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
  const up = new THREE.Vector3().crossVectors(dir, right).normalize();
  const halfH = dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), halfW = halfH * (W / H);
  const vx = (vis.left + vis.right) / W - 1, vy = 1 - (vis.top + vis.bottom) / H;   // the rectangle's centre in NDC
  const cx = (e.minX + e.maxX) / 2 - vx, cy = (e.minY + e.maxY) / 2 - vy;
  const target = center.clone().addScaledVector(right, cx * halfW).addScaledVector(up, cy * halfH);
  ws.flyTo(target.clone().addScaledVector(dir, dist), target, instant ? 0 : 0.55);
  return dist;
}

/** A framer bound to the page: `frame(blocks, opts)` with the add-on's open layers as covers. */
export function makeFramer(proto, coversOf = () => []) {
  return (blocks, opts = {}) => frameFocus(proto, blocks, { covers: coversOf(), ...opts });
}
