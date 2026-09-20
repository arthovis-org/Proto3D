// lod.js — level of detail by camera distance. Beyond `sizes.lod.far` nodes drop port labels
// and footers and grow their title, connections thin out, group titles enlarge. Hysteresis
// keeps the switch from flickering; the blocks themselves animate the crossfade.
// The same pass fits face resolution: it measures how many device pixels one world unit covers at
// each block's distance and asks the block to re-bake its canvas surfaces when the tier changes
// (face-canvas.js), nearest faces first and only a few blocks per frame.
import * as THREE from 'three';
import { sizes } from './theme.js';

const _m = new THREE.Vector3();
const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _box = new THREE.Box3();
export function updateLOD(world, camera, dt, renderer = null) {
  const far = sizes.lod.far, hys = sizes.lod.hysteresis;
  const cam = camera.position;
  for (const n of world.nodes) {
    const d = cam.distanceTo(n.position);
    const level = n.lod ? (d < far - hys ? 0 : 1) : (d > far + hys ? 1 : 0);
    n.setLOD(level, d);
  }
  if (renderer) fitFaceResolutions(world, camera, renderer);
  for (const c of world.connections) {
    c.midpoint(_m);
    const d = cam.distanceTo(_m);
    c.setFar(c.far ? d > far - hys : d > far + hys);
  }
  for (const g of world.groups) {
    const d = cam.distanceTo(g.center);
    g.setFar(g.far ? d > far - hys : d > far + hys, d);
  }
}
/** Device pixels one world unit covers at distance `d` (perspective) or anywhere (orthographic). */
export function pixelsPerUnit(camera, renderer, d) {
  const H = renderer.domElement.height || 1;   // drawing-buffer height: css px × pixel ratio
  if (camera.isOrthographicCamera) return H * (camera.zoom || 1) / Math.max(1e-6, camera.top - camera.bottom);
  return H / (2 * Math.max(d, 1e-3) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}
/**
 * Face resolution: rank blocks with canvas surfaces by how many device pixels a logical face pixel
 * covers; the nearest on-screen ones may go up to `maxScale`, the next few up to 2×, everything
 * else (and every far or off-screen face) stays at 1× or below. `rebakesPerFrame` bounds the work.
 */
function fitFaceResolutions(world, camera, renderer) {
  const F = sizes.face;
  _frustum.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const list = [];
  for (const n of world.nodes) {
    if (!n.face && !n.def?.body3d) continue;
    const onScreen = n.visible && !n.lod && _frustum.intersectsBox(n.getAABB(_box));
    const ratio = pixelsPerUnit(camera, renderer, n.lodDistance) * (n.scale.x || 1) / F.pxPerUnit;
    list.push({ n, ratio, onScreen });
  }
  list.sort((a, b) => b.ratio - a.ratio);
  let budget = F.rebakesPerFrame, rank = 0;
  for (const { n, ratio, onScreen } of list) {
    let allowance = 1;
    if (onScreen) { allowance = rank < F.nearBudget[0] ? F.maxScale : rank < F.nearBudget[1] ? 2 : 1; rank++; }
    if (n.fitFaceResolution(ratio, allowance) && --budget <= 0) break;
  }
}
/** Distance from the camera to the nearest node (workspace panel readout). */
export function nearestDistance(world, camera) {
  let best = Infinity;
  for (const n of world.nodes) best = Math.min(best, camera.position.distanceTo(n.position));
  return best;
}
