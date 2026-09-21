// arrange.js — apply a flow preset to the hub nodes of the current world as one undoable, animated
// move (position and rotation y). The set keeps the floor-plan centre it had (so the flows do not
// wander off), y comes from the flow's levels, and the moved blocks are framed when the tween lands. Off-contract seams: window.__proto.{world, history}.
import { layoutFlow, flowById, layoutBounds } from './flows.js';
import { isHubNode } from './nodes.js';
import { blueprintSlug } from './generate.js';
import { tweenNodes } from './motion.js';

/** Flows that stack levels in y: framed from a higher elevation so the floors do not hide each other. */
export const STACKED = Object.freeze(['audience', 'compare', 'sitemap', 'devices']);
const ELEVATION = 40, FLOWBAR_PX = 64;

/**
 * Frame `blocks` like ws.frameBlocks (current azimuth, the AABB union filling `fill` of the visible
 * area) but from `elevation` degrees, keeping the Add rail (`insetLeft`) and the flow bar clear.
 * Off-contract: window.__proto.ws.{renderer, controls, camera, flyTo}, window.__proto.THREE.
 */
export function frameFrom(host, blocks, { elevation = ELEVATION, fill = 0.85, duration = 0.55 } = {}) {
  const proto = typeof window !== 'undefined' ? window.__proto : null;
  const list = (blocks || []).filter((b) => b && b.getAABB);
  if (!proto || !list.length) return null;
  const { ws, THREE, leftBar } = proto;
  const box = new THREE.Box3(), tmp = new THREE.Box3();
  for (const b of list) box.union(b.getAABB(tmp));
  box.expandByScalar(0.6);
  const centre = box.getCenter(new THREE.Vector3());
  const cur = ws.camera.position.clone().sub(ws.controls.target);
  const az = Math.atan2(cur.x, cur.z || 1e-6), el = THREE.MathUtils.degToRad(elevation);
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const r = ws.renderer.domElement.getBoundingClientRect();
  const Wpx = Math.max(1, r.width), Hpx = Math.max(1, r.height), insetLeft = leftBar?.isOpen ? 300 : 0;
  const visW = Math.max(100, Wpx - insetLeft), visH = Math.max(100, Hpx - FLOWBAR_PX);
  const persp = ws.controls.perspective || ws.camera;
  const cam = new THREE.PerspectiveCamera(persp.fov || 42, Wpx / Hpx, 0.1, 1000);
  const corners = []; for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  const ndc = new THREE.Vector3();
  const extents = (d) => { cam.position.copy(centre).addScaledVector(dir, d); cam.lookAt(centre); cam.updateMatrixWorld(); cam.updateProjectionMatrix(); let x0 = 1, x1 = -1, y0 = 1, y1 = -1; for (const c of corners) { ndc.copy(c).project(cam); x0 = Math.min(x0, ndc.x); x1 = Math.max(x1, ndc.x); y0 = Math.min(y0, ndc.y); y1 = Math.max(y1, ndc.y); } return { pxW: (x1 - x0) / 2 * Wpx, pxH: (y1 - y0) / 2 * Hpx }; };
  let dist = Math.max(8, box.getSize(new THREE.Vector3()).length());
  for (let i = 0; i < 5; i++) { const e = extents(dist); dist = THREE.MathUtils.clamp(dist * Math.max(e.pxW / (visW * fill), e.pxH / (visH * fill)), 6, ws.controls.maxDistance || 240); }
  // centre the box in the visible area: shift the target towards the rail and the flow bar
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize(), up = new THREE.Vector3().crossVectors(dir, right).normalize();
  const halfH = dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), halfW = halfH * (Wpx / Hpx);
  const target = centre.clone().addScaledVector(right, -(insetLeft / 2) / Wpx * 2 * halfW).addScaledVector(up, -(FLOWBAR_PX / 2) / Hpx * 2 * halfH);
  const position = target.clone().addScaledVector(dir, dist);
  ws.flyTo(position, target, duration);
  return { distance: dist, position, target };
}
/** Frame the hub nodes for a flow: stacked flows from the higher elevation, the rest through host.ui.frameBlocks. */
export function frameFlow(host, flowId, blocks, opts = {}) {
  return STACKED.includes(flowId) ? frameFrom(host, blocks, opts) : host.ui.frameBlocks(blocks, { fill: 0.94, ...opts });   // the arc fills the view so a 21-page hub frames under the LOD distance
}

const str = (v) => String(v ?? '').trim();
/** The client key of a hub node: page → client, blueprint → slug, section → client. */
export const clientKeyOf = (n) => (n.typeId === 'hub-blueprint' ? blueprintSlug(n.params) : str(n.params?.client));

export function arrangeFlow(host, flowId, { client = null, frame = true, duration = 0.45 } = {}) {
  const proto = typeof window !== 'undefined' ? window.__proto : null;
  const flow = flowById(flowId);
  if (!proto || !flow) return null;
  const { world, history } = proto;
  const nodes = world.nodes.filter((n) => isHubNode(n) && n.visible !== false && (!client || clientKeyOf(n) === client));
  if (!nodes.length) { host.ui.toast('No hub nodes to arrange — load a demo from the Hubs menu'); return null; }
  const items = nodes.map((n) => ({ uid: n.uid, type: n.typeId, params: n.params, width: n.width * (n.scale?.x || 1), height: n.height * (n.scale?.x || 1) }));
  const map = layoutFlow(flow.id, items);
  const b = layoutBounds(map);
  const cx = nodes.reduce((s, n) => s + n.position.x, 0) / nodes.length, cz = nodes.reduce((s, n) => s + n.position.z, 0) / nodes.length;
  const dx = cx - b.cx, dz = cz - b.cz;
  // y: the flow gives the base elevation; the block's origin is its centre, the floor gap 0.4 as the example builder uses
  const positions = nodes.map((n) => { const p = map.get(n.uid); return [+(p.x + dx).toFixed(3), +(p.y + (n.height * (n.scale?.x || 1)) / 2 + 0.4).toFixed(3), +(p.z + dz).toFixed(3), p.ry]; });
  const before = nodes.map((n) => [...n.position.toArray(), n.rotation?.y || 0]);
  const after = () => { if (frame) frameFlow(host, flow.id, nodes); };
  const cmd = {
    label: `Arrange · ${flow.label} (${nodes.length})`, nodes,
    do: () => tweenNodes(nodes, positions, { duration, world, onDone: after }),
    undo: () => tweenNodes(nodes, before, { duration, world, onDone: after }),
  };
  history.execute(cmd);
  return { flow, nodes, positions };
}
